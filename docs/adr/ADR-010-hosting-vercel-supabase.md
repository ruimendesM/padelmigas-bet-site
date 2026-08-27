# ADR-010: Host on Vercel (EU) with Supabase EU, and Nothing Else

## Status
Accepted — 2026-08-27

## Context
The audience is a Portuguese padel club: a few hundred people, bursty traffic in the minutes before a
tournament starts, and effectively zero traffic between events. There is one maintainer and no
appetite for operations. Data residency and latency both argue for EU placement. The architecture must
not depend on the host, because ADR-002 anticipates detaching the API later.

## Decision
Deploy `apps/web` (pages and `/api/v1` routes) to Vercel with EU function placement, and use a
Supabase project in an EU region, connected through the Supabase pooler. Trigger the rankings sync
with a Vercel cron job hitting the admin sync route with a server-side secret. Add no other runtime
service: no queue, no cache, no worker, no container. Keep all host-specific concerns in
`apps/web`; nothing in `packages/**` may reference a hosting provider.

## Consequences

### Positive
- Zero-ops deploys with preview environments per change, which suits a single maintainer.
- EU placement keeps requests fast for the audience and keeps data in the EU.
- Free or near-free at this scale; costs scale with actual traffic, not provisioned capacity.
- Cron is a platform feature rather than another moving part to operate.

### Negative
- Cold starts on the first request after an idle period, most visible on the first page view before an
  event — mitigated by keeping the hot path to a single query and by the pre-event traffic pattern.
- Vendor coupling at the host layer, and Vercel's pricing model punishes an unexpected traffic spike.
- The database's connection limits, not the app, are the real ceiling under a burst; the pooler is
  mandatory, not optional.

### Neutral
- Detaching the API to a container platform later changes only the deploy target and the client base
  URL, by design (ADR-001, ADR-002).

## Alternatives Considered
- **Fly.io or Railway container from the start** — no cold starts and full control. Rejected as
  needless operations before the API is even detached; it becomes the obvious choice at that point.
- **Cloudflare Workers** — excellent cold-start behaviour. Rejected because the Node-oriented parts of
  the stack and the Postgres driver story add friction for no current benefit.
- **Self-hosting on a VPS** — cheapest at steady state. Rejected: patching, backups, and TLS renewal
  are exactly the work this project cannot afford.
- **US-region defaults** — the platform default. Rejected on latency and EU data residency.

## References
- Constitution, Principle V (Simplicity and YAGNI)
- [plan.md](../../specs/001-group-standings-voting/plan.md) — Constraints, Risk R8
