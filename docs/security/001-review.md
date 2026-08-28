# Security review — 001-group-standings-voting

**Date**: 2026-08-27, updated 2026-08-28 · **Reviewer**: implementation agent · **Scope**: FR-022,
SC-006, T101

Four claims were checked and **all four are now verified**. Three are continuously enforced by a
test. The fourth — RLS denying an anon-key client — stood as *verified in part* until 2026-08-28,
because the `anon` role is created by Supabase and does not exist on a plain Postgres, so the
migration was a no-op on every local run. It was executed against a real Supabase project on
2026-08-28 and is recorded in §4. The gap was stated rather than glossed for as long as it existed,
because an unverified deny rule reads exactly like a verified one.

---

## 1. No service-role key or server secret in any client bundle — ✅ verified

`apps/web/src/env.ts` is the only module that reads a server variable, and nothing in the product is
prefixed `NEXT_PUBLIC_` — that prefix is the only mechanism by which a value reaches the browser.

Checked two ways:

- `tests/architecture/no-secrets-in-client.test.ts` fails the build if any component, page or
  client module reads `DATABASE_URL`, `CRON_SECRET`, `ADMIN_PASSWORD_HASH`, `VOTER_COOKIE_SECRET`,
  `RATE_LIMIT_SALT` or `RANKINGS_CSV_URL` directly, or introduces a `NEXT_PUBLIC_` variable.
- Grep over the built client chunks (`apps/web/.next/static`) after `pnpm --filter @padelmigas/web
  build`: no variable name and no `postgres://` connection string appears.

There is no service-role key in the product at all. ADR-003 was amended during implementation to use
the Postgres wire protocol (postgres.js) rather than the Supabase SDK, so the credential is one
pooler connection string, held server-side, and PostgREST is not used.

## 2. `no-store` on every voter-dependent response — ✅ verified

`apps/web/src/server/adapter.ts` sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
plus `Pragma: no-cache` on **every** response it produces, success and failure alike, rather than on
the ones someone remembered to mark. Every page whose content depends on the caller is
`export const dynamic = 'force-dynamic'`.

Asserted in the contract suite:

- `tests/contract/tournament-detail.test.ts` — "sends no-store, because the same URL answers
  differently per caller".
- `tests/contract/group-results.test.ts` — "sends no-store on both the reveal and the refusal". The
  refusal matters as much as the reveal: a cached 403 would pin a voter's pre-vote state.

A cached reveal is Risk R1, and it is the failure this control exists for.

## 3. No voter identifier reachable from any public path — ✅ verified

`tests/contract/no-voter-identity.test.ts` asserts, against the raw response text and every response
header:

- No voter id appears in any body or header of `GET /tournaments`, `GET /tournaments/{slug}`,
  `GET /groups/{id}/results` or `GET /players/{id}`, for a caller who has voted.
- The signed cookie value is never echoed into a body.
- No endpoint enumerates ballots — asserted against the endpoint registry itself, so a future route
  that did would fail the test rather than merely be noticed in review.
- With a single ballot in a group and voting closed, the aggregate is public and still cannot be
  attributed: the ordering is visible, and nothing says whose it is.

`hasVoted` is a boolean about the caller and carries nothing identifying. Per-IP rate limiting keeps
a salted hash in memory only: never written to Postgres, never logged (`apps/web/src/server/rate-limit.ts`).

## 4. RLS denies an anon-key client on every table — ✅ verified 2026-08-28

`supabase/migrations/0003_rls_deny_anon.sql` enables row-level security on every table and grants the
`anon` and `authenticated` roles nothing. It applies cleanly, and
`pnpm migrations:verify-rollback` proves it reverses and re-applies.

**Verified against a real Supabase project on 2026-08-28** (project in an EU region, Postgres 17.6),
which is the first environment where the `anon` and `authenticated` roles have actually existed —
they are created by Supabase and are absent from a plain Postgres, so the migration's `pg_roles`
guard made it a no-op on every earlier run. Docker being unavailable on the development machine is
what had blocked this until a real project existed.

Observed state, all ten tables:

| Property                                             | Result                          |
| ---------------------------------------------------- | ------------------------------- |
| `relrowsecurity` (RLS enabled)                       | true on all 10                  |
| `relforcerowsecurity` (applies to the owner too)     | true on all 10                  |
| Policies in `pg_policies`                            | **0** — deny-by-default          |
| `anon` / `authenticated` grants in `role_table_grants` | **none**                       |

And the denial was executed rather than inferred. Under `SET LOCAL ROLE anon` and again under
`SET LOCAL ROLE authenticated`, a `select` was attempted on `tournaments`, `ballots`,
`ballot_entries`, `voters` and `players`, and on both aggregate views `group_ballot_counts` and
`group_position_counts` — the two objects through which a vote count could leak (Risk R1). Every one
failed with `42501 permission denied`. A write was attempted as `anon`
(`insert into voters`) and also failed with `42501`.

The views matter as much as the tables: a view is queried with its owner's privileges, so a grant
there would have bypassed the table denials entirely. Both are denied.

**Residual note**: this verifies the SQL-level denial, which is the mechanism PostgREST would run
under. It does not exercise a PostgREST round trip with a literal anon API key, because the project's
REST surface is not used by any code path — `packages/db` connects as the owner over the Postgres
wire protocol. RLS here remains defence in depth against that surface being enabled later, and it is
now confirmed to hold.

---

## Other observations

- **Organiser auth** (FR-006): one argon2id-hashed password, exchanged for an HS256 session cookie
  that is `HttpOnly; Secure; SameSite=Strict`, eight-hour lifetime. A wrong password and a
  misconfigured hash are reported identically, so the response does not disclose whether the
  deployment is configured.
- **The cron secret is accepted by one route only** — the rankings sync — and compared in constant
  time. Asserted in `tests/contract/admin-rankings-sync.test.ts`, including that a wrong bearer is
  refused. Widening it to the publish route would put a public tournament one leaked secret away.
- **The voter cookie** is `HttpOnly; Secure; SameSite=Lax`. Lax rather than Strict is deliberate: a
  voter arriving from a shared WhatsApp link must be recognised, or they would appear never to have
  voted (FR-014). It carries no personal data, and a forged one fails signature verification.
- **Reads never mint an identity.** Only the ballot route creates a voter, so a shared link cannot
  hand one identity to several people, and browsing does not fill `voters` with rows.
- **Accepted by design** (ADR-004): a determined person can vote again from a fresh browser profile.
  This is a friendly local prediction game; the alternative is collecting personal data to prevent
  it, which the spec explicitly refuses.
