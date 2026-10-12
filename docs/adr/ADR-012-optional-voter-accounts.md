# ADR-012: Optional Voter Accounts that Own a Voter

## Status
Accepted — 2026-10-12

## Context
ADR-004 made the anonymous signed cookie the only voter identity. That keeps voting frictionless,
but a visitor's ballot is tied to one browser: a second device, a cleared cookie, or a private
window is a new voter that can vote again and cannot see the ballot already cast. The organiser
wants an optional account so a person's "already voted" state follows them across devices, while
logged-out voting keeps working exactly as today. Constitution v1.1.0 allows optional accounts
identified by a self-chosen username and a password, with no email collected.

## Decision
Add an `accounts` table holding a unique username, an argon2id password hash, and a unique
reference to exactly one `voters` row. The account owns that voter; every existing ballot rule
(`UNIQUE (group_id, voter_id)`, own-ballot lookup, vote-to-reveal) keeps keying on `voter_id`
and is unchanged.

- A signed account-session cookie identifies the signed-in account. When present and valid it
  takes priority over the anonymous voter cookie, and the voter cookie is re-issued with the
  account's voter id.
- On registration, if the device's anonymous voter is not already owned by an account, the new
  account adopts it, so ballots already cast on that device carry over.
- On sign-in, ballots of the device's unowned anonymous voter move to the account's voter for
  every group the account has not voted in; ballots in groups where both voted are discarded, so
  the account's ballot wins. This runs in one transaction.
- Signing out clears both cookies, so the device becomes a fresh anonymous voter.
- A forgotten password is handled by the organiser, who issues a one-time temporary password that
  must be changed at next sign-in. Resetting a password ends that account's existing sessions.
- IP addresses remain rate-limit input only and are never stored.

## Consequences

### Positive
- Cross-device "already voted" state and own-ballot display for anyone who signs in.
- No change to the ballot pipeline, the aggregation, or the logged-out experience.
- No email and no third-party provider, so no new hosted service and minimal personal data.
- The schema leaves room to attach a third-party identity (e.g. Google) to an account later.

### Negative
- Passwords are a new secret to protect; brute force is mitigated only by rate limiting and
  argon2id cost.
- Without email there is no self-service recovery; recovery depends on the organiser.
- Accounts do not stop ballot stuffing: anyone can still vote logged out or create more accounts.
- Merging on sign-in can discard an anonymous ballot that was cast on a shared device.

### Neutral
- Signing out and voting again anonymously is possible, the same gap a private window already has.

## Alternatives Considered
- **Account replaces the voter** (ballots reference accounts directly) — rejected: it splits the
  one-ballot rule across two identity types and touches every ballot query.
- **Email + password or magic link** — rejected for now: collects personal data, and a magic link
  needs a mail provider, a new hosted service under Principle V.
- **Google sign-in in this change** — deferred to its own spec to keep this change small.
- **Keep the device's anonymous ballots separate on sign-in** — rejected: lets one person vote
  twice in the same group (once anonymously, once signed in).

## References
- Constitution v1.1.0, Technology & Data Constraints (Voter identity, Privacy)
- [ADR-004](ADR-004-anonymous-voter-cookie.md) — anonymous voter cookie, extended here
- [spec.md](../../specs/004-voter-accounts/spec.md)
