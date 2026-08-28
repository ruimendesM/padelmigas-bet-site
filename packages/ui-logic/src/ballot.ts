import type { BallotSubmissionDto } from '@padelmigas/contracts';

/**
 * Ballot draft state (FR-009, FR-010).
 *
 * A pure reducer plus a few selectors: no DOM, no React import, no fetch. The web form and a future
 * React Native form drive the same state machine, so "one tap per position" behaves identically on
 * both (SC-002, SC-010).
 *
 * The client's completeness check is a **convenience, never an authority**. `core/ballot` re-decides
 * every rule on the server against the group's real membership, because a client can be stale, or
 * edited (Principle IV). Keeping the two implementations separate is deliberate: this one exists to
 * disable a button, that one exists to protect the aggregate.
 */

export interface BallotDraft {
  /** Pair ids in the group, in the order they are displayed. */
  readonly pairIds: readonly string[];
  /** `pairId → position`. A pair with no entry has not been placed yet. */
  readonly positions: Readonly<Record<string, number>>;
}

export function createDraft(pairIds: readonly string[]): BallotDraft {
  return { pairIds: [...pairIds], positions: {} };
}

export type BallotAction =
  /** Place a pair at a position, displacing whoever held it. */
  | { readonly type: 'assign'; readonly pairId: string; readonly position: number }
  /** Remove a pair's position, leaving it unplaced. */
  | { readonly type: 'clear'; readonly pairId: string }
  /** Fill every remaining position in display order — the "accept the seeding" shortcut. */
  | { readonly type: 'fill-remaining' }
  | { readonly type: 'reset' };

/**
 * Assignment **swaps** rather than refusing.
 *
 * A voter who taps "1st" on the second pair means it, and a form that answered "position taken"
 * would make them clear the first pair before they could say so. Swapping keeps the draft a valid
 * permutation at every step, which is what keeps the interaction to one tap per position (SC-002).
 */
export function ballotReducer(draft: BallotDraft, action: BallotAction): BallotDraft {
  switch (action.type) {
    case 'assign': {
      if (!draft.pairIds.includes(action.pairId)) return draft;
      if (action.position < 1 || action.position > draft.pairIds.length) return draft;

      const positions = { ...draft.positions };
      const previous = positions[action.pairId];
      const displaced = Object.keys(positions).find((id) => positions[id] === action.position);

      positions[action.pairId] = action.position;
      if (displaced !== undefined && displaced !== action.pairId) {
        // The displaced pair takes the assigning pair's old position, or becomes unplaced if it had
        // none. Either way no two pairs ever share a position mid-draft.
        if (previous === undefined) delete positions[displaced];
        else positions[displaced] = previous;
      }
      return { ...draft, positions };
    }

    case 'clear': {
      if (draft.positions[action.pairId] === undefined) return draft;
      const positions = { ...draft.positions };
      delete positions[action.pairId];
      return { ...draft, positions };
    }

    case 'fill-remaining': {
      const positions = { ...draft.positions };
      const taken = new Set(Object.values(positions));
      let next = 1;
      for (const pairId of draft.pairIds) {
        if (positions[pairId] !== undefined) continue;
        while (taken.has(next)) next += 1;
        positions[pairId] = next;
        taken.add(next);
      }
      return { ...draft, positions };
    }

    case 'reset':
      return createDraft(draft.pairIds);
  }
}

/** The pair currently at a position, or `null`. */
export function pairAt(draft: BallotDraft, position: number): string | null {
  return Object.keys(draft.positions).find((id) => draft.positions[id] === position) ?? null;
}

export function positionOf(draft: BallotDraft, pairId: string): number | null {
  return draft.positions[pairId] ?? null;
}

/** How many positions are still unassigned — drives the "falta atribuir…" hint. */
export function remainingCount(draft: BallotDraft): number {
  return draft.pairIds.length - Object.keys(draft.positions).length;
}

/** Whether the draft is a complete permutation, and therefore submittable. */
export function isComplete(draft: BallotDraft): boolean {
  const assigned = Object.values(draft.positions);
  if (assigned.length !== draft.pairIds.length) return false;
  const distinct = new Set(assigned);
  if (distinct.size !== assigned.length) return false;
  return assigned.every((position) => position >= 1 && position <= draft.pairIds.length);
}

/**
 * The submission body, or `null` when the draft is not yet complete.
 *
 * Returning `null` rather than throwing keeps the caller's "submit" handler a straight line: a form
 * that cannot submit simply has nothing to send.
 */
export function toSubmission(draft: BallotDraft): BallotSubmissionDto | null {
  if (!isComplete(draft)) return null;
  return {
    ordering: draft.pairIds
      .map((pairId) => ({ pairId, position: draft.positions[pairId] as number }))
      .sort((a, b) => a.position - b.position) as BallotSubmissionDto['ordering'],
  };
}
