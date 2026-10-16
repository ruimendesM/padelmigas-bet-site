# Research: Optional Voter Accounts

No `NEEDS CLARIFICATION` remained after `/speckit-clarify`; these are the design decisions taken
while planning.

## R1. Account owns a voter vs ballots reference accounts

- **Decision**: `accounts.voter_id` (unique, not null) → `voters.id`. Ballots stay keyed on voter.
- **Rationale**: every existing read and write path, the unique constraint, the counts views and the
  reveal gate keep working unchanged; the one-ballot rule never spans two identity types.
- **Alternatives**: `ballots.account_id` nullable alongside `voter_id` — rejected: two uniqueness
  rules, every query branches, merge becomes a dual-key problem.

## R2. Session mechanism

- **Decision**: stateless signed cookie `pm_account` (jose HS256, issuer `padelmigas-bet`, audience
  `account`, `sub` = account id, `sv` = session version, 90-day expiry, HttpOnly, Secure,
  SameSite=Lax). Signed with `VOTER_COOKIE_SECRET`; the audience keeps it from being accepted as a
  voter or organiser token, the same separation `admin-auth.ts` already relies on.
- **Rationale**: matches the existing voter and organiser cookies; no session table (Principle V).
  Lax so a signed-in person following a WhatsApp link arrives recognised (as FR-014 required for
  voters).
- **Alternatives**: DB session table — rejected: revocation is already covered by `sv`; a table adds
  cleanup work. Separate `ACCOUNT_SESSION_SECRET` — rejected: a new deploy secret for no isolation
  gain over audience separation.

## R3. Ending sessions on password change / reset

- **Decision**: integer `accounts.session_version`; the token's `sv` must equal it. Change password
  increments it and re-issues the current device's cookie; reset increments it.
- **Rationale**: exact and immediate. An `iat < password_changed_at` check was rejected: one-second
  JWT resolution makes "re-issue in the same second" ambiguous.

## R4. Stopping a device from reaching account ballots after sign-out / reset

- **Decision**: a `pm_voter` cookie whose voter is owned by an account is ignored; register and
  sign-in clear `pm_voter`; sign-out clears both cookies.
- **Rationale**: without this, a device that once held the account's voter id in `pm_voter` would
  keep showing the account's ballots after its session ended. One rule closes it for sign-out,
  password change, reset and expiry alike.

## R5. Forced password change after reset (FR-321)

- **Decision**: a pending temporary password never yields a session. Sign-in with it returns
  `403 PASSWORD_CHANGE_REQUIRED`; the client re-submits sign-in with `newPassword`, which sets the
  password, clears the flag, and signs in. Expired (24 h) temporary passwords answer
  `INVALID_CREDENTIALS` (clarification 2026-10-12).
- **Rationale**: no "half-signed-in" session state to guard on every route.
- **Alternatives**: restricted session with a `mustChange` claim checked by the ballot route and
  pages — rejected: every caller-resolving path would need the extra check.

## R6. Merge decision placement and concurrency

- **Decision**: pure `core/accounts.planDeviceMerge(deviceBallots, accountGroupIds)` where each device
  ballot carries `votingOpen`. Output: `move` (account has none in that group), `discard` (conflict,
  open group), `leave` (conflict, closed group). `db/accounts.mergeDeviceVoter` runs it inside one
  transaction after locking both voter rows `FOR UPDATE`, computing `votingOpen` via
  `core/window.isVotingOpen` with the server clock.
- **Rationale**: the rule needs 100% branch coverage (constitution); the transaction gives FR-312.
  Ballot inserts by the account voter racing a move into the same group hit
  `UNIQUE (group_id, voter_id)` and abort the merge, which surfaces as a retryable failure rather
  than a double count.

## R7. Password hashing behind a port

- **Decision**: `core/ports.PasswordHasher { hash, verify }`, implemented in
  `apps/web/src/server/password-hasher.ts` with `@node-rs/argon2` and the existing `ARGON2_OPTIONS`.
  Unknown usernames still run one `verify` against a fixed dummy hash.
- **Rationale**: argon2 is a native module configured as a server-external package in the host;
  core and api must not import it (Principle II). The dummy verify keeps timing from revealing
  whether a username exists (FR-314).

## R8. Temporary password generation

- **Decision**: `core/accounts.generateTemporaryPassword(random)` builds 12 characters from an
  unambiguous alphabet (no `0/O/1/l/I`) using `crypto.getRandomValues`; the random source is
  injected for tests. Stored only as an argon2id hash, with `temporary_password_expires_at =
  now + 24h`.
- **Rationale**: easy to read aloud or paste into WhatsApp; ~70 bits of entropy; core may use
  `crypto`.

## R9. Username rules

- **Decision**: trim + lowercase, then `^[a-z0-9._-]{3,30}$`. Stored already lowercased, so a plain
  `text unique` column suffices (no `citext` extension).
- **Rationale**: FR-303; case-insensitive uniqueness without an extension.

## R10. Rate limiting

- **Decision**: `rate-limit.ts` keyed by `(bucket, hashed IP)`. Bucket `auth`: 10 attempts per 10
  minutes, shared by register and sign-in. Ballot bucket unchanged.
- **Rationale**: FR-317 within the existing privacy rules (in memory, salted, never logged). Per
  username lockout was rejected: it lets anyone lock someone else out.

## R11. Sign-in event logging

- **Decision**: no new logging. Failed sign-ins are not logged with usernames or IPs.
- **Rationale**: privacy constraint; nothing operational depends on it at this scale.
