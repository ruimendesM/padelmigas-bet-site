# ADR-004: Anonymous Voter Identity via a Signed httpOnly Cookie

## Status
Accepted — 2026-08-27

## Context
Voting must be frictionless: the audience is a club WhatsApp group tapping a link minutes before a
tournament, and any sign-up step costs turnout. At the same time the system must enforce one ballot
per group and show a visitor their own ballot afterwards. The accepted strength of duplicate
prevention was stated explicitly: a cookie is enough, and a private window counting as a new voter is
acceptable. Phase 1 has no accuracy leaderboard, so no durable cross-device identity is required.

## Decision
On the first request that needs it, create a `voters` row and set a cookie carrying that voter id,
signed with a server secret (`jose`), `httpOnly`, `Secure`, `SameSite=Lax`, with a one-year expiry.
The cookie is the only voter identity. Store no IP address and no user agent on the voter or ballot
record. Enforce one ballot per group with `UNIQUE (group_id, voter_id)`. Rate-limit ballot submission
per IP at the edge without persisting the IP.

## Consequences

### Positive
- Zero friction: voting works on first tap with no account, email, or provider.
- Tamper-proof: the signature means a client cannot claim another voter's id, so `ownBallot` cannot
  be used to read someone else's ballot.
- No personal data is stored, which keeps the privacy surface effectively empty.
- Portable to mobile: the same token, held in secure storage, works against the same API unchanged.

### Negative
- Trivially bypassed by a private window or a second device; ballot stuffing is possible for anyone
  who cares to (Risk R2).
- A cleared cookie loses the visitor's link to their ballot; the ballot remains counted but is no
  longer shown back to them.
- No cross-device history, which blocks a per-voter accuracy leaderboard until identity is upgraded.

### Neutral
- The upgrade path is additive: add an auth provider later and attach existing voter rows to accounts
  without discarding ballots.

## Alternatives Considered
- **Supabase anonymous auth** — equivalent dedupe strength; rejected because it adds an auth
  dependency, JWT refresh handling, and a second identity concept for no phase-1 gain.
- **Browser fingerprinting** — stronger dedupe; rejected as privacy-hostile and contrary to the
  constitution's privacy constraint.
- **Magic-link accounts** — strongest identity and a prerequisite for a leaderboard; rejected for
  phase 1 because turnout was explicitly preferred over vote integrity.
- **`localStorage` token instead of a cookie** — no signing, readable and forgeable by page scripts,
  and unavailable to server rendering. Rejected.

## References
- Constitution, Technology & Data Constraints (Voter identity, Privacy)
- [spec.md](../../specs/001-group-standings-voting/spec.md) — FR-012, FR-013, FR-022
- [research.md](../../specs/001-group-standings-voting/research.md) — D4
