# Implementation Plan: Optional Voter Accounts

**Branch**: `004-voter-accounts` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-voter-accounts/spec.md`

## Summary

Let a visitor optionally register a username + password so their "already voted" state follows
them across devices, while logged-out voting stays exactly as today (ADR-012).

Approach: one new table, `accounts`, where each account **owns exactly one existing `voters` row**.
Every ballot rule and read path (`UNIQUE (group_id, voter_id)`, `findOwn`, `votedGroupIds`, the
reveal gate, the counts views) keeps keying on `voter_id` and is untouched. What changes is *how
the caller's voter is resolved*:

- A signed `pm_account` cookie, when valid, resolves to the account's voter.
- A `pm_voter` cookie resolves as today, **unless that voter is owned by an account**, in which case
  it is ignored. That one rule makes sign-out, password change and reset end access to the
  account's ballots on every device, with no server-side session table.
- Sessions carry a `sessionVersion`; bumping it on the account (password change, reset) kills every
  other session.

Sign-in merges the device's anonymous voter into the account in one transaction, using a pure
decision in `core/accounts` (move / discard / leave per ballot, with "leave" for conflicts in closed
groups — clarification 2026-10-12). A temporary password from an organiser reset never yields a
session: sign-in with it answers `PASSWORD_CHANGE_REQUIRED`, and the same sign-in call with a
`newPassword` sets it and signs in (FR-321).

## Technical Context

**Language/Version**: TypeScript 5.7, `strict`, Node ≥ 22

**Primary Dependencies**: unchanged — Next.js App Router (host), Zod (contracts), `postgres` (db),
`jose` (cookies), `@node-rs/argon2` (already used for the organiser password)

**Storage**: Supabase Postgres; one additive migration `0008_voter_accounts.sql`

**Testing**: Vitest `unit` (100% branch on `core/accounts`), `contract` (scratch Postgres) for every
new route and the merge; Playwright e2e for register / sign-in-merge / sign-out / reset

**Target Platform**: existing VPS deployment (docs/deploy/vps.md); no new env var

**Project Type**: web application in the existing monorepo

**Performance Goals**: sign-in is one argon2id verify (~tens of ms) plus one transaction over at
most a few dozen ballots; no target beyond "completes within the request"

**Constraints**: merge is all-or-nothing (FR-312); no IP stored (FR-302, FR-317); password hashes
never leave the server (FR-306); API change is additive only (Principle III)

**Scale/Scope**: one club; tens to low hundreds of accounts; a voter holds ≤ ~50 ballots

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-driven | Spec 004 written and clarified before this plan; constitution amended to v1.1.0 first | PASS |
| II. Portable core | Username normalisation, merge decision and temporary-password expiry are pure in `core/accounts`; hashing behind a `PasswordHasher` port implemented by the host; routes parse → one handler → respond | PASS |
| III. Contract-first | `/api/v1/account*` and `/api/v1/admin/accounts*` defined in `packages/contracts` first; additive; client + OpenAPI regenerated | PASS |
| IV. Server-authoritative | One-ballot rule unchanged; merge and session validity decided server-side; `accounts` added to deny-anon RLS | PASS |
| V. Simplicity | No new dependency, service, env var or session table; one table; reuses argon2 setup, jose, rate limiter | PASS |
| Data: voter identity / privacy (v1.1.0) | Username + argon2id hash only; no email; IP still never stored | PASS |
| Data: migrations | Committed SQL with rollback block | PASS |
| Gates | typecheck, lint, unit, contract, boundaries, openapi:check | PASS (to verify) |

Post-design re-check: unchanged — PASS.

## Project Structure

### Documentation (this feature)

```text
specs/004-voter-accounts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/README.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
supabase/migrations/0008_voter_accounts.sql          # accounts table, RLS deny-anon, rollback
packages/contracts/src/
├── common.ts             # + USERNAME_TAKEN, INVALID_CREDENTIALS, PASSWORD_CHANGE_REQUIRED, accountId
├── accounts.ts           # NEW: username/password schemas, register/sign-in/change/me, admin search/reset
├── index.ts              # re-export
└── endpoints.ts          # + register, signIn, signOut, getAccount, changePassword,
                          #   searchAccounts, resetAccountPassword
packages/core/src/
├── domain/index.ts       # + Account
├── accounts/             # NEW: normaliseUsername, planDeviceMerge, temporaryPasswordState,
│                         #      generateTemporaryPassword (100% branch)
├── ports/index.ts        # + AccountRepository, PasswordHasher; VoterRepository.isOwned
└── errors.ts             # new codes → 409 / 401 / 403
packages/db/src/
├── accounts.ts           # NEW: create (adopting a voter), findById/ByUsername, search,
│                         #      setPassword, resetPassword, mergeDeviceVoter (one transaction)
├── ballots.ts / repositories.ts  # VoterRepository.isOwned; wire accounts repo
└── index.ts
packages/api/src/
├── handler.ts            # Deps + accounts, passwords; CallerContext.accountId
└── handlers/accounts.ts  # NEW: register, getAccount, signIn (forced change + merge),
                          #      changePassword, searchAccounts, resetAccountPassword
apps/web/
├── src/server/
│   ├── account-session.ts   # NEW: sign/verify pm_account (aud 'account', claim sv), cookies
│   ├── account-routes.ts    # NEW: auth rate limit, session cookies for the account routes
│   ├── voter-cookie.ts      # caller resolution: account session first; owned pm_voter ignored
│   ├── page-data.ts         # caller() uses the same resolution
│   ├── password-hasher.ts   # NEW: PasswordHasher over @node-rs/argon2 + ARGON2_OPTIONS
│   ├── rate-limit.ts        # named buckets: 'ballot' (unchanged) and 'auth'
│   └── deps.ts              # wire accounts + passwords
├── app/api/v1/account/route.ts                 # POST register, GET me
├── app/api/v1/account/session/route.ts         # POST sign in, DELETE sign out
├── app/api/v1/account/password/route.ts        # PUT change password
├── app/api/v1/admin/accounts/route.ts          # GET search
├── app/api/v1/admin/accounts/[accountId]/password-reset/route.ts   # POST reset
├── app/(public)/entrar/page.tsx, registar/page.tsx, conta/page.tsx  # NEW pages
├── app/layout.tsx                               # header: username + Sair / Entrar · Registar
├── app/admin/accounts-panel.tsx + page.tsx      # search + "Repor palavra-passe"
├── components/AccountForms.tsx, src/return-path.ts   # forms, safe ?depois= redirect
└── src/i18n/{pt,en}.ts
tests/contract/accounts.test.ts, admin-accounts.test.ts, no-voter-identity.test.ts (account case)
apps/web/tests/e2e/accounts.spec.ts
docs/adr/ADR-012-optional-voter-accounts.md (done)
```

**Structure Decision**: existing monorepo layout; one new core module, one new db module, six new
handlers, five new route files, three public pages, one admin panel, one migration.

## Design Notes

**Caller resolution** (shared by route handlers and server components, `voter-cookie.ts`):

1. `pm_account` verifies (issuer, audience `account`) → load account → `sv` equals
   `session_version` → caller is `{ voterId: account.voterId, accountId }`.
2. Else `pm_voter` verifies → voter exists → **not owned by an account** → caller is that voter.
3. Else nobody. `requireVoter` (ballot route only) mints a fresh anonymous voter as today.

Register and sign-in set `pm_account` and **clear `pm_voter`**; sign-out clears both (FR-316).
After a reset or a password change elsewhere, a stale device falls through to step 3 and becomes a
fresh visitor.

**Sign-in** (`sign-in.ts`): normalise username → load → verify (dummy verify on unknown username so
timing does not reveal existence) → temporary-password state:
- expired → `INVALID_CREDENTIALS`;
- pending and no `newPassword` → `PASSWORD_CHANGE_REQUIRED`;
- pending with valid `newPassword` → set it, clear the flag, bump `session_version`.
Then `accounts.mergeDeviceVoter` (when the device's `pm_voter` is valid and unowned) and return the
account + `sessionVersion` for the route to sign.

**Merge** (`db/accounts.mergeDeviceVoter`, one transaction): lock both voter rows `FOR UPDATE`; read
the device voter's ballots with each group's tournament; read the account voter's group ids; call
`core/accounts.planDeviceMerge` with `isVotingOpen` per ballot; `UPDATE ballots SET voter_id` for
`move`, `DELETE` for `discard` (entries cascade), nothing for `leave`. A concurrent unique violation
aborts the whole sign-in (FR-312); the user retries.

**Rate limiting**: `rate-limit.ts` gains a bucket name. `'auth'`: 10 attempts / 10 min per hashed
IP, shared by register and sign-in; same in-memory, salted, never-logged rules (FR-317).

## Complexity Tracking

None.
