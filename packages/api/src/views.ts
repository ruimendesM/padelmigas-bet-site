import type {
  GroupDto,
  GroupResultsDto,
  OwnBallotDto,
  PairDto,
  TournamentInvalidationDto,
  TournamentSummaryDto,
} from '@padelmigas/contracts';
import type { Ballot, GroupResults, GroupWithPairs, Pair, Tournament } from '@padelmigas/core';
import { isRevealed, publicStatusAt } from '@padelmigas/core';

/**
 * Domain → wire serialisation.
 *
 * Kept in one module rather than inlined per handler so a field cannot appear in one response and be
 * forgotten in another — and, more importantly, so the omissions are in one place. Two of them are
 * confidentiality rules, not formatting choices:
 *
 *  - `ownBallot` and `results` are **absent** unless earned. Not null, not empty — absent
 *    (contracts/README rule 2, FR-020, SC-006).
 *  - No voter identifier appears in any shape here. `hasVoted` is a boolean about the caller and
 *    carries nothing that could identify a device (FR-022).
 */

export function toPairDto(pair: Pair): PairDto {
  return {
    id: pair.id,
    seed: pair.seed,
    club: pair.club,
    totalPoints: pair.totalPoints,
    players: [
      {
        id: pair.members[0].playerId,
        name: pair.members[0].displayName,
        points: pair.members[0].points,
      },
      {
        id: pair.members[1].playerId,
        name: pair.members[1].displayName,
        points: pair.members[1].points,
      },
    ],
  };
}

/**
 * A tournament summary.
 *
 * A draft cannot be serialised: `publicStatusAt` returns `null` for one and this throws rather than
 * inventing a status, because a draft reaching a public response is Risk R9's failure (FR-023).
 */
export function toTournamentSummaryDto(
  tournament: Tournament,
  options: {
    groupCount: number;
    ballotCount: number;
    now: Date;
    /** Required for an invalidated tournament (feature 003); ignored otherwise. */
    replacement?: InvalidationContext;
  },
): TournamentSummaryDto {
  const status = publicStatusAt(tournament, options.now);
  if (status === null) {
    throw new Error(`Refusing to serialise unpublished tournament ${tournament.id}.`);
  }
  return {
    id: tournament.id,
    slug: tournament.slug,
    name: tournament.name,
    startsAt: tournament.startsAt.toISOString(),
    status,
    groupCount: options.groupCount,
    ballotCount: options.ballotCount,
    ...(tournament.invalidatedAt === null
      ? {}
      : { invalidation: toInvalidationDto(tournament, options.now, options.replacement) }),
  };
}

/** What an invalidated tournament's summary needs beyond the tournament itself (feature 003). */
export interface InvalidationContext {
  /** The direct replacement, linked from the invalidated page (FR-212). */
  readonly replacedBy: Tournament | null;
  /** The live end of the chain, which decides whether results are withheld (FR-213). */
  readonly liveSuccessor: Tournament | null;
}

function toInvalidationDto(
  tournament: Tournament,
  now: Date,
  context: InvalidationContext | undefined,
): TournamentInvalidationDto {
  // Both are guaranteed by `tournaments_invalidation_complete` and the chain invariant. Missing
  // means a caller forgot to load them, and a link to nowhere is worse than a loud failure.
  if (tournament.invalidatedAt === null || !context?.replacedBy) {
    throw new Error(`Invalidated tournament ${tournament.id} serialised without its replacement.`);
  }
  return {
    invalidatedAt: tournament.invalidatedAt.toISOString(),
    replacedBy: { slug: context.replacedBy.slug, name: context.replacedBy.name },
    // The same gate the groups go through, asked for an anonymous caller: withheld is about
    // everyone, not about who is asking (FR-213).
    resultsWithheld: !isRevealed({
      tournament,
      hasVoted: false,
      now,
      liveSuccessor: context.liveSuccessor,
    }),
  };
}

export function toOwnBallotDto(ballot: Ballot): OwnBallotDto {
  return {
    castAt: ballot.castAt.toISOString(),
    ordering: ballot.ordering.map((entry) => ({ pairId: entry.pairId, position: entry.position })),
  };
}

export function toGroupResultsDto(results: GroupResults): GroupResultsDto {
  return {
    groupId: results.groupId,
    ballotCount: results.ballotCount,
    standings: results.standings.map((standing) => ({
      pairId: standing.pairId,
      predictedPosition: standing.predictedPosition,
      // Unrounded on the wire. Rounding is a render concern; rounding here would make two clients
      // disagree about an order that SC-004 requires to be identical.
      meanPosition: standing.meanPosition,
      positionShares: standing.positionShares.map((share) => ({
        position: share.position,
        votes: share.votes,
        share: share.share,
      })),
    })),
  };
}

export interface GroupViewState {
  readonly hasVoted: boolean;
  readonly votingOpen: boolean;
  /** Omitted from the response unless the caller voted (FR-014). */
  readonly ownBallot: Ballot | null;
  /** Omitted unless the reveal gate opened AND ballots exist (FR-019, FR-020). */
  readonly results: GroupResults | null;
}

export function toGroupDto(group: GroupWithPairs, state: GroupViewState): GroupDto {
  return {
    id: group.id,
    label: group.label,
    position: group.position,
    pairs: group.pairs.map(toPairDto),
    hasVoted: state.hasVoted,
    votingOpen: state.votingOpen,
    // Spread-when-present rather than `?? null`: the key must not exist at all when unearned.
    ...(state.ownBallot === null ? {} : { ownBallot: toOwnBallotDto(state.ownBallot) }),
    ...(state.results === null ? {} : { results: toGroupResultsDto(state.results) }),
  };
}
