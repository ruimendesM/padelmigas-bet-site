# Data Model: Optional Voter Accounts

## New table: `accounts` (migration `0008_voter_accounts.sql`)

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` pk | `default gen_random_uuid()` |
| `username` | `text not null unique` | `check (username ~ '^[a-z0-9._-]{3,30}$')`; stored lowercased (FR-303) |
| `password_hash` | `text not null` | argon2id encoded hash; never selected into a DTO (FR-306) |
| `voter_id` | `uuid not null unique` → `voters(id)` | the voter this account owns (ADR-012) |
| `session_version` | `integer not null default 1` | bumped on password change and reset (FR-318, FR-320) |
| `temporary_password_expires_at` | `timestamptz null` | set by reset to `now + 24h`; null otherwise |
| `password_changed_at` | `timestamptz not null default now()` | informational |
| `created_at` | `timestamptz not null default now()` | |

- "Must change password" is `temporary_password_expires_at is not null` — one column, no flag that
  can disagree with it.
- `accounts` joins the deny-anon RLS list (enable + force RLS, revoke all from `anon`,
  `authenticated`), as in `0003_rls_deny_anon.sql`.
- Index: the unique constraints on `username` and `voter_id` cover every lookup; search uses
  `username like '%' || $q || '%'` (wildcards escaped) over a table of at most hundreds of rows.

Rollback:

```sql
-- rollback:
-- drop table if exists accounts;
-- -- Lossy: account-owned voters and their ballots stay, but no longer reachable by sign-in.
```

## Unchanged tables

- `voters`: no new column. "Owned" is `exists (select 1 from accounts where voter_id = voters.id)`.
- `ballots`, `ballot_entries`: no change. Merge `UPDATE`s `ballots.voter_id` and `DELETE`s ballots
  (entries cascade).

## Domain types (`packages/core/src/domain`)

```text
Account {
  id: AccountId
  username: string
  voterId: VoterId
  sessionVersion: number
  temporaryPasswordExpiresAt: Date | null
  createdAt: Date
}
```

`passwordHash` is returned only by `AccountRepository.findCredentialsByUsername`, never on `Account`.

## Ports (`packages/core/src/ports`)

```text
AccountRepository {
  create({ username, passwordHash, adoptVoterId | null }) → { kind: 'created', account } | { kind: 'username-taken' }
      // adoptVoterId is used only when that voter is unowned; otherwise a new voter is minted (FR-309, FR-313)
  findById(id) → Account | null
  findCredentialsById(id) → { account, passwordHash } | null       // password change
  findCredentialsByUsername(username) → { account, passwordHash } | null
  search(query, limit) → Account[]
  setPassword(id, passwordHash, now) → Account               // clears temp expiry, bumps session_version
  resetPassword(id, temporaryHash, expiresAt) → Account | null // bumps session_version
  mergeDeviceVoter({ accountVoterId, deviceVoterId, now }) → { moved, discarded, left }  // one transaction
}
VoterRepository += isOwned(id) → boolean
PasswordHasher { hash(plain) → string; verify(hash, plain) → boolean }
```

## Pure rules (`packages/core/src/accounts`, 100% branch)

- `normaliseUsername(raw) → string | null` — trim, lowercase, match the pattern.
- `temporaryPasswordState(account, now) → 'none' | 'pending' | 'expired'`.
- `planDeviceMerge(deviceBallots: { ballotId, groupId, votingOpen }[], accountGroupIds: Set<GroupId>)
   → { move: BallotId[], discard: BallotId[], leave: BallotId[] }`
  - group not in `accountGroupIds` → `move`
  - in it and `votingOpen` → `discard`
  - in it and closed → `leave`
- `generateTemporaryPassword(randomBytes) → string` — 12 characters, unambiguous alphabet.

## State: an account's password

```text
           register / sign-in-with-newPassword / change
 ┌──────────────────────────────────────────────────────────┐
 ▼                                                          │
[normal] ── organiser reset ──► [temporary pending] ── 24 h ──► [temporary expired]
                                   │                               │
                                   └── sign-in + newPassword ──────┘ (expired: refused; organiser resets again)
```

Every arrow into "temporary pending" and every password change bumps `session_version`.
