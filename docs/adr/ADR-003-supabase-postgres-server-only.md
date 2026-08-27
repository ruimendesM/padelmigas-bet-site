# ADR-003: Supabase Postgres as System of Record, Server-Only Access

## Status
Accepted — 2026-08-27

## Context
The data is small, highly relational, and full of hard uniqueness rules: one ballot per voter per
group, one position per ballot, one player row per real person, one seed per group. Some of those
rules are the difference between trustworthy percentages and garbage. The product also needs
aggregate counts per group on every results view. Supabase was the stated preference and provides
managed Postgres with backups, plus an anon-key client path that this decision deliberately does not
use.

## Decision
Use Supabase Postgres (EU region) as the single system of record. Declare the uniqueness rules as
database constraints, not only in application code. Access the database exclusively from the server
through `packages/db` using the service-role key held in server-only environment variables. Enable
Row Level Security on every table and grant the `anon` role nothing, so a leaked anon key yields no
data. Keep schema in committed SQL migrations under `supabase/migrations/`, applied against a scratch
database in CI; console-only schema edits are forbidden.

## Consequences

### Positive
- Concurrency correctness for ballots comes from `UNIQUE (group_id, voter_id)` — no application-level
  locking, and correct even under simultaneous submissions.
- Aggregation is a grouped count in the same database, so no separate analytics store or job.
- Managed backups and point-in-time recovery without operating a database.
- A leaked publishable key exposes nothing, because no client-side data path exists.

### Negative
- Every read needs a server route; the "just query from the client" convenience of Supabase is
  deliberately given up.
- The service-role key is a high-value secret whose blast radius is the whole database; it must never
  reach a client bundle or a log.
- Postgres connection limits require the pooler under spiky serverless load.

### Neutral
- Supabase-specific features (Realtime, Storage, Edge Functions) stay unused, so the store is
  effectively plain Postgres and portable if needed.

## Alternatives Considered
- **Supabase with client-side access under RLS** — much less code. Rejected for the same reason as in
  ADR-002: the interesting rules would live in policies, and the reveal gate in particular is a
  per-request decision that RLS expresses poorly.
- **SQLite or Turso** — cheap, fast, fine at this scale. Rejected for a weaker managed-backup story
  and no advantage for relational constraint enforcement.
- **A document store (Firestore/Mongo)** — flexible schema. Rejected because the ballot uniqueness
  rules are precisely what a relational engine enforces for free, and would become application code.

## References
- Constitution, Principle IV (Server-Authoritative Trust Boundary)
- [data-model.md](../../specs/001-group-standings-voting/data-model.md)
- [research.md](../../specs/001-group-standings-voting/research.md) — D3
