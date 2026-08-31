# ADR-011: Gemini Flash Behind a `LineupImageReader` Port for Lineup Image Extraction

## Status
Accepted — 2026-08-31. Supports feature 002 (`specs/002-lineup-image-import/`).

## Context
The organiser receives a tournament lineup as a screenshot of a spreadsheet — one row per pair, with
both player names, both players' ranking points, the pair's total and the club, headed in Portuguese
(`Jogador 1`, `PTS J1`, `Pontos Total`, `Clube`) or not headed at all. Today they transcribe it into
a structured payload by hand: for twelve pairs that is twenty-four names and thirty-six numbers, and
it is the likeliest source of Risk R9 — a wrong lineup on a public page.

Reading that table needs something that can see. Nothing in the current stack can, and the
constitution forbids adding a hosted service without recording the alternative that was rejected
(Principle V). Two properties of the input shape the decision: the table is dense with adjacent
numeric columns and accented Portuguese names, where plain OCR is weakest; and every value in it is
already published on the club's ranking sheet, so sending the image out discloses nothing new.

## Decision
Extraction enters the system as a **port**, `LineupImageReader`, declared in
`packages/core/src/ports/index.ts` beside `RankingSource`. It has one method, `read(image)`, returning
raw rows in which every field is nullable.

Its single implementation calls **Google Gemini** (free tier) over plain `fetch` against the REST
`generateContent` endpoint, with a structured-output schema. No SDK is added.

The model is a **lite, non-reasoning** one — `gemini-3.5-flash-lite` at the time of writing. Measured
on a twelve-row lineup screenshot with the committed prompt: the lite model read all seventy-two
cells correctly in 2.9–3.0 s across four runs, while `gemini-3.6-flash` was exactly as accurate and
took 13 s, 54 s, then over 90 s on three consecutive runs, spending some 1500 thought tokens
deliberating over a transcription. Reading a table is not a reasoning task, and SC-102 allows ten
seconds to a visible draft, so the deliberation buys nothing and costs the budget. `GEMINI_MODEL`
overrides the default; the measurements sit next to it in the adapter, and changing it means
re-measuring. That
implementation lives in `apps/web/src/server/lineup-image-reader.ts` and is the only file in the
repository that names a vision provider; it is reached only through `Deps`.

Three rules bind it:

1. **Never guess.** The instruction and response schema — committed as
   `specs/002-lineup-image-import/contracts/extraction-prompt.md` rather than embedded as a string
   literal — require `null` for anything unreadable, forbid computing a missing total, and forbid
   reordering, merging or inventing rows. Everything downstream is pure: `normalizeExtraction` in
   `packages/core/src/lineup-extraction` flags suspect values rather than repairing them.
2. **Suggestion, never authority.** Nothing extraction returns is trusted. The mandatory
   preview-then-publish flow re-validates the submitted draft exactly as it does a hand-typed one,
   and no path from the extraction endpoint writes to the database.
3. **Optional configuration.** `GEMINI_API_KEY` is optional. With no key the app is fully
   functional: the endpoint answers `EXTRACTION_UNAVAILABLE` and hand entry is untouched.

The ranking list is **never** sent to the provider as context.

## Consequences

### Positive
- The organiser types two values instead of sixty to publish a tournament.
- The provider is one file behind a one-method port, so swapping it — to tesseract.js, a local VLM,
  or another hosted model — is a new file plus a line in `deps.ts`, with no change to the contract,
  the handler, the core module or the UI.
- No new runtime dependency in `package.json`, no new workspace package, no migration, no stored
  image, no server-side draft.
- The prompt is a reviewable document, so a change in extraction behaviour is a visible diff.
- CI needs no API key: unit tests use hand-written raw rows, contract and E2E tests stub the reader.

### Negative
- A third party sees the uploaded image. Accepted because its contents are already public on the
  ranking sheet — and only such images may be uploaded. Free-tier terms may allow the provider to
  train on inputs; for already-published names and points this is not a disclosure.
- Output is non-deterministic. Contained by the mandatory preview, by flagging rather than repairing,
  and by exact-name resolution against the ranking sheet, which fails loudly on anything unmatched.
- Extraction can be rate-limited or unreachable, which is why "unavailable" is a first-class state
  with its own error code rather than a failure mode.
- Model ids are retired. `gemini-2.0-flash`, the id chosen when this was written, returned 404 within
  days. The failure is a clean `EXTRACTION_FAILED` with `upstream-status-404` in the server log and
  the remedy is one environment variable — but it will recur, and it is the maintenance cost this
  decision accepts.
- A future standalone API host would have to re-provide the adapter file, since it lives in the web
  host rather than a shared package. Accepted: it is one file, and it is a host capability.

## Alternatives rejected

- **tesseract.js, in-process OCR.** Free, offline, deterministic, no key. Rejected: it returns
  unstructured text, so the six-column layout must be recovered by heuristics, and it misreads
  accented names (`Paupério`, `Corte-Real`) and confuses digits between adjacent numeric columns
  often enough that the organiser would proof-read every cell — the exact cost this feature exists to
  remove. Still reachable later as a second adapter behind the same port.
- **A local vision model on the VPS** (Ollama with Qwen2.5-VL or Llama 3.2 Vision). Free and private.
  Rejected: roughly 8 GB of resident RAM on a small single-purpose VPS, a second service to
  supervise, and tens of seconds per image against a ten-second target (SC-102).
- **Other free tiers** — Groq, Mistral Pixtral, Cloudflare Workers AI. Comparable shape, weaker table
  fidelity in their free models. Kept as fallbacks rather than chosen.
- **OpenRouter `:free` models.** Rejected: which free vision models exist there changes over time, so
  committed behaviour would drift underneath the contract.
- **Pasting tabular text instead of an image.** Genuinely cheaper — the source is a spreadsheet, so a
  copy yields TSV. Rejected as the *only* path because the lineup frequently arrives as a screenshot
  from a chat app with no sheet behind it. Nothing here blocks adding a TSV path later; it would share
  the same draft table and the same normalisation.
- **Requiring the API key at startup.** Rejected: it would make a feature used a few times a month a
  precondition for the whole app, and break FR-120.
- **Persisting the image or the draft.** Rejected: a table, a migration, a lifecycle and a cleanup
  policy for a workflow that lasts two minutes and happens monthly.

## Relationship to other decisions
- **ADR-001** (portable core, thin adapters): this is the pattern applied to a vendor that cannot live
  in `core`.
- **ADR-002** (Next.js route handlers as API host): the adapter is host plumbing, assembled in
  `deps.ts` like every other capability.
- **ADR-007** (player identity): unchanged and deliberately untouched. Extraction supplies no external
  id and the ranking list is never given to the model, because letting it snap a misread name onto a
  real person is precisely the failure ADR-007 exists to prevent.
