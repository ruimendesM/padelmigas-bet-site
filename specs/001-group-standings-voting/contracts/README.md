# Contracts: Group Standings Voting

**Source of truth**: the Zod schemas in `packages/contracts`. `openapi.yaml` in this directory is
generated from them and committed so the contract is reviewable in the spec; never hand-edit it.

## Files

| File | Purpose |
|------|---------|
| `openapi.yaml` | Generated OpenAPI 3.1 document — 8 endpoints, 12 schemas |
| `lineup-payload.example.json` | A 12-pair lineup fixture (2 groups, 24 players) used as the admin-page placeholder and as a test fixture. Names, ranking IDs and clubs are **fictional**; the point totals and group shape mirror a real lineup |

## Endpoint map

| Method | Path | Auth | Requirements |
|--------|------|------|--------------|
| GET | `/api/v1/tournaments` | none | FR-023 |
| GET | `/api/v1/tournaments/{slug}` | voter cookie (optional) | FR-014, FR-015, FR-020, FR-021 |
| POST | `/api/v1/groups/{groupId}/ballots` | voter cookie (minted if absent) | FR-009 – FR-013, SC-005 |
| GET | `/api/v1/groups/{groupId}/results` | voter cookie (optional) | FR-016 – FR-021 |
| GET | `/api/v1/players/{playerId}` | none | FR-025 |
| POST | `/api/v1/admin/tournaments/preview` | organiser session | FR-001 – FR-005 |
| POST | `/api/v1/admin/tournaments` | organiser session | FR-002, FR-006 – FR-008 |
| POST | `/api/v1/admin/rankings/sync` | organiser session **or** bearer `CRON_SECRET` | FR-004, FR-007 |

## Rules that bind every endpoint

1. **Versioned prefix**: all routes are under `/api/v1`. Field additions ship in place; any removal,
   rename, or semantic change ships as `/api/v2` with v1 kept alive (constitution, Principle III).
2. **Reveal gate**: a response must never contain a count, share, or ordering for a group the caller
   has not earned (not voted, voting still open). Absent, not zeroed, not empty-arrayed — omitted.
3. **No caching of voter-dependent responses**: `Cache-Control: no-store` on
   `/tournaments/{slug}`, `/groups/{id}/results`, and every ballot response (Risk R1).
4. **Server time only**: the voting window is decided from the server clock; no client-supplied
   timestamp is ever consulted (SC-007).
5. **Errors carry a stable `code`**: clients branch on `code`, never on `message`, which is
   localisable copy. Multi-problem responses use `issues[]` and report every offending entry.
6. **No voter identifiers on the wire**: responses may say `hasVoted` and echo `ownBallot`; they must
   never contain a voter id, and no endpoint lists ballots (FR-022).
7. **One non-cookie credential, one route**: bearer `CRON_SECRET` is accepted by
   `/admin/rankings/sync` and nowhere else, so the scheduler can run without an organiser session.
   Every other admin route requires the signed organiser cookie.
8. **Idempotent by constraint**: a duplicate ballot is a `409 ALREADY_VOTED` produced by the unique
   constraint, not a silent second insert.

## Client generation

`packages/client` is generated from the same Zod schemas — a fetch-only, framework-free typed client.
`apps/web` and a future `apps/mobile` both consume it; neither constructs a URL or parses a response
by hand (constitution, Principle III).
