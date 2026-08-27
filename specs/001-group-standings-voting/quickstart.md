# Quickstart & Validation: Group Standings Voting

**Date**: 2026-08-27 | **Plan**: [plan.md](./plan.md)

This is the run-and-verify guide. Implementation belongs in `tasks.md`; this file proves the feature
works end to end once those tasks are done.

## Prerequisites

- Node 22 LTS and pnpm 9+
- A Supabase project in an EU region (free tier is sufficient for club scale)
- The Supabase CLI, for applying migrations locally and in CI

## Environment

Server-only variables in `apps/web/.env.local` — never prefixed `NEXT_PUBLIC_`:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The only data-access key; server-only (ADR-003) |
| `VOTER_COOKIE_SECRET` | Signing key for the voter cookie (ADR-004) |
| `ADMIN_PASSWORD_HASH` | Argon2id hash gating the organiser area (FR-006) |
| `RANKINGS_CSV_URL` | Public CSV export of the club ranking sheet |
| `CRON_SECRET` | Bearer secret the scheduler uses to call the rankings-sync route |

A missing or empty variable must fail startup loudly rather than degrade — no silent fallbacks.

## Setup

```bash
pnpm install
pnpm supabase db push          # apply supabase/migrations to the target database
pnpm rankings:sync             # import ~783 players + dated rating snapshots
pnpm dev                       # http://localhost:3000
```

## Automated verification

```bash
pnpm typecheck                 # strict TS across all packages
pnpm lint                      # includes the import-boundary rules (Principle II)
pnpm test:unit                 # core rules; 100% branch on scoring/ballot/window/matching
pnpm test:contract             # every /api/v1 route: success shape + each documented failure
pnpm test:e2e                  # Playwright: publish flow, vote-and-reveal flow
pnpm boundaries                # dependency-cruiser: no next/react/supabase imports in core
```

All six must pass before a merge. A failing gate is fixed or reverted, never skipped
(constitution, Quality Gates).

## Manual validation scenarios

### V1 — Publish the sample lineup (User Story 1)

1. Sign in at `/admin`.
2. Paste `contracts/lineup-payload.example.json` and choose Preview.
3. **Expect**: 2 groups of 6, ordered by pair total points descending — group A led by
   Bastos / Trindade (1193), group B led by Chaves / da Costa (885); all 24 players resolved to
   ranking-list IDs; no player flagged unknown.
4. Publish. **Expect**: the tournament appears at `/` with voting open.
5. Now edit the payload to misspell one name (e.g. `Rodrigo da Costaa`) and preview again.
   **Expect**: publishing blocked, the offending entry named with its path, nothing persisted.
6. Set `startsAt` to a past instant and preview. **Expect**: `START_NOT_IN_FUTURE`, no publish.

### V2 — Vote and reveal (User Stories 2 and 3)

1. Open the tournament in a fresh private window. **Expect**: a voting form for each group and no
   percentages anywhere — confirm in the network tab that the response carries no counts (Risk R1).
2. Assign 1–6 in group A and submit. **Expect**: 201, results replace the form for group A within
   2 seconds (SC-005); group B still shows its form with no percentages (FR-015).
3. Re-submit group A via the API directly. **Expect**: `409 ALREADY_VOTED`.
4. Submit a ballot that repeats position 3. **Expect**: `400 DUPLICATE_POSITION`, nothing stored.
5. Reload. **Expect**: group A still shows results plus your own ordering (FR-014).
6. Repeat steps 1–2 from a second private window with a different ordering. **Expect**: the ballot
   count rises to 2 and the percentages move accordingly.

### V3 — Percentage audit (SC-004)

With a known small set of ballots on one group, compute by hand:
`share(pair, p) = votes(pair, p) / ballotCount`, `meanPosition(pair) = Σ p·votes / ballotCount`,
crowd order = ascending mean, ties broken by more 1st-place votes, then higher total points, then
pair id. **Expect**: every displayed number matches exactly, and repeated reloads never reorder a tie.

### V4 — Window close (SC-007, FR-011)

1. Set a tournament's `startsAt` a minute ahead and open the voting form.
2. Wait for it to pass, then submit. **Expect**: `422 VOTING_CLOSED`, the entered ordering still
   visible on screen, results shown.
3. Set the client's system clock back an hour and retry. **Expect**: still `422` — the client clock
   changes nothing.

### V5 — History and player identity (User Story 4, SC-008)

1. Publish a second tournament sharing at least one player with the first.
2. **Expect**: `/historico` lists closed tournaments newest first with their final crowd predictions
   and ballot counts.
3. Open a shared player. **Expect**: both appearances listed with the right partner and group, and
   exactly one player record for that person.

### V6 — Rankings sync resilience (Risk R3)

1. Run `pnpm rankings:sync` twice. **Expect**: the second run creates no duplicates and rewrites the
   same snapshots (idempotent).
2. Point `RANKINGS_CSV_URL` at an unreachable host and run a publish. **Expect**: the import path
   reports staleness and uses the last stored snapshot; it does not invent players.
3. Feed a CSV containing two rows whose names normalise identically. **Expect**:
   `409 DUPLICATE_MATCH_KEY`, import aborted, database untouched.
