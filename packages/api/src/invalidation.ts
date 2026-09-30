import type { Tournament } from '@padelmigas/core';
import type { Deps } from './handler.js';
import type { InvalidationContext } from './views.js';

/**
 * Loads what an invalidated tournament's responses need: its direct replacement, for the link, and
 * the live end of its replacement chain, for the reveal gate (feature 003, FR-212, FR-213).
 *
 * `null` for a live tournament, so the common path costs no query.
 */
export async function loadInvalidationContext(
  tournament: Tournament,
  deps: Deps,
): Promise<InvalidationContext | null> {
  if (tournament.replacedById === null) return null;
  const [replacedBy, liveSuccessor] = await Promise.all([
    deps.tournaments.findById(tournament.replacedById),
    deps.tournaments.findLiveSuccessor(tournament.id),
  ]);
  return { replacedBy, liveSuccessor };
}
