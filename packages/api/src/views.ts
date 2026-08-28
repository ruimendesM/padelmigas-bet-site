import type {
  GroupDto,
  GroupResultsDto,
  OwnBallotDto,
  PairDto,
  TournamentSummaryDto,
} from '@padelmigas/contracts';
import type { Ballot, GroupResults, GroupWithPairs, Pair, Tournament } from '@padelmigas/core';
import { publicStatusAt } from '@padelmigas/core';

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
  options: { groupCount: number; ballotCount: number; now: Date },
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
