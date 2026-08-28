import type { TournamentDetailDto } from '@padelmigas/contracts';
import type { GroupId } from '@padelmigas/contracts/common';
import { domainError, isRevealed, isVotingOpen, scoreGroup } from '@padelmigas/core';
import type { Deps, VoterScoped } from '../handler.js';
import { toGroupDto, toTournamentSummaryDto } from '../views.js';

/**
 * The tournament page (FR-014, FR-015, FR-020, FR-021).
 *
 * Everything a voter needs for every group in one response: the pairs, whether *they* have voted,
 * whether the window is open, their own ordering if they voted, and the crowd results only where the
 * reveal gate has opened.
 *
 * Per-group independence is the point of FR-015: voting in group A must leave group B votable with
 * its results still absent. That falls out of deciding `hasVoted`, `votingOpen` and `results` per
 * group rather than per tournament — there is deliberately no tournament-wide "voted" flag to get
 * wrong.
 *
 * The response is always `Cache-Control: no-store`: its content depends on who is asking, and a
 * cached reveal is Risk R1 exactly.
 */
export interface TournamentDetailInput {
  readonly slug: string;
}

export async function getTournamentDetail(
  input: VoterScoped<TournamentDetailInput>,
  deps: Deps,
): Promise<TournamentDetailDto> {
  const tournament = await deps.tournaments.findBySlug(input.slug);
  // A draft is answered exactly as a missing tournament is: "not published" and "does not exist"
  // must be indistinguishable from outside, or the 404 becomes an existence oracle (FR-023).
  if (!tournament || tournament.publishedAt === null) {
    throw domainError('NOT_FOUND', 'Torneio não encontrado.');
  }

  const now = deps.clock.now();
  const votingOpen = isVotingOpen(tournament, now);
  const groupIds = tournament.groups.map((group) => group.id);

  const votedGroupIds: ReadonlySet<GroupId> = input.caller.voterId
    ? await deps.ballots.votedGroupIds(groupIds, input.caller.voterId)
    : new Set<GroupId>();

  // Counts are read for every group in one round trip, then discarded for the groups the caller has
  // not earned. Reading them is not the leak; serialising them is.
  const countsByGroup = await deps.results.countsForGroups(groupIds);

  const voterId = input.caller.voterId;
  const groups = await Promise.all(
    tournament.groups.map(async (group) => {
      const hasVoted = votedGroupIds.has(group.id);
      const ownBallot = hasVoted && voterId ? await deps.ballots.findOwn(group.id, voterId) : null;

      const counts = countsByGroup.get(group.id);
      const revealed = isRevealed({ tournament, hasVoted, now });
      const results =
        revealed && counts
          ? scoreGroup({
              groupId: group.id,
              pairs: group.pairs,
              ballotCount: counts.ballotCount,
              positionCounts: counts.positionCounts,
            })
          : null;

      return toGroupDto(group, { hasVoted, votingOpen, ownBallot, results });
    }),
  );

  // The tournament total, which is public regardless of the gate: it says how many people have voted
  // across the whole tournament and reveals nothing about any group's ordering (SC-006).
  const ballotCount = [...countsByGroup.values()].reduce(
    (total, counts) => total + counts.ballotCount,
    0,
  );

  return {
    ...toTournamentSummaryDto(tournament, {
      groupCount: tournament.groups.length,
      ballotCount,
      now,
    }),
    groups,
  };
}
