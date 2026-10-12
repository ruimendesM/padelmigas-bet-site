---

description: "Task list for feature 004 — optional voter accounts"
---

# Tasks: Optional Voter Accounts

**Input**: Design documents from `/specs/004-voter-accounts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: required by the constitution — failing unit tests before `core/accounts` (100% branch),
and a contract test per new route and per documented failure shape. Playwright e2e for the account
flows.

## Phase 1: Setup

- [ ] T001 Write migration `supabase/migrations/0008_voter_accounts.sql`: `accounts` table with checks and unique constraints, enable + force RLS, revoke from `anon`/`authenticated` (same pattern as `0003_rls_deny_anon.sql`), comments, `-- rollback:` block — per data-model.md
- [ ] T002 Add `accounts` to the truncate/reset order (before `voters`) in `tests/contract/harness.ts`, and to any test factory reset in `tests/factories/` if present

## Phase 2: Foundational (blocks every story)

- [ ] T003 Add `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `PASSWORD_CHANGE_REQUIRED` to `ERROR_CODES` and a branded `accountId` in `packages/contracts/src/common.ts`; map them to 409 / 401 / 403 in `HTTP_STATUS_BY_CODE` in `packages/core/src/errors.ts`
- [ ] T004 Create `packages/contracts/src/accounts.ts` (`username`, `password`, `accountDto`, `registerRequest`, `signInRequest` with optional `newPassword`, `changePasswordRequest`, `accountResponse`, `accountSearchQuery`, `accountSearchResponse`, `passwordResetResponse`) per contracts/README.md; re-export from `packages/contracts/src/index.ts`
- [ ] T005 Register `register`, `getAccount`, `signIn`, `signOut`, `changePassword`, `searchAccounts`, `resetAccountPassword` in `packages/contracts/src/endpoints.ts` (add an `account` auth kind next to the organiser one)
- [ ] T006 Add `Account` and `AccountId` to `packages/core/src/domain/index.ts`
- [ ] T007 [P] Write failing unit tests for `normaliseUsername`, `temporaryPasswordState`, `planDeviceMerge`, `generateTemporaryPassword` in `packages/core/src/accounts/accounts.test.ts`
- [ ] T008 Implement `packages/core/src/accounts/index.ts` to pass T007; export from `packages/core/src/index.ts`; add `packages/core/src/accounts/**` to coverage `include` in `vitest.config.ts` (100% branch)
- [ ] T009 Add `AccountRepository`, `PasswordHasher`, and `VoterRepository.isOwned` to `packages/core/src/ports/index.ts` per data-model.md
- [ ] T010 Implement `createAccountRepository` (`create` adopting an unowned voter or minting one, `findById`, `findCredentialsByUsername`, `search` with escaped wildcards, `setPassword`, `resetPassword`) in `packages/db/src/accounts.ts`; add `isOwned` to `createVoterRepository` in `packages/db/src/ballots.ts`; map rows in `packages/db/src/mappers.ts`; wire in `packages/db/src/repositories.ts` and export from `packages/db/src/index.ts`
- [ ] T011 Add `accounts` and `passwords` to `Deps` in `packages/api/src/handler.ts`; extend `CallerContext` with optional `accountId`
- [ ] T012 [P] Implement `PasswordHasher` over `@node-rs/argon2` + `ARGON2_OPTIONS` (including a fixed dummy hash for unknown usernames) in `apps/web/src/server/password-hasher.ts`; wire `accounts` + `passwords` in `apps/web/src/server/deps.ts`
- [ ] T013 [P] Implement `apps/web/src/server/account-session.ts`: sign/verify `pm_account` (issuer `padelmigas-bet`, audience `account`, `sub`, `sv`, 90 days), `accountSessionCookie`, `clearAccountSessionCookie`, `clearVoterCookie`
- [ ] T014 Rework caller resolution in `apps/web/src/server/voter-cookie.ts`: account session first (valid token + account exists + `sv` matches), else `pm_voter` only if the voter is not owned, else nobody; `requireVoter` mints only in the last case; share one resolver used by `recogniseVoter` and by `caller()` in `apps/web/src/server/page-data.ts`
- [ ] T015 Add named buckets to `apps/web/src/server/rate-limit.ts` (`'ballot'` unchanged default, `'auth'` 10 / 10 min) keeping the salted, in-memory, never-logged rules; update the ballot route call site
- [ ] T016 Contract test in `tests/contract/cast-ballot.test.ts` and `tests/contract/tournament-detail.test.ts`: a `pm_voter` cookie for an account-owned voter is treated as unrecognised (no `hasVoted`, new voter minted on vote)

**Checkpoint**: foundation ready — logged-out behaviour unchanged, account plumbing in place.

## Phase 3: User Story 1 — Register and keep my vote across devices (P1) 🎯 MVP

**Goal**: register with username + password; device votes carry over; signed-in devices share voted state.

**Independent test**: vote logged out → register → sign in on a second client → group shows voted with the same ballot.

- [ ] T017 [US1] Implement `register` (normalise, hash, `accounts.create` adopting the device voter when unowned, `USERNAME_TAKEN`) and `getAccount` handlers in `packages/api/src/handlers/register.ts` and `packages/api/src/handlers/get-account.ts`; export from `packages/api/src/index.ts`
- [ ] T018 [US1] Route `apps/web/app/api/v1/account/route.ts`: `POST` (auth rate limit → handler → set `pm_account`, clear `pm_voter`, 201) and `GET` (account session → 200, else `UNAUTHORISED`)
- [ ] T019 [US1] Contract tests in `tests/contract/accounts.test.ts`: register success shape + cookies, adopts device ballots, does not adopt an owned voter, `USERNAME_TAKEN` (case-insensitive), `MALFORMED_PAYLOAD` per username/password rule, `RATE_LIMITED`, `GET /account` 200/401, no hash/voter id in any body
- [ ] T020 [US1] Contract test: two sessions of one account racing a ballot on the same group → exactly one 201, one `ALREADY_VOTED`, in `tests/contract/cast-ballot.test.ts`
- [ ] T021 [P] [US1] Page `apps/web/app/(public)/registar/page.tsx` (client form via `@padelmigas/client`, inline rule errors, redirect back on success)
- [ ] T022 [P] [US1] Header account area in `apps/web/app/layout.tsx` (username + `Sair` / `Entrar` · `Registar`), reading the account through `apps/web/src/server/page-data.ts`
- [ ] T023 [US1] pt-PT (and en fallback) copy for register + header in `apps/web/src/i18n/pt.ts` and `apps/web/src/i18n/en.ts`
- [ ] T024 [US1] Regenerate client and OpenAPI (`pnpm generate:client`, `pnpm generate:openapi`)

## Phase 4: User Story 2 — Sign in where I already voted logged out (P1)

**Goal**: sign-in merges the device's anonymous ballots; account wins in open groups; closed-group conflicts left untouched.

**Independent test**: account voted A; device voted A and B logged out; sign in → B moved, A device ballot discarded, counts count the person once.

- [ ] T025 [US2] Implement `mergeDeviceVoter` in `packages/db/src/accounts.ts`: one transaction, lock both voter rows `FOR UPDATE`, load device ballots with their tournament, compute `votingOpen` with `isVotingOpen`, apply `planDeviceMerge` (UPDATE moves, DELETE discards, leave others)
- [ ] T026 [US2] Implement `signIn` handler in `packages/api/src/handlers/sign-in.ts`: normalise → credentials lookup (dummy verify on miss) → `temporaryPasswordState` (expired → `INVALID_CREDENTIALS`; pending without `newPassword` → `PASSWORD_CHANGE_REQUIRED`; pending with it → `setPassword`) → merge when the device voter is valid and unowned → return account + session version
- [ ] T027 [US2] Route `apps/web/app/api/v1/account/session/route.ts` `POST`: auth rate limit → handler → set `pm_account`, clear `pm_voter`
- [ ] T028 [US2] Contract tests in `tests/contract/account-session.test.ts`: success shape + cookies, move, discard in open group, leave in closed group (counts unchanged), owned device voter never moved, no-ballot device, `INVALID_CREDENTIALS` identical for unknown user and wrong password, case-insensitive username, `RATE_LIMITED`
- [ ] T029 [P] [US2] Page `apps/web/app/(public)/entrar/page.tsx` (sign-in form; on `PASSWORD_CHANGE_REQUIRED` show new-password fields and resubmit with `newPassword`)
- [ ] T030 [US2] Copy for sign-in in `apps/web/src/i18n/pt.ts` and `en.ts`

## Phase 5: User Story 3 — Keep voting without an account (P1)

**Goal**: logged-out flow unchanged; optional, non-blocking sign-in hint.

**Independent test**: existing `vote-and-reveal.spec.ts` passes unchanged; vote on a fresh profile with no extra step.

- [ ] T031 [P] [US3] Non-blocking hint ("Entra para guardares o teu voto em qualquer dispositivo") for logged-out visitors in `apps/web/app/(public)/torneios/[slug]/page.tsx`, copy in `apps/web/src/i18n/pt.ts` / `en.ts`
- [ ] T032 [US3] Run existing e2e `apps/web/tests/e2e/vote-and-reveal.spec.ts` and contract suite unchanged; fix any regression in caller resolution

## Phase 6: User Story 4 — Sign out and change my password (P2)

**Goal**: sign-out returns the device to a fresh visitor; password change ends other sessions.

**Independent test**: sign out → no ballots shown; change password on one client → other client signed out.

- [ ] T033 [US4] `DELETE` in `apps/web/app/api/v1/account/session/route.ts`: clear both cookies, 204
- [ ] T034 [US4] Implement `changePassword` handler in `packages/api/src/handlers/change-password.ts` (verify current, hash new, `setPassword` bumps version) and route `apps/web/app/api/v1/account/password/route.ts` (`PUT`, re-issue `pm_account`)
- [ ] T035 [US4] Contract tests in `tests/contract/account-session.test.ts` and `tests/contract/account-password.test.ts`: sign-out clears both cookies, old token after sign-out still verifies but owned `pm_voter` is ignored, change success re-issues cookie, other session's old `sv` rejected, wrong current → `INVALID_CREDENTIALS`, `UNAUTHORISED` without session
- [ ] T036 [P] [US4] Page `apps/web/app/(public)/conta/page.tsx` (change password form) and wire `Sair` in the header; copy in `apps/web/src/i18n/pt.ts` / `en.ts`

## Phase 7: User Story 5 — Organiser resets a forgotten password (P2)

**Goal**: organiser searches accounts and issues a one-time 24 h temporary password that ends sessions.

**Independent test**: reset → old session dead → temporary password forces new one → can vote.

- [ ] T037 [US5] Implement `searchAccounts` and `resetAccountPassword` handlers (`generateTemporaryPassword`, hash, `resetPassword` with `expiresAt = now + 24h`) in `packages/api/src/handlers/search-accounts.ts` and `packages/api/src/handlers/reset-account-password.ts`
- [ ] T038 [US5] Routes `apps/web/app/api/v1/admin/accounts/route.ts` (`GET`, `requireOrganiser`) and `apps/web/app/api/v1/admin/accounts/[accountId]/password-reset/route.ts` (`POST`, `requireOrganiser`, `Cache-Control: no-store`)
- [ ] T039 [US5] Contract tests in `tests/contract/admin-accounts.test.ts`: search shape and substring match, reset shape, reset kills existing session, temporary password → `PASSWORD_CHANGE_REQUIRED`, with `newPassword` → signed in, expired (clock past 24 h) → `INVALID_CREDENTIALS`, `NOT_FOUND`, `UNAUTHORISED` for both routes
- [ ] T040 [P] [US5] Admin panel `apps/web/app/admin/accounts-panel.tsx` (search, list, "Repor palavra-passe" with confirm, show temporary password once with copy button) mounted in `apps/web/app/admin/page.tsx`; copy in `apps/web/src/i18n/pt.ts` / `en.ts`

## Phase 8: Polish & Cross-Cutting

- [ ] T041 [P] E2E `apps/web/tests/e2e/accounts.spec.ts`: quickstart scenarios 1–8 (register adopts, cross-device, merge, sign-out, change password, organiser reset + forced change)
- [ ] T042 [P] Extend `tests/contract/no-voter-identity.test.ts` to cover every new route (no voter id, no account id outside organiser search, no hash)
- [ ] T043 [P] Update `README.md` voter-identity note and link ADR-012; update `voters` table comment if it still claims "no accounts" (new migration comment only, never edit applied migrations)
- [ ] T044 Run all gates: `pnpm typecheck && pnpm lint && pnpm test:unit:coverage && pnpm test:contract && pnpm boundaries && pnpm openapi:check && pnpm migrations:check && pnpm migrations:verify-rollback`
- [ ] T045 Walk quickstart.md manually against `pnpm dev`, including scenarios 9–10 and the privacy spot-checks; mark spec Status `Implemented`

## Dependencies

- Phase 1 → Phase 2 → stories.
- US1 (register) first: US2–US5 sign in to accounts it creates.
- US2 depends on US1 (needs accounts); US3 depends only on Phase 2; US4 depends on US1 (and US2 for sign-in in tests); US5 depends on US2 (forced change runs through sign-in).
- Phase 8 after all stories.

## Parallel Opportunities

- Phase 2: T007 (core tests) ∥ T012 (hasher) ∥ T013 (session cookie) once T003–T006 land.
- US1: T021 (page) ∥ T022 (header) while T019 contract tests are written.
- US2: T029 (page) ∥ T028 (contract tests) after T026.
- US3 can run alongside US2.
- US5: T040 (admin panel) ∥ T039 (contract tests) after T038.
- Phase 8: T041 ∥ T042 ∥ T043.

## Implementation Strategy

- **MVP**: Phases 1–3 + Phase 5 (register, cross-device voted state, logged-out flow intact). Sign-in on other devices needs Phase 4, so in practice ship MVP = Phases 1–5.
- Then US4 (sign-out, change password), then US5 (organiser reset) — US5 before release, since without email it is the only recovery path.
- One PR for the whole feature, pointing at the spec.
