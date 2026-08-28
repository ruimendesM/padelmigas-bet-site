import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, LineupPreviewDto } from '@padelmigas/contracts';
import { POST } from '../../apps/web/app/api/v1/admin/tournaments/preview/route.js';
import { createPlayer } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, install, jsonRequest, organiserCookie } from './helpers.js';

/**
 * `POST /api/v1/admin/tournaments/preview` (FR-001, FR-002, FR-005, FR-006).
 *
 * The preview is the safety net before an irreversible public publish (Risk R9), so every documented
 * failure code is asserted reachable — a code that cannot be produced is a code the organiser will
 * never see when they need it.
 */

const URL = 'http://localhost/api/v1/admin/tournaments/preview';
const START = '2026-12-01T18:00:00.000Z';

/** Six pairs of already-known players, seeded so grouping is deterministic. */
async function knownPairs(count: number): Promise<
  {
    club: string;
    totalPoints: number;
    players: [{ name: string; points: number }, { name: string; points: number }];
  }[]
> {
  const sql = rawSql();
  const pairs = [];
  for (let index = 0; index < count; index += 1) {
    const first = await createPlayer(sql, { displayName: `Jogador Um ${index}` });
    const second = await createPlayer(sql, { displayName: `Jogador Dois ${index}` });
    const points = 300 - index * 10;
    pairs.push({
      club: `Clube ${index}`,
      totalPoints: points * 2,
      players: [
        { name: first.displayName, points },
        { name: second.displayName, points },
      ] as [{ name: string; points: number }, { name: string; points: number }],
    });
  }
  return pairs;
}

describe('POST /api/v1/admin/tournaments/preview', () => {
  beforeEach(() => {
    install({ now: new Date('2026-09-01T12:00:00.000Z') });
  });

  it('returns the derived groups without persisting anything', async () => {
    const pairs = await knownPairs(6);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio de Setembro', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );

    expect(response.status).toBe(200);
    const preview = await body<LineupPreviewDto>(response);
    expect(preview.slug).toBe('torneio-de-setembro');
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]?.pairs).toHaveLength(6);
    expect(preview.resolvedPlayers).toHaveLength(12);

    // "Without persisting" is the whole point of a preview; assert past the API.
    const tournaments = await rawSql()`select count(*)::int as count from tournaments`;
    expect(tournaments[0]?.['count']).toBe(0);
  });

  it('rejects a caller with no organiser session', async () => {
    const response = await POST(jsonRequest(URL, { name: 'Torneio', startsAt: START, pairs: [] }));
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });

  it('reports every unresolved name at once rather than the first', async () => {
    const pairs = await knownPairs(3);
    pairs[0]!.players[0].name = 'Alguém Que Não Existe';
    pairs[1]!.players[1].name = 'Outra Pessoa Desconhecida';

    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    const error = await body<ApiErrorWithIssues>(response);
    expect(error.code).toBe('UNRESOLVED_PLAYERS');
    // FR-005: an organiser fixing a paste should not re-submit once per typo.
    expect(error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a payload that is not even the right shape', async () => {
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'x', startsAt: 'not-a-date', pairs: [] },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('MALFORMED_PAYLOAD');
  });

  it('rejects a start instant that is not in the future', async () => {
    const pairs = await knownPairs(3);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: '2026-08-01T18:00:00.000Z', pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('START_NOT_IN_FUTURE');
  });

  it('rejects the same player appearing twice in one tournament', async () => {
    const pairs = await knownPairs(3);
    pairs[1]!.players[0] = { ...pairs[0]!.players[0] };
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('DUPLICATE_PLAYER');
  });

  it('rejects a pair whose stated total disagrees with its players', async () => {
    const pairs = await knownPairs(3);
    pairs[0]!.totalPoints += 1;
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('POINTS_MISMATCH');
  });

  it('rejects a group smaller than three pairs', async () => {
    const pairs = await knownPairs(9);
    // Explicit group labels override derivation, so this asks for a group of one (research D10).
    pairs.forEach((pair, index) => {
      Object.assign(pair, { group: index < 8 ? 'A' : 'B' });
    });
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('INVALID_GROUP_SIZE');
  });

  it('reports a slug that is already taken, before the organiser confirms a publish', async () => {
    const pairs = await knownPairs(3);
    await rawSql()`
      insert into tournaments (name, slug, starts_at, published_at)
      values ('Existente', 'torneio', ${START}, now())
    `;
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('SLUG_TAKEN');
  });
});
