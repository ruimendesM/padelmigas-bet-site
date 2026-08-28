# Tasks: Group Standings Voting

**Input**: Design documents from `/specs/001-group-standings-voting/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: REQUIRED. The constitution mandates test-first development for `packages/core/{scoring,ballot,window,matching}` with 100% branch coverage, and a contract test per `/api/v1` route covering its success shape and every documented failure code. Test tasks below are therefore not optional.

**Organization**: Tasks are grouped by user story so each story is independently implementable and testable.

**Traceability**: every task names the requirements it satisfies as `(FR-xxx)` / `(SC-xxx)`. A task with no requirement tag is tooling or governance work and says so.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = publish lineup, US2 = vote, US3 = see results, US4 = history
- Exact file paths are given in every task

## Path Conventions

Monorepo per [plan.md](./plan.md) — Project Structure. `apps/web` is the only Next.js-aware
directory; `packages/core` imports no framework and no vendor SDK; only `packages/db` constructs a
Supabase client.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace, tooling, and the gates that keep the architecture honest (governance work — no FR mapping)

- [X] T001 Create pnpm workspace root in `package.json`, `pnpm-workspace.yaml`, `turbo.json` with `typecheck`, `lint`, `test:unit`, `test:contract`, `test:e2e`, `boundaries`, `migrations:check` pipelines
- [X] T002 [P] Create shared TypeScript base config in `packages/tsconfig/base.json` with `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [X] T003 [P] Configure ESLint and Prettier in `eslint.config.js` and `.prettierrc`, including a rule banning `any` outside parse boundaries
- [X] T004 Configure the import-boundary gate in `.dependency-cruiser.cjs`: forbid `next/*`, `react`, `react-dom`, `react-native`, `expo/*`, `@supabase/*` inside `packages/core`; forbid `packages/** → apps/**`; forbid `apps/** → packages/db` (SC-010)
- [X] T005 [P] Configure Vitest in `vitest.workspace.ts` and `vitest.config.ts` with a 100% branch coverage threshold scoped to `packages/core/src/{scoring,ballot,window,matching}/**`
- [X] T006 [P] Create empty package skeletons with `package.json` and `src/index.ts` for `packages/{contracts,core,api,db,client,ui-logic}`
- [X] T007 Scaffold the Next.js 15 App Router host in `apps/web` with React 19 and Tailwind (`apps/web/package.json`, `apps/web/app/layout.tsx`, `apps/web/tailwind.config.ts`)
- [X] T008 [P] Implement fail-fast environment validation in `apps/web/src/env.ts` for `DATABASE_URL`, `VOTER_COOKIE_SECRET`, `ADMIN_PASSWORD_HASH`, `RANKINGS_CSV_URL`, `CRON_SECRET`, `RATE_LIMIT_SALT` (`DATABASE_URL` replaces the `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` pair per the ADR-003 amendment)
- [X] T009 [P] Document required variables in `.env.example` with no real values
- [X] T010 Wire the Supabase CLI in `supabase/config.toml` and add `db:push` / `db:reset` scripts to root `package.json`
- [X] T011 Create CI in `.github/workflows/ci.yml` running typecheck, lint, boundaries, unit, contract, migration application against a scratch Postgres, and a `scripts/check-migration-rollback.ts` lint asserting every file in `supabase/migrations/` contains either a `-- rollback:` block or an explicit `-- irreversible:` note (constitution: Quality Gates)
- [X] T012 [P] Configure Playwright in `apps/web/playwright.config.ts` with a single mobile-viewport project

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts spine, data access, and the adapter plumbing every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T013 Write the initial schema migration in `supabase/migrations/0001_initial_schema.sql` creating `players`, `player_ratings`, `tournaments`, `groups`, `pairs`, `voters`, `ballots`, `ballot_entries`, `group_final_standings` with every constraint listed in [data-model.md](./data-model.md), including `UNIQUE (group_id, voter_id)` and `UNIQUE (ballot_id, position)`; end the file with a `-- rollback:` block dropping the created objects in dependency order (FR-008, FR-013, FR-026)
- [X] T014 Add the aggregate views `group_position_counts` and `group_ballot_counts` in `supabase/migrations/0002_result_views.sql` with a `-- rollback:` block dropping both views (FR-016)
- [X] T015 Enable RLS and grant the `anon` role nothing on every table in `supabase/migrations/0003_rls_deny_anon.sql`, with a `-- rollback:` block restoring the prior grants (FR-022)
- [X] T016 Add the indexes from [data-model.md](./data-model.md) in `supabase/migrations/0004_indexes.sql` with a `-- rollback:` block dropping each index
- [X] T017 [P] Define shared contract primitives in `packages/contracts/src/common.ts`: branded id types, the `ErrorCode` union, `Error`, `ErrorWithIssues`, cursor pagination
- [X] T018 [P] Define repository interfaces in `packages/core/src/ports/index.ts`: `PlayerRepository`, `RatingRepository`, `TournamentRepository`, `GroupRepository`, `PairRepository`, `VoterRepository`, `BallotRepository`, `ResultsRepository`, `RankingSource`, `Clock` (SC-010)
- [X] T019 [P] Define domain error types and their HTTP mapping table in `packages/core/src/errors.ts`
- [X] T020 Implement the single database client factory in `packages/db/src/client.ts` using `postgres` (postgres.js) against `DATABASE_URL`, which points at the connection pooler; this is the only module in the repo permitted to construct one (ADR-003 as amended, Risk R8)
- [X] T021 Implement row-to-domain mapping helpers in `packages/db/src/mappers.ts`
- [X] T022 Define the handler contract and dependency container in `packages/api/src/handler.ts` (`(input, deps) => Promise<output>`, `Deps` assembled from ports) (SC-010)
- [X] T023 Implement the route adapter helper in `apps/web/src/server/adapter.ts`: schema parse, single handler call, domain-error-to-status mapping, `Cache-Control: no-store` on voter-dependent responses (FR-020, SC-006)
- [X] T024 [P] Build the contract-test harness in `tests/contract/harness.ts`: scratch database connection, per-test truncation, handler invocation through the real route
- [X] T025 [P] Build fixture factories in `tests/factories/index.ts` for players, tournaments, groups, pairs, voters, and ballots
- [X] T026 [P] Add the typed client generator in `scripts/generate-client.ts` emitting `packages/client/src/generated.ts` from the contracts (SC-010)
- [X] T027 [P] Set up the shared query layer in `packages/ui-logic/src/query.ts` (TanStack Query client, typed hook factory, no DOM imports) consuming only `packages/client` (SC-010)
- [X] T028 [P] Add OpenAPI generation in `scripts/generate-openapi.ts` plus a CI check that `specs/001-group-standings-voting/contracts/openapi.yaml` matches the schemas
- [X] T029 Add a meta-test in `tests/architecture/boundaries.test.ts` asserting `dependency-cruiser` fails on a deliberate forbidden import, and that `apps/web` reaches the API only through `packages/client` (SC-010)
- [X] T030 Build the app shell in `apps/web/app/layout.tsx` with pt-PT copy loading from `apps/web/src/i18n/pt.ts` and Europe/Lisbon formatting helpers in `packages/ui-logic/src/format.ts`

**Checkpoint**: schema applied with rollbacks, contracts spine in place, adapters and test harness ready — user stories can begin

---

## Phase 3: User Story 1 - Publish a tournament lineup (Priority: P1) 🎯 MVP

**Goal**: An organiser pastes a lineup payload, sees a validated preview with every player resolved to a ranking-list identity, and publishes a tournament that appears on the public landing page with voting open.

**Independent Test**: paste `contracts/lineup-payload.example.json` at `/admin`, confirm 2 groups of 6 ordered by pair total points descending with all 24 players resolved, publish, and confirm the tournament is listed at `/` with voting open. Then misspell one name and confirm publishing is blocked with that entry named.

### Tests for User Story 1 ⚠️ Write first, confirm they fail

- [X] T031 [P] [US1] Unit tests for name normalisation and player resolution in `packages/core/src/matching/matching.test.ts`: NFC composition, case folding, whitespace collapsing, explicit `externalId` override, unmatched name, duplicate match key (FR-004, SC-003)
- [X] T032 [P] [US1] Unit tests for lineup derivation in `packages/core/src/lineup/lineup.test.ts`: grouping by total points descending, explicit group override, groups of six with one smaller final group of 3–5, group size below 3 rejected, duplicate player within a tournament, `total_points` mismatch, non-future start instant, all issues reported together (FR-003, FR-005)
- [X] T033 [P] [US1] Contract test for `POST /api/v1/admin/tournaments/preview` in `tests/contract/admin-preview.test.ts`: success shape, `UNRESOLVED_PLAYERS`, `MALFORMED_PAYLOAD`, `START_NOT_IN_FUTURE`, `DUPLICATE_PLAYER`, `POINTS_MISMATCH`, `INVALID_GROUP_SIZE`, 401 without a session (FR-001, FR-002, FR-005, FR-006)
- [X] T034 [P] [US1] Contract test for `POST /api/v1/admin/tournaments` in `tests/contract/admin-publish.test.ts`: 201 with derived groups, points captured at publish time, `SLUG_TAKEN`, `confirm: false` rejected, 401, and nothing persisted on failure (FR-002, FR-006, FR-007)
- [X] T035 [P] [US1] Contract test for `POST /api/v1/admin/rankings/sync` in `tests/contract/admin-rankings-sync.test.ts`: counts returned, idempotent re-run, `DUPLICATE_MATCH_KEY` aborts with the database untouched, unreachable source returns `stale: true`, cookie session accepted, `CRON_SECRET` bearer accepted, neither present rejected (FR-004)
- [X] T036 [P] [US1] Contract test for `GET /api/v1/tournaments` in `tests/contract/tournament-list.test.ts`: newest-first ordering, `status` filter, cursor pagination, ballot counts, no per-group counts in the list payload (FR-023, SC-006)

### Implementation for User Story 1

- [X] T037 [P] [US1] Define lineup and tournament schemas in `packages/contracts/src/tournaments.ts`: `LineupPayload`, `LineupPreview`, `Pair`, `TournamentSummary`, `TournamentDetail`, list response (FR-001, FR-003, FR-023)
- [X] T038 [US1] Implement normalisation and resolution in `packages/core/src/matching/index.ts` (`toMatchKey`, `resolvePlayers`) — depends on T031 (FR-004)
- [X] T039 [US1] Implement lineup derivation and validation in `packages/core/src/lineup/index.ts`, returning every issue rather than the first — depends on T032, T038 (FR-003, FR-005)
- [X] T040 [P] [US1] Implement tolerant ranking-CSV parsing in `packages/core/src/rankings/parse.ts` handling both `dd/mm/yyyy` and `dd-mm-yyyy` column headers and rejecting colliding match keys (FR-004)
- [X] T041 [US1] Implement the sync job in `tools/rankings-sync/src/index.ts` and expose it as the root `rankings:sync` script in `package.json`: fetch `RANKINGS_CSV_URL` following redirects, store the raw snapshot, upsert players and dated ratings idempotently, abort on collision, fall back to the last snapshot and report staleness — depends on T040 (FR-004)
- [X] T042 [US1] Implement `PlayerRepository` and `RatingRepository` in `packages/db/src/players.ts` — depends on T020, T021 (FR-008)
- [X] T043 [US1] Implement tournament publishing in `packages/db/src/tournaments.ts` as one transaction inserting tournament, groups, and pairs with points captured at publish time — depends on T020, T021 (FR-007, FR-008)
- [X] T044 [US1] Implement the published-tournament listing query in `packages/db/src/tournament-list.ts`: newest first, status filter, cursor pagination, ballot counts — depends on T020, T021 (FR-023)
- [X] T045 [US1] Implement the `previewLineup` handler in `packages/api/src/handlers/preview-lineup.ts` — depends on T039, T042 (FR-002, FR-005)
- [X] T046 [US1] Implement the `publishTournament` handler in `packages/api/src/handlers/publish-tournament.ts` — depends on T039, T043 (FR-002, FR-007)
- [X] T047 [US1] Implement the `syncRankings` handler in `packages/api/src/handlers/sync-rankings.ts` — depends on T041, T042 (FR-004)
- [X] T048 [US1] Implement the `listTournaments` handler in `packages/api/src/handlers/list-tournaments.ts` — depends on T044 (FR-023)
- [X] T049 [US1] Implement organiser authentication in `apps/web/src/server/admin-auth.ts`: argon2id verification against `ADMIN_PASSWORD_HASH`, signed session cookie, a guard used by every admin adapter, and bearer `CRON_SECRET` acceptance for the rankings-sync route only (FR-006)
- [X] T050 [US1] Add the admin route adapters in `apps/web/app/api/v1/admin/tournaments/preview/route.ts`, `apps/web/app/api/v1/admin/tournaments/route.ts`, and `apps/web/app/api/v1/admin/rankings/sync/route.ts` — depends on T023, T045, T046, T047, T049 (FR-001, FR-002, FR-006)
- [X] T051 [US1] Add the public listing adapter in `apps/web/app/api/v1/tournaments/route.ts` — depends on T023, T048 (FR-023)
- [X] T052 [US1] Build the organiser page in `apps/web/app/admin/page.tsx`: paste payload, preview table of groups and resolved players, issue list on rejection, explicit publish action (FR-002)
- [X] T053 [US1] Build the public landing page in `apps/web/app/(public)/page.tsx` listing open tournaments newest first with their start time and group count, linking to each tournament — depends on T048, T051 (FR-023)
- [X] T054 [US1] Add the Playwright publish flow (quickstart V1) in `apps/web/tests/e2e/publish-lineup.spec.ts`, asserting the published tournament is listed at `/` (SC-001, SC-003)

**Checkpoint**: a tournament can be published and is reachable from the public landing page. US1 is demonstrable on its own.

---

## Phase 4: User Story 2 - Vote on a group's final standings (Priority: P1)

**Goal**: A visitor assigns distinct positions 1..n to a group's pairs, submits once, and cannot vote on that group again; other groups remain independently votable.

**Independent Test**: on a published tournament, submit a complete ordering for one group and confirm the form is replaced by a "vote recorded" state showing your ordering; confirm a second submission returns `ALREADY_VOTED`; confirm the other group still shows its form with nothing revealed. (Percentages arrive in US3 — this story is testable without them.)

### Tests for User Story 2 ⚠️ Write first, confirm they fail

- [X] T055 [P] [US2] Unit tests for ballot validation in `packages/core/src/ballot/ballot.test.ts`: complete permutation accepted, repeated position, missing pair, pair outside the group, extra pair, group sizes 3–6 (FR-010)
- [X] T056 [P] [US2] Unit tests for the voting window in `packages/core/src/window/window.test.ts`: open before the start instant, closed exactly at it, closed after, unpublished tournament never open, client-supplied time ignored (FR-011, SC-007)
- [X] T057 [P] [US2] Contract test for `POST /api/v1/groups/{groupId}/ballots` in `tests/contract/cast-ballot.test.ts`: 201, `INCOMPLETE_BALLOT`, `DUPLICATE_POSITION`, `UNKNOWN_PAIR`, `MISSING_PAIR`, `ALREADY_VOTED`, `VOTING_CLOSED`, and two concurrent submissions producing exactly one ballot (FR-009, FR-010, FR-011, FR-013, SC-009)
- [X] T058 [P] [US2] Contract test for `GET /api/v1/tournaments/{slug}` in `tests/contract/tournament-detail.test.ts`: `hasVoted`, `ownBallot` present only after voting, `votingOpen` from server time, `no-store` header, no counts anywhere in the un-voted payload, and — on a two-group tournament — voting group A leaves group B votable with its results still absent (FR-014, FR-015, FR-020)

### Implementation for User Story 2

- [X] T059 [P] [US2] Define voting schemas in `packages/contracts/src/ballots.ts`: `BallotSubmission`, `OwnBallot`, `Group` (FR-009, FR-014)
- [X] T060 [US2] Implement ballot validation in `packages/core/src/ballot/index.ts` — depends on T055 (FR-010)
- [X] T061 [US2] Implement the window decision in `packages/core/src/window/index.ts` using the injected `Clock` — depends on T056 (FR-011, SC-007)
- [X] T062 [US2] Implement `VoterRepository` and `BallotRepository` in `packages/db/src/ballots.ts`: single-transaction insert of ballot plus entries, `last_seen_at` refreshed on voter access, unique violation surfaced as `ALREADY_VOTED` — depends on T020, T021 (FR-012, FR-013)
- [X] T063 [US2] Implement voter cookie mint and verify in `apps/web/src/server/voter-cookie.ts` using `jose`: signed, httpOnly, Secure, SameSite=Lax, one-year expiry, and refresh `last_seen_at` through `VoterRepository` on each recognised request — depends on T062 (FR-012)
- [X] T064 [US2] Implement the `castBallot` handler in `packages/api/src/handlers/cast-ballot.ts` — depends on T060, T061, T062 (FR-009, FR-010, FR-011, FR-013)
- [X] T065 [US2] Implement the `getTournamentDetail` handler in `packages/api/src/handlers/get-tournament-detail.ts` returning per-group vote state and omitting results entirely when not revealed — depends on T061, T062 (FR-014, FR-015, FR-020)
- [X] T066 [US2] Add route adapters in `apps/web/app/api/v1/groups/[groupId]/ballots/route.ts` and `apps/web/app/api/v1/tournaments/[slug]/route.ts` — depends on T023, T063, T064, T065 (FR-011, FR-020)
- [X] T067 [P] [US2] Implement ballot draft state and the submit mutation in `packages/ui-logic/src/ballot.ts` (assign/swap positions, completeness check, submit) (FR-009, FR-010)
- [X] T068 [US2] Build the tournament page and group voting form in `apps/web/app/(public)/torneios/[slug]/page.tsx` and `apps/web/components/BallotForm.tsx`, mobile-first, one tap per position, per-group state independent (FR-009, FR-015, SC-002)
- [X] T069 [US2] Add per-IP rate limiting to ballot submission in `apps/web/src/server/rate-limit.ts`: key on a salted hash of the IP held in memory or edge KV with a 10-minute TTL, never written to Postgres and never logged; document the window in the file header (constitution: Privacy)

**Checkpoint**: ballots are recorded exactly once per voter per group, enforced server-side. US1 and US2 both work independently.

---

## Phase 5: User Story 3 - See the crowd's predicted standings (Priority: P1)

**Goal**: After voting, or after voting closes, a group shows per-position percentages per pair and a crowd predicted order, with the ballot count always visible.

**Independent Test**: record a known set of ballots on one group, then confirm the displayed percentages and predicted order match hand-computed values exactly, and that a non-voter with voting still open cannot obtain them through any request.

### Tests for User Story 3 ⚠️ Write first, confirm they fail

- [X] T070 [P] [US3] Unit tests for scoring in `packages/core/src/scoring/scoring.test.ts`: per-position shares, mean position, ordering, the full tie-break chain (first-place votes → total points → pair id), a single ballot, a 3-pair group, rounding applied only at render, and no results object when the ballot count is zero (FR-016, FR-017, FR-018, FR-019, SC-004)
- [X] T071 [P] [US3] Contract test for `GET /api/v1/groups/{groupId}/results` in `tests/contract/group-results.test.ts`: 200 after voting, `RESULTS_HIDDEN` for a non-voter while open, 200 for everyone after close, `no-store` header (FR-020, FR-021)
- [X] T072 [P] [US3] Aggregate non-leakage test in `tests/contract/no-leakage-aggregates.test.ts` covering the read paths that exist at this phase — `GET /tournaments`, `GET /tournaments/{slug}`, `GET /groups/{id}/results` — asserting no count, share, or ordering appears for an unrevealed group; extended to the remaining paths by T084 (SC-006)
- [X] T073 [P] [US3] Voter-identity non-exposure test in `tests/contract/no-voter-identity.test.ts`: no public response body or header contains a voter id or cookie value, no endpoint enumerates ballots, and an aggregate of a single ballot still cannot be attributed to a device (FR-022, SC-006)

### Implementation for User Story 3

- [X] T074 [P] [US3] Define the results schema in `packages/contracts/src/results.ts` (`GroupResults`, `positionShares`) (FR-016, FR-019)
- [X] T075 [US3] Implement scoring in `packages/core/src/scoring/index.ts` — pure function from raw counts to results, rounding only at render time — depends on T070 (FR-016, FR-017, FR-018, SC-004)
- [X] T076 [US3] Implement `ResultsRepository` in `packages/db/src/results.ts` reading `group_position_counts` and `group_ballot_counts` — depends on T014, T020 (FR-016)
- [X] T077 [US3] Implement the reveal gate in `packages/core/src/reveal/index.ts` (voted OR closed) and the `getGroupResults` handler in `packages/api/src/handlers/get-group-results.ts` — depends on T061, T075, T076 (FR-020, FR-021)
- [X] T078 [US3] Attach results to the tournament detail response when revealed, and return the group's results inside the 201 ballot response, in `packages/api/src/handlers/{get-tournament-detail,cast-ballot}.ts` — depends on T065, T077 (FR-020, SC-005)
- [X] T079 [US3] Add the route adapter in `apps/web/app/api/v1/groups/[groupId]/results/route.ts` — depends on T023, T077 (FR-020, FR-021)
- [X] T080 [P] [US3] Implement results formatting in `packages/ui-logic/src/results.ts`: percentage display, ballot-count label, explicit no-votes state (FR-019)
- [X] T081 [US3] Build the results view in `apps/web/components/GroupResults.tsx`: crowd predicted table plus per-position share bars per pair, ballot count always visible — depends on T080 (FR-017, FR-019)
- [X] T082 [US3] Add the Playwright vote-and-reveal flow (quickstart V2) in `apps/web/tests/e2e/vote-and-reveal.spec.ts`: assert the pre-vote response carries no counts, assert results render within 2 seconds of the ballot being accepted, and assert that after a full page reload in the same browser session the group still shows results plus the voter's own ordering (FR-012, FR-014, SC-005, SC-006)

**Checkpoint**: the full product loop works — publish, vote, see the crowd. This is the shippable release.

---

## Phase 6: User Story 4 - Browse past tournaments and players (Priority: P2)

**Goal**: Past tournaments are shown with their final crowd predictions, and each player shows every tournament they appeared in with partner and group.

**Independent Test**: publish two tournaments sharing a player, let voting close on the first, then confirm the history view's archived results and both appearances on the shared player — with exactly one player record for that person.

### Tests for User Story 4 ⚠️ Write first, confirm they fail

- [X] T083 [P] [US4] Contract test for `GET /api/v1/players/{playerId}` in `tests/contract/player-detail.test.ts`: appearances with partner, group label, and points captured at each tournament; one player row across multiple tournaments (FR-025, SC-008)
- [X] T084 [P] [US4] Extend `tests/contract/no-leakage-aggregates.test.ts` to cover the read paths added since T072 — `GET /players/{playerId}` and the history view's data source — asserting they expose no unrevealed group's counts (SC-006)

### Implementation for User Story 4

- [X] T085 [P] [US4] Define history schemas in `packages/contracts/src/players.ts` (`PlayerDetail`, `Appearance`) (FR-025)
- [X] T086 [US4] Implement player appearance queries in `packages/db/src/history.ts`, joined through `pairs` — depends on T020, T021 (FR-025)
- [X] T087 [US4] Implement the `getPlayer` handler in `packages/api/src/handlers/get-player.ts` — depends on T086 (FR-025)
- [X] T088 [US4] Add the route adapter in `apps/web/app/api/v1/players/[playerId]/route.ts` — depends on T023, T087 (FR-025)
- [X] T089 [US4] Build the history page in `apps/web/app/(public)/historico/page.tsx`: closed tournaments newest first with final crowd predicted standings, per-position percentages, and ballot counts — depends on T048, T081 (FR-023, FR-024)
- [X] T090 [US4] Build the player page in `apps/web/app/(public)/jogadores/[playerId]/page.tsx` listing every appearance with partner and group — depends on T088 (FR-025, SC-008)

**Checkpoint**: all four stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T091 [P] Accessibility pass on the voting form in `apps/web/components/BallotForm.tsx`: full keyboard position assignment, labelled controls, visible focus, 4.5:1 contrast, and a screen-reader announcement when the vote is recorded (SC-011)
- [X] T092 [P] Complete pt-PT copy with English fallback in `apps/web/src/i18n/{pt,en}.ts`; assert no hard-coded strings remain in components (constitution: Locale)
- [X] T093 [P] Add loading, empty, and error states for every public view in `apps/web/components/states/` (FR-019)
- [X] T094 [P] Add metadata and Open Graph tags in `apps/web/app/(public)/torneios/[slug]/page.tsx` that never include results for an unrevealed group (SC-006)
- [ ] T095 Load-test the ballot path at 3× expected peak using `tools/loadtest/vote.js` and record findings in `docs/perf/2026-vote-loadtest.md` (SC-009)
- [X] T096 [P] Verify the coverage gate holds at 100% branch for `packages/core/src/{scoring,ballot,window,matching}`, remove any unreachable defensive branches, and add an assertion in `tests/architecture/reserved-tables.test.ts` that no source file references `group_final_standings` (FR-026)
- [X] T097 [P] Update `README.md` with real run instructions and amend any ADR in `docs/adr/` whose decision changed during implementation
- [ ] T098 Execute quickstart scenarios V1–V6 manually and record the outcomes in `specs/001-group-standings-voting/quickstart.md` (SC-004, SC-007)
- [ ] T099 Run a timed first-use walkthrough with two people who have not seen the site, recording time-to-submitted-ballot on a phone in `docs/usability/2026-ballot-timing.md`; fix any step that pushes the median past 60 seconds (SC-002)
- [X] ~~T100~~ **Retired 2026-08-28 by T126** — the Vercel cron it added is replaced by the systemd timer in T123. `apps/web/vercel.json` is deleted; leaving it would have invited a second scheduler firing the same route (ADR-010 § Amendment, FR-004)
- [X] T101 Security review recorded in `docs/security/001-review.md`: no service-role key in any client bundle, `no-store` present on every voter-dependent response, RLS verified to deny an anon-key client on every table, and no voter identifier reachable from any public path (FR-022, SC-006)

---

## Phase 8: Amendment — normalised name as canonical player identity (2026-08-28)

Added after Phase 7 in response to a source-data defect found while running the first real import.
Rationale and trade-offs: [ADR-007](../../docs/adr/ADR-007-player-identity-ranking-sheet.md)
§ Amendment; requirement wording: FR-004 as amended; schema: `data-model.md` § `players`.

**Why this is not optional**: while `players.external_id` is `UNIQUE NOT NULL`, every import of the
real ranking sheet aborts, so no tournament can be published at all. The sheet is third-party
maintained and cannot be corrected upstream.

- [X] T102 Migration `0006_external_id_not_unique.sql` with its rollback: drop the UNIQUE constraint on `players.external_id` and make the column nullable, leaving `players.match_key` UNIQUE as the sole identity key; rollback must be executable on a database holding duplicate `external_id` values, or fail loudly rather than silently discard rows (FR-004, data-model § `players`)
- [X] T103 Verify the rollback actually reverses and re-applies via `pnpm migrations:verify-rollback`, which is the gate that caught the unexecutable rollback in `0003` (Principle: Quality Gates)
- [X] T104 [P] Contract test: an import whose source rows carry duplicate `external_id` values but distinct normalised names succeeds and creates one player per name (FR-004)
- [X] T105 [P] Contract test: an import whose source rows produce two identical `match_key` values still aborts with `DUPLICATE_MATCH_KEY` and leaves the database untouched — this check is now the sole guard on identity (FR-004, quickstart V6.3)
- [X] T106 [P] Contract test: re-running the import is idempotent — no duplicate players, no duplicate ratings, snapshots rewritten (quickstart V6.1)
- [X] T107 Make `externalId` nullable in the `playerDetail` and `resolvedPlayer` response schemas in `packages/contracts` (`players.ts`, `tournaments.ts`). Both currently declare it required and non-nullable, so a player row without one would fail response validation the moment the column becomes nullable (Principle III, FR-004)
- [X] T108 Retire the explicit `externalId` disambiguation path in **both** `packages/contracts` (the optional `externalId` on `lineupPlayer`) and `packages/core/matching`: it resolved ties by a field that is no longer unique, so it can now select the wrong person. Removing it means two genuinely identical normalised names abort with no payload-level override — the accepted cost recorded in ADR-007 § Amendment (FR-004)
- [X] T109 Regenerate the client and the OpenAPI document with `pnpm generate:client && pnpm generate:openapi` after T107 and T108, and confirm `pnpm openapi:check` passes. Contracts are the source of truth and both artifacts are generated from them; skipping this fails CI (Principle III)
- [X] T110 Remove the `external_id` uniqueness precondition from `packages/core/rankings/parse.ts` so a repeated identifier is no longer an import failure, keeping the `match_key` collision check exactly as written (FR-004)
- [X] T111 Change the players repository in `packages/db` to upsert on `match_key` rather than `external_id`, so a repeated identifier cannot merge two people (data-model § `players`)
- [X] T112 Update the unit tests for `core/matching`, `core/rankings/parse` and the fixtures that assumed a unique `external_id`, keeping branch coverage on the gated modules at 100% (Principle: Quality Gates)
- [X] T113 Run the real import against the live sheet and record the outcome — row count, players created, ratings, snapshots — then re-run to confirm idempotence (quickstart V6.1, closes the import half of T098)

---

## Phase 9: Close the Principle III violation the boundary gate had never reported (2026-08-28)

`tests/architecture/boundaries.test.ts` shells out to `git grep`, which searches **tracked files
only**. The source tree was untracked for the whole of phases 1-7, so this assertion passed
vacuously every time it ran and never once inspected the code it guards. Committing the tree on
2026-08-28 switched it on, and it immediately reported four hand-rolled `fetch` calls to `/api/v1`
that Principle III forbids.

The gate was also stricter than its own name: it matched bare `/api/`, which flags
`POST /api/admin/session` — the organiser sign-in, which is host plumbing outside the versioned
product API by design (ADR-002) and therefore absent from the generated client.

- [X] T114 Narrow the boundary assertion to `/api/v1/` so it matches its own name and stops flagging the documented `/api/admin/session` exception, and record in the test that `git grep` makes it vacuous for untracked files — the reason it never reported for seven phases (Principle III)
- [X] T115 Add `apps/web/src/api.ts`: one module-level generated-client instance built from `createApi` and `WEB_API_BASE_URL`, so interactive components have a single typed entry point to the product API (Principle III, SC-010)
- [X] T116 Route `apps/web/components/BallotForm.tsx` through `api.castBallot`, mapping `ApiRequestError.code` to the translated message instead of decoding the error body by hand (FR-010, Principle III)
- [X] T117 Route the three organiser calls in `apps/web/app/admin/page.tsx` — preview, publish, rankings sync — through the generated client, and rewrite `fail()` to take an `ApiRequestError` so network and handler failures share one shape (FR-002, FR-004, Principle III)

---

## Phase 10: Deploy to the maintainer's VPS (2026-08-28)

Recorded per Principle I before any deploy file is written. Rationale and the full trade-off:
[ADR-010](../../docs/adr/ADR-010-hosting-vercel-supabase.md) § Amendment. Supabase EU is unchanged;
only `apps/web` moves.

**Blocked on three facts about the host** that cannot be determined from the repository: the domain
or subdomain the site answers on (needed for `server_name` and the certificate), the existing nginx
vhost layout, and whether a Node 22 runtime is present. T121 and T122 cannot be written without the
first.

- [X] T118 Set `output: 'standalone'` and `outputFileTracingRoot` (pointed at the monorepo root) in `apps/web/next.config.ts`. Without the tracing root, pnpm's symlinked workspace dependencies are traced wrongly and the bundle fails at runtime rather than at build (ADR-010 § Amendment)
- [X] T119 Verify the standalone bundle boots from a clean directory with only the traced `node_modules`, and that `@node-rs/argon2` — a native addon — loads. An architecture or libc mismatch fails at process start, not at build time, so this must be checked against the target's platform rather than assumed
- [X] T120 Add `deploy/padelmigas.service`: systemd unit running the standalone server, `EnvironmentFile=/etc/padelmigas/env` (root-owned, mode 0600), `Restart=on-failure`. Secrets live in that file and never in the repository or in Actions logs
- [X] T121 Add `deploy/nginx.conf`: the vhost, TLS, and `proxy_set_header X-Forwarded-For $remote_addr`. **Overwrite, not append** — the idiomatic `$proxy_add_x_forwarded_for` would let a caller supply their own first hop and rotate the ballot rate-limit key at will, because `clientAddress()` trusts the first hop (Risk R2, ADR-010 § Amendment)
- [X] T122 Add an architecture test asserting the committed nginx config sets `X-Forwarded-For` to `$remote_addr`, so the rate limiter's assumption cannot be silently broken by a later edit. The rule is invisible at the call site and would otherwise decay (Risk R2)
- [X] T123 Add `deploy/padelmigas-rankings.service` and `.timer`: weekly systemd timer calling `/api/v1/admin/rankings/sync` with the bearer `CRON_SECRET`, replacing the Vercel cron. A timer fails silently, so it needs a failure path that reaches a human — ADR-010 § Amendment names this as a cost of the move (FR-004)
- [ ] T124 Add `.github/workflows/deploy.yml`: gates, then build, then rsync the standalone bundle, then `systemctl restart`. Mirrors the deploy idiom already used for the other two services on that host. Deploys only after CI passes on `main`
- [ ] T125 Keep the previous release on disk and make the restart switch a symlink, so a bad deploy is reversible. ADR-010 § Amendment records the loss of platform rollback as a cost of leaving Vercel; this is the mitigation, and without it there is none
- [X] T126 Delete `apps/web/vercel.json` and retire T100, which configured the Vercel cron the timer in T123 replaces. Leaving it invites a second scheduler firing the same route
- [ ] T127 Write `docs/deploy/vps.md`: one-time host setup (Node runtime, `/etc/padelmigas/env`, unit installation, certificate) and the runbook for a deploy, a rollback, and a failed sync

### Task count (deploy)

10 tasks: build shape 2, systemd 2, nginx 2, CI 1, safety 1, cleanup 1, docs 1.

### Task count (Principle III)

4 tasks. Not new scope: this is a pre-existing violation of an existing principle, found only because
committing the tree made an existing gate functional for the first time.

### Task count (amendment)

12 tasks: schema 2, contract tests 3, contracts + codegen 3, implementation 2, tests 1, verification 1.

T107-T109 were added on 2026-08-28 by `/speckit-analyze`, which found that `externalId` is declared
required and non-nullable in two response schemas and that Principle III makes this a contracts-first
change rather than a schema-only one. Without them the migration lands green and `openapi:check`
fails.


---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: depends on Foundational only
- **US2 (Phase 4)**: depends on Foundational; needs a published tournament to test against, which US1 provides (fixtures can substitute)
- **US3 (Phase 5)**: depends on Foundational; needs recorded ballots to display, which US2 provides (fixtures can substitute)
- **US4 (Phase 6)**: depends on Foundational; T089 also depends on T081 (the results view it archives) and T048 (the listing query)
- **Polish (Phase 7)**: depends on the stories being delivered

### Critical path

T001 → T007 → T013 → T017/T018 → T020 → T022 → T023 → then story phases. Within stories, the chain
is: contracts schema → core rules → repository → handler → adapter → page.

### Story-internal rules

- Test tasks are written first and must fail before the implementation task that satisfies them.
- Core rules (`packages/core`) before repositories, repositories before handlers, handlers before
  route adapters, adapters before pages.
- No page may call a repository directly; that is a boundary violation and CI will fail it.
- Non-leakage coverage is cumulative: T072 covers the paths existing in Phase 5, T084 extends it to
  those added in Phase 6. Any future route must extend the same file.

### Parallel Opportunities

- Setup: T002, T003, T005, T006, T008, T009, T012 in parallel after T001
- Foundational: T017, T018, T019 in parallel; T024–T028 in parallel once T020–T023 land
- Every story's test tasks are mutually parallel (`[P]`)
- US1 T037 and T040 are parallel; US3 T074 and T080 are parallel
- With more than one contributor, US2 and US4 can proceed alongside US1 using fixture data

---

## Parallel Example: User Story 1

```bash
# All US1 tests together (write first, expect failure):
Task: "Unit tests for matching in packages/core/src/matching/matching.test.ts"
Task: "Unit tests for lineup derivation in packages/core/src/lineup/lineup.test.ts"
Task: "Contract test for admin preview in tests/contract/admin-preview.test.ts"
Task: "Contract test for admin publish in tests/contract/admin-publish.test.ts"
Task: "Contract test for rankings sync in tests/contract/admin-rankings-sync.test.ts"
Task: "Contract test for tournament list in tests/contract/tournament-list.test.ts"

# Then the independent implementation starters:
Task: "Define lineup and tournament schemas in packages/contracts/src/tournaments.ts"
Task: "Implement ranking-CSV parsing in packages/core/src/rankings/parse.ts"
```

---

## Implementation Strategy

### MVP scope

Phases 1–3 (T001–T054) deliver a publishable tournament, resolved player identities, and a public
landing page listing it — the prerequisite for everything and the only phase that must be correct
before an audience sees anything.

**However**, the smallest scope worth showing the club is Phases 1–5 (T001–T082): publish, vote, and
see the crowd. US2 without US3 records ballots but shows no payoff, so treat Phase 5 as part of the
first release rather than a follow-up.

### Incremental delivery

1. Phases 1–2 → foundation, CI green, schema applied with rollbacks
2. Phase 3 → publish a real lineup, verify identity resolution, tournament visible at `/`
3. Phase 4 → voting recorded, one ballot per group enforced
4. Phase 5 → **first public release**: full loop with percentages
5. Phase 6 → history and player pages
6. Phase 7 → accessibility, copy, load test, usability timing, security review

### Task count

127 tasks: Setup 12, Foundational 18, US1 24, US2 15, US3 13, US4 8, Polish 11, Amendment 12,
Principle III 4, Deploy 10.

The Amendment phase (T102–T113) was added on 2026-08-28, after Phase 7, when the first import against
the real ranking sheet revealed that the source's `ID` column is not unique. It is a correctness fix
to an already-specified requirement (FR-004), not new scope.
