# Implementation Plan: Lineup Image Import

**Branch**: `002-lineup-image-import` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-lineup-image-import/spec.md`

## Summary

The organiser uploads a screenshot of the lineup table; the server reads it once, in memory, and
returns candidate rows with suspect values flagged; the admin page renders those rows as an editable
draft table with two empty required fields — tournament name and start date/time — and the draft
feeds the existing preview-then-publish flow untouched (FR-101 – FR-121).

Technically this is one new endpoint and one new pure module. Image reading enters the system as a
port, `LineupImageReader`, declared in `packages/core/src/ports` alongside `RankingSource`. Its only
implementation calls Google Gemini Flash's REST API with `fetch` and a response schema; that file is
the one place in the repository that names a vision provider, and it lives in the host
(`apps/web/src/server/`), reached only through `Deps`. Everything downstream of the reader is pure:
`normalizeExtraction` in `packages/core/src/lineup-extraction` turns raw rows into ordered rows with
flags and holds 100% branch coverage. No migration, no new workspace package, no persistence of the
image.

## Technical Context

**Language/Version**: TypeScript 5.7, `strict: true`, Node 22, ESM

**Primary Dependencies**: existing set only — Next.js App Router (host), Zod (contracts), Vitest,
Playwright. The one new *runtime* dependency is an outbound HTTPS call to the Gemini
`generateContent` REST endpoint via the platform `fetch`; no SDK is added to `package.json`.

**Storage**: none for this feature. No table, no column, no migration. The uploaded image lives in
the request body and is never written anywhere (FR-118, SC-107).

**Testing**: Vitest unit (`core/lineup-extraction`, 100% branch), Vitest contract (the new route
against a real Postgres with a stub reader), Playwright E2E (upload → draft → preview → publish with
the reader stubbed). No test may reach the real Gemini endpoint.

**Target Platform**: the existing self-hosted Linux deployment (`deploy/padelmigas.service` behind
nginx), one Next.js process.

**Project Type**: web application in an existing pnpm/turbo monorepo — `apps/web` over
`packages/{contracts,core,api,db,client,ui-logic}`.

**Performance Goals**: draft visible within 10 s of choosing an image (SC-102), enforced by a hard
timeout in the reader adapter that converts a slow upstream into `EXTRACTION_FAILED` rather than a
held-open request.

**Constraints**: upload capped at 5 MB decoded, `image/png` · `image/jpeg` · `image/webp` only,
checked before any upstream call (FR-117). Extraction is optional configuration: with no API key the
product runs normally and the endpoint answers `EXTRACTION_UNAVAILABLE` (FR-119, FR-120). Copy is
pt-PT with en fallback, from `apps/web/src/i18n`, never hard-coded.

**Scale/Scope**: a handful of imports per month by one organiser. Roughly one new endpoint, three
new contract schemas, three new error codes, one new core module, one new handler, one adapter, one
sizeable admin-page component.

## Constitution Check

*GATE: passed before Phase 0. Re-checked after Phase 1 — see the second table.*

| Principle | At risk? | How this design satisfies it |
|---|---|---|
| **I. Spec-Driven Delivery** | No | Spec written and validated first ([spec.md](./spec.md)); this plan names no behaviour absent from it. Requirements are numbered from FR-101 so they never collide with feature 001's citations in code. |
| **II. Portable Core, Thin Adapters** | **Yes — the main risk** | A vision provider is a vendor. It enters as the `LineupImageReader` port in `packages/core/src/ports`; the pure `normalizeExtraction` module imports nothing but domain types; the handler in `packages/api` takes the reader through `Deps`; the route file parses, guards, calls one handler, serialises. The provider is named in exactly one file, `apps/web/src/server/lineup-image-reader.ts`. Existing `packages-no-apps` and `core-no-framework` rules already make a core→adapter import fail `pnpm boundaries`. |
| **III. Contract-First, Versioned API** | Yes | Zod schemas land in `packages/contracts` before the handler exists, are registered in `ENDPOINTS`, and regenerate both the client and OpenAPI. Purely additive to v1: a new route and three new error codes, nothing renamed or removed. The admin page calls it through the generated client, not `fetch`. |
| **IV. Server-Authoritative Trust Boundary** | Yes | The endpoint is `auth: 'organiser'` and guards before reading the body (FR-116). Extraction output is *suggestion only*: publication decisions stay where they are, in preview and publish, which re-validate the submitted draft exactly as for a hand-typed lineup (FR-112). The API key is server-only, never `NEXT_PUBLIC_`. The image is never persisted or logged (FR-118). |
| **V. Simplicity and YAGNI** | Yes | No queue, no cache, no background worker, no new package, no migration, no rate limiter beyond the organiser gate. One new hosted dependency, justified in Complexity Tracking with its rejected alternatives. |
| **Test-first for the core** | Yes | `core/lineup-extraction` is core logic: its tests are written before it and it holds 100% branch coverage, joining the modules named in the constitution's coverage gate. |
| **Contract tests** | Yes | The new route gets a test per documented failure code — `UNAUTHORISED`, `MALFORMED_PAYLOAD`, `PAYLOAD_TOO_LARGE`, `EXTRACTION_UNAVAILABLE`, `EXTRACTION_FAILED` — plus its success shape. |
| **Locale & time** | Yes | New copy in `pt.ts`/`en.ts`. The start-time input is entered as `Europe/Lisbon` local time and converted to a UTC instant before it reaches the payload, as today. |
| **Privacy** | Yes | The image carries only what the club already publishes — names, clubs, ranking points. No other data may be sent to the extraction provider; this is stated in the spec's Assumptions and in ADR-011. |

**Verdict: PASS.** One deviation to record — a new hosted dependency — captured in Complexity
Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/002-lineup-image-import/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── README.md
│   ├── extraction-response.example.json
│   └── extraction-prompt.md
├── checklists/
│   └── requirements.md  # written by /speckit-specify
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
packages/contracts/src/
└── tournaments.ts                     # + lineupImage, extractLineupBody, extractedRow,
                                       #   lineupExtraction schemas
    common.ts                          # + EXTRACTION_UNAVAILABLE, EXTRACTION_FAILED,
                                       #   PAYLOAD_TOO_LARGE error codes
    endpoints.ts                       # + extractLineup endpoint definition

packages/core/src/
├── ports/index.ts                     # + LineupImageReader port, RawExtractedRow type
└── lineup-extraction/
    ├── index.ts                       # normalizeExtraction — pure, 100% branch coverage
    └── normalize.test.ts              # written first

packages/api/src/
├── handler.ts                         # + imageReader?: LineupImageReader on Deps
└── handlers/extract-lineup.ts         # size/type checks, reader call, normalise, DTO

apps/web/
├── src/server/lineup-image-reader.ts  # the ONLY file that names Gemini
├── src/server/deps.ts                 # wires the reader when the key is configured
├── src/env.ts                         # + optional GEMINI_API_KEY, GEMINI_MODEL
├── src/i18n/{pt,en}.ts                # new copy: upload, flags, unavailable
├── app/api/v1/admin/tournaments/extract/route.ts   # thin adapter
├── app/admin/page.tsx                 # thinned: orchestration only
└── app/admin/                         # new components
    ├── lineup-upload.tsx              # file choose, size/type pre-check, busy state
    └── lineup-draft-table.tsx         # editable grid, flag rendering, add/remove row

packages/ui-logic/src/
└── lineup-draft.ts (+ .test.ts)       # pure draft state: edit, clear-flag-on-fix, reorder
                                       #   by total desc, completeness check, → LineupPayload

tests/contract/admin-extract-lineup.test.ts
apps/web/tests/e2e/import-lineup-image.spec.ts
apps/web/tests/e2e/fixtures/lineup-12-pairs.png

docs/adr/ADR-011-vision-extraction-provider.md
.env.example                           # + GEMINI_API_KEY (optional), GEMINI_MODEL
```

**Structure Decision**: the existing monorepo layout is kept exactly; this feature adds no workspace
package and no top-level directory. It follows the established seam — port in `core`, pure logic in
`core`, orchestration in `api`, vendor in the host, thin route adapter — which is how
`RankingSource` already handles an outbound HTTP source. The one departure from that precedent is
where the adapter lives: `RankingSource`'s implementation sits in `packages/db` because it also
persists snapshots, whereas this reader persists nothing, so putting it in `packages/db` would put a
vision provider inside the data package for no reason. It lives in `apps/web/src/server/` instead,
which the constitution permits (the host assembles `Deps`) at the cost that a future standalone API
host would re-provide that one file — the same cost as any other host-supplied capability.

`apps/web/app/admin/page.tsx` is 316 lines today and gains an upload control, a draft table and its
edit handlers. It is split as part of this work — upload and draft table become their own
components, and the draft's state transitions move to `packages/ui-logic` where a future mobile
client can reuse them and where they are testable without a DOM. That is a targeted improvement to
the file being worked in, not unrelated refactoring.

## Constitution Re-Check (post-design)

Re-run after Phase 1 produced [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/) and [quickstart.md](./quickstart.md). Nothing in the design changed a
verdict; three points are sharper than they were before:

- **Principle II held under pressure.** The design's one genuinely impure piece — the provider call —
  is a single file with a one-method port in front of it, and the prompt that shapes its output moved
  out of that file into [`contracts/extraction-prompt.md`](./contracts/extraction-prompt.md), so even
  the provider-facing behaviour is reviewable outside the adapter. `pnpm boundaries` enforces the
  seam mechanically via the existing `packages-no-apps` rule.
- **Principle IV strengthened during design.** Research D9 settled that the ranking list is never
  sent to the provider as context. Offering it would invite a misread name to be snapped onto a real
  person, which is precisely the failure FR-114 and ADR-007 exist to prevent. Exact-match resolution
  stays server-side and stays loud.
- **Principle V held.** The final design adds no package, no table, no migration, no queue, no cache
  and no retry loop (research D6: one attempt, 15 s timeout, manual retry). The single justified
  deviation is the hosted dependency below.

**Verdict: PASS.** Proceed to `/speckit-tasks`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New hosted dependency: Google Gemini Flash (free tier) for image → rows | The feature's whole value is not transcribing the lineup by hand. Reading a screenshot of a table needs a vision model; nothing in the current stack can do it. Free tier covers a handful of imports per month, and the image contains only already-published data. | **tesseract.js (local OCR)**: free and offline, but it returns unstructured text — column association must be re-derived by heuristics, and it misreads accented Portuguese names and adjacent numeric columns often enough that the organiser would proof-read every cell, which is the cost the feature exists to remove. **Local VLM (Ollama)**: free and private, but needs ~8 GB of RAM permanently resident on a small VPS plus a second service to keep alive, and tens of seconds per image against SC-102's 10 s. **Do nothing (keep hand entry)**: the status quo the spec exists to fix. The `LineupImageReader` port keeps all three reachable later as one-file swaps. |
| A second `Deps` capability that may be absent (`imageReader?`) | Extraction must be optional configuration: FR-120 requires the product to work fully with no key, and a self-hoster without one must not see a broken app. | Making it required would make the API key a startup requirement for a feature used a few times a month, and would fail the whole app on a missing optional key. The optionality is expressed once, in `Deps`, and surfaces as one documented error code. |
