import { z } from 'zod';
import { groupId, pairId, position } from './common.js';

/**
 * Crowd results (FR-016 – FR-019).
 *
 * `GroupResults` is **omitted entirely** rather than zeroed when a group has no ballots, and omitted
 * rather than emptied when the caller has not earned the reveal (contracts/README rule 2). That is
 * why `ballotCount` has a minimum of 1: a `GroupResults` object that exists always describes real
 * ballots, so no client can accidentally render "0% · 0 votes" as if it were a finding.
 */

export const positionShare = z.object({
  position,
  votes: z.number().int().min(0),
  /**
   * `votes / ballotCount`, unrounded. Rounding happens at render time only — rounding before
   * ordering would let two pairs tie on a displayed number and then sort inconsistently (SC-004).
   */
  share: z.number().min(0).max(1),
});
export type PositionShareDto = z.infer<typeof positionShare>;

export const standingEntry = z.object({
  pairId,
  /** 1-based place in the crowd order (FR-017). */
  predictedPosition: z.number().int().min(1),
  /** `Σ (p × votes(pair, p)) / ballotCount`. Unrounded, for the same reason as `share`. */
  meanPosition: z.number().min(1),
  positionShares: z.array(positionShare),
});
export type StandingEntryDto = z.infer<typeof standingEntry>;

export const groupResults = z.object({
  groupId,
  /** At least 1 by construction: no ballots means no results object at all (FR-019). */
  ballotCount: z.number().int().min(1),
  /** Crowd predicted order, best first (FR-017, FR-018). */
  standings: z.array(standingEntry),
});
export type GroupResultsDto = z.infer<typeof groupResults>;
