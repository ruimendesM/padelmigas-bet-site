import { describe, expect, it } from 'vitest';
import type { GroupId, PairId, PlayerId, TournamentId } from '@padelmigas/contracts';
import type { Pair, PositionCount } from '../domain/index.js';
import { scoreGroup } from './index.js';

/**
 * Crowd scoring (FR-016 – FR-019, SC-004).
 *
 * 100% branch coverage. The tie-break chain is asserted link by link, each with the preceding links
 * held equal, because a chain is only deterministic if every link is reachable — an untested link is
 * a coin flip between two servers.
 */

const GROUP_ID = '00000000-0000-4000-8000-0000000000aa' as GroupId;

function pairId(n: number): PairId {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as PairId;
}

function pair(n: number, totalPoints = 600): Pair {
  return {
    id: pairId(n),
    groupId: GROUP_ID,
    club: 'Clube Fictício',
    members: [
      { playerId: pairId(n) as unknown as PlayerId, displayName: `A${n}`, points: totalPoints / 2 },
      {
        playerId: pairId(n + 500) as unknown as PlayerId,
        displayName: `B${n}`,
        points: totalPoints / 2,
      },
    ],
    totalPoints,
    seed: n,
  };
}

/** `counts([[pair, position, votes], ...])` — reads as the view rows it stands in for. */
function counts(rows: readonly (readonly [number, number, number])[]): PositionCount[] {
  return rows.map(([n, position, votes]) => ({ pairId: pairId(n), position, votes }));
}

const TOURNAMENT_ID = '00000000-0000-4000-8000-0000000000bb' as TournamentId;
void TOURNAMENT_ID;

describe('scoreGroup', () => {
  it('produces no results object at all when the group has no ballots', () => {
    // Not a zeroed object: "0% · 0 votes" must never be renderable as a finding (FR-019).
    expect(
      scoreGroup({
        groupId: GROUP_ID,
        pairs: [pair(1), pair(2), pair(3)],
        ballotCount: 0,
        positionCounts: [],
      }),
    ).toBeNull();
  });

  it('treats a negative ballot count as no ballots rather than dividing by it', () => {
    expect(
      scoreGroup({ groupId: GROUP_ID, pairs: [pair(1)], ballotCount: -1, positionCounts: [] }),
    ).toBeNull();
  });

  it('orders by ascending mean position', () => {
    // 2 ballots. Pair 1: 1st twice (mean 1). Pair 2: 2nd twice (mean 2). Pair 3: 3rd twice (mean 3).
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(3), pair(1), pair(2)],
      ballotCount: 2,
      positionCounts: counts([
        [1, 1, 2],
        [2, 2, 2],
        [3, 3, 2],
      ]),
    });
    expect(results?.standings.map((s) => s.pairId)).toEqual([pairId(1), pairId(2), pairId(3)]);
    expect(results?.standings.map((s) => s.predictedPosition)).toEqual([1, 2, 3]);
    expect(results?.standings.map((s) => s.meanPosition)).toEqual([1, 2, 3]);
  });

  it('computes per-position shares as unrounded fractions of the ballot count', () => {
    // 3 ballots: a third is 0.333… and must not arrive pre-rounded (SC-004).
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2), pair(3)],
      ballotCount: 3,
      positionCounts: counts([
        [1, 1, 1],
        [1, 2, 2],
      ]),
    });
    const first = results?.standings.find((s) => s.pairId === pairId(1));
    expect(first?.positionShares).toEqual([
      { position: 1, votes: 1, share: 1 / 3 },
      { position: 2, votes: 2, share: 2 / 3 },
      { position: 3, votes: 0, share: 0 },
    ]);
    // 1/3 survives as a float, not as 0.33.
    expect(first?.positionShares[0]?.share).not.toBe(0.33);
  });

  it('emits a share for every position, including ones nobody chose', () => {
    // One ballot ranking all six: each pair has exactly one non-zero position and five zeros.
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2), pair(3), pair(4), pair(5), pair(6)],
      ballotCount: 1,
      positionCounts: counts([
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 1],
        [4, 4, 1],
        [5, 5, 1],
        [6, 6, 1],
      ]),
    });
    expect(results?.standings[0]?.positionShares).toHaveLength(6);
    expect(results?.standings[0]?.positionShares.map((s) => s.votes)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(results?.standings.at(-1)?.positionShares.map((s) => s.votes)).toEqual([
      0, 0, 0, 0, 0, 1,
    ]);
  });

  it('handles a single ballot', () => {
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2), pair(3)],
      ballotCount: 1,
      positionCounts: counts([
        [2, 1, 1],
        [3, 2, 1],
        [1, 3, 1],
      ]),
    });
    expect(results?.ballotCount).toBe(1);
    expect(results?.standings.map((s) => s.pairId)).toEqual([pairId(2), pairId(3), pairId(1)]);
  });

  it('breaks a mean tie by descending first-place votes', () => {
    // 2 ballots. Pair 1: 1st, 3rd → mean 2. Pair 2: 2nd, 2nd → mean 2. Pair 1 has the first places.
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(2), pair(1), pair(3)],
      ballotCount: 2,
      positionCounts: counts([
        [1, 1, 1],
        [1, 3, 1],
        [2, 2, 2],
        [3, 1, 1],
        [3, 3, 1],
      ]),
    });
    const order = results?.standings.map((s) => s.pairId) ?? [];
    // Pairs 1 and 3 both have one first place and mean 2; pair 2 has none, so it sits last of the three.
    expect(order.at(-1)).toBe(pairId(2));
  });

  it('breaks a first-place tie by descending total points', () => {
    // Both pairs: 1st once, 2nd once → mean 1.5, one first place each. Points decide.
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1, 600), pair(2, 900)],
      ballotCount: 2,
      positionCounts: counts([
        [1, 1, 1],
        [1, 2, 1],
        [2, 1, 1],
        [2, 2, 1],
      ]),
    });
    expect(results?.standings.map((s) => s.pairId)).toEqual([pairId(2), pairId(1)]);
  });

  it('breaks a points tie by ascending pair id, so the order is total', () => {
    // Identical means, identical first places, identical points: only the id is left (FR-018).
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(9, 600), pair(4, 600)],
      ballotCount: 2,
      positionCounts: counts([
        [9, 1, 1],
        [9, 2, 1],
        [4, 1, 1],
        [4, 2, 1],
      ]),
    });
    expect(results?.standings.map((s) => s.pairId)).toEqual([pairId(4), pairId(9)]);
  });

  it('is stable regardless of the order the pairs arrive in', () => {
    const positionCounts = counts([
      [1, 1, 1],
      [1, 2, 1],
      [2, 1, 1],
      [2, 2, 1],
    ]);
    const ascending = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2)],
      ballotCount: 2,
      positionCounts,
    });
    const descending = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(2), pair(1)],
      ballotCount: 2,
      positionCounts,
    });
    expect(ascending?.standings).toEqual(descending?.standings);
  });

  it('ignores a count for a pair that is not in the group', () => {
    // A stale row must not inflate anyone's mean.
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2), pair(3)],
      ballotCount: 1,
      positionCounts: counts([
        [1, 1, 1],
        [2, 2, 1],
        [3, 3, 1],
        [77, 1, 1],
      ]),
    });
    expect(results?.standings).toHaveLength(3);
    expect(results?.standings[0]?.meanPosition).toBe(1);
  });

  it('sums two count rows that name the same pair and position', () => {
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs: [pair(1), pair(2), pair(3)],
      ballotCount: 2,
      positionCounts: counts([
        [1, 1, 1],
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 2],
      ]),
    });
    const first = results?.standings.find((s) => s.pairId === pairId(1));
    expect(first?.positionShares[0]?.votes).toBe(2);
  });

  it('scores a full group of six against three ballots', () => {
    const pairs = [pair(1), pair(2), pair(3), pair(4), pair(5), pair(6)];
    const results = scoreGroup({
      groupId: GROUP_ID,
      pairs,
      ballotCount: 3,
      positionCounts: counts([
        [1, 1, 3],
        [2, 2, 2],
        [2, 3, 1],
        [3, 2, 1],
        [3, 3, 2],
        [4, 4, 3],
        [5, 5, 3],
        [6, 6, 3],
      ]),
    });
    expect(results?.standings.map((s) => s.pairId)).toEqual([
      pairId(1),
      pairId(2),
      pairId(3),
      pairId(4),
      pairId(5),
      pairId(6),
    ]);
    expect(results?.standings[1]?.meanPosition).toBeCloseTo((2 * 2 + 3) / 3, 10);
  });
});
