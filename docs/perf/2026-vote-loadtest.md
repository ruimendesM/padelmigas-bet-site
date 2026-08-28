# Ballot-path load test (SC-009, T095)

**Status**: ⏳ **not yet run.** The script is written and ready; it needs a deployed environment,
which does not exist yet.

## Why it has not been run

SC-009 is about behaviour under concurrency across a network and a connection pooler — the two things
a local single-process run cannot reproduce. Running it against `localhost` would produce a number
that looks like evidence and is not, so no number is recorded here.

## How to run it

`tools/loadtest/vote.js` is a k6 script. Against a **staging** deployment with a throwaway
tournament — every iteration casts a real ballot:

```bash
k6 run -e BASE_URL=https://staging.example -e SLUG=torneio-de-carga tools/loadtest/vote.js
```

## The load it applies, and why

Expected peak is the few minutes before a tournament starts, when the link goes round a club of
roughly 100 people: about 1 request/second sustained, bursting to ~5. The script runs **15
requests/second for two minutes** — 3× that peak — with each virtual user on its own cookie jar, so
each is a distinct device casting its one ballot (FR-013).

## Pass criteria

| Threshold | Value |
|-----------|-------|
| `http_req_failed` | < 1 % |
| `cast-ballot` p95 | < 500 ms |
| `tournament-detail` p95 | < 400 ms |

A 409 (`ALREADY_VOTED`) and a 429 (`RATE_LIMITED`) both count as correct answers — they are the
product working. Only a 5xx is a failure.

The script also checks, under load, that an un-voted detail response still carries no aggregate: a
concurrency bug that crossed two callers' reveals would be the worst possible failure here (SC-006),
and it is exactly the kind that only appears under load.

## To record when it runs

Fill in: date, environment, k6 summary output, whether each threshold passed, and the pooler's
connection count at peak (Risk R8).
