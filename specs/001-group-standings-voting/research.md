# Phase 0 Research: Group Standings Voting

**Date**: 2026-08-27 | **Plan**: [plan.md](./plan.md)

No `NEEDS CLARIFICATION` markers remained in the Technical Context; this document records the
decisions behind it, plus the two empirical checks that were run against real data before designing.

## Empirical findings

### F1 — The ranking sheet is publicly exportable as CSV

The club ranking spreadsheet exports without credentials via
`https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>` (HTTP 307 → 200 after
following the redirect). Shape observed on 2026-08-27:

- 783 player rows plus a header.
- Columns: `ID`, `Nome`, then 17 dated rating columns (most recent first, e.g. `26/08/2026`).
- Date headers are inconsistently formatted (`26/08/2026` and `22-08-2026` both occur) and must be
  parsed tolerantly, not assumed.

The concrete document id and sheet gid are deliberately **not committed**; they are supplied at
runtime through `RANKINGS_CSV_URL`. Player names in every committed example and fixture are
fictional — see [contracts/lineup-payload.example.json](./contracts/lineup-payload.example.json).

**Consequence**: no OAuth, no service account, no manual export step. The sync tool is a scheduled
HTTP GET plus an upsert. The dated columns give a free rating history, which populates
`player_ratings` and lets a tournament capture points as of its publish date (FR-007).

### F2 — Names are unique and match the lineup after normalisation

Checked the 24 names from a real 12-pair lineup against the sheet:

- 783 rows, **0 duplicate names** → a name is a usable match key today.
- 23 of 24 matched byte-for-byte. The single miss differed only in the capitalisation of a name
  particle — the lineup wrote it lower-case, the sheet upper-case (illustrated in the committed
  fixture as `Rodrigo da Costa` vs `Rodrigo Da Costa`). **24 of 24 match after case folding.**

**Consequence**: normalised exact matching (NFC → case fold → collapse whitespace) is sufficient and
fuzzy matching is unnecessary. Because uniqueness is a property of today's data and not a guarantee,
the importer re-checks for duplicate match keys on every sync and fails loudly (ADR-007).

## Decisions

### D1 — Repository shape: monorepo with portable core packages

- **Decision**: pnpm workspaces + Turborepo; domain logic in `packages/core`, application handlers
  in `packages/api`, contracts in `packages/contracts`, shared client state in `packages/ui-logic`;
  `apps/web` is the only Next.js-aware directory.
- **Rationale**: both stated future intents (React Native app, standalone API service) are adapter
  swaps under this layout. Import boundaries are machine-checkable, so the property does not decay.
- **Alternatives considered**: single Next.js app with `lib/` (fastest start, but the mobile and
  detach paths both become rewrites — the boundary is unenforceable and always erodes); Nx
  (more capable generators and caching than needed here, heavier config); two separate repos for web
  and API (real isolation, but duplicated contracts and a versioning problem on day one).
- **See**: [ADR-001](../../docs/adr/ADR-001-monorepo-portable-core.md)

### D2 — API host: Next.js route handlers now, detachable later

- **Decision**: `/api/v1/**` served by Next.js route adapters that only parse, call one handler, and
  serialise.
- **Rationale**: one deploy target, one language, shared contracts, and server-only secrets — while
  keeping every business rule outside the framework.
- **Alternatives considered**: clients talking straight to Supabase PostgREST with RLS (least code,
  but the vote-to-reveal gate, permutation validation and Borda ordering would live in SQL/RLS where
  they are hard to test and evolve — rejected against Principle IV and the testability requirement);
  a standalone Fastify service from the start (cleanest boundary, but a second deploy target, second
  CI pipeline and second set of secrets for a club-sized product — rejected against Principle V).
- **See**: [ADR-002](../../docs/adr/ADR-002-nextjs-route-handlers-as-api-host.md)

### D3 — Storage: Supabase Postgres, server-only access

- **Decision**: Supabase Postgres in an EU region; the anon key is never used for data access; RLS
  denies the anon role on every table; all access flows through `packages/db` with the service-role
  key held in server environment variables.
- **Rationale**: relational data with hard uniqueness rules (one ballot per voter per group, one
  position per ballot) belongs in a relational store with those constraints declared. Postgres also
  aggregates ballots directly, removing any need for a separate analytics path.
- **Alternatives considered**: Supabase with client-side access under RLS (fewer moving parts,
  rejected as above); SQLite/Turso (cheap and fast, but weaker managed-backup story and no
  meaningful gain here); a document store (rejected — the ballot uniqueness rules are exactly what a
  relational engine enforces for free).
- **See**: [ADR-003](../../docs/adr/ADR-003-supabase-postgres-server-only.md)

### D4 — Voter identity: signed httpOnly cookie

- **Decision**: on first visit, mint a `voters` row and set a signed, httpOnly, `SameSite=Lax`,
  long-lived cookie carrying that voter id.
- **Rationale**: zero friction, satisfies one-ballot-per-group enforcement, needs no auth provider,
  and works unchanged when a mobile client stores the same token in secure storage.
- **Alternatives considered**: Supabase anonymous auth (equivalent strength, adds an auth dependency
  and a JWT refresh path for no gain in phase 1); browser fingerprinting (stronger dedupe, but
  privacy-hostile and explicitly unwanted); accounts via magic link (strongest identity, but the
  spec chose anonymous voting and turnout over accuracy).
- **See**: [ADR-004](../../docs/adr/ADR-004-anonymous-voter-cookie.md)

### D5 — Scoring: per-position percentages plus Borda order

- **Decision**: for each pair, `position_share[p] = ballots_placing_pair_at_p / ballots_in_group`;
  the crowd order sorts by ascending mean predicted position, tie-broken by more first-place votes,
  then higher pair total points, then pair id.
- **Rationale**: the per-position share is directly interpretable ("62% put them 1st") and the mean
  rank produces one consistent table. Both are computable from a single grouped count.
- **Alternatives considered**: per-position winner only (can name the same pair for two positions,
  producing an inconsistent table); weighted 6..1 points as a share of total (one tidy number, but
  it reads as "62% of people" when it is not); full Condorcet/Kemeny ordering (theoretically nicer
  aggregate, disproportionate complexity and inexplicable to users).
- **See**: [ADR-006](../../docs/adr/ADR-006-aggregation-sql-view-plus-pure-scoring.md)

### D6 — Reveal gating

- **Decision**: a group's aggregate numbers are attached to a response only when the requesting
  voter has a ballot for that group or the voting window has closed; responses that depend on voter
  state are `Cache-Control: no-store`.
- **Rationale**: satisfies FR-020/FR-021 and SC-006 while keeping one endpoint per resource.
- **Alternatives considered**: hiding results in the UI only (trivially bypassed via the network
  tab); separate public/private endpoints (duplicated shapes, easy to drift out of sync).
- **See**: [ADR-008](../../docs/adr/ADR-008-vote-to-reveal-gating.md)

### D7 — Client data layer shared with future mobile

- **Decision**: `packages/client` is generated from the contracts; `packages/ui-logic` holds TanStack
  Query hooks, ballot draft state, and formatting helpers with no DOM or React Native imports.
- **Rationale**: SC-010 requires identical behaviour across platforms without re-implementing rules;
  TanStack Query runs unchanged on React Native.
- **Alternatives considered**: tRPC (excellent DX for a TS-only world, but weaker fit for a future
  standalone service and for non-TS consumers; OpenAPI generation keeps that door open); hand-written
  fetch wrappers per platform (drift guaranteed); Redux Toolkit Query (equivalent, more boilerplate
  for this size).

### D8 — Testing and enforcement

- **Decision**: Vitest for units and contract tests; 100% branch coverage on
  `core/{scoring,ballot,window,matching}`; Playwright for the publish flow and the vote-and-reveal
  flow; `dependency-cruiser` boundary rules and migration application both run in CI.
- **Rationale**: the correctness risk concentrates in a few pure modules and in the reveal gate; the
  architectural risk concentrates in import creep. Both are cheap to test mechanically.
- **Alternatives considered**: Jest (slower with ESM/TS here); broad E2E coverage instead of unit
  coverage (slow, flaky, and poor at covering permutation edge cases); manual review of import
  boundaries (does not survive a busy week).
- **See**: [ADR-009](../../docs/adr/ADR-009-testing-strategy.md)

### D9 — Hosting

- **Decision**: Vercel (EU region) for `apps/web` including the API routes; Supabase EU for the
  database; a scheduled job (Vercel cron) triggers the rankings sync.
- **Rationale**: the audience is Portuguese, so EU placement is both a latency and a data-residency
  win; one deploy target matches the single-maintainer budget.
- **Alternatives considered**: Fly.io/Railway container (needed only once the API detaches);
  self-hosting (no).
- **See**: [ADR-010](../../docs/adr/ADR-010-hosting-vercel-supabase.md)

### D10 — Group derivation and size

- **Decision**: pairs are ordered by total points descending and chunked into groups of six; the
  payload may override group assignment explicitly. A final short group (3–5 pairs) is valid and is
  voted over its own size; fewer than 3 pairs in a group is rejected.
- **Rationale**: matches how the lineup is produced today (ranking order, colour-coded by club) while
  not breaking on an 11- or 14-pair entry list.
- **Alternatives considered**: hard-coding groups of exactly six (rejects real lineups that do not
  divide evenly); inferring groups from the club column (the sample lineup's colours track club, not
  group — an unsafe coincidence to depend on).
