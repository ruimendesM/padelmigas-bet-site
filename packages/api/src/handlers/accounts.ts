import type {
  AccountResponse,
  AccountSearchResponse,
  ChangePasswordRequestDto,
  PasswordResetResponse,
  RegisterRequestDto,
  SignInRequestDto,
} from '@padelmigas/contracts';
import type { AccountId, VoterId } from '@padelmigas/contracts/common';
import {
  TEMPORARY_PASSWORD_TTL_MS,
  domainError,
  generateTemporaryPassword,
  normaliseUsername,
  temporaryPasswordState,
  type Account,
} from '@padelmigas/core';
import type { Deps } from '../handler.js';

/**
 * Optional voter accounts (feature 004, ADR-012).
 *
 * The handlers decide; the host signs. A handler that grants a session returns the account id and
 * session version, and the route turns them into a cookie — this package never touches a cookie or a
 * signing key (Principle II).
 *
 * One rule runs through sign-in and password change: **wrong credentials get one answer**, whatever
 * was wrong (FR-314). An unknown username still costs one hash verification, so the response time
 * does not reveal whether it exists (research R7).
 */

/** What a route needs to issue an account session. Never serialised as such. */
export interface SessionGrant {
  readonly response: AccountResponse;
  readonly session: { readonly accountId: AccountId; readonly sessionVersion: number };
}

function grant(account: Account): SessionGrant {
  return {
    response: { account: { username: account.username } },
    session: { accountId: account.id, sessionVersion: account.sessionVersion },
  };
}

const INVALID_CREDENTIALS_MESSAGE = 'Nome de utilizador ou palavra-passe incorretos.';

function invalidCredentials(): never {
  throw domainError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
}

/**
 * A real argon2id hash (same parameters as `ARGON2_OPTIONS`) of a random string that was discarded.
 * Verified against when the username does not exist, so both paths cost one full verification. It must
 * stay a well-formed hash: a malformed one fails instantly and the timing difference returns.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$9pxcKuaO/gebW62HzR6z2g$5O0VUXXwtD9/wGcXHco1lR6/5qimUH7LH1X0PJRGIjE';

// ---------------------------------------------------------------------------------------------
// Register (FR-303 – FR-309)
// ---------------------------------------------------------------------------------------------

export interface RegisterInput {
  readonly request: RegisterRequestDto;
  /** The device's anonymous voter, adopted if no account owns it (FR-309). */
  readonly deviceVoterId: VoterId | null;
}

export async function register(input: RegisterInput, deps: Deps): Promise<SessionGrant> {
  // The contract already normalised and validated; re-normalising here keeps the rule in core the
  // single authority if a second adapter ever skips the contract.
  const username = normaliseUsername(input.request.username);
  if (!username) {
    throw domainError('MALFORMED_PAYLOAD', 'O nome de utilizador não é válido.', [
      { path: 'username', message: 'O nome de utilizador não é válido.' },
    ]);
  }

  const outcome = await deps.accounts.create({
    username,
    passwordHash: await deps.passwords.hash(input.request.password),
    adoptVoterId: input.deviceVoterId,
  });

  if (outcome.kind === 'username-taken') {
    throw domainError('USERNAME_TAKEN', 'Esse nome de utilizador já existe. Escolhe outro.');
  }
  return grant(outcome.account);
}

// ---------------------------------------------------------------------------------------------
// Who am I (FR-322)
// ---------------------------------------------------------------------------------------------

export interface GetAccountInput {
  readonly accountId: AccountId | null;
}

export async function getAccount(input: GetAccountInput, deps: Deps): Promise<AccountResponse> {
  const account = input.accountId ? await deps.accounts.findById(input.accountId) : null;
  if (!account) throw domainError('UNAUTHORISED', 'Não tens sessão iniciada.');
  return { account: { username: account.username } };
}

// ---------------------------------------------------------------------------------------------
// Sign in (FR-310 – FR-314, FR-321)
// ---------------------------------------------------------------------------------------------

export interface SignInInput {
  readonly request: SignInRequestDto;
  /** The device's anonymous voter, merged into the account if no account owns it (FR-310). */
  readonly deviceVoterId: VoterId | null;
}

export async function signIn(input: SignInInput, deps: Deps): Promise<SessionGrant> {
  const username = normaliseUsername(input.request.username);
  const credentials = username ? await deps.accounts.findCredentialsByUsername(username) : null;

  if (!credentials) {
    await deps.passwords.verify(DUMMY_HASH, input.request.password);
    invalidCredentials();
  }
  if (!(await deps.passwords.verify(credentials.passwordHash, input.request.password))) {
    invalidCredentials();
  }

  const now = deps.clock.now();
  let account = credentials.account;

  const temporary = temporaryPasswordState(account, now);
  // An expired temporary password gets the wrong-password answer: the organiser resets again (FR-320).
  if (temporary === 'expired') invalidCredentials();
  if (temporary === 'pending') {
    // A temporary password never yields a session on its own (FR-321, research R5).
    const replacement = input.request.newPassword;
    if (replacement === undefined) {
      throw domainError(
        'PASSWORD_CHANGE_REQUIRED',
        'Esta palavra-passe é temporária. Escolhe uma nova para continuar.',
      );
    }
    account = await deps.accounts.setPassword(
      account.id,
      await deps.passwords.hash(replacement),
      now,
    );
  }

  if (input.deviceVoterId) {
    await deps.accounts.mergeDeviceVoter({
      accountVoterId: account.voterId,
      deviceVoterId: input.deviceVoterId,
      now,
    });
  }

  return grant(account);
}

// ---------------------------------------------------------------------------------------------
// Change password (FR-318)
// ---------------------------------------------------------------------------------------------

export interface ChangePasswordInput {
  readonly accountId: AccountId | null;
  readonly request: ChangePasswordRequestDto;
}

export async function changePassword(
  input: ChangePasswordInput,
  deps: Deps,
): Promise<SessionGrant> {
  const credentials = input.accountId
    ? await deps.accounts.findCredentialsById(input.accountId)
    : null;
  if (!credentials) throw domainError('UNAUTHORISED', 'Não tens sessão iniciada.');

  if (!(await deps.passwords.verify(credentials.passwordHash, input.request.currentPassword))) {
    throw domainError('INVALID_CREDENTIALS', 'A palavra-passe atual está incorreta.');
  }

  // Bumps the session version: every other device is signed out, and the route re-issues this
  // device's session with the new version.
  const account = await deps.accounts.setPassword(
    credentials.account.id,
    await deps.passwords.hash(input.request.newPassword),
    deps.clock.now(),
  );
  return grant(account);
}

// ---------------------------------------------------------------------------------------------
// Organiser (FR-319, FR-320)
// ---------------------------------------------------------------------------------------------

const SEARCH_LIMIT = 20;

export async function searchAccounts(
  input: { readonly q: string },
  deps: Deps,
): Promise<AccountSearchResponse> {
  const now = deps.clock.now();
  const accounts = await deps.accounts.search(input.q, SEARCH_LIMIT);
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      username: account.username,
      createdAt: account.createdAt.toISOString(),
      temporaryPasswordPending: temporaryPasswordState(account, now) === 'pending',
    })),
  };
}

export async function resetAccountPassword(
  input: { readonly accountId: AccountId },
  deps: Deps,
): Promise<PasswordResetResponse> {
  const now = deps.clock.now();
  const temporaryPassword = generateTemporaryPassword();
  const expiresAt = new Date(now.getTime() + TEMPORARY_PASSWORD_TTL_MS);

  const account = await deps.accounts.resetPassword(
    input.accountId,
    await deps.passwords.hash(temporaryPassword),
    expiresAt,
    now,
  );
  if (!account) throw domainError('NOT_FOUND', 'Conta não encontrada.');

  return { temporaryPassword, expiresAt: expiresAt.toISOString() };
}
