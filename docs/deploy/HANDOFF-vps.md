# Handoff — deploying `apps/web` to the maintainer's VPS

**Date**: 2026-08-28 · **Branch**: `main`, pushed, CI green · **Tasks**: 114 / 127
**Scope**: Phase 10 of [tasks.md](../../specs/001-group-standings-voting/tasks.md) — T118–T127

Written for the next agent. Read this, then
[ADR-010 § Amendment](../adr/ADR-010-hosting-vercel-supabase.md#amendment--2026-08-28-appsweb-runs-on-the-maintainers-vps-not-vercel),
then Phase 10 in `tasks.md`. The application itself is finished and verified; what remains is
deployment only.

> **The implementation handoff at
> [`specs/001-group-standings-voting/HANDOFF.md`](../../specs/001-group-standings-voting/HANDOFF.md)
> is historical.** Its task counts and its "four remaining tasks" list are from before the identity
> amendment. Its *conventions* section is still accurate and worth reading.

---

## Ask the maintainer these three things first

**Do not guess any of them.** A plausible-looking nginx config that is subtly wrong is worse than no
config, because it fails as a security hole rather than as an error. Three of the tasks below cannot
be written without these.

| # | Needed | Why it blocks |
| - | ------ | ------------- |
| 1 | **The domain or subdomain** the site answers on | `server_name` and the TLS certificate. Nothing in the repo implies it |
| 2 | **The existing nginx vhost layout** — `nginx -T`, or `ls /etc/nginx/sites-enabled/` | So this vhost matches the convention already on that box rather than inventing a second one |
| 3 | **Whether a Node 22 runtime is installed** — `node -v` | The other two services there are a static site and a JVM jar, so it may well be absent. The standalone bundle needs a runtime |

Also confirm the **architecture** (`uname -m`). The maintainer reported **x86_64**, which is the good
case: GitHub Actions `ubuntu-latest` matches it, so the native addon can be built in CI and shipped
as-is. On `aarch64` it would need an ARM runner or a rebuild on the host.

**The host address is deliberately not recorded in this repository.** The repo is public. Get it from
the maintainer, or from the `deploy.yml` of their other services.

---

## The house deploy idiom — match it, don't invent

The maintainer already runs two services on that host. Both deploy the same way, and the third should
too. From their `askme-server` workflow:

1. GitHub Actions on push to `main`
2. run the tests
3. build the artifact
4. `webfactory/ssh-agent@v0.5.3` with a `DEPLOY_KEY` secret
5. `ssh-keyscan` the host into `known_hosts`
6. `rsync` the artifact to a directory under `/opt/<service>/`
7. `ssh … systemctl restart <service>.service`

There is **no Docker anywhere** on that box, and the static site is served straight from
`/var/www/<domain>/`. Do not introduce a container runtime for this one service — two deploy idioms
on one host is exactly the complexity Principle V exists to prevent, and ADR-010 § Amendment records
Docker as considered and rejected for this reason.

**`DEPLOY_KEY` already exists as a secret in the other repositories, but this repository has no
secrets at all** (verified: `gh secret list` returns empty). The maintainer will need to add
`DEPLOY_KEY` here.

---

## Two requirements that are not preferences

### 1. nginx MUST overwrite `X-Forwarded-For`, not append to it

```nginx
proxy_set_header X-Forwarded-For $remote_addr;      # correct
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # WRONG HERE
```

`clientAddress()` in [`apps/web/src/server/rate-limit.ts`](../../apps/web/src/server/rate-limit.ts)
takes the **first** hop of `X-Forwarded-For`, because on a platform that sanitises the header the
first hop is the real client. The idiomatic nginx form **appends** to whatever the caller sent, so
the caller controls the first hop and can rotate their own rate-limit key at will — defeating the
ballot rate limit entirely (Risk R2).

This is invisible at the call site, so **T122 adds a test asserting the committed config gets it
right.** Write that test; it is the only thing that stops a later edit reintroducing the hole.

### 2. Use the pooler, never the direct database endpoint

`DATABASE_URL` must be Supabase's **transaction pooler on port 6543**, not the direct 5432 endpoint.
Two independent reasons:

- Risk R8 — burst connections at the moment a tournament starts.
- **The direct endpoint resolves to IPv6 only** (verified 2026-08-28: `db.<ref>.supabase.co` has an
  AAAA record and no A record). GitHub Actions runners are IPv4-only, and many VPS hosts are too. The
  pooler is the only reachable path from CI.

`packages/db/src/client.ts` already sets `prepare: false`, which transaction-mode pooling requires.
Leave it.

---

## Environment the host needs

Six variables, all server-only, none prefixed `NEXT_PUBLIC_`. The schema in
[`apps/web/src/env.ts`](../../apps/web/src/env.ts) validates them and **throws at startup** if any is
missing or malformed — deliberately, so a half-configured deploy fails loudly instead of running
degraded. See [`.env.example`](../../.env.example).

| Variable | Notes |
| -------- | ----- |
| `DATABASE_URL` | Supabase **pooler**, port 6543. See above |
| `VOTER_COOKIE_SECRET` | ≥32 chars. `openssl rand -base64 48` |
| `ADMIN_PASSWORD_HASH` | argon2id PHC string. `pnpm tsx scripts/hash-admin-password.ts 'the password'` |
| `RANKINGS_CSV_URL` | The club sheet's CSV export. **Not committed** — ask the maintainer |
| `CRON_SECRET` | ≥32 chars. `openssl rand -hex 32`. The timer presents this as a bearer token |
| `RATE_LIMIT_SALT` | ≥16 chars. Salts the in-memory IP hash |

These belong in `/etc/padelmigas/env`, root-owned, mode `0600`, loaded by the systemd unit via
`EnvironmentFile=`. **Never in the repository, and never as plaintext in Actions logs.**

> ⚠️ **The maintainer's Supabase database password was exposed in a chat transcript on 2026-08-28 and
> should be rotated before this goes live.** Confirm it has been. Settings → Database → Reset database
> password, then update `/etc/padelmigas/env` and the local `apps/web/.env.local`.

---

## Gotchas that already cost time

These are all verified, and each one produced a confusing failure before it was understood.

1. **A gate that has never run against a committed tree proves nothing.** Five separate defects this
   session came from this single cause. `tests/architecture/boundaries.test.ts` shells out to
   `git grep`, which sees **tracked files only** — the tree was untracked for seven phases, so it
   passed vacuously and hid four real Principle III violations. `ci.yml` was itself untracked, so the
   workflow had never executed and its first real run died on a duplicate pnpm version pin. **Commit
   before trusting any gate**, and be suspicious of a green check on a new file.

2. **That same boundary grep matches prose.** Writing the forbidden pattern literally in a comment —
   even to document it — trips the rule. Describe it; don't quote it. See
   [`apps/web/src/api.ts`](../../apps/web/src/api.ts).

3. **`pnpm db:apply` replays every migration from scratch and has no tracking table.** It is a
   scratch-database tool. Against a database that already has the schema it fails with
   `relation "players" already exists`. It also reads **`TEST_DATABASE_URL` only**, never
   `DATABASE_URL` — so migrating a real database means setting that oddly-named variable, or applying
   the SQL directly. Worth fixing; not yet fixed.

4. **`next.config.ts` needs the webpack `extensionAlias`.** Workspace packages are ESM and import
   siblings as `./x.js` while the file on disk is `./x.ts`. TypeScript and Vitest resolve that
   natively; webpack does not, and without the alias the app does not compile at all even though
   every other gate passes. Do not remove it when adding `output: 'standalone'`.

5. **`pnpm test:contract` needs `--no-file-parallelism`.** A workspace project does not honour
   `fileParallelism`; without the flag contract files truncate each other's rows and every suite
   passes alone while the whole fails.

6. **`@node-rs/argon2` is a native addon** and is in `serverExternalPackages`, so it is never bundled.
   A wrong architecture or libc fails **at process start, not at build**. T119 exists to catch this
   before a deploy does.

7. **`specs/**` and `docs/**` markdown are prettier-ignored** — Prettier reflows spec tables and
   rewrites `- [X]` to `- [x]`, which makes spec diffs unreadable.

---

## Repository conventions

- **Spec before code, always** (Constitution Principle I, NON-NEGOTIABLE). A change that contradicts
  a shipped requirement is recorded by **amending 001's artifacts in place** with a dated note — not
  by minting a new feature number, which would fork `.specify/feature.json`. Five amendments exist;
  follow their shape. Run `/speckit-analyze` after amending and before implementing.
- **Commit messages carry no Claude attribution and no `Co-Authored-By` trailer.** The maintainer
  asked for this explicitly. Long-form messages explaining *why* are the house style.
- **The repo is public.** No real player names, no club names, no ranking sheet URL, no host address.
  Every committed fixture uses fictional names.
- **Never read the wall clock outside `packages/db/src/clock.ts`.** ESLint enforces it; the allowlist
  is `clock.ts`, `admin-auth.ts`, `voter-cookie.ts`, plus tools/scripts/tests.
- Comments explain *why* and cite the FR/SC/ADR/Risk they serve. Match that density.

---

## Verifying your work

Run from the repo root with `TEST_DATABASE_URL` exported. All eleven pass on `main` today, and CI
(four jobs) is green.

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm boundaries \
  && pnpm test:unit && pnpm test:unit:coverage && pnpm test:contract \
  && pnpm migrations:check && pnpm migrations:verify-rollback \
  && pnpm openapi:check && pnpm --filter @padelmigas/web build
```

Local Postgres for the contract suite — **Docker is unavailable on the maintainer's machine**, so this
targets native Postgres 18 (Homebrew). The `LC_ALL=C` is required; without it Postgres 18 aborts with
`postmaster became multithreaded during startup`:

```bash
LC_ALL=C /opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /tmp/pg18.log start
```

```bash
psql -d postgres -c "CREATE DATABASE padelmigas_test;" && export TEST_DATABASE_URL="postgresql://$(whoami)@localhost:5432/padelmigas_test" && pnpm db:apply
```

**E2E is green because it tests nothing.** Both specs skip themselves when their fixtures are absent,
which is deliberate — a fixture-less run should be honest rather than green. But it does mean E2E
currently provides no coverage: the job points `RANKINGS_CSV_URL` at `127.0.0.1:4599`, nothing serves
it, and no sync step runs, so the database has no players and no lineup could reference one. Making
these specs real means serving a fixture CSV, syncing it, and deriving `E2E_LINEUP_JSON` from those
players. Do not read a green E2E job as "the flows work".

---

## What is already true, so you don't re-derive it

- **The app is complete and verified.** 8 `/api/v1` routes, 5 public screens, 1 organiser screen.
- **Supabase is live** — EU region, Postgres 17.6, 6 migrations applied, **784 players and 12,280
  rating snapshots imported**. The import is idempotent.
- **Identity is the normalised name**, not the sheet's `ID` (FR-004 as amended). The sheet is
  third-party maintained and its `ID` column is not unique — 784 rows, 756 distinct ids, 18 shared by
  46 different people. `players.match_key` is the sole identity key and its collision check is the
  only guard on identity.
- **T101 security review is closed**, all four claims verified, including RLS denying `anon` and
  `authenticated` on all 10 tables and both aggregate views, executed rather than inferred.
- **Three tasks outside deployment remain open** and need people or a deployed environment, not code:
  T095 load test, T098 quickstart V1–V6, T099 usability timing. Each has a document saying exactly
  what is missing: `docs/perf/`, `quickstart.md` § Outcomes, `docs/usability/`.

## Suggested order

T118 → T119 (prove the bundle runs before building a pipeline around it) → T120 → **T121 and T122
together**, so the header rule and its test land in one change → T123 → T124 → T125 → T126 → T127.

Do not skip T125. ADR-010 § Amendment accepts the loss of platform rollback as a cost of leaving
Vercel, and T125 *is* the mitigation. Without it a bad deploy has no way back.
