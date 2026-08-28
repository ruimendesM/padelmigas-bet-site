import { beforeEach, describe, expect, it } from 'vitest';
import { GET as LIST } from '../../apps/web/app/api/v1/tournaments/route.js';
import { GET as DETAIL } from '../../apps/web/app/api/v1/tournaments/[slug]/route.js';
import { GET as RESULTS } from '../../apps/web/app/api/v1/groups/[groupId]/results/route.js';
import { GET as PLAYER } from '../../apps/web/app/api/v1/players/[playerId]/route.js';
import { POST as CAST } from '../../apps/web/app/api/v1/groups/[groupId]/ballots/route.js';
import { VOTER_COOKIE_NAME } from '../../apps/web/src/server/voter-cookie.js';
import {
  createGroupWithPairs,
  createPair,
  createPlayer,
  createTournament,
} from '../factories/index.js';
import { rawSql } from './harness.js';
import { cookieFrom, current, getRequest, install, jsonRequest, params } from './helpers.js';

/**
 * No voter identifier is reachable from any public path (FR-022, SC-006).
 *
 * Three separate claims, because they fail separately:
 *  1. No response body or header carries a voter id — the signed cookie is the only place it exists.
 *  2. No endpoint enumerates ballots; there is no "who voted" shape in the contract at all.
 *  3. A group with exactly one ballot still cannot attribute that ballot to a device. This is the
 *     sharpest case: with N=1 the aggregate *is* one person's ballot, and it must still be
 *     anonymous (ADR-004).
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = new Date('2026-12-01T18:00:00.000Z');

/** Every header value of a response, joined, so a stray id in a header is caught too. */
function headerText(response: Response): string {
  return [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
}

async function voterIds(): Promise<string[]> {
  const rows = await rawSql()<{ id: string }[]>`select id from voters`;
  return rows.map((row) => row.id);
}

describe('no voter identity is exposed', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('never returns a voter id in any public body, on any path', async () => {
    const sql = rawSql();
    const tournament = await createTournament(sql, { slug: 'anonimo', startsAt: START });
    const group = await createGroupWithPairs(sql, tournament.id, { size: 3 });
    const player = await createPlayer(sql, { displayName: 'Jogadora de Teste' });
    await createPair(sql, group.groupId, { seed: 4, player1Id: player.id });

    const cast = await CAST(
      jsonRequest(`http://localhost/api/v1/groups/${group.groupId}/ballots`, {
        ordering: group.pairIds.map((pairId, index) => ({ pairId, position: index + 1 })),
      }),
      params({ groupId: group.groupId }),
    );
    const cookie = cookieFrom(cast, VOTER_COOKIE_NAME) ?? '';
    const ids = await voterIds();
    expect(ids).toHaveLength(1);

    const responses = [
      await LIST(getRequest('http://localhost/api/v1/tournaments', { cookie })),
      await DETAIL(
        getRequest('http://localhost/api/v1/tournaments/anonimo', { cookie }),
        params({ slug: 'anonimo' }),
      ),
      await RESULTS(
        getRequest(`http://localhost/api/v1/groups/${group.groupId}/results`, { cookie }),
        params({ groupId: group.groupId }),
      ),
      await PLAYER(
        getRequest(`http://localhost/api/v1/players/${player.id}`, { cookie }),
        params({ playerId: player.id }),
      ),
    ];

    for (const response of responses) {
      const raw = await response.text();
      for (const id of ids) {
        expect(raw).not.toContain(id);
        expect(headerText(response)).not.toContain(id);
      }
      // Nor the shape that would carry one.
      expect(raw).not.toContain('voterId');
      expect(raw).not.toContain('voter_id');
    }
  });

  it('never echoes the voter cookie value back in a body', async () => {
    const sql = rawSql();
    const tournament = await createTournament(sql, { slug: 'anonimo-2', startsAt: START });
    const group = await createGroupWithPairs(sql, tournament.id, { size: 3 });

    const cast = await CAST(
      jsonRequest(`http://localhost/api/v1/groups/${group.groupId}/ballots`, {
        ordering: group.pairIds.map((pairId, index) => ({ pairId, position: index + 1 })),
      }),
      params({ groupId: group.groupId }),
    );
    const cookie = cookieFrom(cast, VOTER_COOKIE_NAME) ?? '';
    const token = cookie.slice(`${VOTER_COOKIE_NAME}=`.length);
    expect(token.length).toBeGreaterThan(0);
    expect(await cast.text()).not.toContain(token);

    const detail = await DETAIL(
      getRequest('http://localhost/api/v1/tournaments/anonimo-2', { cookie }),
      params({ slug: 'anonimo-2' }),
    );
    expect(await detail.text()).not.toContain(token);
  });

  it('exposes no endpoint that enumerates ballots', async () => {
    // The contract has no such operation; this asserts the property at the source rather than by
    // probing URLs that were never defined.
    const { ENDPOINTS } = await import('@padelmigas/contracts');
    const suspicious = ENDPOINTS.filter(
      (endpoint) =>
        endpoint.method === 'GET' &&
        (endpoint.path.includes('ballot') || endpoint.path.includes('voter')),
    );
    expect(suspicious).toEqual([]);
  });

  it('cannot attribute a lone ballot to a device even when N is 1', async () => {
    const sql = rawSql();
    const tournament = await createTournament(sql, { slug: 'um-so-voto', startsAt: START });
    const group = await createGroupWithPairs(sql, tournament.id, { size: 3 });

    await CAST(
      jsonRequest(`http://localhost/api/v1/groups/${group.groupId}/ballots`, {
        ordering: group.pairIds.map((pairId, index) => ({ pairId, position: index + 1 })),
      }),
      params({ groupId: group.groupId }),
    );

    // Close the window so the aggregate is public — the hardest case for anonymity.
    current().setNow(START);
    const response = await RESULTS(
      getRequest(`http://localhost/api/v1/groups/${group.groupId}/results`),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(200);

    const raw = await response.text();
    const ids = await voterIds();
    expect(ids).toHaveLength(1);
    for (const id of ids) expect(raw).not.toContain(id);
    // The ordering is visible — that is the product — but nothing says whose it is.
    expect(raw).toContain('standings');
    expect(raw).not.toContain('castAt');
  });
});
