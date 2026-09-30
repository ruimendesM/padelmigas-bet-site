# Quickstart: Replace Active Tournament

## Prerequisites

- Scratch Postgres reachable at `TEST_DATABASE_URL`, migrations applied (`pnpm db:apply`).
- Local dev server with an organiser password configured (see `.env.example`).

## Automated

```bash
pnpm typecheck && pnpm lint && pnpm boundaries && pnpm openapi:check
pnpm test:unit:coverage     # core/replacement at 100% branch
pnpm test:contract          # tests/contract/admin-replace.test.ts and the list/detail/ballot additions
```

## Manual (against the running app)

1. Publish a two-group tournament (12 pairs) from `/admin`.
2. In a normal and a private window, vote on both groups.
3. In `/admin`, pick "Substituir torneio", select it, paste the same lineup with one player in
   group B swapped, preview. Expect: A "mantém N votos", B "votação recomeça".
4. Confirm. Expect:
   - `/torneios/<slug>` shows the corrected lineup; group A shows each window's own ballot and
     results; group B shows a voting form in both windows.
   - `/` lists only the replacement.
   - `/historico` lists the original with "Invalidado", a link to the replacement, and results
     withheld with a note.
   - `/torneios/<slug>-invalidado-1` shows the old lineup, no form, the same note and link.
   - A player page for the swapped-out player no longer lists the tournament.
5. Try replacing the invalidated tournament from `/admin`: it is not offered; a direct API call
   answers `409 NOT_REPLACEABLE`.
