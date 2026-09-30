# Contracts: Replace Active Tournament

All changes are additive under `/api/v1` (Principle III). Schemas live in
`packages/contracts/src/tournaments.ts`; endpoints in `packages/contracts/src/endpoints.ts`.

## New error code

| Code | HTTP | When |
|---|---|---|
| `NOT_REPLACEABLE` | 409 | Target tournament's voting has closed, or it is already invalidated. |

## `POST /admin/tournaments/{slug}/replace/preview` — `previewReplacement`

- Auth: organiser. Body: `lineupPayload` (a `slug` in it is ignored).
- 200 `replacementPreview`:
  - everything in `lineupPreview`, with `slug` = the target's slug
  - `replaces: { id, slug, name }`
  - `groups[]` each gain `carryOver: { keepsVotes: boolean, ballotCount: int ≥ 0 }`
    (`ballotCount` is 0 when `keepsVotes` is false)
- Errors: `NOT_FOUND`, `NOT_REPLACEABLE`, `UNAUTHORISED`, and every lineup validation code
  (`UNRESOLVED_PLAYERS`, `MALFORMED_PAYLOAD`, `START_NOT_IN_FUTURE`, `DUPLICATE_PLAYER`,
  `POINTS_MISMATCH`, `INVALID_GROUP_SIZE`).

Organiser-only: showing per-group ballot counts here is fine because the organiser is not a voter
and the counts are not public.

## `POST /admin/tournaments/{slug}/replace` — `replaceTournament`

- Auth: organiser. Body: `publishRequest` (`confirm: true` required).
- 201 `tournamentDetail` of the replacement (organiser view: no ballot, no results).
- Errors: as preview, plus `NOT_CONFIRMED`.

## Changed shapes

- `tournamentSummary` (and so `tournamentDetail`, list items) gains optional
  `invalidation: { invalidatedAt, replacedBy: { slug, name }, resultsWithheld: boolean }`.
  Absent for live tournaments. An invalidated tournament reports `status: 'closed'`.
- `tournamentListQuery` gains `includeInvalidated: boolean` (default `false`; accepts
  `"true"`/`"false"` in the query string).

## Behavioural changes to existing endpoints

- `castBallot` on an invalidated tournament's group → `422 VOTING_CLOSED`.
- `getGroupResults` / `getTournamentDetail` on an invalidated tournament withhold results while its
  live successor is open (`RESULTS_HIDDEN` for the former; `results` absent for the latter).
- `getPlayer` omits appearances in invalidated tournaments.
