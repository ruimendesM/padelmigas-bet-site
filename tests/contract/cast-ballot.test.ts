import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, CastBallotResponse } from '@padelmigas/contracts';
import { POST } from '../../apps/web/app/api/v1/groups/[groupId]/ballots/route.js';
import { VOTER_COOKIE_NAME } from '../../apps/web/src/server/voter-cookie.js';
import { createGroupWithPairs, createTournament } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, cookieFrom, current, install, jsonRequest, params } from './helpers.js';

/**
 * `POST /api/v1/groups/{groupId}/ballots` (FR-009 – FR-013, SC-005, SC-009).
 *
 * The one write a member of the public can perform, so every documented rejection is asserted, and
 * the two rules that protect the aggregate get direct cases: one ballot per device per group
 * (FR-013), and a rejected ballot leaving nothing behind (FR-010).
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = new Date('2026-12-01T18:00:00.000Z');

function url(groupId: string): string {
  return `http://localhost/api/v1/groups/${groupId}/ballots`;
}

async function openGroup(size = 4) {
  const sql = rawSql();
  const tournament = await createTournament(sql, { slug: 'torneio-aberto', startsAt: START });
  const group = await createGroupWithPairs(sql, tournament.id, { size });
  return { tournament, ...group };
}

/** A complete permutation of the group's pairs, in seed order. */
function orderingFor(pairIds: readonly string[]) {
  return { ordering: pairIds.map((pairId, index) => ({ pairId, position: index + 1 })) };
}

describe('POST /api/v1/groups/{groupId}/ballots', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('records the ballot, answers 201 with the results, and mints a voter cookie', async () => {
    const group = await openGroup();
    const response = await POST(
      jsonRequest(url(group.groupId), orderingFor(group.pairIds)),
      params({ groupId: group.groupId }),
    );

    expect(response.status).toBe(201);
    const payload = await body<CastBallotResponse>(response);
    expect(payload.ballot.ordering).toHaveLength(4);
    // SC-005: the payoff is immediate — the crowd view comes back with the 201, not on a second call.
    expect(payload.results.ballotCount).toBe(1);
    expect(payload.results.standings).toHaveLength(4);
    expect(payload.results.standings[0]?.pairId).toBe(group.pairIds[0]);

    // FR-012: the identity is minted here, together with the row it references.
    expect(cookieFrom(response, VOTER_COOKIE_NAME)).not.toBeNull();
    const voters = await rawSql()`select count(*)::int as count from voters`;
    expect(voters[0]?.['count']).toBe(1);
  });

  it('never echoes a voter identifier in the response body', async () => {
    // FR-022: the cookie is the only place the id may appear.
    const group = await openGroup();
    const response = await POST(
      jsonRequest(url(group.groupId), orderingFor(group.pairIds)),
      params({ groupId: group.groupId }),
    );
    const raw = await response.text();
    const voterIds = await rawSql()<{ id: string }[]>`select id from voters`;
    for (const voter of voterIds) expect(raw).not.toContain(voter.id);
  });

  it('refuses a second ballot from the same device for the same group', async () => {
    const group = await openGroup();
    const first = await POST(
      jsonRequest(url(group.groupId), orderingFor(group.pairIds)),
      params({ groupId: group.groupId }),
    );
    const cookie = cookieFrom(first, VOTER_COOKIE_NAME) ?? '';

    const second = await POST(
      jsonRequest(url(group.groupId), orderingFor([...group.pairIds].reverse()), { cookie }),
      params({ groupId: group.groupId }),
    );
    expect(second.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(second)).code).toBe('ALREADY_VOTED');

    const ballots = await rawSql()`select count(*)::int as count from ballots`;
    expect(ballots[0]?.['count']).toBe(1);
  });

  it('produces exactly one ballot when two submissions race on the same identity', async () => {
    // Risk R7 / SC-009: a check-then-insert would let both through. The unique constraint decides.
    const group = await openGroup();
    const seed = await POST(
      jsonRequest(url(group.groupId), orderingFor(group.pairIds)),
      params({ groupId: group.groupId }),
    );
    const cookie = cookieFrom(seed, VOTER_COOKIE_NAME) ?? '';
    await rawSql()`delete from ballots`;

    const [a, b] = await Promise.all([
      POST(
        jsonRequest(url(group.groupId), orderingFor(group.pairIds), { cookie }),
        params({ groupId: group.groupId }),
      ),
      POST(
        jsonRequest(url(group.groupId), orderingFor([...group.pairIds].reverse()), { cookie }),
        params({ groupId: group.groupId }),
      ),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const ballots = await rawSql()`select count(*)::int as count from ballots`;
    expect(ballots[0]?.['count']).toBe(1);
  });

  it('rejects an ordering that does not cover every pair, and stores nothing', async () => {
    const group = await openGroup();
    const partial = {
      ordering: group.pairIds.slice(0, 3).map((pairId, index) => ({ pairId, position: index + 1 })),
    };
    const response = await POST(
      jsonRequest(url(group.groupId), partial),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('INCOMPLETE_BALLOT');

    const sql = rawSql();
    expect((await sql`select count(*)::int as count from ballots`)[0]?.['count']).toBe(0);
    expect((await sql`select count(*)::int as count from ballot_entries`)[0]?.['count']).toBe(0);
  });

  it('rejects two pairs sharing a position', async () => {
    const group = await openGroup();
    const clashing = {
      ordering: group.pairIds.map((pairId, index) => ({
        pairId,
        position: index === 1 ? 1 : index + 1,
      })),
    };
    const response = await POST(
      jsonRequest(url(group.groupId), clashing),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('DUPLICATE_POSITION');
  });

  it('rejects a pair that belongs to another group', async () => {
    const group = await openGroup();
    const other = await createGroupWithPairs(
      rawSql(),
      (await createTournament(rawSql(), { slug: 'outro' })).id,
      { size: 4 },
    );
    const foreign = {
      ordering: [
        { pairId: other.pairIds[0], position: 1 },
        ...group.pairIds.slice(1).map((pairId, index) => ({ pairId, position: index + 2 })),
      ],
    };
    const response = await POST(
      jsonRequest(url(group.groupId), foreign),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNKNOWN_PAIR');
  });

  it('rejects an ordering that repeats a pair and so omits another', async () => {
    const group = await openGroup();
    const repeated = {
      ordering: [
        { pairId: group.pairIds[0], position: 1 },
        { pairId: group.pairIds[0], position: 2 },
        { pairId: group.pairIds[1], position: 3 },
        { pairId: group.pairIds[2], position: 4 },
      ],
    };
    const response = await POST(
      jsonRequest(url(group.groupId), repeated),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('MISSING_PAIR');
  });

  it('refuses a ballot once the tournament has started', async () => {
    const group = await openGroup();
    // Stand exactly at the start instant: the boundary is the requirement (FR-011, SC-007).
    current().setNow(START);

    const response = await POST(
      jsonRequest(url(group.groupId), orderingFor(group.pairIds)),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(422);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('VOTING_CLOSED');
    const ballots = await rawSql()`select count(*)::int as count from ballots`;
    expect(ballots[0]?.['count']).toBe(0);
  });

  it('answers 404 for a group that does not exist', async () => {
    // A well-formed body, so the 404 is about the group rather than the payload: shape is parsed
    // before existence is looked up, and this asserts the second half of that order.
    const missing = '00000000-0000-4000-8000-000000000999';
    const response = await POST(
      jsonRequest(url(missing), {
        ordering: [
          { pairId: '00000000-0000-4000-8000-000000000001', position: 1 },
          { pairId: '00000000-0000-4000-8000-000000000002', position: 2 },
          { pairId: '00000000-0000-4000-8000-000000000003', position: 3 },
        ],
      }),
      params({ groupId: missing }),
    );
    expect(response.status).toBe(404);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_FOUND');
  });

  it('rejects a malformed body', async () => {
    const group = await openGroup();
    const response = await POST(
      jsonRequest(url(group.groupId), { ordering: 'not-an-array' }),
      params({ groupId: group.groupId }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('MALFORMED_PAYLOAD');
  });

  it('rate-limits a flood from one address', async () => {
    const group = await openGroup(3);
    let last: Response | undefined;
    // The window is 10 per 10 minutes; the eleventh attempt is refused.
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await POST(
        jsonRequest(url(group.groupId), orderingFor(group.pairIds), {
          headers: { 'x-forwarded-for': '198.51.100.7' },
        }),
        params({ groupId: group.groupId }),
      );
    }
    expect(last?.status).toBe(429);
    expect((await body<ApiErrorWithIssues>(last as Response)).code).toBe('RATE_LIMITED');
  });
});
