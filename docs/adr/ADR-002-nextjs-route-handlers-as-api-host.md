# ADR-002: Next.js Route Handlers Host `/api/v1` in Phase 1

## Status
Accepted — 2026-08-27

## Context
A dedicated API is wanted so a future mobile app can reuse the same functionality. The options range
from "no API at all" (clients talk to the database) through "the web app also serves the API" to "a
separate service from day one". Today there is exactly one client, one maintainer, and no mobile app
in development. Whatever is chosen must not put business rules somewhere a second client cannot
reach, and must not require a second deploy pipeline for a club-sized audience.

## Decision
Serve the public interface from `apps/web/app/api/v1/**` using Next.js route handlers, with each
route file restricted to three responsibilities: parse and validate the request with a
`packages/contracts` schema, call exactly one `packages/api` handler, serialise the result. No
business branching in route files. Every route lives under the `/api/v1` prefix from the first commit,
and clients consume the generated `packages/client` rather than constructing URLs.

## Consequences

### Positive
- One deploy target, one CI pipeline, one set of secrets.
- Server-side rendering can call the same handlers in-process, skipping an HTTP hop, while HTTP
  clients get identical behaviour.
- Detaching later is mechanical: mount the same handlers in Fastify (one file per route) and point
  the generated client at a new base URL.
- Secrets stay server-side by construction; the browser never holds a data-access key.

### Negative
- Until the API is detached, a mobile client's backend availability is tied to the web app's deploys.
- Vercel's function runtime characteristics (cold starts, request limits) apply to the API too.
- The discipline that keeps route files thin is a review responsibility; only the import boundary is
  automated, not the "no branching in adapters" rule.

### Neutral
- The `/api/v1` prefix costs nothing now and is what makes a later move invisible to clients.

## Alternatives Considered
- **No API layer; clients call Supabase PostgREST directly under RLS** — least code and already
  mobile-capable. Rejected because the reveal gate, permutation validation, and Borda ordering would
  have to live in SQL and RLS policies, where they are hard to unit-test and awkward to evolve; it
  also contradicts the constitution's server-authoritative principle by making the policy engine the
  entire business layer.
- **Standalone Fastify/Nest service from day one** — the cleanest boundary and independent scaling.
  Rejected against Principle V: a second deploy target, second pipeline, and CORS/session plumbing
  for a product with one client and a few hundred users per event.
- **tRPC instead of REST** — excellent ergonomics for a TypeScript-only world. Rejected because a
  documented HTTP contract keeps a non-TypeScript or third-party consumer possible, and OpenAPI
  generation gives the same type safety through the generated client.

## References
- Constitution, Principle III (Contract-First, Versioned API)
- [contracts/README.md](../../specs/001-group-standings-voting/contracts/README.md)
- [research.md](../../specs/001-group-standings-voting/research.md) — D2
