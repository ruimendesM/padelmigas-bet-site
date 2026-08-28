import type { GroupResultsDto } from '@padelmigas/contracts';
import type { GroupId } from '@padelmigas/contracts/common';
import { domainError, isRevealed, scoreGroup } from '@padelmigas/core';
import type { Deps, VoterScoped } from '../handler.js';
import { toGroupResultsDto } from '../views.js';

/**
 * One group's crowd results, behind the reveal gate (FR-016 – FR-021).
 *
 * `RESULTS_HIDDEN` (403) rather than an empty 200: an empty body would be indistinguishable from
 * "nobody has voted", and a client would render the wrong thing. The gate itself lives in
 * `core/reveal` so this handler and the tournament page cannot disagree about who has earned a
 * reveal (Risk R1).
 */
export interface GroupResultsInput {
  readonly groupId: GroupId;
}

export async function getGroupResults(
  input: VoterScoped<GroupResultsInput>,
  deps: Deps,
): Promise<GroupResultsDto> {
  const group = await deps.groups.findById(input.groupId);
  if (!group) throw domainError('NOT_FOUND', 'Grupo não encontrado.');

  const tournament = await deps.groups.findTournamentForGroup(input.groupId);
  if (!tournament || tournament.publishedAt === null) {
    throw domainError('NOT_FOUND', 'Grupo não encontrado.');
  }

  const hasVoted = input.caller.voterId
    ? (await deps.ballots.findOwn(input.groupId, input.caller.voterId)) !== null
    : false;

  if (!isRevealed({ tournament, hasVoted, now: deps.clock.now() })) {
    throw domainError(
      'RESULTS_HIDDEN',
      'Vota neste grupo para veres a previsão da malta, ou espera pelo início do torneio.',
    );
  }

  const counts = await deps.results.countsForGroup(input.groupId);
  const results = scoreGroup({
    groupId: input.groupId,
    pairs: group.pairs,
    ballotCount: counts.ballotCount,
    positionCounts: counts.positionCounts,
  });

  // Revealed but empty: the gate opened (voting closed with nobody voting) and there is nothing to
  // show. `NOT_FOUND` would be a lie about the group, so the absence is reported as the absence of
  // results (FR-019) — the caller renders the explicit "no votes yet" state.
  if (!results) {
    throw domainError('NOT_FOUND', 'Este grupo ainda não tem votos.');
  }

  return toGroupResultsDto(results);
}
