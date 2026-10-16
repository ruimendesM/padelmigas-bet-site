import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountResponse,
  ApiErrorWithIssues,
  TournamentDetailDto,
} from '@padelmigas/contracts';
import type { VoterId } from '@padelmigas/contracts/common';
import { GET as getAccount, POST as register } from '../../apps/web/app/api/v1/account/route.js';
import {
  DELETE as signOut,
  POST as signIn,
} from '../../apps/web/app/api/v1/account/session/route.js';
import { PUT as changePassword } from '../../apps/web/app/api/v1/account/password/route.js';
import { POST as castBallot } from '../../apps/web/app/api/v1/groups/[groupId]/ballots/route.js';
import { GET as getTournament } from '../../apps/web/app/api/v1/tournaments/[slug]/route.js';
import { ACCOUNT_COOKIE_NAME } from '../../apps/web/src/server/account-session.js';
import { VOTER_COOKIE_NAME, signVoterToken } from '../../apps/web/src/server/voter-cookie.js';
import { createGroupWithPairs, createTournament } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, current, getRequest, install, isNoStore, jsonRequest, params } from './helpers.js';

/**
 * Voter accounts (feature 004): `/api/v1/account`, `/account/session`, `/account/password`.
 *
 * Every case goes through the real routes, so the cookies, the caller resolution, the merge
 * transaction and the one-ballot constraint are all exercised together — the account rules are only
 * observable across several requests from several "devices".
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const OPEN_START = new Date('2026-12-01T18:00:00.000Z');
const BASE = 'http://localhost/api/v1';
const PASSWORD = 'palavra-passe-1';

// ---------------------------------------------------------------------------------------------
// A tiny cookie jar per simulated device
// ---------------------------------------------------------------------------------------------

/** One browser profile: applies every `Set-Cookie` it receives, including deletions. */
class Device {
  private readonly jar = new Map<string, string>();

  absorb(response: Response): Response {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '' || /max-age=0/i.test(header)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return response;
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  get cookie(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async post(path: string, payload: unknown, handler: (request: Request) => Promise<Response>) {
    return this.absorb(
      await handler(jsonRequest(`${BASE}${path}`, payload, cookieOption(this.cookie))),
    );
  }
}

function cookieOption(cookie: string | undefined): { cookie?: string } {
  return cookie === undefined ? {} : { cookie };
}

async function vote(device: Device, groupId: string, pairIds: readonly string[]) {
  return device.absorb(
    await castBallot(
      jsonRequest(
        `${BASE}/groups/${groupId}/ballots`,
        { ordering: pairIds.map((pairId, index) => ({ pairId, position: index + 1 })) },
        cookieOption(device.cookie),
      ),
      params({ groupId }),
    ),
  );
}

async function detail(device: Device, slug: string): Promise<TournamentDetailDto> {
  const response = await getTournament(
    getRequest(`${BASE}/tournaments/${slug}`, cookieOption(device.cookie)),
    params({ slug }),
  );
  return body<TournamentDetailDto>(response);
}

async function registerOn(device: Device, username: string, password = PASSWORD) {
  return device.post('/account', { username, password }, register);
}

async function signInOn(
  device: Device,
  username: string,
  password = PASSWORD,
  newPassword?: string,
) {
  return device.post(
    '/account/session',
    { username, password, ...(newPassword === undefined ? {} : { newPassword }) },
    signIn,
  );
}

async function ballotCount(groupId: string): Promise<number> {
  const rows =
    await rawSql()`select count(*)::int as count from ballots where group_id = ${groupId}`;
  return rows[0]?.['count'] as number;
}

/** One tournament with two open groups. */
async function openTournament(slug = 'torneio-aberto') {
  const sql = rawSql();
  const tournament = await createTournament(sql, { slug, startsAt: OPEN_START });
  const a = await createGroupWithPairs(sql, tournament.id, { label: 'A', position: 1 });
  const b = await createGroupWithPairs(sql, tournament.id, { label: 'B', position: 2 });
  return { slug, a, b };
}

// ---------------------------------------------------------------------------------------------

describe('POST /api/v1/account (register)', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('creates the account, answers 201 with the username only, signs in, and clears the voter cookie', async () => {
    const device = new Device();
    const response = await registerOn(device, '  Rui.M ');

    expect(response.status).toBe(201);
    expect(isNoStore(response)).toBe(true);
    expect(await body<AccountResponse>(response)).toEqual({ account: { username: 'rui.m' } });
    expect(device.has(ACCOUNT_COOKIE_NAME)).toBe(true);
    expect(device.has(VOTER_COOKIE_NAME)).toBe(false);

    const me = await getAccount(getRequest(`${BASE}/account`, cookieOption(device.cookie)));
    expect(me.status).toBe(200);
    expect(await body<AccountResponse>(me)).toEqual({ account: { username: 'rui.m' } });
  });

  it('stores only an argon2id hash and never echoes an id or hash (FR-306, FR-022)', async () => {
    const response = await registerOn(new Device(), 'rui.m');
    const raw = await response.text();
    const rows = await rawSql()`select id, voter_id, password_hash from accounts`;
    const row = rows[0] ?? {};
    expect(String(row['password_hash'])).toMatch(/^\$argon2id\$/);
    expect(String(row['password_hash'])).not.toContain(PASSWORD);
    for (const value of [row['id'], row['voter_id'], row['password_hash']]) {
      expect(raw).not.toContain(String(value));
    }
  });

  it('adopts the ballots already cast on this device (FR-309)', async () => {
    const { slug, a } = await openTournament();
    const device = new Device();
    await vote(device, a.groupId, a.pairIds);

    await registerOn(device, 'rui.m');

    const other = new Device();
    await signInOn(other, 'rui.m');
    const seen = await detail(other, slug);
    expect(seen.groups.find((g) => g.id === a.groupId)?.hasVoted).toBe(true);
    expect(await ballotCount(a.groupId)).toBe(1);
  });

  it('does not adopt a voter another account already owns (FR-313)', async () => {
    const { slug, a } = await openTournament();
    const device = new Device();
    await registerOn(device, 'primeira');
    await vote(device, a.groupId, a.pairIds);

    // A stale voter cookie pointing at the first account's voter, then registering a second account.
    const voterId = (await rawSql()`select voter_id from accounts`)[0]?.['voter_id'] as string;
    const stale = new Device();
    stale.absorb(
      new Response(null, {
        headers: {
          'Set-Cookie': `${VOTER_COOKIE_NAME}=${await signVoterToken(voterId as VoterId)}`,
        },
      }),
    );
    await registerOn(stale, 'segunda');

    const seen = await detail(stale, slug);
    expect(seen.groups.find((g) => g.id === a.groupId)?.hasVoted).toBe(false);
    const owners = await rawSql()`select count(distinct voter_id)::int as n from accounts`;
    expect(owners[0]?.['n']).toBe(2);
  });

  it('refuses a taken username regardless of case with USERNAME_TAKEN', async () => {
    await registerOn(new Device(), 'rui.m');
    const response = await registerOn(new Device(), 'RUI.M');
    expect(response.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('USERNAME_TAKEN');
  });

  it.each([
    ['ab', PASSWORD, 'username'],
    ['a'.repeat(31), PASSWORD, 'username'],
    ['rui m', PASSWORD, 'username'],
    ['rui.m', 'curta', 'password'],
    ['rui.m', 'x'.repeat(129), 'password'],
  ])('rejects %s / %s with MALFORMED_PAYLOAD naming %s', async (username, password, path) => {
    const response = await registerOn(new Device(), username, password);
    expect(response.status).toBe(400);
    const payload = await body<ApiErrorWithIssues>(response);
    expect(payload.code).toBe('MALFORMED_PAYLOAD');
    expect(payload.issues.map((issue) => issue.path)).toContain(path);
  });

  it('rate-limits registration per network with RATE_LIMITED (FR-317)', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await registerOn(new Device(), 'ab');
    expect(last?.status).toBe(429);
    expect((await body<ApiErrorWithIssues>(last as Response)).code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/v1/account', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('answers UNAUTHORISED without a session', async () => {
    const response = await getAccount(getRequest(`${BASE}/account`));
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });
});

describe('POST /api/v1/account/session (sign in)', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('signs in with any capitalisation and answers the username', async () => {
    await registerOn(new Device(), 'rui.m');
    const device = new Device();
    const response = await signInOn(device, 'Rui.M');
    expect(response.status).toBe(200);
    expect(await body<AccountResponse>(response)).toEqual({ account: { username: 'rui.m' } });
    expect(device.has(ACCOUNT_COOKIE_NAME)).toBe(true);
  });

  it('gives the same answer for an unknown user and a wrong password (FR-314)', async () => {
    await registerOn(new Device(), 'rui.m');
    const unknown = await signInOn(new Device(), 'ninguem');
    const wrong = await signInOn(new Device(), 'rui.m', 'outra-palavra');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await body(unknown)).toEqual(await body(wrong));
  });

  it('moves a device ballot in a group the account has not voted in (FR-310)', async () => {
    const { slug, a, b } = await openTournament();
    const home = new Device();
    await registerOn(home, 'rui.m');
    await vote(home, a.groupId, a.pairIds);

    const phone = new Device();
    await vote(phone, b.groupId, b.pairIds);
    await signInOn(phone, 'rui.m');

    const seen = await detail(home, slug);
    expect(seen.groups.find((g) => g.id === b.groupId)?.hasVoted).toBe(true);
    expect(await ballotCount(b.groupId)).toBe(1);
  });

  it('keeps the account ballot and discards the device one on an open-group conflict (FR-311)', async () => {
    const { slug, a } = await openTournament();
    const home = new Device();
    await registerOn(home, 'rui.m');
    await vote(home, a.groupId, a.pairIds);

    const phone = new Device();
    await vote(phone, a.groupId, [...a.pairIds].reverse());
    expect(await ballotCount(a.groupId)).toBe(2);

    await signInOn(phone, 'rui.m');

    expect(await ballotCount(a.groupId)).toBe(1);
    const own = (await detail(phone, slug)).groups.find((g) => g.id === a.groupId)?.ownBallot;
    expect(own?.ordering[0]?.pairId).toBe(a.pairIds[0]);
  });

  it('leaves both ballots on a conflict in a closed group, so its totals do not change', async () => {
    const { a } = await openTournament();
    const home = new Device();
    await registerOn(home, 'rui.m');
    await vote(home, a.groupId, a.pairIds);
    const phone = new Device();
    await vote(phone, a.groupId, [...a.pairIds].reverse());

    current().setNow(new Date(OPEN_START.getTime() + 60_000));
    await signInOn(phone, 'rui.m');

    expect(await ballotCount(a.groupId)).toBe(2);
  });

  it('never moves the ballots of a voter another account owns (FR-313)', async () => {
    const { a } = await openTournament();
    const first = new Device();
    await registerOn(first, 'primeira');
    await vote(first, a.groupId, a.pairIds);
    await registerOn(new Device(), 'segunda');

    // `first` still carries the first account's session; signing in to the second account on it
    // presents no anonymous voter (register cleared it), so nothing can move.
    await signInOn(first, 'segunda');
    const owner = await rawSql()`
      select a.username from ballots b join accounts a on a.voter_id = b.voter_id
    `;
    expect(owner.map((row) => row['username'])).toEqual(['primeira']);
  });

  it('rate-limits sign-in per network with RATE_LIMITED (FR-317)', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await signInOn(new Device(), 'ninguem');
    expect(last?.status).toBe(429);
  });
});

describe('one account, one ballot per group (FR-308)', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('accepts exactly one of two simultaneous ballots from two signed-in devices', async () => {
    const { a } = await openTournament();
    await registerOn(new Device(), 'rui.m');
    const one = new Device();
    const two = new Device();
    await signInOn(one, 'rui.m');
    await signInOn(two, 'rui.m');

    const statuses = (
      await Promise.all([vote(one, a.groupId, a.pairIds), vote(two, a.groupId, a.pairIds)])
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([201, 409]);
  });
});

describe('DELETE /api/v1/account/session (sign out)', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('clears both cookies and the device no longer sees the account ballots (FR-316)', async () => {
    const { slug, a } = await openTournament();
    const device = new Device();
    await registerOn(device, 'rui.m');
    await vote(device, a.groupId, a.pairIds);
    expect((await detail(device, slug)).groups[0]?.hasVoted).toBe(true);

    const response = device.absorb(await signOut());
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ signedOut: true });
    expect(device.has(ACCOUNT_COOKIE_NAME)).toBe(false);
    expect(device.has(VOTER_COOKIE_NAME)).toBe(false);
    expect((await detail(device, slug)).groups[0]?.hasVoted).toBe(false);
  });
});

describe('PUT /api/v1/account/password', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  async function change(device: Device, currentPassword: string, newPassword: string) {
    return device.absorb(
      await changePassword(
        jsonRequest(
          `${BASE}/account/password`,
          { currentPassword, newPassword },
          { method: 'PUT', ...cookieOption(device.cookie) },
        ),
      ),
    );
  }

  it('changes the password, keeps this device signed in and signs out the others (FR-318)', async () => {
    const one = new Device();
    await registerOn(one, 'rui.m');
    const two = new Device();
    await signInOn(two, 'rui.m');

    const response = await change(one, PASSWORD, 'nova-palavra-2');
    expect(response.status).toBe(200);

    const meOne = await getAccount(getRequest(`${BASE}/account`, cookieOption(one.cookie)));
    const meTwo = await getAccount(getRequest(`${BASE}/account`, cookieOption(two.cookie)));
    expect(meOne.status).toBe(200);
    expect(meTwo.status).toBe(401);

    expect((await signInOn(new Device(), 'rui.m')).status).toBe(401);
    expect((await signInOn(new Device(), 'rui.m', 'nova-palavra-2')).status).toBe(200);
  });

  it('refuses a wrong current password with INVALID_CREDENTIALS', async () => {
    const device = new Device();
    await registerOn(device, 'rui.m');
    const response = await change(device, 'errada-123', 'nova-palavra-2');
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('INVALID_CREDENTIALS');
  });

  it('answers UNAUTHORISED without a session', async () => {
    const response = await change(new Device(), PASSWORD, 'nova-palavra-2');
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });

  it('rejects a too-short new password with MALFORMED_PAYLOAD', async () => {
    const device = new Device();
    await registerOn(device, 'rui.m');
    const response = await change(device, PASSWORD, 'curta');
    expect(response.status).toBe(400);
  });
});

describe('cross-site writes are refused (FR-324)', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  function rawPost(path: string, payload: string, headers: Record<string, string>): Request {
    return new Request(`${BASE}${path}`, { method: 'POST', headers, body: payload });
  }

  it('refuses a text/plain sign-in shaped like JSON, the form-post attack, without setting cookies', async () => {
    await registerOn(new Device(), 'rui.m');
    const response = await signIn(
      rawPost('/account/session', JSON.stringify({ username: 'rui.m', password: PASSWORD }), {
        'content-type': 'text/plain',
        origin: 'https://evil.example',
        host: 'localhost',
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a JSON sign-in or registration from another origin', async () => {
    await registerOn(new Device(), 'rui.m');
    const headers = {
      'content-type': 'application/json',
      origin: 'https://evil.example',
      host: 'localhost',
    };
    const signedIn = await signIn(
      rawPost(
        '/account/session',
        JSON.stringify({ username: 'rui.m', password: PASSWORD }),
        headers,
      ),
    );
    const registered = await register(
      rawPost('/account', JSON.stringify({ username: 'outra', password: PASSWORD }), headers),
    );
    for (const response of [signedIn, registered]) {
      expect(response.status).toBe(401);
      expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('refuses the literal null origin of sandboxed pages', async () => {
    const response = await register(
      rawPost('/account', JSON.stringify({ username: 'rui.m', password: PASSWORD }), {
        'content-type': 'application/json',
        origin: 'null',
        host: 'localhost',
      }),
    );
    expect(response.status).toBe(401);
  });

  it('accepts a same-site origin, and a client that sends no origin at all', async () => {
    const sameSite = await register(
      rawPost('/account', JSON.stringify({ username: 'rui.m', password: PASSWORD }), {
        'content-type': 'application/json; charset=utf-8',
        origin: 'http://localhost',
        host: 'localhost',
      }),
    );
    expect(sameSite.status).toBe(201);
    const noOrigin = await signIn(
      rawPost('/account/session', JSON.stringify({ username: 'rui.m', password: PASSWORD }), {
        'content-type': 'application/json',
      }),
    );
    expect(noOrigin.status).toBe(200);
  });

  it('refuses a cross-site password change', async () => {
    const device = new Device();
    await registerOn(device, 'rui.m');
    const response = await changePassword(
      new Request(`${BASE}/account/password`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          host: 'localhost',
          cookie: device.cookie ?? '',
        },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'nova-palavra-2' }),
      }),
    );
    expect(response.status).toBe(401);
    expect((await signInOn(new Device(), 'rui.m')).status).toBe(200);
  });
});
