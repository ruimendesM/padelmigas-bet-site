import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, TournamentDetailDto } from '@padelmigas/contracts';
import { GET } from '../../apps/web/app/api/v1/tournaments/[slug]/route.js';
import { POST as CAST } from '../../apps/web/app/api/v1/groups/[groupId]/ballots/route.js';
import { VOTER_COOKIE_NAME } from '../../apps/web/src/server/voter-cookie.js';
import { castBallots, createGroupWithPairs, createTournament } from '../factories/index.js';
import { rawSql } from './harness.js';
import {
  body,
  cookieFrom,
  current,
  getRequest,
  install,
  isNoStore,
  jsonRequest,
  params,
} from './helpers.js';

/**
 * `GET /api/v1/tournaments/{slug}` (FR-014, FR-015, FR-020, FR-021, SC-006).
 *
 * The page a voter actually loads, and the response with the most ways to leak. The central case is
 * FR-015: two groups, a vote in one, and the other must still be votable with its aggregate entirely
 * absent — not zeroed, absent.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = new Date('2026-12-01T18:00:00.000Z');

function url(slug: string): string {
  return `http://localhost/api/v1/tournaments/${slug}`;
}

async function twoGroupTournament() {
  const sql = rawSql();
  const tournament = await createTournament(sql, { slug: 'torneio-duplo', startsAt: START });
  const a = await createGroupWithPairs(sql, tournament.id, { size: 4, position: 1, label: 'A' });
  const b = await createGroupWithPairs(sql, tournament.id, { size: 4, position: 2, label: 'B' });
  return { tournament, a, b };
}

describe('GET /api/v1/tournaments/{slug}', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('returns the groups and pairs with no aggregate for an un-voted visitor', async () => {
    const { a, b } = await twoGroupTournament();
    await castBallots(rawSql(), a.groupId, a.pairIds, 5);

    const response = await GET(getRequest(url('torneio-duplo')), params({ slug: 'torneio-duplo' }));
    expect(response.status).toBe(200);
    const detail = await body<TournamentDetailDto>(response);

    expect(detail.groups.map((group) => group.label)).toEqual(['A', 'B']);
    expect(detail.groups.every((group) => group.hasVoted === false)).toBe(true);
    expect(detail.groups.every((group) => group.votingOpen === true)).toBe(true);
    // Absent, not empty: a client cannot render "0%" from a key that does not exist (FR-020).
    expect(detail.groups.every((group) => group.results === undefined)).toBe(true);
    expect(detail.groups.every((group) => group.ownBallot === undefined)).toBe(true);
    // The tournament-wide total is public and reveals nothing about any group's ordering.
    expect(detail.ballotCount).toBe(5);
    void b;
  });

  it('carries no count, share or ordering anywhere in an un-voted payload', async () => {
    const { a } = await twoGroupTournament();
    await castBallots(rawSql(), a.groupId, a.pairIds, 3);

    const raw = await (
      await GET(getRequest(url('torneio-duplo')), params({ slug: 'torneio-duplo' }))
    ).text();
    expect(raw).not.toContain('standings');
    expect(raw).not.toContain('positionShares');
    expect(raw).not.toContain('meanPosition');
    expect(raw).not.toContain('predictedPosition');
  });

  it('sends no-store, because the same URL answers differently per caller', async () => {
    await twoGroupTournament();
    const response = await GET(getRequest(url('torneio-duplo')), params({ slug: 'torneio-duplo' }));
    // Risk R1: a cached reveal would serve one voter's view to everyone.
    expect(isNoStore(response)).toBe(true);
  });

  it('reveals only the voted group and leaves the other votable and blank (FR-015)', async () => {
    const { a, b } = await twoGroupTournament();
    await castBallots(rawSql(), b.groupId, b.pairIds, 4);

    const cast = await CAST(
      jsonRequest(`http://localhost/api/v1/groups/${a.groupId}/ballots`, {
        ordering: a.pairIds.map((pairId, index) => ({ pairId, position: index + 1 })),
      }),
      params({ groupId: a.groupId }),
    );
    const cookie = cookieFrom(cast, VOTER_COOKIE_NAME) ?? '';

    const detail = await body<TournamentDetailDto>(
      await GET(getRequest(url('torneio-duplo'), { cookie }), params({ slug: 'torneio-duplo' })),
    );

    const groupA = detail.groups.find((group) => group.label === 'A');
    const groupB = detail.groups.find((group) => group.label === 'B');

    expect(groupA?.hasVoted).toBe(true);
    expect(groupA?.ownBallot?.ordering).toHaveLength(4);
    expect(groupA?.results?.ballotCount).toBe(1);

    // Group B has four ballots on record and the caller has earned none of them.
    expect(groupB?.hasVoted).toBe(false);
    expect(groupB?.votingOpen).toBe(true);
    expect(groupB?.results).toBeUndefined();
    expect(groupB?.ownBallot).toBeUndefined();
  });

  it('reveals every group to everyone once voting has closed', async () => {
    const { a, b } = await twoGroupTournament();
    const sql = rawSql();
    await castBallots(sql, a.groupId, a.pairIds, 2);
    await castBallots(sql, b.groupId, b.pairIds, 3);

    current().setNow(START);

    const detail = await body<TournamentDetailDto>(
      await GET(getRequest(url('torneio-duplo')), params({ slug: 'torneio-duplo' })),
    );
    expect(detail.status).toBe('closed');
    expect(detail.groups.every((group) => group.votingOpen === false)).toBe(true);
    expect(detail.groups.map((group) => group.results?.ballotCount)).toEqual([2, 3]);
  });

  it('omits results for a closed group that nobody voted in', async () => {
    // Revealed but empty: FR-019 says the absence is the answer, not a zeroed object.
    await twoGroupTournament();
    current().setNow(START);

    const detail = await body<TournamentDetailDto>(
      await GET(getRequest(url('torneio-duplo')), params({ slug: 'torneio-duplo' })),
    );
    expect(detail.groups.every((group) => group.results === undefined)).toBe(true);
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await GET(getRequest(url('nao-existe')), params({ slug: 'nao-existe' }));
    expect(response.status).toBe(404);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_FOUND');
  });

  it('answers 404 for a draft, so the 404 is not an existence oracle', async () => {
    await createTournament(rawSql(), { slug: 'rascunho', publishedAt: null });
    const response = await GET(getRequest(url('rascunho')), params({ slug: 'rascunho' }));
    expect(response.status).toBe(404);
  });
});
