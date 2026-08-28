import type { BallotSubmissionDto, CastBallotResponse } from '@padelmigas/contracts';
import type { GroupId } from '@padelmigas/contracts/common';
import { domainError, isVotingOpen, scoreGroup, validateBallot } from '@padelmigas/core';
import type { Deps, VoterScoped } from '../handler.js';
import { toGroupResultsDto, toOwnBallotDto } from '../views.js';

/**
 * Casting a ballot (FR-009 – FR-013, SC-005).
 *
 * The order of checks is the specification, not a style choice:
 *
 *  1. **Window before shape.** A closed group answers `VOTING_CLOSED` whatever the payload looks
 *     like; telling a late voter their ordering was malformed would be noise (FR-011).
 *  2. **Shape before write.** `core/ballot` validates against the group's real membership, so an
 *     invalid ballot never reaches the database and "a rejected ballot leaves nothing behind" holds
 *     structurally (FR-010).
 *  3. **The unique constraint is the authority on "already voted".** Not a prior SELECT: two
 *     submissions racing would both pass a check-then-insert, and Risk R7 is exactly that race. The
 *     repository surfaces the violation as an outcome, which becomes `409 ALREADY_VOTED` (FR-013,
 *     SC-009).
 *
 * The 201 carries the group's results, because the payoff has to be immediate — seeing the crowd
 * right after voting is the product (SC-005).
 */
export interface CastBallotInput {
  readonly groupId: GroupId;
  readonly submission: BallotSubmissionDto;
}

export async function castBallot(
  input: VoterScoped<CastBallotInput>,
  deps: Deps,
): Promise<CastBallotResponse> {
  const voterId = input.caller.voterId;
  // The route mints a voter cookie before calling, so a null id here is a wiring bug rather than an
  // anonymous caller.
  if (!voterId) {
    throw domainError('UNAUTHORISED', 'Não foi possível identificar este dispositivo.');
  }

  const group = await deps.groups.findById(input.groupId);
  if (!group) throw domainError('NOT_FOUND', 'Grupo não encontrado.');

  const tournament = await deps.groups.findTournamentForGroup(input.groupId);
  if (!tournament || tournament.publishedAt === null) {
    throw domainError('NOT_FOUND', 'Grupo não encontrado.');
  }

  if (!isVotingOpen(tournament, deps.clock.now())) {
    throw domainError('VOTING_CLOSED', 'As votações deste torneio já fecharam.');
  }

  const validated = validateBallot(group, input.submission);

  const outcome = await deps.ballots.insert({
    groupId: validated.groupId,
    voterId,
    ordering: validated.ordering,
  });

  if (outcome.kind === 'already-voted') {
    throw domainError('ALREADY_VOTED', 'Já votaste neste grupo. Cada pessoa vota uma vez.');
  }

  const counts = await deps.results.countsForGroup(input.groupId);
  const results = scoreGroup({
    groupId: input.groupId,
    pairs: group.pairs,
    ballotCount: counts.ballotCount,
    positionCounts: counts.positionCounts,
  });

  // The ballot just inserted is in the counts, so `scoreGroup` cannot return null here. Asserting it
  // rather than defaulting keeps a silent zero-ballot response impossible (FR-019).
  if (!results) {
    throw new Error(
      `Results were empty immediately after inserting a ballot for ${input.groupId}.`,
    );
  }

  return {
    ballot: toOwnBallotDto(outcome.ballot),
    results: toGroupResultsDto(results),
  };
}
