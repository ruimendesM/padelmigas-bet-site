# Implementation handoff — 001-group-standings-voting

**Date**: 2026-08-27 · **Branch**: `main` (uncommitted working tree) · **Tasks done**: 97 / 101 (updated 2026-08-27, second session)

Written for the next agent picking up `/speckit-implement`. Read this, then `tasks.md`.

> **Historical as of 2026-08-28 — the counts below are out of date.** Two more phases have landed
> since (the FR-004 identity amendment, and the Principle III fix), the state is now 114/127, and
> T101 is closed. **If you are here to deploy, read
> [`docs/deploy/HANDOFF-vps.md`](../../docs/deploy/HANDOFF-vps.md) instead.** What is still accurate
> in this file: the "How to get running" section, the three spec amendments, the bugs the gates
> caught, and the conventions at the end.

> **Second session update (2026-08-27).** Everything below still holds. The four tasks left open are
> T095 (load test), T098 (manual quickstart), T099 (usability timing) and T101 (the RLS half of the
> security review) — all four need a deployed environment or other people, and each has a document
> recording exactly what is missing and how to close it:
> `docs/perf/2026-vote-loadtest.md`, `specs/001-group-standings-voting/quickstart.md` (Outcomes),
> `docs/usability/2026-ballot-timing.md`, `docs/security/001-review.md`.
>
> Two build-level fixes worth knowing: `apps/web/next.config.ts` needed a webpack `extensionAlias` so
> ESM `.js` specifiers resolve to `.ts` sources (without it the app did not compile at all, though
> every other gate passed), and `test:contract` needs `--no-file-parallelism` — a workspace project
> does not honour `fileParallelism`, and without the flag contract files truncate each other's rows
> and every suite passes alone while the suite as a whole fails.

---

## How to get running

```bash
pnpm install
```

Local Postgres 18 (Homebrew) is the scratch database — **Docker is unavailable on this machine**, so
`supabase start` is not an option and the contract suite targets native Postgres.

Start it (the `LC_ALL=C` is required; without it Postgres 18 aborts with
`postmaster became multithreaded during startup`):

```bash
LC_ALL=C /opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /tmp/pg18.log start
```

Then create and migrate the scratch database:

```bash
psql -d postgres -c "CREATE DATABASE padelmigas_test;"
```

```bash
export TEST_DATABASE_URL="postgresql://$(whoami)@localhost:5432/padelmigas_test" && pnpm db:apply
```

## Gate status — all green as of this handoff

Run from the repo root with `TEST_DATABASE_URL` exported.

| Gate                             | Command                           | State                                    |
| -------------------------------- | --------------------------------- | ---------------------------------------- |
| Typecheck (root, 6 pkgs, web)    | `pnpm typecheck`                  | ✅ clean                                 |
| Lint                             | `pnpm lint`                       | ✅ clean                                 |
| Format                           | `pnpm format:check`               | ✅ clean                                 |
| Import boundaries (Principle II) | `pnpm boundaries`                 | ✅ 0 violations, 100 modules             |
| Unit tests                       | `pnpm test:unit`                  | ✅ 146 passing                           |
| Core branch coverage             | `pnpm test:unit:coverage`         | ✅ 100% on scoring/ballot/window/matching |
| Contract tests                   | `pnpm test:contract`              | ✅ 76 passing, 10 files                  |
| Migration rollback lint          | `pnpm migrations:check`           | ✅ 5 migrations                          |
| Migration rollback **execution** | `pnpm migrations:verify-rollback` | ✅ all 5 reverse cleanly and re-apply    |
| OpenAPI drift                    | `pnpm openapi:check`              | ✅ matches the Zod schemas               |
| Production build                 | `pnpm --filter @padelmigas/web build` | ✅ compiles; every voter-dependent route dynamic |
| E2E                              | `pnpm test:e2e`                   | ⚠️ specs written, need a deployed environment and seeded fixtures |

The E2E specs skip themselves rather than fail when `E2E_ADMIN_PASSWORD`, `E2E_LINEUP_JSON` or
`E2E_TOURNAMENT_SLUG` are absent — a fixture-less run should be honest about not having tested
anything, not green.

---

## Three spec amendments made during implementation

All three were recorded in the spec artifacts before any code depended on them, per Constitution
Principle I ("resolved by amending the spec first, not by diverging silently in code").

### 1. Database driver: `postgres` (postgres.js), not `@supabase/supabase-js`

**Why**: PostgREST — the protocol `supabase-js` speaks — cannot open a multi-statement transaction,
and two requirements are specified *as* transactions: publishing inserts tournament + groups + pairs
atomically (FR-007, T043), and casting a ballot inserts the ballot plus its entries atomically so a
rejected ballot leaves nothing behind (FR-010, T062). It also lets the contract suite run against a
plain `postgres:17` container in CI instead of the full Supabase stack.

**Recorded in**: `plan.md` (Constitution Check section), `research.md` D3, `ADR-003` (new
"Amendment" section), `tasks.md` T008 and T020.

**Consequence**: the boundary rule was *widened*, not relaxed — `no-supabase-outside-db` became
`no-db-client-outside-db` and now forbids `postgres`, `pg` and `@supabase/*` anywhere outside
`packages/db`.

### 2. `DATABASE_URL` replaces `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

Direct consequence of (1) — one pooler connection string replaces the pair. Recorded in
`quickstart.md`'s environment table with a visible amendment note, plus `.env.example`,
`apps/web/src/env.ts`, `turbo.json` and `tasks.md` T008.

**Use the pooler (port 6543), not direct 5432** — Risk R8.

### 3. New table `ranking_snapshots` (migration `0005`)

**Why**: Risk R3's mitigation requires storing the raw CSV so an unreachable sheet falls back to the
last good copy — but `data-model.md` defined nowhere to write it. A filesystem was rejected: the host
is serverless and its disk does not survive an invocation.

**Recorded in**: `data-model.md` (new table section + index list, with an amendment note).

---

## Bugs the gates caught (worth knowing, so they are not reintroduced)

1. **`0003_rls_deny_anon.sql`'s rollback was not executable.** The forward path guards on
   `pg_roles` existence (`anon`/`authenticated` are Supabase-created and absent on plain Postgres);
   the rollback did not. Found by `scripts/verify-migration-rollback.ts`, which I added for exactly
   this reason — a rollback that has never run is worse than none.

2. **`.dependency-cruiser.cjs` had `exclude: ['node_modules', ...]`**, which deleted every external
   dependency from the graph and therefore **silently disabled every rule about `next`, `react`,
   `postgres` and `@supabase/*`** — the rules Principle II actually rests on. Found by the meta-test
   in `tests/architecture/boundaries.test.ts` (T029). `doNotFollow` is now used instead.

3. **External-package rules must match two forms.** dependency-cruiser reports a bare specifier as
   its own name when unresolvable from the importing package, and as a `node_modules/...` path when
   it happens to be reachable (e.g. a root devDependency under pnpm). The `externalPackages()`
   helper at the top of `.dependency-cruiser.cjs` builds a regex covering both. Matching one form
   only disables the rule in the other case.

**Keep the T029 meta-test passing.** It is the only thing standing between the boundary config and
quiet decay.

---

## Sequencing note: `packages/db` landed ahead of its task numbers

`apps/web/src/server/deps.ts` is foundational plumbing that T023's route adapter needs, and it cannot
typecheck without every port implementation. So all of `packages/db` was written during Phase 2
rather than spread across Phases 3–6. The affected task checkboxes (T042, T043, T044, T062, T076,
T086) are ticked because the code exists and typechecks.

**This does not exempt them from tests.** The contract tests that exercise these repositories
(T033–T036, T057, T058, T071, T083) are still unwritten, and the constitution requires them. Write
them before trusting the SQL — none of it has executed against a database yet beyond the migrations.

---

## What exists

Everything below is implemented, typechecked and covered by the gates above.

```
packages/
├── contracts/   ✅ common, tournaments, results, ballots, players, endpoints registry
├── core/        ✅ domain, errors+HTTP map, ports, matching, lineup, rankings/parse,
│                   window, ballot, scoring, reveal   ← the four gated modules at 100% branch
├── api/         ✅ handler.ts, views.ts, all 8 handlers
├── db/          ✅ every port implemented
├── client/      ✅ generated (8 operations)
└── ui-logic/    ✅ format, query, ballot draft state, results formatting

apps/web/
├── app/(public)/            ✅ landing, torneios/[slug], historico, jogadores/[playerId]
├── app/admin/page.tsx       ✅ sign in, paste, preview, publish, rankings sync
├── app/api/v1/**            ✅ all 8 route adapters
├── app/api/admin/session/   ✅ organiser sign-in (outside /api/v1 — host plumbing, not product API)
├── components/              ✅ BallotForm, GroupResults, states/
├── src/server/              ✅ adapter, deps, admin-auth, voter-cookie, rate-limit, page-data
└── tests/e2e/               ✅ publish-lineup, vote-and-reveal (need fixtures to run)

tests/
├── architecture/  ✅ boundaries (meta), reserved-tables, no-hardcoded-copy, no-secrets-in-client
├── contract/      ✅ 10 files, 76 tests — every /api/v1 route, every documented failure code,
│                     plus no-leakage-aggregates and no-voter-identity
└── factories/     ✅

tools/
├── rankings-sync/ ✅ CLI over the same handler the route and the scheduler call
└── loadtest/      ✅ k6 script, not yet run (needs a deployed environment)
```

### Design decisions taken this session

- **Server components call handlers in-process**; interactive components go over HTTP through
  `@padelmigas/client`. That is what `plan.md`'s architecture diagram specifies (`Pages --> API`) and
  what ADR-002 argues for. `apps/web/src/server/page-data.ts` is the one place that does it.
- **The reveal is decided once, server-side.** Pages pass `resultsStateFor` a boolean the server
  already computed; no component can re-decide it. A second opinion about the gate would be a second
  place for Risk R1 to hide.
- **`isRevealed` treats a draft as never revealed.** The naive form ("not open ⇒ closed ⇒ reveal")
  would expose an unpublished tournament whose start instant had passed.
- **Ballot validation reports the most specific failure first** — unknown pair, then wrong count,
  then a missing pair, then a duplicate position, then an out-of-range position. Each ordering choice
  is the one that produces the useful message rather than the first-detected one.
- **Two defensive branches were removed from `core/scoring`** rather than tested around: the map
  lookup that could not miss, and the equal-ids comparator arm that could not tie (T096).

---

## Next steps

Four tasks remain, and every one needs something this machine does not have. Each has a document
stating exactly what is missing and how to close it — none is marked done:

| Task | Blocked on | Where the detail lives |
| ---- | ---------- | ---------------------- |
| T095 load test | A deployed environment | `docs/perf/2026-vote-loadtest.md` — script ready, thresholds fixed |
| T098 quickstart V1–V6 | A real Supabase project and the real sheet | `quickstart.md` § Outcomes — table of what each scenario already has automated |
| T099 usability timing | Two people who have not seen the site | `docs/usability/2026-ballot-timing.md` — protocol written |
| T101 security review | A live Supabase project for the RLS half | `docs/security/001-review.md` — three of four claims verified |

T101 is worth reading before assuming it is a formality: three claims are verified and continuously
enforced by tests; the fourth (RLS denying an anon-key client) applies cleanly but has never been
executed against a real `anon` role, because that role does not exist on plain Postgres.

---

## Conventions to keep

- **Never read the wall clock outside `packages/db/src/clock.ts`.** ESLint's `no-restricted-syntax`
  bans `new Date()` and `Date.now()`; the allowlist is `clock.ts`, `admin-auth.ts` and
  `voter-cookie.ts` (JWT lifetimes, not the voting window), plus tools/scripts/tests.
- **Add an endpoint by adding it to `packages/contracts/src/endpoints.ts`**, then
  `pnpm generate:client && pnpm generate:openapi`. `pnpm openapi:check` fails CI otherwise.
- **`specs/**` and `docs/**` markdown are prettier-ignored** — Prettier reflows spec tables and
  rewrites `- [X]` to `- [x]`, which makes spec diffs unreadable.
- **`pnpm` 12 names the build allowlist `allowBuilds`** (a map) in `pnpm-workspace.yaml`, not
  `onlyBuiltDependencies`.
- Comments explain *why*, and cite the FR/SC/ADR/Risk they serve. Match that density.
