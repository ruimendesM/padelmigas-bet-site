import type { GroupId, PairId } from '@padelmigas/contracts/common';
import type { BallotEntry, GroupWithPairs } from '../domain/index.js';
import { DomainError } from '../errors.js';

/**
 * Ballot validation (FR-010).
 *
 * A ballot is valid only if it is a **complete permutation of this group's pairs**: every pair
 * exactly once, positions forming `1..n`. Anything less is rejected outright rather than stored
 * partially — a ballot with a missing entry would silently skew every percentage in the group, and
 * "a rejected ballot leaves nothing behind" is a stated requirement.
 *
 * The client validates the same rule for a good form experience, and that validation is never
 * trusted (Principle IV): this function runs on the server against the group's real membership,
 * which a client cannot know it has stale.
 *
 * 100% branch coverage is required here. Each branch below is a distinct way to corrupt a group's
 * aggregate, and an aggregate is what the whole product shows.
 */

export interface BallotSubmission {
  readonly ordering: readonly { readonly pairId: PairId; readonly position: number }[];
}

export interface ValidatedBallot {
  readonly groupId: GroupId;
  /** Sorted by position, so downstream code never re-sorts and never disagrees about order. */
  readonly ordering: readonly BallotEntry[];
}

/**
 * Checks are ordered most-specific first, so the code the caller sees names the real problem.
 *
 * A pair from another group is `UNKNOWN_PAIR` even when the length happens to be right; reporting
 * `INCOMPLETE_BALLOT` there would send an organiser hunting for a missing entry that is actually a
 * misdirected one.
 */
export function validateBallot(
  group: GroupWithPairs,
  submission: BallotSubmission,
): ValidatedBallot {
  const groupPairIds = new Set<PairId>(group.pairs.map((pair) => pair.id));
  const size = group.pairs.length;

  // 1. Pairs that do not belong to this group.
  const unknown = submission.ordering.filter((entry) => !groupPairIds.has(entry.pairId));
  if (unknown.length > 0) {
    throw new DomainError(
      'UNKNOWN_PAIR',
      'O voto inclui uma dupla que não pertence a este grupo.',
      unknown.map((entry, index) => ({
        path: `ordering[${index}].pairId`,
        message: `A dupla ${entry.pairId} não está neste grupo.`,
      })),
    );
  }

  // 2. The wrong number of entries. Checked before membership because "you ranked four of six" is
  //    the useful message, and a partial ballot is exactly what `INCOMPLETE_BALLOT` names.
  if (submission.ordering.length !== size) {
    throw new DomainError(
      'INCOMPLETE_BALLOT',
      `O voto tem de atribuir as posições 1 a ${size}, uma por dupla.`,
      [
        {
          path: 'ordering',
          message: `Foram recebidas ${submission.ordering.length} entradas para ${size} duplas.`,
        },
      ],
    );
  }

  // 3. A pair of this group the ballot never mentions. With the count already correct, this can only
  //    mean another pair was listed twice — naming the absent one is what the voter needs.
  const mentioned = new Set<PairId>(submission.ordering.map((entry) => entry.pairId));
  const missing = group.pairs.filter((pair) => !mentioned.has(pair.id));
  if (missing.length > 0) {
    throw new DomainError(
      'MISSING_PAIR',
      'O voto tem de ordenar todas as duplas do grupo.',
      missing.map((pair) => ({
        path: 'ordering',
        message: `A dupla ${pair.id} não foi ordenada.`,
      })),
    );
  }

  // 4. Two pairs sharing a position.
  const seenPositions = new Set<number>();
  const duplicatePositions = new Set<number>();
  for (const entry of submission.ordering) {
    if (seenPositions.has(entry.position)) duplicatePositions.add(entry.position);
    else seenPositions.add(entry.position);
  }
  if (duplicatePositions.size > 0) {
    throw new DomainError(
      'DUPLICATE_POSITION',
      'Cada posição só pode ser atribuída a uma dupla.',
      [...duplicatePositions].map((position) => ({
        path: 'ordering',
        message: `A posição ${position} foi atribuída mais do que uma vez.`,
      })),
    );
  }

  // 5. The count is right, every pair appears once and the positions are distinct, so the only
  //    remaining failure is a position outside `1..n` — which leaves a position in range unused.
  const outOfRange = submission.ordering.filter(
    (entry) => entry.position < 1 || entry.position > size,
  );
  if (outOfRange.length > 0) {
    throw new DomainError(
      'INCOMPLETE_BALLOT',
      `O voto tem de atribuir as posições 1 a ${size}, uma por dupla.`,
      outOfRange.map((entry) => ({
        path: 'ordering',
        message: `A posição ${entry.position} está fora do intervalo 1–${size}.`,
      })),
    );
  }

  return {
    groupId: group.id,
    ordering: [...submission.ordering]
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({ pairId: entry.pairId, position: entry.position })),
  };
}
