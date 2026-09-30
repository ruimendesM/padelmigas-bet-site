# Implementation Plan: Replace Active Tournament

**Branch**: `003-replace-active-tournament` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-replace-active-tournament/spec.md`

## Summary

Let the organiser replace an open tournament with a corrected lineup. The replacement is published
through the existing lineup derivation, takes over the original slug, and inherits the ballots of
every group whose label and pair set are unchanged. The original is kept, renamed to a derived slug,
marked invalidated, closed to voting, hidden from the landing list, shown in history with a link to
its replacement, and its results withheld until the replacement closes.

Approach: two nullable columns on `tournaments` (`invalidated_at`, `replaced_by_id`) and one on
`ballots` (`carried_from_id`). Carried-over ballots are **copied** into the replacement group, so every
existing read path — counts views, `votedGroupIds`, `findOwn`, the reveal gate — works unchanged. A
new pure module `core/replacement` decides which groups carry over and maps their pairs; the
repository executes that plan in one transaction under a row lock on the original.

## Technical Context

**Language/Version**: TypeScript 5.7, `strict`, Node ≥ 22

**Primary Dependencies**: unchanged — Next.js App Router (host), Zod (contracts), `postgres` (db)

**Storage**: Supabase Postgres; one additive migration `0007_tournament_replacement.sql`

**Testing**: Vitest `unit` (core, 100% branch on `core/replacement`) and `contract` (scratch Postgres);
Playwright e2e for the admin flow is out of scope for this change (manual quickstart instead)

**Target Platform**: existing VPS deployment (docs/deploy/vps.md)

**Project Type**: web application in the existing monorepo

**Performance Goals**: a replacement is one transaction over ≤ ~12 groups and a few hundred ballots;
no target beyond "completes within the request"

**Constraints**: replacement is atomic (FR-204); no ballot is lost between the check and the commit
(spec edge case); API change is additive only (Principle III)

**Scale/Scope**: one club, a handful of tournaments a year, ≤ ~1 000 ballots per tournament

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-driven | Spec 003 written and confirmed before this plan | PASS |
| II. Portable core | Carry-over rule is pure (`core/replacement`); window/reveal stay the single deciders; route files only parse + call one handler | PASS |
| III. Contract-first | New endpoints and fields defined in `packages/contracts` first; all changes additive under `/api/v1`; client + OpenAPI regenerated | PASS |
| IV. Server-authoritative | Replaceability, closure of invalidated tournaments, and the invalidated reveal gate all enforced server-side; ballot insert re-checks under lock | PASS |
| V. Simplicity | No new dependency, service or table; copies ballots instead of a view/union layer | PASS |
| Data: migrations | Committed SQL with rollback block | PASS |
| Gates | typecheck, lint, unit, contract, boundaries, openapi:check | PASS (to verify) |

Post-design re-check: unchanged — PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-replace-active-tournament/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/README.md
└── tasks.md
```

### Source Code (repository root)

```text
supabase/migrations/0007_tournament_replacement.sql     # new columns + rollback
packages/contracts/src/
├── common.ts             # + NOT_REPLACEABLE
├── tournaments.ts        # + invalidation on summary, replacement preview, list flag
└── endpoints.ts          # + previewReplacement, replaceTournament
packages/core/src/
├── domain/index.ts       # Tournament gains invalidatedAt, replacedById
├── window/index.ts       # invalidated ⇒ closed
├── reveal/index.ts       # invalidated ⇒ revealed only when live successor closed
├── replacement/          # NEW: planCarryOver + invalidatedSlug (100% branch)
├── ports/index.ts        # replace(), findLiveSuccessor(), countsForGroups reuse, insert 'closed'
└── errors.ts             # NOT_REPLACEABLE → 409
packages/db/src/
├── tournaments.ts        # replace() transaction, findLiveSuccessor(), columns
├── tournament-list.ts    # includeInvalidated filter + replacedBy join
├── ballots.ts            # insert locks tournament row FOR SHARE, 'closed' outcome
├── history.ts            # exclude invalidated
└── mappers.ts            # new columns
packages/api/src/handlers/
├── replace-tournament.ts # NEW: preview + confirm
├── get-tournament-detail.ts / get-group-results.ts   # successor-aware reveal, invalidation DTO
├── cast-ballot.ts        # 'closed' outcome → VOTING_CLOSED
└── list-tournaments.ts   # pass includeInvalidated
apps/web/
├── app/api/v1/admin/tournaments/[slug]/replace/route.ts
├── app/api/v1/admin/tournaments/[slug]/replace/preview/route.ts
├── app/admin/page.tsx    # "replace" target selector + carry-over badges in preview
├── app/(public)/torneios/[slug]/page.tsx, historico/page.tsx   # badge, link, withheld note
└── src/i18n/{pt,en}.ts
tests/contract/admin-replace.test.ts (+ list/detail/ballot additions)
```

**Structure Decision**: existing monorepo layout; one new core module, one new handler file, two new
route files, one migration.

## Complexity Tracking

None.
