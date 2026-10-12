# Quickstart: Optional Voter Accounts

Validation guide. Shapes are in [contracts/README.md](./contracts/README.md); storage in
[data-model.md](./data-model.md).

## Prerequisites

- Local stack running as in `README.md` (`pnpm dev`, local Supabase), migrations applied including
  `0008_voter_accounts.sql`.
- A published tournament with voting open and at least two groups (A, B), plus one whose voting has
  closed with at least one group (C).
- Organiser signed in at `/admin` in one browser profile.

## Automated gates

```bash
pnpm typecheck && pnpm lint && pnpm test:unit:coverage && pnpm test:contract && pnpm boundaries && pnpm openapi:check && pnpm migrations:check && pnpm migrations:verify-rollback
```

```bash
pnpm test:e2e -- accounts
```

## Manual scenarios

1. **Logged-out voting unchanged** (Story 3) — fresh profile, vote on group A without registering.
   Ballot accepted, results revealed, no sign-in prompt in the way.
2. **Register adopts device votes** (Story 1) — same profile, `/registar` with `rui.teste` /
   8+ chars. Header shows `rui.teste`. Group A still shows your ballot.
3. **Cross-device** (Story 1) — second profile, `/entrar` as `rui.teste`. Group A shows voted with
   the same ballot; voting on B there makes B voted in the first profile on reload.
4. **Merge on sign-in** (Story 2) — third profile, logged out: vote on A (conflict) and on a new group
   the account has not voted on. Sign in. The new group is now the account's; A shows the account's
   original ballot; A's ballot count dropped by one versus just before sign-in.
5. **Closed-group conflict** (clarification) — before C closes, vote on C as the account and in a
   logged-out profile; after C closes, sign in on that profile. C's count is unchanged.
6. **Sign out** (Story 4) — `Sair`. The device shows no ballots and can vote as a new visitor.
7. **Change password** (Story 4) — signed in on two profiles, change password on one. The other is
   signed out on reload; the old password is refused.
8. **Organiser reset** (Story 5) — `/admin`, search `teste`, "Repor palavra-passe". Temporary
   password shown once. The account's open sessions are signed out on reload. Signing in with the
   temporary password asks for a new one; after setting it the person can vote.
9. **Expired temporary password** — set `temporary_password_expires_at` to the past on a scratch DB;
   sign-in with it gives the generic wrong-credentials message.
10. **Rate limit** — 11 quick wrong sign-ins from one profile → "Demasiadas tentativas" (429).

## Privacy spot-checks

- `select * from accounts` shows argon2id hashes only; no IP, no email.
- No response body contains a voter id, account id (outside the organiser search), or hash.
