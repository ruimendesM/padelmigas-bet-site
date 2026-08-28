import { beforeEach, describe, expect, it } from 'vitest';
import { GET as LIST } from '../../apps/web/app/api/v1/tournaments/route.js';
import { GET as DETAIL } from '../../apps/web/app/api/v1/tournaments/[slug]/route.js';
import { GET as RESULTS } from '../../apps/web/app/api/v1/groups/[groupId]/results/route.js';
import { GET as PLAYER } from '../../apps/web/app/api/v1/players/[playerId]/route.js';
import {
  castBallot,
  createGroup,
  createPair,
  createPlayer,
  createTournament,
} from '../factories/index.js';
import { rawSql } from './harness.js';
import { getRequest, install, params } from './helpers.js';

/**
 * No aggregate escapes an unrevealed group, on any read path (SC-006, FR-020).
 *
 * One test per public read, all asserting the same property against the **raw response text** rather
 * than a parsed shape: a leak that arrives under an unexpected key is still a leak, and parsing to a
 * DTO would hide exactly that. Extended by T084 as read paths were added — every public GET in the
 * product is covered here.
 *
 * The world under test is deliberately lopsided: a group with a distinctive number of ballots and a
 * distinctive ordering, so any figure that escapes is recognisable in the text.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = new Date('2026-12-01T18:00:00.000Z');

/** Words that only ever appear in a results payload. */
const AGGREGATE_KEYS = [
  'standings',
  'positionShares',
  'meanPosition',
  'predictedPosition',
  'share',
  'votes',
];

async function world() {
  const sql = rawSql();
  const tournament = await createTournament(sql, { slug: 'sem-fugas', startsAt: START });
  const group = await createGroup(sql, tournament.id, { label: 'A', position: 1 });

  // A named player so the history path has something to return.
  const subject = await createPlayer(sql, { displayName: 'Sujeito de Teste' });
  const partner = await createPlayer(sql, { displayName: 'Parceiro de Teste' });
  const first = await createPair(sql, group.id, {
    seed: 1,
    player1Id: subject.id,
    player2Id: partner.id,
  });
  const second = await createPair(sql, group.id, { seed: 2 });
  const third = await createPair(sql, group.id, { seed: 3 });

  // Seven ballots, all agreeing: a 100% share for seed 1 at position 1 is as loud as a leak gets.
  for (let index = 0; index < 7; index += 1) {
    await castBallot(sql, group.id, [first.id, second.id, third.id]);
  }

  return { tournament, group, subject };
}

describe('no aggregate leaks for an unrevealed group', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('GET /tournaments exposes no group id and no aggregate key', async () => {
    const { group } = await world();
    const raw = await (await LIST(getRequest('http://localhost/api/v1/tournaments'))).text();
    expect(raw).not.toContain(group.id);
    for (const key of AGGREGATE_KEYS) expect(raw).not.toContain(key);
  });

  it('GET /tournaments/{slug} exposes no aggregate to a caller who has not voted', async () => {
    await world();
    const raw = await (
      await DETAIL(
        getRequest('http://localhost/api/v1/tournaments/sem-fugas'),
        params({ slug: 'sem-fugas' }),
      )
    ).text();
    for (const key of AGGREGATE_KEYS) expect(raw).not.toContain(key);
  });

  it('GET /groups/{id}/results refuses rather than answering with an empty aggregate', async () => {
    const { group } = await world();
    const response = await RESULTS(
      getRequest(`http://localhost/api/v1/groups/${group.id}/results`),
      params({ groupId: group.id }),
    );
    expect(response.status).toBe(403);
    const raw = await response.text();
    for (const key of AGGREGATE_KEYS) expect(raw).not.toContain(key);
  });

  it('GET /players/{id} exposes no aggregate for the groups the player appeared in (T084)', async () => {
    // The history path was added after this test first existed; SC-006 applies to it identically.
    const { subject } = await world();
    const raw = await (
      await PLAYER(
        getRequest(`http://localhost/api/v1/players/${subject.id}`),
        params({ playerId: subject.id }),
      )
    ).text();
    for (const key of AGGREGATE_KEYS) expect(raw).not.toContain(key);
  });

  it('the history view’s data source exposes no unrevealed aggregate (T084)', async () => {
    // The history page reads closed tournaments through `GET /tournaments?status=closed`; while a
    // tournament is still open it must not appear there at all, aggregates included.
    await world();
    const raw = await (
      await LIST(getRequest('http://localhost/api/v1/tournaments?status=closed'))
    ).text();
    expect(raw).toContain('"tournaments":[]');
    for (const key of AGGREGATE_KEYS) expect(raw).not.toContain(key);
  });
});
