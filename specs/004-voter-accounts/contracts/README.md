# Contracts: Optional Voter Accounts

All changes are additive under `/api/v1` (Principle III). Schemas live in
`packages/contracts/src/accounts.ts`; endpoints in `packages/contracts/src/endpoints.ts`.

## Shared schemas

- `username`: string, trimmed and lower-cased, `^[a-z0-9._-]{3,30}$` (FR-303). Violations →
  `MALFORMED_PAYLOAD` with an issue naming the rule.
- `password`: string, 8–128 characters (FR-304).
- `accountDto`: `{ username }`. Nothing else is ever returned to the account holder: no id, no voter
  id (FR-022 still holds), no hash.

## New error codes

| Code | HTTP | When |
|---|---|---|
| `USERNAME_TAKEN` | 409 | Register with a username that exists (any case). |
| `INVALID_CREDENTIALS` | 401 | Wrong username or password, or expired temporary password. One message for all. |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Sign-in with a valid, pending temporary password and no `newPassword`. |

`RATE_LIMITED` (429) applies to register and sign-in through the `auth` bucket.

## `POST /account` — `register`

- Auth: none. Body: `{ username, password }`.
- 201 `{ account: accountDto }`. Sets `pm_account`, clears `pm_voter`. If the device's `pm_voter` was
  a valid unowned voter, the account adopts it (FR-309).
- Errors: `MALFORMED_PAYLOAD`, `USERNAME_TAKEN`, `RATE_LIMITED`.

## `GET /account` — `getAccount`

- Auth: account session. 200 `{ account: accountDto }`.
- Errors: `UNAUTHORISED` when there is no valid session.

## `POST /account/session` — `signIn`

- Auth: none. Body: `{ username, password, newPassword? }`.
- 200 `{ account: accountDto }`. Sets `pm_account`, clears `pm_voter`, after merging the device's
  unowned voter into the account (FR-310 – FR-312).
- Errors: `MALFORMED_PAYLOAD`, `INVALID_CREDENTIALS`, `PASSWORD_CHANGE_REQUIRED`, `RATE_LIMITED`.

## `DELETE /account/session` — `signOut`

- Auth: none required (idempotent). 204. Clears `pm_account` and `pm_voter` (FR-316).

## `PUT /account/password` — `changePassword`

- Auth: account session. Body: `{ currentPassword, newPassword }`.
- 200 `{ account: accountDto }`. Bumps the session version and re-issues `pm_account` for this
  device, ending every other session (FR-318).
- Errors: `UNAUTHORISED`, `INVALID_CREDENTIALS` (wrong current password), `MALFORMED_PAYLOAD`.

## `GET /admin/accounts?q=` — `searchAccounts`

- Auth: organiser. Query: `q` (1–30 chars, matched case-insensitively as a substring), up to 20 rows.
- 200 `{ accounts: [{ id, username, createdAt, temporaryPasswordPending: boolean }] }`.
- Errors: `UNAUTHORISED`.

## `POST /admin/accounts/{accountId}/password-reset` — `resetAccountPassword`

- Auth: organiser. Body: none.
- 201 `{ temporaryPassword, expiresAt }`. The only response that ever contains the temporary
  password; it is not retrievable afterwards (FR-320). Response carries `Cache-Control: no-store`.
- Errors: `NOT_FOUND`, `UNAUTHORISED`.

## Unchanged shapes, changed meaning

- Ballot, results and tournament-detail endpoints resolve the caller from the account session when
  present (see plan.md, Caller resolution). Their schemas do not change.
