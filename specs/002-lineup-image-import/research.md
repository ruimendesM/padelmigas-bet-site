# Phase 0 Research: Lineup Image Import

Every unknown in the plan's Technical Context is resolved here. Nothing below is left as
NEEDS CLARIFICATION.

## D1 — Extraction engine

**Decision**: Google Gemini Flash, free tier, called over plain HTTPS with the platform `fetch`
against the `generateContent` REST endpoint, with a response schema constraining the model to a JSON
array of rows. No SDK is added; the request is a JSON body containing the image as inline base64 data
plus a short instruction.

**Rationale**: the input is a dense table of Portuguese names and adjacent numeric columns, which is
exactly where plain OCR fails. A vision model that can be handed an explicit output schema returns
the column association directly instead of leaving it to be re-derived from loose text. The free tier
comfortably covers a handful of imports per month, and the image's contents — names, clubs, ranking
points — are already published on the club's ranking sheet, so no unpublished data is disclosed.
Adding no SDK keeps the dependency to one outbound URL, which is what makes the swap in D2 cheap.

**Alternatives considered**:

- **tesseract.js in-process** — free, offline, deterministic, no key. Rejected: returns unstructured
  text, so the six-column layout must be recovered by heuristics, and it misreads accented names
  (`Paupério`, `Corte-Real`) and confuses digits in adjacent numeric columns often enough that the
  organiser would end up proof-reading every cell — the exact cost the feature exists to remove.
  Retained as a possible second adapter later, behind the same port.
- **Local VLM via Ollama on the VPS** (Qwen2.5-VL, Llama 3.2 Vision) — free, private, no third party.
  Rejected: needs roughly 8 GB of resident RAM on a small single-purpose VPS plus a second service to
  supervise, and takes tens of seconds per image against SC-102's ten-second target.
- **Groq / Mistral / Cloudflare Workers AI free tiers** — comparable shape, weaker table fidelity in
  the free models, and Cloudflare's smallest models in particular. Kept as fallbacks, not chosen.
- **OpenRouter `:free` models** — rejected: which free vision models exist there changes over time,
  so the behaviour of a committed contract would drift underneath it.
- **Paste tabular text instead of an image** — genuinely cheaper (the source *is* a spreadsheet, so
  a copy gives TSV). Rejected as the sole path because the organiser frequently receives only a
  screenshot, from a chat app, with no sheet behind it. Nothing here prevents adding a TSV paste path
  later; it would share the same draft table and normalisation.

## D2 — Where the vendor lives

**Decision**: a `LineupImageReader` port in `packages/core/src/ports/index.ts`, with its single
implementation in `apps/web/src/server/lineup-image-reader.ts`, wired into `Deps` by
`apps/web/src/server/deps.ts`.

**Rationale**: Principle II. `packages/core` may not import a vendor; `packages/api` receives
capabilities through `Deps`; the host assembles them. This is the same seam `RankingSource` uses for
the ranking CSV. The port is deliberately narrow — one method, `read(image) → RawExtractedRow[]` —
so swapping to tesseract.js or a local VLM is one new file plus one line in `deps.ts`, with no
change to the contract, the handler, the core module, or the UI.

**Alternatives considered**:

- **Implementation in `packages/db`**, matching where `createRankingSource` lives. Rejected: that
  adapter belongs there because it also *stores* snapshots; this one persists nothing, and putting a
  vision provider inside the data package would misfile it.
- **A new `packages/vision` workspace package**. Rejected by Principle V: a package for one file with
  one consumer. If a second host ever needs it, promoting the file is trivial.
- **Calling the provider from the route handler**. Rejected: business capability in an adapter,
  directly against Principle II, and untestable without network.

## D3 — Best-effort versus all-or-nothing extraction

**Decision**: return every row the reader produced, with per-value flags (`MISSING_NAME`,
`MISSING_POINTS`, `MISSING_CLUB`, `TOTAL_MISMATCH`) and row-set warnings (`NO_ROWS_FOUND`,
`ODD_ROW_COUNT`). Never repair: a mismatched total is kept as read, an unreadable value stays empty,
an unreadable row still appears.

**Rationale**: FR-105 – FR-108. A single misread digit forcing a re-upload would make the feature
unpleasant for the exact images it exists to handle. Silent repair is worse than either: it is the
constitution's "fail loudly, never guess" rule inverted, and it hides a misread behind a plausible
number. Flags make the correction targeted — the organiser looks at four cells rather than seventy —
and the mandatory preview remains the actual gate.

**On `TOTAL_MISMATCH` specifically**: the value read from the image wins, and the mismatch is a
warning rather than a block. The sheet's own total column is what the club seeds by, and it can
legitimately differ from the sum when the sheet was edited by hand. Recomputing it would silently
change the seeding order.

**Alternatives considered**: reject the whole upload on any inconsistency (simpler contract, worse
for real screenshots); auto-repair silently (rejected as above).

## D4 — Transport for the image

**Decision**: `POST /api/v1/admin/tournaments/extract` with a JSON body carrying
`{ image: { mimeType, dataBase64 } }`. Cap at 5 MB decoded — roughly 6.9 MB of base64 — checked
against the declared size before decoding, and again after. Accepted types: `image/png`,
`image/jpeg`, `image/webp`.

**Rationale**: JSON keeps the route identical in shape to every other `/api/v1` route, keeps the
generated client and OpenAPI generation working with no special-casing, and lets the body be
described by a Zod schema like everything else (Principle III). `multipart/form-data` would buy a
~33% smaller payload at the cost of a bespoke parse path in the one place the contract is meant to be
uniform; a 5 MB screenshot is not a size where that trade pays. The cap and type check run in the
handler *before* the reader is called, so an oversized upload never reaches the provider.

**Alternatives considered**: multipart upload (rejected above); a two-step signed-upload-then-extract
flow (rejected outright — it would require storing the image, contradicting FR-118).

## D5 — Optional configuration and failure vocabulary

**Decision**: `GEMINI_API_KEY` is **optional** in `apps/web/src/env.ts`; `GEMINI_MODEL` is optional
with a default. `Deps.imageReader` is optional. Three new error codes:

| Code | Meaning | HTTP |
|---|---|---|
| `PAYLOAD_TOO_LARGE` | Upload exceeds the cap, or the declared type is not accepted | 413 / 400 |
| `EXTRACTION_UNAVAILABLE` | No reader is configured — no key present | 503 |
| `EXTRACTION_FAILED` | The reader was called and did not produce usable output: upstream error, timeout, non-JSON response, or a response failing the row schema | 502 |

**Rationale**: FR-119 requires the organiser to be able to tell "extraction is turned off" from "the
image could not be read", because the remedies differ — configure a key versus try another image.
FR-120 requires the product to work fully with no key at all, which forbids making the key a startup
requirement. A missing key must be a clean 503 with copy, never a 500.

**Alternatives considered**: one generic `EXTRACTION_FAILED` for both (rejected — the organiser
cannot act on it); making the key required at startup (rejected — breaks FR-120 and any self-host
that does not want the feature).

## D6 — Timeout and retry

**Decision**: a single attempt with a 15-second `AbortController` timeout in the reader; no retry, no
backoff, no queue. A timeout surfaces as `EXTRACTION_FAILED`, and the organiser may upload again.

**Rationale**: SC-102 allows ten seconds to a visible draft or a clear "unavailable"; a retry would
double the worst case past that. With one organiser and a handful of imports a month, a manual retry
is the correct retry policy, and Principle V forbids the queue that a fancier one would want. The
same pattern the ranking source already uses (`AbortController`, fail rather than degrade).

## D7 — Where draft state lives

**Decision**: draft state transitions — editing a cell, clearing a flag when a value becomes valid,
reordering by total points descending, checking completeness, and serialising to the existing lineup
payload — are pure functions in `packages/ui-logic/src/lineup-draft.ts`. The React components hold
only the state object and render it.

**Rationale**: Principle II's last clause: UI logic shared with a future mobile client lives in
`packages/ui-logic` as pure functions with no DOM access. It also makes the interesting behaviour —
FR-109's flag clearing, FR-110's completeness refusal, the reorder — unit-testable without rendering
anything.

**Alternatives considered**: keeping the logic inside the admin page component (rejected: not
portable, and it grows an already-316-line file); a client-side store library (rejected by
Principle V — this is one object and a handful of transitions).

## D8 — Draft persistence

**Decision**: the draft is client-side only. Nothing is written server-side between the extract call
and the existing preview call. Leaving the page discards it, with a browser warning first (FR-121).

**Rationale**: persisting a draft would mean a table, a migration, a lifecycle and a cleanup policy
for a workflow that lasts two minutes and happens monthly — the Principle V case against it writes
itself. FR-118's "the image leaves no trace" argues the same way for what is derived from it.

## D9 — Prompt and response shape given to the model

**Decision**: the instruction and the response schema handed to the provider are committed as
[`contracts/extraction-prompt.md`](./contracts/extraction-prompt.md), not buried in the adapter as a
string literal. The model is told: one object per table row; return the values as read, never
compute a missing one; use `null` for anything unreadable; do not reorder; do not translate names.

**Rationale**: the prompt is the real contract with the provider — it is what makes the output map
onto `RawExtractedRow`. Reviewing it as a document is how it stays honest about "never guess", and
committing it means a change to extraction behaviour is a visible diff rather than an invisible
tweak. `null`-for-unreadable is what makes D3's flags possible: a model that invents a plausible
number produces an unflaggable error.

## D10 — Testing without the network

**Decision**: no test calls the real provider. Unit tests exercise `normalizeExtraction` against
hand-written raw rows. The contract test installs a stub `imageReader` through the existing `setDeps`
seam and drives every documented failure code, including "no reader configured" for
`EXTRACTION_UNAVAILABLE`. The E2E test stubs the route's upstream and uses a committed fixture image.

**Rationale**: the constitution's contract-test rule asks for every documented failure shape to be
reachable, which a live provider cannot deliver on demand. A network-free suite also keeps CI free of
an API key. The accuracy claim in SC-103 is validated manually against real screenshots in
[`quickstart.md`](./quickstart.md), not asserted in CI, since it is a property of the provider rather
than of this code.
