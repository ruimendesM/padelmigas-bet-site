# ADR-010: Host on Vercel (EU) with Supabase EU, and Nothing Else

## Status
Accepted — 2026-08-27. **Amended 2026-08-28**: `apps/web` moves from Vercel to the maintainer's
existing VPS behind nginx. Supabase EU is unchanged and remains the system of record. See
"Amendment" below.

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

## Amendment — 2026-08-28: `apps/web` runs on the maintainer's VPS, not Vercel

### What changed
`apps/web` is deployed to the maintainer's existing VPS: built in GitHub Actions, rsynced as a
Next.js standalone bundle, run under systemd, reverse-proxied by nginx. The rankings sync moves from
a Vercel cron to a systemd timer presenting the same bearer `CRON_SECRET` to the same route.

**Supabase EU is unchanged.** It remains the system of record, still reached through the pooler.
Nothing about the data tier moves, and no new runtime service is introduced: still no queue, no
cache, no worker, no container.

### Why the original rejection no longer holds
This ADR considered self-hosting and rejected it, in these words: *"patching, backups, and TLS
renewal are exactly the work this project cannot afford."* That reasoning assumed self-hosting
**everything, database included**. The actual proposal splits the tiers, and each clause fails
separately:

- **Backups** — does not apply. The data stays in Supabase, managed and backed up there. The VPS
  holds no durable state; losing the box loses nothing but uptime.
- **Patching** — already sunk. The box already runs two services for this maintainer, so it is
  already being patched on their schedule. This adds no new commitment.
- **TLS renewal** — already solved on that host for an existing domain. This adds one more name to
  an already-working arrangement.

What remains is a genuine trade, recorded below rather than waved through.

### Consequences of the amendment

**Positive**
- **Cold starts disappear.** They were this ADR's first-listed negative, and the one most visible to
  the audience: the first page view before an event. A long-lived process has none.
- The **in-memory rate limiter gets stronger**, not weaker. It was written to tolerate per-instance
  buckets that reset on a cold start (`apps/web/src/server/rate-limit.ts`); one durable process gives
  it a single accurate bucket. A limiter that was accepted as approximate becomes real.
- **One deploy idiom across all three services** on that host — build in Actions, rsync the artifact,
  restart a systemd unit. A single maintainer debugging one pipeline at 23:00 before a tournament is
  better off than one debugging two.
- No vendor pricing exposure. This ADR flagged that Vercel "punishes an unexpected traffic spike";
  a fixed-cost box does not.

**Negative**
- **Preview environments per change are lost.** This ADR listed them as a positive and they were
  real: every change could be seen before merging. There is no equivalent, and nothing here replaces
  it.
- **Cron becomes a moving part to operate.** This ADR valued it as "a platform feature rather than
  another moving part"; a systemd timer is exactly that other moving part, and it fails silently
  unless someone looks. It needs a failure path that reaches a human.
- **One box is a single point of failure.** A reboot, a full disk, or a bad deploy takes the site
  down, and there is no platform rollback — the previous release has to be kept on disk deliberately.
  Vercel would have absorbed all three.
- **A Node runtime now has to exist and be patched** on that host, which was not previously true of
  it. `@node-rs/argon2` is a native addon, so the deployed binary must match the box's architecture
  and libc; a mismatch fails at process start, not at build time.
- **`X-Forwarded-For` becomes security-relevant.** `clientAddress()` trusts the first hop, which was
  safe when the platform sanitised the header. Behind nginx it is only safe if the proxy
  **overwrites** the header (`proxy_set_header X-Forwarded-For $remote_addr`). The idiomatic
  `$proxy_add_x_forwarded_for` **appends**, which would let a caller supply their own first hop and
  rotate the ballot rate-limit key at will (Risk R2). This is a deploy-time correctness requirement,
  not a preference.

**Neutral**
- Risk R8's pooler requirement is unchanged, and now has a second independent reason: Supabase's
  direct endpoint resolves to IPv6 only, and both GitHub Actions runners and many VPS hosts are
  IPv4-only. The pooler is the only reachable path from CI.
- `ranking_snapshots` was justified partly by the serverless host having no durable disk
  (data-model.md, 2026-08-27). A VPS does have one, so that clause no longer applies — but the
  decision stands unchanged: the table also survives redeploys and doubles as an audit trail, it is
  already built, and moving the fallback to the filesystem now would be churn for nothing
  (Principle V).
- Detaching the API later is unaffected. This ADR already anticipated a container platform "at that
  point"; the deploy target changes and the client base URL changes, exactly as ADR-001 and ADR-002
  designed for.

### Alternatives reconsidered
- **Stay on Vercel** — cheapest in effort, keeps preview environments. Rejected: the maintainer
  already operates the VPS, and running a third service on it costs less than a second platform to
  learn, bill and monitor.
- **Docker Compose on the same VPS** — reproducible, isolates the native addon. Rejected: the two
  existing services are deployed as a bare artifact plus a systemd unit, and introducing a container
  runtime for the third would mean two deploy idioms on one box (Principle V).
- **Keep Vercel cron and point it at the VPS** — avoids the systemd timer. Rejected: it keeps a
  vendor dependency alive for one HTTP request a week and leaves the sync broken whenever that
  account lapses.

## References
- Constitution, Principle V (Simplicity and YAGNI)
- [plan.md](../../specs/001-group-standings-voting/plan.md) — Constraints, Risk R8
- [ADR-002](./ADR-002-nextjs-route-handlers-as-api-host.md) — why the host is replaceable at all
- `apps/web/src/server/rate-limit.ts` — the `X-Forwarded-For` requirement above
