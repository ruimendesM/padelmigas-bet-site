---

description: "Task list for Lineup Image Import"
---

# Tasks: Lineup Image Import

**Input**: Design documents from `/specs/002-lineup-image-import/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are included and are **not optional here** — the constitution requires
test-first development with 100% branch coverage for core modules, and a contract test per
documented failure code. Both apply to this feature.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested and
delivered on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: The user story the task serves (US1, US2, US3)
- Every task names the exact file it touches

## Path Conventions

Existing pnpm/turbo monorepo: `packages/{contracts,core,api,db,client,ui-logic}`, `apps/web`,
`tests/contract`, `apps/web/tests/e2e`. Paths below are repository-relative and match the Source Code
tree in [plan.md](./plan.md).

---

## Phase 1: Setup

**Purpose**: configuration and the decision record, both prerequisites for reviewing anything else.

- [ ] T001 Add `GEMINI_API_KEY` and `GEMINI_MODEL` as **optional** server-only variables in `apps/web/src/env.ts`, keeping the existing fail-fast behaviour for required variables untouched — a missing key must leave the app fully functional (FR-120, research D5)
- [ ] T002 [P] Document both variables under a new `# --- Lineup image extraction (FR-101) ---` section in `.env.example`, marking them optional and stating that the key is server-only and never `NEXT_PUBLIC_`
- [ ] T003 [P] Write `docs/adr/ADR-011-vision-extraction-provider.md`: the Gemini Flash free-tier choice, the `LineupImageReader` port that makes it swappable, the rejected alternatives from research D1 (tesseract.js, local VLM, other free tiers, TSV paste), and the privacy position — only data already public on the ranking sheet is ever sent, and the ranking list itself never is

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract and the seam. Principle III requires schemas before handlers, and no story
can be built before the port and the DTOs exist.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [ ] T004 Add `PAYLOAD_TOO_LARGE`, `EXTRACTION_UNAVAILABLE` and `EXTRACTION_FAILED` to `ERROR_CODES` in `packages/contracts/src/common.ts`, in a new commented group for lineup image extraction
- [ ] T005 Add the extraction schemas to `packages/contracts/src/tournaments.ts`: `lineupImage` (mimeType enum of `image/png`·`image/jpeg`·`image/webp`, `dataBase64`), `extractLineupBody`, `extractionFlag` enum, `extractionWarning` enum, `extractedRow`, and `lineupExtraction` — shapes exactly per [data-model.md](./data-model.md)
- [ ] T006 Register the `extractLineup` endpoint in `packages/contracts/src/endpoints.ts` — `POST /admin/tournaments/extract`, `auth: 'organiser'`, `tag: 'admin'`, `successStatus: 200`, `voterDependent: false`, `errors` listing all five documented codes, `requirements: ['FR-101','FR-102','FR-105','FR-106','FR-107','FR-108','FR-116','FR-117','FR-118','FR-119']`
- [ ] T007 Regenerate the client and the OpenAPI document with `pnpm generate:client && pnpm generate:openapi`, and confirm `pnpm openapi:check` passes with the new endpoint present in `specs/001-group-standings-voting/contracts/openapi.yaml`
- [ ] T008 [P] Declare the `LineupImageReader` port and the `RawExtractedRow` type in `packages/core/src/ports/index.ts`, next to `RankingSource`, with the "never guess, `null` instead" contract stated in the doc comment (research D9)
- [ ] T009 [P] Add `readonly imageReader?: LineupImageReader` to `Deps` in `packages/api/src/handler.ts`, documenting that its absence is a supported deployment state, not an error
- [ ] T010 Add `packages/core/src/lineup-extraction/**/*.ts` to the coverage `include` list in `vitest.config.ts` with the existing 100% thresholds — the file's own comment warns that changing this list is a policy change, so state the reason in the commit

**Checkpoint**: contract published, seam declared. Stories can begin.

---

## Phase 3: User Story 1 — Import a lineup from a screenshot (Priority: P1) 🎯 MVP

**Goal**: an organiser uploads a screenshot and reaches a complete, ready-to-preview draft having
typed only the tournament name and the start time.

**Independent Test**: upload a legible twelve-pair screenshot; twelve rows appear with both names,
both point values, the total and the club, ordered by total descending; only Nome and Início are
empty; preview and publish behave exactly as for a hand-typed lineup.

### Tests for User Story 1 ⚠️ write first, watch them fail

- [ ] T011 [P] [US1] Write `packages/core/src/lineup-extraction/normalize.test.ts` covering the happy path: trimming, NFC normalisation, whitespace collapsing, ordering by total descending, rows without a total placed last, `sourceIndex` preserved through the sort
- [ ] T012 [P] [US1] Write `packages/ui-logic/src/lineup-draft.test.ts` for the draft transitions used by this story: `editCell`, `addRow`, `removeRow`, and `toLineupPayload` producing the existing `lineupPayload` shape with a UTC instant, no `slug`, no `group` labels and no external ids (FR-113, FR-114)
- [ ] T013 [US1] Write `tests/contract/admin-extract-lineup.test.ts` asserting the documented success shape against a stubbed `imageReader` installed through `setDeps`, plus the `UNAUTHORISED` and `MALFORMED_PAYLOAD` failures — `UNAUTHORISED` asserted for an unparseable body too, proving the guard runs before the body is read

### Implementation for User Story 1

- [ ] T014 [US1] Implement `normalizeExtraction` in `packages/core/src/lineup-extraction/index.ts` — normalisation, ordering and `sourceIndex` preservation. Flags land in US2; leave the flag array empty here and do not stub anything the tests do not require
- [ ] T015 [P] [US1] Implement the pure draft transitions in `packages/ui-logic/src/lineup-draft.ts` and export them from `packages/ui-logic/src/index.ts`
- [ ] T016 [US1] Implement `packages/api/src/handlers/extract-lineup.ts`: reject an unaccepted mime type or an over-cap payload with `PAYLOAD_TOO_LARGE` **before** touching the reader, answer `EXTRACTION_UNAVAILABLE` when `deps.imageReader` is absent, map any reader failure to `EXTRACTION_FAILED`, then return `normalizeExtraction`'s result. Export it from `packages/api/src/index.ts`
- [ ] T017 [US1] Implement the provider adapter in `apps/web/src/server/lineup-image-reader.ts` — the only file naming Gemini. Plain `fetch` to `generateContent`, the instruction and response schema from [`contracts/extraction-prompt.md`](./contracts/extraction-prompt.md), a 15 s `AbortController` timeout, re-validation of the response against the row schema, `sourceIndex` assigned from array position, and a throw (never a partial salvage) on anything unusable (research D6, D9)
- [ ] T018 [US1] Wire the reader in `apps/web/src/server/deps.ts`: construct it only when `GEMINI_API_KEY` is present, leaving `imageReader` undefined otherwise, and keep the existing per-process caching
- [ ] T019 [US1] Add the route adapter `apps/web/app/api/v1/admin/tournaments/extract/route.ts` — `requireOrganiser` before `jsonBody`, one handler call, `respond`, no business branching (Principle II), mirroring the preview route exactly
- [ ] T020 [P] [US1] Add pt-PT and en copy for the upload control, the two required fields and the new error codes in `apps/web/src/i18n/pt.ts` and `apps/web/src/i18n/en.ts`
- [ ] T021 [US1] Build `apps/web/app/admin/lineup-upload.tsx` — file input restricted to the three accepted types, client-side size and type pre-check with the server still authoritative (FR-112), base64 encoding, busy state, and a call through the generated client, never a hand-rolled `fetch` (Principle III)
- [ ] T022 [US1] Build `apps/web/app/admin/lineup-draft-table.tsx` — editable grid over the draft rows (two names, two point values, total, club), add and remove row, driven entirely by the `packages/ui-logic` transitions. Flag rendering is US2
- [ ] T023 [US1] Wire both components into `apps/web/app/admin/page.tsx`, moving the page to orchestration only: upload replaces the draft and retracts any preview (FR-115), the draft serialises into the existing payload state, and the preview-then-publish flow below is untouched
- [ ] T024 [US1] Add the E2E happy path `apps/web/tests/e2e/import-lineup-image.spec.ts` with a committed fixture at `apps/web/tests/e2e/fixtures/lineup-12-pairs.png` and the route's upstream stubbed — upload, fill name and start time, preview, publish
- [ ] T025 [US1] Run `pnpm boundaries` and confirm the new rules-free seam holds: `packages/core` cannot reach `apps/web/src/server/lineup-image-reader.ts` via the existing `packages-no-apps` rule

**Checkpoint**: a clean screenshot publishes end to end with two typed values (SC-101, SC-106).

---

## Phase 4: User Story 2 — Correct what the image could not give (Priority: P2)

**Goal**: suspect values are marked with a stated reason, corrected in place, and never silently
repaired.

**Independent Test**: upload an image where one row's points are unreadable and another's total
disagrees with its two player values; exactly those cells are marked, with reasons; correcting them
clears the marks without re-uploading.

### Tests for User Story 2 ⚠️ write first, watch them fail

- [ ] T026 [P] [US2] Extend `packages/core/src/lineup-extraction/normalize.test.ts` to cover every flag and warning branch — `MISSING_NAME`, `MISSING_POINTS`, `MISSING_CLUB`, `TOTAL_MISMATCH`, `NO_ROWS_FOUND`, `ODD_ROW_COUNT` — including the boundaries: a total absent (no mismatch flag), a player's points absent (no mismatch flag), negative and non-finite numbers reduced to `null`, and an empty-after-trim name. This suite is what carries the module to the 100% branch threshold set in T010
- [ ] T027 [P] [US2] Extend `packages/ui-logic/src/lineup-draft.test.ts`: editing a flagged cell to a valid value clears that flag and no other (FR-109); editing a total re-sorts the rows; `isComplete` is false while any required value is empty and **true** with only a `TOTAL_MISMATCH` outstanding
- [ ] T028 [US2] Extend `tests/contract/admin-extract-lineup.test.ts` with a stub returning the imperfect fixture from [`contracts/extraction-response.example.json`](./contracts/extraction-response.example.json), asserting the flags and warnings arrive verbatim and that no value was repaired server-side (FR-107)

### Implementation for User Story 2

- [ ] T029 [US2] Implement flag and warning derivation in `packages/core/src/lineup-extraction/index.ts` per [data-model.md](./data-model.md) — total and deterministic, never repairing: a mismatched total is kept as read, an unreadable value stays `null`, an unreadable row still appears
- [ ] T030 [US2] Implement flag clearing and the completeness check in `packages/ui-logic/src/lineup-draft.ts`, with `TOTAL_MISMATCH` explicitly non-blocking (research D3)
- [ ] T031 [US2] Render flags in `apps/web/app/admin/lineup-draft-table.tsx` — the affected cell marked with its stated reason, using the i18n copy, never a raw code
- [ ] T032 [P] [US2] Render row-set warnings (`NO_ROWS_FOUND`, `ODD_ROW_COUNT`) as a banner above the table in `apps/web/app/admin/page.tsx`, distinct from per-cell marks (FR-108)
- [ ] T033 [US2] Gate the preview button on `isComplete`, naming the incomplete rows when it refuses (FR-110)
- [ ] T034 [P] [US2] Add the pt-PT and en copy for every flag, warning and refusal message in `apps/web/src/i18n/{pt,en}.ts`
- [ ] T035 [US2] Extend `apps/web/tests/e2e/import-lineup-image.spec.ts` with the correction path: a stubbed imperfect extraction, assert the marked cells, correct one, assert its mark clears, then preview and publish
- [ ] T036 [US2] Run `pnpm test:unit:coverage` and confirm `packages/core/src/lineup-extraction` reaches 100% branch, function, line and statement coverage

**Checkpoint**: imperfect screenshots are usable, and no misread can pass unmarked (SC-104).

---

## Phase 5: User Story 3 — Keep hand entry available (Priority: P3)

**Goal**: the product is fully usable with extraction switched off or broken.

**Independent Test**: with no API key configured, the app starts, every page works, the upload
control explains that extraction is unavailable, and a publish completes through hand entry.

### Tests for User Story 3 ⚠️ write first, watch them fail

- [ ] T037 [US3] Extend `tests/contract/admin-extract-lineup.test.ts` with the two remaining documented codes: `EXTRACTION_UNAVAILABLE` for `Deps` assembled without an `imageReader`, and `EXTRACTION_FAILED` for a reader that throws and for one that returns output failing the row schema — asserting neither surfaces as `INTERNAL_ERROR`
- [ ] T038 [P] [US3] Extend `tests/contract/admin-extract-lineup.test.ts` with `PAYLOAD_TOO_LARGE` for both causes — an over-cap image and an unaccepted mime type — asserting the stub reader was never called

### Implementation for User Story 3

- [ ] T039 [US3] Render the unavailable state in `apps/web/app/admin/lineup-upload.tsx`: wording distinct from a failed read (FR-119), with the hand-entry path visibly available alongside it
- [ ] T040 [P] [US3] Add pt-PT and en copy for `EXTRACTION_UNAVAILABLE`, `EXTRACTION_FAILED` and `PAYLOAD_TOO_LARGE` in `apps/web/src/i18n/{pt,en}.ts`, phrased so the organiser knows which remedy applies
- [ ] T041 [US3] Confirm the existing `apps/web/tests/e2e/publish-lineup.spec.ts` still passes unchanged, proving the hand-entry path survived the page split (FR-120)

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T042 Warn before navigating away from an unsaved draft in `apps/web/app/admin/page.tsx` (FR-121), and confirm no draft state is written server-side or to storage
- [ ] T043 Audit that the image never reaches a log or an error message: grep the adapter, the handler and the route for any logging of `dataBase64`, `mimeType` or the provider response, and confirm error issues carry no image data (FR-118, SC-107)
- [ ] T044 [P] Update `README.md` — add feature 002 to the spec-driven table, describe the image import in "How it works", and note `GEMINI_API_KEY` as optional configuration
- [ ] T045 [P] Update `specs/002-lineup-image-import/contracts/README.md` if the generated OpenAPI ended up differing from the documented request or response shape
- [ ] T046 Run every gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm boundaries && pnpm openapi:check && pnpm test:unit:coverage && pnpm test:contract && pnpm test:e2e`
- [ ] T047 Walk [quickstart.md](./quickstart.md) V1–V6 by hand against a running app, including the manual SC-103 accuracy check with three real screenshots

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs T001 for the env shape; blocks every story
- **US1 (Phase 3)**: needs Phase 2 complete
- **US2 (Phase 4)**: needs US1's `normalizeExtraction`, draft module and table component to exist
- **US3 (Phase 5)**: needs US1's handler and upload component; independent of US2
- **Polish (Phase 6)**: needs the stories that are being shipped

### User Story Dependencies

- **US1 (P1)**: independent once Phase 2 lands. Ships alone as the MVP
- **US2 (P2)**: extends US1's module and component rather than replacing them. Not independently
  shippable before US1, but independently testable and reviewable
- **US3 (P3)**: touches the upload component and the handler's absent-reader path only. Can be built
  in parallel with US2 by a second person

### Within Each Story

Tests first and failing → core (pure) → ui-logic (pure) → handler → adapter → route → components →
E2E. This is the constitution's test-first rule for core, not a preference.

### Parallel Opportunities

- T002 and T003 in Setup
- T008 and T009 in Foundational, after T004–T007
- T011 and T012 (different packages); T015 alongside T016–T019; T020 alongside any of them
- T026 and T027; T032 and T034
- US2 and US3 in parallel after US1

---

## Parallel Example: User Story 1

```text
# Tests first, three files, no shared state:
T011  packages/core/src/lineup-extraction/normalize.test.ts
T012  packages/ui-logic/src/lineup-draft.test.ts
T013  tests/contract/admin-extract-lineup.test.ts    # depends on the T005–T009 contract

# Then implementation, with the pure modules parallel to the server chain:
T014 → T015              (core, ui-logic)
T016 → T017 → T018 → T019 (handler → adapter → deps → route)
T020                     (i18n, anytime)
```

---

## Implementation Strategy

**MVP is US1 alone.** A clean screenshot becomes a published tournament with two typed values, and
that is already the entire point of the feature — it removes the transcription. Ship it, use it once
for a real tournament, and let that decide how much of US2's flagging the real screenshots actually
demand.

**US2 is what makes it safe for bad images**, and its cost is concentrated in one test file and one
component. Do not skip T036: the coverage threshold added in T010 is what stops the flag logic
drifting later.

**US3 is small and mostly copy**, but it is what keeps the deployment honest — the product must not
require an API key to function. Build it before the feature ships publicly, not after.

**Do not build**: draft persistence, retry logic, a second extraction provider, a TSV paste path, or
rate limiting beyond the organiser gate. Each was considered and rejected in
[research.md](./research.md); building one anyway is a Principle V violation and needs a spec change
first.
