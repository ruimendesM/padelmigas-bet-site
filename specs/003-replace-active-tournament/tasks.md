---

description: "Task list for feature 003 — replace active tournament"
---

# Tasks: Replace Active Tournament

**Input**: Design documents from `/specs/003-replace-active-tournament/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: required by the constitution — failing unit tests before `core/replacement` (100% branch),
and a contract test per new route and per changed failure shape.

## Phase 1: Setup

- [ ] T001 Write migration `supabase/migrations/0007_tournament_replacement.sql` (columns, constraints, rollback block) per data-model.md
- [ ] T002 Add `tournaments` column handling to the contract-test harness reset order if needed in `tests/contract/harness.ts`

## Phase 2: Foundational

- [ ] T003 Add `NOT_REPLACEABLE` to `ERROR_CODES` in `packages/contracts/src/common.ts` and map it to 409 in `packages/core/src/errors.ts`
- [ ] T004 Add optional `invalidation` to `tournamentSummary`, `includeInvalidated` to `tournamentListQuery`, and `replacementPreview` in `packages/contracts/src/tournaments.ts`
- [ ] T005 Register `previewReplacement` and `replaceTournament` in `packages/contracts/src/endpoints.ts`
- [ ] T006 Add `invalidatedAt` and `replacedById` to `Tournament` in `packages/core/src/domain/index.ts`; map them in `packages/db/src/mappers.ts` and select them everywhere tournaments are read in `packages/db/src/*.ts`
- [ ] T007 Write failing tests, then make `core/window` treat an invalidated tournament as closed in `packages/core/src/window/`
- [ ] T008 Write failing tests, then add `liveSuccessor` to `isRevealed` (invalidated ⇒ revealed only when live successor closed; fail closed without one) in `packages/core/src/reveal/`

## Phase 3: User Story 1 — Replace a tournament (P1) 🎯 MVP

**Goal**: organiser previews and confirms a replacement; original becomes invalidated at a derived slug; replacement live at original slug.

**Independent test**: contract test replacing a two-group tournament; original slug serves the replacement, derived slug serves the invalidated original.

- [ ] T009 [P] [US1] Write failing unit tests for `planCarryOver` and `invalidatedSlug` in `packages/core/src/replacement/replacement.test.ts`
- [ ] T010 [US1] Implement `packages/core/src/replacement/index.ts`, export from `packages/core/src/index.ts`, add to coverage `include` in `vitest.config.ts`
- [ ] T011 [US1] Extend ports in `packages/core/src/ports/index.ts`: `TournamentRepository.replace`, `findLiveSuccessor`, `countInvalidatedSlugs` equivalent inside `replace`
- [ ] T012 [US1] Implement `replace()` (lock original FOR UPDATE, re-check open, rename slug, insert replacement, copy carried ballots, set invalidation) and `findLiveSuccessor()` in `packages/db/src/tournaments.ts`
- [ ] T013 [US1] Implement `previewReplacement` and `replaceTournament` handlers in `packages/api/src/handlers/replace-tournament.ts`; export from `packages/api/src/index.ts`
- [ ] T014 [P] [US1] Add route files `apps/web/app/api/v1/admin/tournaments/[slug]/replace/route.ts` and `.../replace/preview/route.ts`
- [ ] T015 [US1] Regenerate client and OpenAPI (`pnpm generate:client`, `pnpm generate:openapi`)
- [ ] T016 [US1] Admin UI: replace-target selector (open tournaments), replacement preview with per-group carry-over badges, confirm in `apps/web/app/admin/page.tsx`; copy in `apps/web/src/i18n/pt.ts` and `en.ts`
- [ ] T017 [US1] Contract tests in `tests/contract/admin-replace.test.ts`: success shape, slug takeover, derived slug, `NOT_FOUND`, `NOT_REPLACEABLE` (closed and already invalidated), `NOT_CONFIRMED`, lineup validation failure leaves original untouched, `UNAUTHORISED`

## Phase 4: User Story 2 — Keep votes on unchanged groups (P1)

**Goal**: ballots on unchanged groups count in the replacement; voters see their own ballot; changed groups start at zero.

**Independent test**: after replacement, voter of group A sees `hasVoted` + results on A and a form on B; A's counts match the original.

- [ ] T018 [US2] Ballot insert takes `FOR SHARE` on the tournament row and returns a `closed` outcome when invalidated or past start, in `packages/db/src/ballots.ts` and `BallotInsertOutcome` in `packages/core/src/ports/index.ts`
- [ ] T019 [US2] Map the `closed` outcome to `VOTING_CLOSED` in `packages/api/src/handlers/cast-ballot.ts`
- [ ] T020 [US2] Contract tests in `tests/contract/admin-replace.test.ts`: carried ballots, identical percentages, pair order/points change still carries, label-mismatch restarts, voter can vote on changed group, ballot on invalidated group → `VOTING_CLOSED`

## Phase 5: User Story 3 — See what was replaced (P2)

**Goal**: invalidated tournament hidden from landing, listed in history with badge + link, results withheld until successor closes, excluded from player history.

**Independent test**: list, detail, results and player endpoints after a replacement.

- [ ] T021 [US3] `includeInvalidated` filter and `invalidation` data (direct replacement slug/name) in `packages/db/src/tournament-list.ts`; pass through `packages/api/src/handlers/list-tournaments.ts`
- [ ] T022 [US3] Invalidation DTO and successor-aware reveal in `packages/api/src/views.ts`, `get-tournament-detail.ts`, `get-group-results.ts`
- [ ] T023 [US3] Exclude invalidated tournaments in `packages/db/src/history.ts`
- [ ] T024 [US3] Public pages: badge + link + withheld note on `apps/web/app/(public)/torneios/[slug]/page.tsx` and `historico/page.tsx`; history passes `includeInvalidated: true` via `apps/web/src/server/page-data.ts`
- [ ] T025 [US3] Contract tests: list hides/includes invalidated, detail carries `invalidation`, results withheld then revealed after successor closes, player history excludes invalidated

## Phase 6: Polish

- [ ] T026 Run gates: `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm openapi:check`, `pnpm migrations:check`, `pnpm test:unit:coverage`, `pnpm test:contract`
- [ ] T027 Walk quickstart.md manual steps against the running app

## Dependencies

- Phase 2 blocks everything. US1 blocks US2 and US3 (both need a replacement to exist). US2 and US3 are independent of each other.

## Parallel opportunities

- T009 alongside T011; T014 alongside T013 once contracts exist; T021–T023 in parallel.

## Implementation strategy

MVP = Phases 1–4 (replacing with vote carry-over is what fixes the live problem). Phase 5 hardens the public record and the reveal guarantee; ship it in the same PR because FR-213 protects an existing guarantee.
