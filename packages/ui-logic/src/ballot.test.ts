import { describe, expect, it } from 'vitest';
import {
  ballotReducer,
  createDraft,
  isComplete,
  pairAt,
  positionOf,
  remainingCount,
  toSubmission,
} from './ballot.js';

/**
 * Ballot draft state (FR-009, FR-010, SC-002).
 *
 * The interaction rule under test is "one tap per position": assigning a taken position swaps rather
 * than refusing, so the draft is a valid partial permutation at every step and the voter is never
 * forced to undo before they can say what they mean.
 */

const PAIRS = ['p1', 'p2', 'p3', 'p4'];

describe('ballotReducer', () => {
  it('assigns a position to an unplaced pair', () => {
    const draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p2', position: 1 });
    expect(positionOf(draft, 'p2')).toBe(1);
    expect(remainingCount(draft)).toBe(3);
  });

  it('swaps when the position is already taken and the newcomer was unplaced', () => {
    let draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p1', position: 1 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p2', position: 1 });
    expect(positionOf(draft, 'p2')).toBe(1);
    // p1 had no other position to fall back to, so it becomes unplaced rather than sharing 1st.
    expect(positionOf(draft, 'p1')).toBeNull();
  });

  it('exchanges positions when both pairs were already placed', () => {
    let draft = createDraft(PAIRS);
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p1', position: 1 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p2', position: 2 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p2', position: 1 });
    expect(positionOf(draft, 'p2')).toBe(1);
    expect(positionOf(draft, 'p1')).toBe(2);
  });

  it('is a no-op when a pair is assigned the position it already holds', () => {
    let draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p1', position: 3 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p1', position: 3 });
    expect(positionOf(draft, 'p1')).toBe(3);
    expect(remainingCount(draft)).toBe(3);
  });

  it('ignores a pair that is not in the group', () => {
    const draft = ballotReducer(createDraft(PAIRS), {
      type: 'assign',
      pairId: 'intruso',
      position: 1,
    });
    expect(remainingCount(draft)).toBe(4);
  });

  it('ignores a position outside 1..n', () => {
    const draft = createDraft(PAIRS);
    expect(ballotReducer(draft, { type: 'assign', pairId: 'p1', position: 0 })).toBe(draft);
    expect(ballotReducer(draft, { type: 'assign', pairId: 'p1', position: 5 })).toBe(draft);
  });

  it('clears a placed pair and ignores clearing an unplaced one', () => {
    let draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p1', position: 2 });
    draft = ballotReducer(draft, { type: 'clear', pairId: 'p1' });
    expect(positionOf(draft, 'p1')).toBeNull();
    expect(ballotReducer(draft, { type: 'clear', pairId: 'p1' })).toBe(draft);
  });

  it('fills the remaining positions in display order without disturbing existing choices', () => {
    let draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p4', position: 1 });
    draft = ballotReducer(draft, { type: 'fill-remaining' });
    expect(isComplete(draft)).toBe(true);
    expect(positionOf(draft, 'p4')).toBe(1);
    expect(positionOf(draft, 'p1')).toBe(2);
    expect(positionOf(draft, 'p2')).toBe(3);
    expect(positionOf(draft, 'p3')).toBe(4);
  });

  it('resets to an empty draft', () => {
    let draft = ballotReducer(createDraft(PAIRS), { type: 'fill-remaining' });
    draft = ballotReducer(draft, { type: 'reset' });
    expect(remainingCount(draft)).toBe(4);
  });
});

describe('selectors', () => {
  it('finds the pair at a position, or nobody', () => {
    const draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p3', position: 2 });
    expect(pairAt(draft, 2)).toBe('p3');
    expect(pairAt(draft, 1)).toBeNull();
  });

  it('reports incompleteness until every position is assigned', () => {
    let draft = createDraft(PAIRS);
    expect(isComplete(draft)).toBe(false);
    draft = ballotReducer(draft, { type: 'fill-remaining' });
    expect(isComplete(draft)).toBe(true);
  });
});

describe('toSubmission', () => {
  it('produces nothing while the draft is incomplete', () => {
    const draft = ballotReducer(createDraft(PAIRS), { type: 'assign', pairId: 'p1', position: 1 });
    expect(toSubmission(draft)).toBeNull();
  });

  it('produces an ordering sorted by position', () => {
    let draft = createDraft(PAIRS);
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p4', position: 1 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p3', position: 2 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p2', position: 3 });
    draft = ballotReducer(draft, { type: 'assign', pairId: 'p1', position: 4 });

    expect(toSubmission(draft)).toEqual({
      ordering: [
        { pairId: 'p4', position: 1 },
        { pairId: 'p3', position: 2 },
        { pairId: 'p2', position: 3 },
        { pairId: 'p1', position: 4 },
      ],
    });
  });
});
