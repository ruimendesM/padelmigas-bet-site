import { describe, expect, it } from 'vitest';
import type { GroupId, PairId, PlayerId, TournamentId } from '@padelmigas/contracts';
import type { GroupWithPairs, Pair } from '../domain/index.js';
import { DomainError } from '../errors.js';
import { validateBallot } from './index.js';

/**
 * Ballot validation (FR-010).
 *
 * 100% branch coverage: every branch here is a distinct way for a malformed ballot to reach the
 * aggregate, and the aggregate is the entire product. Group sizes 3 and 6 are both exercised because
 * the short final group is a real shape, not an edge case (research D10).
 */

function pairId(n: number): PairId {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as PairId;
}

function pair(n: number, groupId: GroupId): Pair {
  return {
    id: pairId(n),
    groupId,
    club: 'Clube Fictício',
    members: [
      { playerId: `${pairId(n)}` as unknown as PlayerId, displayName: `A${n}`, points: 300 },
      { playerId: `${pairId(n + 100)}` as unknown as PlayerId, displayName: `B${n}`, points: 300 },
    ],
    totalPoints: 600,
    seed: n,
  };
}

function group(size: number): GroupWithPairs {
  const id = '00000000-0000-4000-8000-0000000000aa' as GroupId;
  return {
    id,
    tournamentId: '00000000-0000-4000-8000-0000000000bb' as TournamentId,
    label: 'A',
    position: 1,
    pairs: Array.from({ length: size }, (_, index) => pair(index + 1, id)),
  };
}

/** Asserts the thrown error is a `DomainError` with the expected code, and returns it. */
function expectCode(run: () => unknown, code: string): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
  throw new Error(`Expected ${code} but nothing was thrown.`);
}

describe('validateBallot', () => {
  it('accepts a complete permutation of a group of six', () => {
    const g = group(6);
    const result = validateBallot(g, {
      ordering: g.pairs.map((p, index) => ({ pairId: p.id, position: index + 1 })),
    });
    expect(result.groupId).toBe(g.id);
    expect(result.ordering.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('accepts a complete permutation of the smallest group the product allows', () => {
    const g = group(3);
    const result = validateBallot(g, {
      ordering: [
        { pairId: g.pairs[2]!.id, position: 1 },
        { pairId: g.pairs[0]!.id, position: 2 },
        { pairId: g.pairs[1]!.id, position: 3 },
      ],
    });
    expect(result.ordering.map((entry) => entry.pairId)).toEqual([
      g.pairs[2]!.id,
      g.pairs[0]!.id,
      g.pairs[1]!.id,
    ]);
  });

  it('returns the ordering sorted by position, whatever order it arrived in', () => {
    // Downstream code must never have to re-sort, and must never disagree about the order.
    const g = group(4);
    const result = validateBallot(g, {
      ordering: [
        { pairId: g.pairs[1]!.id, position: 4 },
        { pairId: g.pairs[3]!.id, position: 1 },
        { pairId: g.pairs[0]!.id, position: 3 },
        { pairId: g.pairs[2]!.id, position: 2 },
      ],
    });
    expect(result.ordering).toEqual([
      { pairId: g.pairs[3]!.id, position: 1 },
      { pairId: g.pairs[2]!.id, position: 2 },
      { pairId: g.pairs[0]!.id, position: 3 },
      { pairId: g.pairs[1]!.id, position: 4 },
    ]);
  });

  it('rejects a pair that belongs to another group, even at the right length', () => {
    const g = group(4);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[1]!.id, position: 2 },
            { pairId: g.pairs[2]!.id, position: 3 },
            { pairId: pairId(999), position: 4 },
          ],
        }),
      'UNKNOWN_PAIR',
    );
    expect(error.issues).toHaveLength(1);
  });

  it('rejects an ordering with fewer entries than the group has pairs', () => {
    const g = group(4);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[1]!.id, position: 2 },
            { pairId: g.pairs[2]!.id, position: 3 },
          ],
        }),
      'INCOMPLETE_BALLOT',
    );
    expect(error.issues[0]?.message).toContain('3 entradas');
  });

  it('rejects a repeated pair, naming the pair it displaced', () => {
    // Mentioning one pair twice necessarily leaves another unmentioned.
    const g = group(3);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[0]!.id, position: 2 },
            { pairId: g.pairs[1]!.id, position: 3 },
          ],
        }),
      'MISSING_PAIR',
    );
    expect(error.issues[0]?.message).toContain(g.pairs[2]!.id);
  });

  it('rejects two pairs sharing a position', () => {
    const g = group(3);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[1]!.id, position: 1 },
            { pairId: g.pairs[2]!.id, position: 3 },
          ],
        }),
      'DUPLICATE_POSITION',
    );
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.message).toContain('1');
  });

  it('reports a repeated position once however many times it repeats', () => {
    const g = group(3);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 2 },
            { pairId: g.pairs[1]!.id, position: 2 },
            { pairId: g.pairs[2]!.id, position: 2 },
          ],
        }),
      'DUPLICATE_POSITION',
    );
    expect(error.issues).toHaveLength(1);
  });

  it('rejects a position outside 1..n even when every pair appears exactly once', () => {
    // A group of three with a position 6 leaves one of 1..3 unused, so the ranking is incomplete.
    const g = group(3);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[1]!.id, position: 2 },
            { pairId: g.pairs[2]!.id, position: 6 },
          ],
        }),
      'INCOMPLETE_BALLOT',
    );
    expect(error.issues[0]?.message).toContain('6');
  });

  it('rejects an ordering with more entries than the group has pairs', () => {
    const g = group(3);
    const error = expectCode(
      () =>
        validateBallot(g, {
          ordering: [
            { pairId: g.pairs[0]!.id, position: 1 },
            { pairId: g.pairs[1]!.id, position: 2 },
            { pairId: g.pairs[2]!.id, position: 3 },
            { pairId: g.pairs[0]!.id, position: 4 },
          ],
        }),
      'INCOMPLETE_BALLOT',
    );
    expect(error.issues[0]?.message).toContain('4 entradas');
  });

  it('rejects an empty ordering', () => {
    const g = group(3);
    expectCode(() => validateBallot(g, { ordering: [] }), 'INCOMPLETE_BALLOT');
  });
});
