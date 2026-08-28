# Scheduled rankings sync (FR-004, T100)

`vercel.json` schedules `POST /api/v1/admin/rankings/sync` for 05:00 UTC every Monday — after the
weekend's tournaments have been rated and before anyone would publish a new lineup.

## Authentication

The route accepts an organiser session **or** a bearer `CRON_SECRET`, and it is the only route that
accepts the secret (contracts/README rule 7). Vercel Cron sends
`Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set as a project
environment variable, which is why no credential appears in this file.

Widening that credential to the publish route would put a public tournament one leaked secret away,
so it stays narrow deliberately.

## If the sheet is down

The job does not fail: it re-imports the last stored snapshot and reports `stale: true` (Risk R3).
An import that has never had a successful fetch has nothing to fall back on and does fail, loudly.
