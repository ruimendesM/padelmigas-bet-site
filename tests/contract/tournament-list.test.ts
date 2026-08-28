import { beforeEach, describe, expect, it } from 'vitest';
import type { TournamentListResponse } from '@padelmigas/contracts';
import { GET } from '../../apps/web/app/api/v1/tournaments/route.js';
import { castBallots, createGroupWithPairs, createTournament } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, getRequest, install } from './helpers.js';

/**
 * `GET /api/v1/tournaments` (FR-023, SC-006).
 *
 * The landing page's data source. Two things it must never do: show a draft, and carry a per-group
 * figure — a per-group ballot count here would be aggregate information about a group the caller has
 * not earned, which is the leak SC-006 forbids.
 */

const URL = 'http://localhost/api/v1/tournaments';
const NOW = new Date('2026-09-01T12:00:00.000Z');

describe('GET /api/v1/tournaments', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('lists published tournaments newest first', async () => {
    const sql = rawSql();
    await createTournament(sql, {
      name: 'Mais antigo',
      slug: 'mais-antigo',
      publishedAt: new Date('2026-08-01T10:00:00.000Z'),
    });
    await createTournament(sql, {
      name: 'Mais recente',
      slug: 'mais-recente',
      publishedAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    const response = await GET(getRequest(URL));
    expect(response.status).toBe(200);
    const list = await body<TournamentListResponse>(response);
    expect(list.tournaments.map((t) => t.slug)).toEqual(['mais-recente', 'mais-antigo']);
  });

  it('never lists a draft', async () => {
    const sql = rawSql();
    await createTournament(sql, { slug: 'rascunho', publishedAt: null });
    const list = await body<TournamentListResponse>(await GET(getRequest(URL)));
    expect(list.tournaments).toHaveLength(0);
  });

  it('filters by status against the server clock', async () => {
    const sql = rawSql();
    await createTournament(sql, { slug: 'aberto', startsAt: new Date('2026-12-01T18:00:00.000Z') });
    // A closed tournament was published before it started — the CHECK on `tournaments` says so.
    await createTournament(sql, {
      slug: 'fechado',
      startsAt: new Date('2026-08-01T18:00:00.000Z'),
      publishedAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    const open = await body<TournamentListResponse>(await GET(getRequest(`${URL}?status=open`)));
    expect(open.tournaments.map((t) => t.slug)).toEqual(['aberto']);

    const closed = await body<TournamentListResponse>(
      await GET(getRequest(`${URL}?status=closed`)),
    );
    expect(closed.tournaments.map((t) => t.slug)).toEqual(['fechado']);

    const all = await body<TournamentListResponse>(await GET(getRequest(`${URL}?status=all`)));
    expect(all.tournaments).toHaveLength(2);
  });

  it('paginates by cursor without repeating or skipping an item', async () => {
    const sql = rawSql();
    for (let index = 0; index < 5; index += 1) {
      await createTournament(sql, {
        slug: `torneio-${index}`,
        publishedAt: new Date(Date.UTC(2026, 7, index + 1, 10)),
      });
    }

    const first = await body<TournamentListResponse>(await GET(getRequest(`${URL}?limit=2`)));
    expect(first.tournaments).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await body<TournamentListResponse>(
      await GET(getRequest(`${URL}?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)),
    );
    const third = await body<TournamentListResponse>(
      await GET(getRequest(`${URL}?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`)),
    );

    const slugs = [...first.tournaments, ...second.tournaments, ...third.tournaments].map(
      (t) => t.slug,
    );
    expect(new Set(slugs).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('reports the tournament-wide ballot total and the group count', async () => {
    const sql = rawSql();
    const tournament = await createTournament(sql, { slug: 'com-votos' });
    const groupA = await createGroupWithPairs(sql, tournament.id, { size: 3, position: 1 });
    const groupB = await createGroupWithPairs(sql, tournament.id, { size: 3, position: 2 });
    await castBallots(sql, groupA.groupId, groupA.pairIds, 2);
    await castBallots(sql, groupB.groupId, groupB.pairIds, 3);

    const list = await body<TournamentListResponse>(await GET(getRequest(URL)));
    const summary = list.tournaments[0];
    expect(summary?.groupCount).toBe(2);
    expect(summary?.ballotCount).toBe(5);
  });

  it('carries no per-group figure anywhere in the payload', async () => {
    // SC-006 stated as a shape assertion: the list cannot leak a group's aggregate because it has
    // nowhere to put one.
    const sql = rawSql();
    const tournament = await createTournament(sql, { slug: 'sem-fugas' });
    const group = await createGroupWithPairs(sql, tournament.id, { size: 3 });
    await castBallots(sql, group.groupId, group.pairIds, 4);

    const raw = await (await GET(getRequest(URL))).text();
    expect(raw).not.toContain(group.groupId);
    expect(raw).not.toContain('positionShares');
    expect(raw).not.toContain('standings');
    expect(raw).not.toContain('groups');
  });

  it('rejects a malformed query', async () => {
    const response = await GET(getRequest(`${URL}?limit=nonsense`));
    expect(response.status).toBe(400);
  });
});
