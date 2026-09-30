import { describe, expect, it } from 'vitest';
import type { GroupId, PairId, PlayerId } from '@padelmigas/contracts/common';
import {
  INVALIDATED_SLUG_INFIX,
  invalidatedSlug,
  planCarryOver,
  type CarryOverSourceGroup,
  type CarryOverTargetGroup,
} from './index.js';

/**
 * Carry-over (feature 003, FR-206, FR-207, FR-210).
 *
 * 100% branch coverage is required: a group wrongly judged unchanged carries votes for pairs that
 * will not play, and one wrongly judged changed silently throws away every vote on it. Both look
 * correct on the public page.
 */

const player = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as PlayerId;
const pairId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}` as PairId;
const groupId = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}` as GroupId;

/** A pair of players `a` and `b`, as the original stores it. */
function source(id: number, a: number, b: number) {
  return { id: pairId(id), members: [{ playerId: player(a) }, { playerId: player(b) }] as const };
}

/** A pair of players `a` and `b` at `seed`, as the replacement derives it. */
function target(seed: number, a: number, b: number) {
  return { seed, members: [{ playerId: player(a) }, { playerId: player(b) }] as const };
}

const original: CarryOverSourceGroup[] = [
  {
    id: groupId(1),
    label: 'A',
    pairs: [source(1, 1, 2), source(2, 3, 4), source(3, 5, 6)],
  },
  {
    id: groupId(2),
    label: 'B',
    pairs: [source(4, 7, 8), source(5, 9, 10), source(6, 11, 12)],
  },
];

describe('planCarryOver', () => {
  it('carries a group with the same label and the same pairs, mapping each pair by its players', () => {
    const replacement: CarryOverTargetGroup[] = [
      { label: 'A', pairs: [target(1, 1, 2), target(2, 3, 4), target(3, 5, 6)] },
    ];
    expect(planCarryOver(original, replacement)).toEqual([
      {
        label: 'A',
        carriedFrom: {
          groupId: groupId(1),
          pairMap: [
            { fromPairId: pairId(1), toSeed: 1 },
            { fromPairId: pairId(2), toSeed: 2 },
            { fromPairId: pairId(3), toSeed: 3 },
          ],
        },
      },
    ]);
  });

  it('ignores seed order and the order of the two players within a pair', () => {
    // Points changed, so the seeds shuffled; one pair was typed surname-first this time.
    const replacement: CarryOverTargetGroup[] = [
      { label: 'A', pairs: [target(1, 5, 6), target(2, 2, 1), target(3, 3, 4)] },
    ];
    const [decision] = planCarryOver(original, replacement);
    expect(decision?.carriedFrom?.pairMap).toEqual([
      { fromPairId: pairId(3), toSeed: 1 },
      { fromPairId: pairId(1), toSeed: 2 },
      { fromPairId: pairId(2), toSeed: 3 },
    ]);
  });

  it('restarts a group in which one player was swapped', () => {
    const replacement: CarryOverTargetGroup[] = [
      { label: 'A', pairs: [target(1, 1, 2), target(2, 3, 4), target(3, 5, 99)] },
    ];
    expect(planCarryOver(original, replacement)).toEqual([{ label: 'A', carriedFrom: null }]);
  });

  it('restarts a group that gained a pair', () => {
    const replacement: CarryOverTargetGroup[] = [
      {
        label: 'A',
        pairs: [target(1, 1, 2), target(2, 3, 4), target(3, 5, 6), target(4, 13, 14)],
      },
    ];
    expect(planCarryOver(original, replacement)).toEqual([{ label: 'A', carriedFrom: null }]);
  });

  it('restarts a group that lost a pair', () => {
    const shorter: CarryOverSourceGroup[] = [
      { id: groupId(1), label: 'A', pairs: [...original[0]!.pairs, source(7, 13, 14)] },
    ];
    const replacement: CarryOverTargetGroup[] = [
      { label: 'A', pairs: [target(1, 1, 2), target(2, 3, 4), target(3, 5, 6)] },
    ];
    expect(planCarryOver(shorter, replacement)).toEqual([{ label: 'A', carriedFrom: null }]);
  });

  it('restarts a group whose pairs match an original group under a different label', () => {
    // Group B's pairs, now labelled C: the organiser decided the label must match (FR-206).
    const replacement: CarryOverTargetGroup[] = [
      { label: 'C', pairs: [target(1, 7, 8), target(2, 9, 10), target(3, 11, 12)] },
    ];
    expect(planCarryOver(original, replacement)).toEqual([{ label: 'C', carriedFrom: null }]);
  });

  it('decides each group independently', () => {
    const replacement: CarryOverTargetGroup[] = [
      { label: 'A', pairs: [target(1, 1, 2), target(2, 3, 4), target(3, 5, 6)] },
      { label: 'B', pairs: [target(1, 7, 8), target(2, 9, 10), target(3, 11, 99)] },
    ];
    const decisions = planCarryOver(original, replacement);
    expect(decisions.map((d) => [d.label, d.carriedFrom?.groupId ?? null])).toEqual([
      ['A', groupId(1)],
      ['B', null],
    ]);
  });
});

describe('invalidatedSlug', () => {
  it('uses suffix 1 when the slug has never been invalidated', () => {
    expect(invalidatedSlug('torneio-outubro', [])).toBe(
      `torneio-outubro${INVALIDATED_SLUG_INFIX}1`,
    );
  });

  it('uses the next number after the highest one taken', () => {
    expect(
      invalidatedSlug('torneio-outubro', [
        'torneio-outubro-invalidado-1',
        'torneio-outubro-invalidado-3',
        // Not a suffix of this slug: a different tournament that happens to share a prefix.
        'torneio-outubro-invalidado-x',
        'torneio-outubro-2-invalidado-9',
      ]),
    ).toBe('torneio-outubro-invalidado-4');
  });

  it('truncates a long base so the result stays within the 120-character slug limit', () => {
    const long = `${'a'.repeat(60)}-${'b'.repeat(59)}`;
    const result = invalidatedSlug(long, []);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(result.endsWith('-invalidado-1')).toBe(true);
  });

  it('does not leave a double hyphen when truncation lands on one', () => {
    // Cut falls exactly after the hyphen between the two words.
    const long = `${'a'.repeat(106)}-${'b'.repeat(13)}`;
    const result = invalidatedSlug(long, []);
    expect(result).toBe(`${'a'.repeat(106)}-invalidado-1`);
  });
});
