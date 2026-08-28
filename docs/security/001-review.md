# Security review — 001-group-standings-voting

**Date**: 2026-08-27 · **Reviewer**: implementation agent · **Scope**: FR-022, SC-006, T101

Four claims were checked. Three are verified and continuously enforced by a test; the fourth is
**verified in part** and its remaining half needs a live Supabase project. That gap is stated here
rather than glossed, because an unverified deny rule reads exactly like a verified one.

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

## 4. RLS denies an anon-key client on every table — ⚠️ verified in part

`supabase/migrations/0003_rls_deny_anon.sql` enables row-level security on every table and grants the
`anon` and `authenticated` roles nothing. It applies cleanly, and
`pnpm migrations:verify-rollback` proves it reverses and re-applies.

**What has not been checked**: that an anon-key client is actually denied. The `anon` and
`authenticated` roles are created by Supabase and do not exist on a plain Postgres, so the migration
guards on `pg_roles` and becomes a no-op locally. Docker is unavailable on the development machine,
so the full Supabase stack could not be run.

The application itself does not rely on RLS: `packages/db` connects as the owner over the Postgres
wire protocol, and PostgREST — the surface an anon key would reach — is not used by any code path.
RLS is defence in depth against the project's REST surface being enabled, not the mechanism the
product's authorisation rests on. That is why this gap is a residual risk rather than a live hole,
but it remains unverified.

**To close it**: against a real Supabase project, connect with the anon key and attempt
`select`/`insert` on each of `players`, `player_ratings`, `tournaments`, `groups`, `pairs`, `voters`,
`ballots`, `ballot_entries`, `group_final_standings`, `ranking_snapshots`. Every one must be denied.

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
