import type { GroupId, PairId } from '@padelmigas/contracts/common';
import type { Pair, PositionCount } from '../domain/index.js';

/**
 * Crowd scoring (FR-016 – FR-018, SC-004).
 *
 * A pure function from raw vote counts to a crowd order. It reads no clock, touches no store, and
 * rounds nothing: the authoritative definition lives in data-model.md § "Scoring definition" and is
 * implemented here once, so the API, a future mobile client and any report all agree by construction
 * (ADR-006).
 *
 * **Rounding happens at render time only.** Rounding before ordering would let two pairs tie on a
 * displayed percentage and then sort inconsistently between two callers — the determinism SC-004
 * asks for is about the unrounded values.
 *
 * 100% branch coverage is required: this is the product's output, and a tie-break that falls through
 * differently on two servers shows two different "crowd predictions" for the same ballots.
 */

export interface PositionShare {
  readonly position: number;
  readonly votes: number;
  /** `votes / ballotCount`, unrounded. */
  readonly share: number;
}

export interface StandingEntry {
  readonly pairId: PairId;
  /** 1-based place in the crowd order (FR-017). */
  readonly predictedPosition: number;
  /** `Σ (p × votes(pair, p)) / ballotCount`, unrounded. */
  readonly meanPosition: number;
  /** One entry per position `1..n`, including positions nobody chose. */
  readonly positionShares: readonly PositionShare[];
}

export interface GroupResults {
  readonly groupId: GroupId;
  /** At least 1 by construction — see {@link scoreGroup}. */
  readonly ballotCount: number;
  readonly standings: readonly StandingEntry[];
}

export interface ScoreInput {
  readonly groupId: GroupId;
  readonly pairs: readonly Pair[];
  readonly ballotCount: number;
  readonly positionCounts: readonly PositionCount[];
}

/**
 * Produces the crowd order, or `null` when the group has no ballots.
 *
 * `null` rather than a zeroed object: a `GroupResults` that exists always describes real ballots, so
 * no client can render "0% · 0 votes" as though it were a finding (FR-019, contracts/README rule 2).
 * It also makes division by zero impossible by construction rather than by vigilance.
 */
export function scoreGroup(input: ScoreInput): GroupResults | null {
  if (input.ballotCount <= 0) return null;

  const size = input.pairs.length;

  // One entry per pair, each carrying its own tally. Built as a list rather than looked up per pair
  // later, so the scoring loop below has no "pair not found" case to defend against at all.
  const entries = input.pairs.map((pair) => ({ pair, perPosition: new Map<number, number>() }));
  const entryByPairId = new Map(entries.map((entry) => [entry.pair.id, entry]));

  for (const count of input.positionCounts) {
    const entry = entryByPairId.get(count.pairId);
    // A count for a pair that is not in this group cannot be scored against it. Skipping keeps a
    // stale row from silently inflating another pair's mean.
    if (!entry) continue;
    entry.perPosition.set(
      count.position,
      (entry.perPosition.get(count.position) ?? 0) + count.votes,
    );
  }

  const scored = entries.map(({ pair, perPosition }) => {
    // Every position 1..n is emitted, including the ones nobody chose: a missing entry and a zero
    // entry render differently, and "nobody put them first" is information.
    const positionShares: PositionShare[] = [];
    let weighted = 0;
    for (let position = 1; position <= size; position += 1) {
      const votes = perPosition.get(position) ?? 0;
      weighted += position * votes;
      positionShares.push({ position, votes, share: votes / input.ballotCount });
    }

    return {
      pair,
      meanPosition: weighted / input.ballotCount,
      firstPlaceVotes: perPosition.get(1) ?? 0,
      positionShares,
    };
  });

  /**
   * The tie-break chain, in the order data-model.md fixes it: ascending mean, then descending
   * first-place votes, then descending total points, then ascending pair id. The last link is an id
   * comparison precisely because it can never tie — the order is total, so two callers scoring the
   * same ballots cannot disagree (FR-018).
   */
  scored.sort((a, b) => {
    if (a.meanPosition !== b.meanPosition) return a.meanPosition - b.meanPosition;
    if (a.firstPlaceVotes !== b.firstPlaceVotes) return b.firstPlaceVotes - a.firstPlaceVotes;
    if (a.pair.totalPoints !== b.pair.totalPoints) return b.pair.totalPoints - a.pair.totalPoints;
    // Pair ids are unique, so this link always decides and the order is total (FR-018).
    return a.pair.id < b.pair.id ? -1 : 1;
  });

  return {
    groupId: input.groupId,
    ballotCount: input.ballotCount,
    standings: scored.map((entry, index) => ({
      pairId: entry.pair.id,
      predictedPosition: index + 1,
      meanPosition: entry.meanPosition,
      positionShares: entry.positionShares,
    })),
  };
}
