import type { Tournament } from '../domain/index.js';
import { tournamentStatusAt } from '../window/index.js';

/**
 * The reveal gate (FR-020, FR-021).
 *
 * Results are shown to a caller who has **voted in this group**, and to everyone once voting has
 * **closed**. Before either, the group's aggregate does not appear in any response at all — not
 * zeroed, not empty, absent (contracts/README rule 2, SC-006).
 *
 * The gate is a single function because it is the product's one confidentiality rule, and Risk R1 is
 * a cached or leaked reveal. One function is one place to audit, and the route adapter marks every
 * response built through it `no-store`.
 */

export interface RevealInput {
  readonly tournament: Tournament;
  /** Whether THIS caller has a ballot for the group in question. */
  readonly hasVoted: boolean;
  readonly now: Date;
}

export function isRevealed(input: RevealInput): boolean {
  const status = tournamentStatusAt(input.tournament, input.now);
  // A draft has no public existence, so it has nothing to reveal. Stated rather than implied: the
  // naive form of this gate ("not open ⇒ closed ⇒ reveal") would treat an unpublished tournament as
  // finished and expose it.
  if (status === 'draft') return false;
  // Closed reveals to everyone: after the start there is nothing left to influence (FR-021).
  if (status === 'closed') return true;
  // While open, only a voter has earned the reveal — seeing the crowd first would bias the ballot.
  return input.hasVoted;
}
