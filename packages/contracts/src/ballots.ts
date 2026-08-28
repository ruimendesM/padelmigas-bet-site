import { z } from 'zod';
import { MAX_GROUP_SIZE, MIN_GROUP_SIZE, groupId, isoInstant, pairId, position } from './common.js';
import { groupResults } from './results.js';
import { pair, tournamentSummary } from './tournaments.js';

/**
 * Voting schemas (FR-009 – FR-015).
 *
 * Shape only. Whether an ordering is a complete permutation of *this group's* pairs is decided by
 * `packages/core/ballot` against the group's real membership — Zod cannot know it, and a client's
 * pre-validation is never trusted (Principle IV).
 */

export const ballotOrderingEntry = z.object({
  pairId,
  position,
});
export type BallotOrderingEntryDto = z.infer<typeof ballotOrderingEntry>;

export const ballotSubmission = z.object({
  ordering: z
    .array(ballotOrderingEntry)
    .min(MIN_GROUP_SIZE)
    .max(MAX_GROUP_SIZE)
    .describe('Every pair in the group exactly once, positions forming 1..n'),
});
export type BallotSubmissionDto = z.infer<typeof ballotSubmission>;

export const ownBallot = z.object({
  castAt: isoInstant,
  ordering: z.array(ballotOrderingEntry),
});
export type OwnBallotDto = z.infer<typeof ownBallot>;

export const group = z.object({
  id: groupId,
  label: z.string(),
  position: z.number().int().min(1),
  pairs: z.array(pair).min(MIN_GROUP_SIZE).max(MAX_GROUP_SIZE),
  /** Whether THIS caller has a ballot for this group. Never a voter id (FR-022). */
  hasVoted: z.boolean(),
  /** Server-decided from the server clock (FR-011, SC-007). */
  votingOpen: z.boolean(),
  /** Present only when `hasVoted` (FR-014). */
  ownBallot: ownBallot.nullish(),
  /** Present only when `hasVoted` or voting has closed — and only when ballots exist (FR-020). */
  results: groupResults.nullish(),
});
export type GroupDto = z.infer<typeof group>;

export const tournamentDetail = tournamentSummary.extend({
  groups: z.array(group),
});
export type TournamentDetailDto = z.infer<typeof tournamentDetail>;

/** The 201 body: the recorded ballot plus the group's results, so the payoff is immediate (SC-005). */
export const castBallotResponse = z.object({
  ballot: ownBallot,
  results: groupResults,
});
export type CastBallotResponse = z.infer<typeof castBallotResponse>;
