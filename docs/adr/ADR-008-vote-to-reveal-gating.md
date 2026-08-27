# ADR-008: Reveal a Group's Results Only After the Caller Votes or Voting Closes

## Status
Accepted — 2026-08-27

## Context
The product decision is that a visitor sees a group's crowd percentages only once they have voted on
that group, and that everyone sees them after voting closes. The point is to stop later voters
anchoring on the crowd. A UI-only implementation is worthless: anyone can open the network tab. The
gate therefore has to hold at the response level, and it interacts badly with caching — a cached
tournament response containing counts would leak results to every subsequent visitor.

## Decision
Decide the reveal server-side, per request, per group: attach a `results` object to a group only when
the caller has a ballot for that group or the voting window has closed. When it is not revealed, the
field is **omitted** — not zeroed, not an empty array — so no count, share, or ordering exists anywhere
in the payload. Send `Cache-Control: no-store` on every voter-dependent response
(`/tournaments/{slug}`, `/groups/{id}/results`, ballot responses). `GET /groups/{id}/results` returns
`403 RESULTS_HIDDEN` when the caller has not earned it. A successful ballot submission returns the
group's results in the same 201 response, so the reveal costs no extra round trip. Every public read
path has an automated test asserting non-leakage.

## Consequences

### Positive
- The gate cannot be bypassed from the client, satisfying SC-006 by construction.
- One endpoint shape per resource, with presence signalling entitlement — nothing for a public and a
  private variant to drift apart on.
- Reveal is instant after voting (SC-005) because it rides the submission response.

### Negative
- No CDN caching of tournament pages, so every view costs a server render and a database read.
- The `results`-may-be-absent shape must be handled at every call site; a careless client change can
  crash on a missing field.
- Server-rendered pages must run per request, ruling out static generation for tournament pages.

### Neutral
- Post-close responses are effectively public and could be cached later if load ever justifies it;
  the same code path just relaxes the header.

## Alternatives Considered
- **Hide results in the UI only** — trivial to implement, trivially bypassed. Rejected outright.
- **Separate public and gated endpoints** — cacheable public variant. Rejected: two shapes for one
  resource, and the risk that the public one gains a field it should not have.
- **Client-side encryption of results, key released after voting** — cacheable and gated. Rejected as
  needless complexity for a club voting site.

## References
- [spec.md](../../specs/001-group-standings-voting/spec.md) — FR-020, FR-021, FR-022, SC-006
- [contracts/README.md](../../specs/001-group-standings-voting/contracts/README.md) — Rules 2 and 3
