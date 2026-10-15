import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountResponse,
  AccountSearchResponse,
  ApiErrorWithIssues,
  PasswordResetResponse,
} from '@padelmigas/contracts';
import { GET as getAccount, POST as register } from '../../apps/web/app/api/v1/account/route.js';
import { POST as signIn } from '../../apps/web/app/api/v1/account/session/route.js';
import { GET as searchAccounts } from '../../apps/web/app/api/v1/admin/accounts/route.js';
import { POST as resetPassword } from '../../apps/web/app/api/v1/admin/accounts/[accountId]/password-reset/route.js';
import { ACCOUNT_COOKIE_NAME } from '../../apps/web/src/server/account-session.js';
import {
  body,
  current,
  getRequest,
  install,
  isNoStore,
  jsonRequest,
  organiserCookie,
  params,
} from './helpers.js';

/**
 * Organiser account tools (feature 004, FR-319 – FR-321): search and password reset, and the
 * sign-in path a temporary password forces.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const BASE = 'http://localhost/api/v1';
const PASSWORD = 'palavra-passe-1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The account session cookie a response set, as a request `cookie` value. */
function sessionFrom(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${ACCOUNT_COOKIE_NAME}=`));
  return header?.split(';')[0] ?? '';
}

async function registerAccount(username: string): Promise<string> {
  const response = await register(jsonRequest(`${BASE}/account`, { username, password: PASSWORD }));
  return sessionFrom(response);
}

async function signInAs(username: string, password: string, newPassword?: string) {
  return signIn(
    jsonRequest(`${BASE}/account/session`, {
      username,
      password,
      ...(newPassword === undefined ? {} : { newPassword }),
    }),
  );
}

async function search(q: string, cookie?: string) {
  return searchAccounts(
    getRequest(
      `${BASE}/admin/accounts?q=${encodeURIComponent(q)}`,
      cookie === undefined ? {} : { cookie },
    ),
  );
}

async function reset(accountId: string, cookie?: string) {
  return resetPassword(
    jsonRequest(
      `${BASE}/admin/accounts/${accountId}/password-reset`,
      {},
      cookie === undefined ? {} : { cookie },
    ),
    params({ accountId }),
  );
}

async function accountIdOf(username: string): Promise<string> {
  const payload = await body<AccountSearchResponse>(
    await search(username, await organiserCookie()),
  );
  const found = payload.accounts.find((account) => account.username === username);
  if (!found) throw new Error(`No account ${username}`);
  return found.id;
}

describe('GET /api/v1/admin/accounts', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('lists accounts whose username contains the query, case-insensitively', async () => {
    await registerAccount('rui.m');
    await registerAccount('ana_rui');
    await registerAccount('joana');

    const response = await search('RUI', await organiserCookie());
    expect(response.status).toBe(200);
    const payload = await body<AccountSearchResponse>(response);
    expect(payload.accounts.map((account) => account.username).sort()).toEqual([
      'ana_rui',
      'rui.m',
    ]);
    expect(payload.accounts[0]).toEqual({
      id: expect.any(String),
      username: expect.any(String),
      createdAt: expect.any(String),
      temporaryPasswordPending: false,
    });
  });

  it('treats LIKE wildcards in the query literally', async () => {
    await registerAccount('ana_rui');
    await registerAccount('anaxrui');
    const payload = await body<AccountSearchResponse>(await search('a_r', await organiserCookie()));
    expect(payload.accounts.map((account) => account.username)).toEqual(['ana_rui']);
  });

  it('answers UNAUTHORISED without an organiser session', async () => {
    const response = await search('rui');
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });

  it('answers MALFORMED_PAYLOAD for an empty query', async () => {
    const response = await search('', await organiserCookie());
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/admin/accounts/{accountId}/password-reset', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('issues a 24 h temporary password once, no-store, and ends existing sessions (FR-320)', async () => {
    const session = await registerAccount('rui.m');
    const accountId = await accountIdOf('rui.m');

    const response = await reset(accountId, await organiserCookie());
    expect(response.status).toBe(201);
    expect(isNoStore(response)).toBe(true);
    const payload = await body<PasswordResetResponse>(response);
    expect(payload.temporaryPassword).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{12}$/);
    expect(new Date(payload.expiresAt).getTime()).toBe(NOW.getTime() + DAY_MS);

    const me = await getAccount(getRequest(`${BASE}/account`, { cookie: session }));
    expect(me.status).toBe(401);

    const listed = await body<AccountSearchResponse>(await search('rui', await organiserCookie()));
    expect(listed.accounts[0]?.temporaryPasswordPending).toBe(true);
  });

  it('forces a new password before any session exists (FR-321)', async () => {
    await registerAccount('rui.m');
    const { temporaryPassword } = await body<PasswordResetResponse>(
      await reset(await accountIdOf('rui.m'), await organiserCookie()),
    );

    const withoutNew = await signInAs('rui.m', temporaryPassword);
    expect(withoutNew.status).toBe(403);
    expect((await body<ApiErrorWithIssues>(withoutNew)).code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(withoutNew.headers.getSetCookie()).toEqual([]);

    const withNew = await signInAs('rui.m', temporaryPassword, 'nova-palavra-2');
    expect(withNew.status).toBe(200);
    expect(await body<AccountResponse>(withNew)).toEqual({ account: { username: 'rui.m' } });

    expect((await signInAs('rui.m', temporaryPassword)).status).toBe(401);
    expect((await signInAs('rui.m', 'nova-palavra-2')).status).toBe(200);
  });

  it('refuses an expired temporary password like a wrong one', async () => {
    await registerAccount('rui.m');
    const { temporaryPassword } = await body<PasswordResetResponse>(
      await reset(await accountIdOf('rui.m'), await organiserCookie()),
    );

    current().setNow(new Date(NOW.getTime() + DAY_MS));
    const response = await signInAs('rui.m', temporaryPassword, 'nova-palavra-2');
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('INVALID_CREDENTIALS');
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const response = await reset('00000000-0000-4000-8000-000000000000', await organiserCookie());
    expect(response.status).toBe(404);
  });

  it('answers UNAUTHORISED without an organiser session', async () => {
    await registerAccount('rui.m');
    const response = await reset(await accountIdOf('rui.m'));
    expect(response.status).toBe(401);
  });
});
