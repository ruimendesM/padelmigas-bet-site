import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, GroupResultsDto } from '@padelmigas/contracts';
import { GET } from '../../apps/web/app/api/v1/groups/[groupId]/results/route.js';
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
 * `GET /api/v1/groups/{groupId}/results` (FR-016 – FR-021).
 *
 * The reveal gate as an endpoint. `RESULTS_HIDDEN` is a 403 rather than an empty 200 on purpose: an
 * empty body would be indistinguishable from "nobody has voted", and the client would render the
 * wrong thing (FR-019, FR-020).
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = new Date('2026-12-01T18:00:00.000Z');

function url(groupId: string): string {
  return `http://localhost/api/v1/groups/${groupId}/results`;
}

async function openGroup(size = 4) {
  const sql = rawSql();
  const tournament = await createTournament(sql, { slug: 'torneio-resultados', startsAt: START });
  const group = await createGroupWithPairs(sql, tournament.id, { size });
  return { tournament, ...group };
}

describe('GET /api/v1/groups/{groupId}/results', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('hides results from a caller who has not voted while voting is open', async () => {
    const group = await openGroup();
    await castBallots(rawSql(), group.groupId, group.pairIds, 3);

    const response = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(response.status).toBe(403);
    // Read the body once, then assert on both its code and its text: nothing about the aggregate may
    // ride along with the refusal.
    const raw = await response.text();
    expect((JSON.parse(raw) as ApiErrorWithIssues).code).toBe('RESULTS_HIDDEN');
    expect(raw).not.toContain('standings');
    expect(raw).not.toContain('ballotCount');
  });

  it('returns results to a caller who has voted in this group', async () => {
    const group = await openGroup();
    const cast = await CAST(
      jsonRequest(`http://localhost/api/v1/groups/${group.groupId}/ballots`, {
        ordering: group.pairIds.map((pairId, index) => ({ pairId, position: index + 1 })),
      }),
      params({ groupId: group.groupId }),
    );
    const cookie = cookieFrom(cast, VOTER_COOKIE_NAME) ?? '';

    const response = await GET(
      getRequest(url(group.groupId), { cookie }),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(200);
    const results = await body<GroupResultsDto>(response);
    expect(results.groupId).toBe(group.groupId);
    expect(results.ballotCount).toBe(1);
    expect(results.standings.map((s) => s.predictedPosition)).toEqual([1, 2, 3, 4]);
    // Unrounded on the wire: rounding is a render concern (SC-004).
    expect(results.standings[0]?.positionShares[0]?.share).toBe(1);
  });

  it('returns results to everyone once voting has closed', async () => {
    const group = await openGroup();
    await castBallots(rawSql(), group.groupId, group.pairIds, 3);
    current().setNow(START);

    const response = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(response.status).toBe(200);
    const results = await body<GroupResultsDto>(response);
    expect(results.ballotCount).toBe(3);
    // Three identical ballots: everyone put the first seed first.
    expect(results.standings[0]?.positionShares[0]?.share).toBe(1);
  });

  it('sends no-store on both the reveal and the refusal', async () => {
    const group = await openGroup();
    await castBallots(rawSql(), group.groupId, group.pairIds, 1);

    const hidden = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(isNoStore(hidden)).toBe(true);

    current().setNow(START);
    const revealed = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(isNoStore(revealed)).toBe(true);
  });

  it('answers 404 for a closed group nobody voted in', async () => {
    // Revealed but empty. There is no results object to return (FR-019).
    const group = await openGroup();
    current().setNow(START);
    const response = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(response.status).toBe(404);
  });

  it('answers 404 for a group that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000999';
    const response = await GET(getRequest(url(missing)), params({ groupId: missing }));
    expect(response.status).toBe(404);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_FOUND');
  });

  it('answers 404 for a group belonging to a draft', async () => {
    const sql = rawSql();
    const draft = await createTournament(sql, { slug: 'rascunho', publishedAt: null });
    const group = await createGroupWithPairs(sql, draft.id, { size: 3 });
    const response = await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId }));
    expect(response.status).toBe(404);
  });

  it('orders by mean position and applies the tie-break chain', async () => {
    // Two ballots disagreeing: seed 1 first then third, seed 2 second twice. Means tie at 2, and the
    // first-place count decides (FR-018).
    const group = await openGroup(3);
    const sql = rawSql();
    const [p1, p2, p3] = group.pairIds;
    await castBallots(sql, group.groupId, [p1!, p2!, p3!], 1);
    await castBallots(sql, group.groupId, [p3!, p2!, p1!], 1);
    current().setNow(START);

    const results = await body<GroupResultsDto>(
      await GET(getRequest(url(group.groupId)), params({ groupId: group.groupId })),
    );
    expect(results.ballotCount).toBe(2);
    expect(results.standings.map((s) => s.meanPosition)).toEqual([2, 2, 2]);
    // All three tie on mean; p1 and p3 each have one first place, p2 none, so p2 sits last.
    expect(results.standings.at(-1)?.pairId).toBe(p2);
  });
});
