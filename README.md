# Padelmigas Bet

Crowd-prediction voting for padel tournament groups. An organiser publishes a tournament lineup;
visitors predict how each group of six pairs will finish, without signing in; the site shows what the
crowd collectively expects, as per-position percentages.

**Status**: specification and architecture complete, implementation not started.

## How it works

1. The organiser pastes a lineup (pairs, players, ranking points, clubs) into the admin page and
   confirms the preview. Pairs are grouped in sixes by ranking; every player is resolved against the
   club's published ranking list, so one person is one record across all tournaments.
2. Visitors rank the pairs in a group from 1st to 6th. One ballot per group per device, cast once.
3. After voting — or once the tournament starts and voting closes — the group's results appear: the
   share of voters placing each pair at each position, and a crowd predicted table ordered by average
   predicted position.

## Spec-driven

This repository is built with [GitHub Spec Kit](https://github.com/github/spec-kit). Specs come
before code, and they are the reviewable artifact:

| Where | What |
|-------|------|
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Project principles — the non-negotiables every change is checked against |
| [`specs/001-group-standings-voting/spec.md`](specs/001-group-standings-voting/spec.md) | What the feature does, in user-observable terms |
| [`specs/001-group-standings-voting/plan.md`](specs/001-group-standings-voting/plan.md) | Architecture, structure, risks |
| [`specs/001-group-standings-voting/data-model.md`](specs/001-group-standings-voting/data-model.md) | Schema, constraints, the scoring formula |
| [`specs/001-group-standings-voting/contracts/`](specs/001-group-standings-voting/contracts/) | API contract (OpenAPI) and an example lineup payload |
| [`specs/001-group-standings-voting/quickstart.md`](specs/001-group-standings-voting/quickstart.md) | How to run it and how to verify it works |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records, with the alternatives that were rejected |

## Architecture in one paragraph

A TypeScript monorepo where the business logic is deliberately portable: scoring, ballot validation,
vote-window rules and player matching live in `packages/core`, which imports no framework and no
vendor SDK. Next.js hosts the web app and the versioned `/api/v1` routes, but each route file only
parses the request, calls one handler from `packages/api`, and serialises the result. Supabase
Postgres is the system of record and is reached only from the server. The consequence is that adding
a React Native client, or moving the API to a standalone service, is an adapter swap rather than a
rewrite — and CI fails the build if an import crosses that boundary.

See [ADR-001](docs/adr/ADR-001-monorepo-portable-core.md) and
[ADR-002](docs/adr/ADR-002-nextjs-route-handlers-as-api-host.md).

## A note on data

No real player data is committed. Every name, ranking ID and club in this repository's examples and
fixtures is fictional. The live player list is fetched at runtime from a ranking source configured
through `RANKINGS_CSV_URL`, and voting is anonymous: no accounts, no emails, no IP addresses stored.

## Licence

MIT
