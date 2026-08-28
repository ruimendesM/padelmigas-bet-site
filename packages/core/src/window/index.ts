import type { Tournament, TournamentStatus } from '../domain/index.js';
import type { Clock } from '../ports/index.js';

/**
 * The voting window (FR-011, SC-007).
 *
 * One module decides open-vs-closed for the whole system, from the server clock alone. No client
 * timestamp is ever consulted: a browser with a slow clock must not be able to vote after the start
 * (SC-007), and a browser with a fast one must not be locked out early.
 *
 * Risk R5 is a lock-boundary bug. Keeping the comparison in exactly one function means there is
 * exactly one line where that bug could live, and the boundary instant is asserted directly.
 */

/**
 * Derived status. Never stored — a stored status is a second source of truth that goes stale at the
 * exact instant it matters (data-model.md).
 *
 *  - `draft`  — not published; invisible to the public regardless of the clock.
 *  - `open`   — published, and now is strictly before `startsAt`.
 *  - `closed` — published, and now is at or after `startsAt`.
 */
export function tournamentStatusAt(tournament: Tournament, now: Date): TournamentStatus {
  if (tournament.publishedAt === null) return 'draft';
  // Strictly before: at the start instant the window is already shut. The tournament is beginning,
  // and a ballot cast on the first point is not a prediction (FR-011).
  return now.getTime() < tournament.startsAt.getTime() ? 'open' : 'closed';
}

/** Whether a ballot may be accepted for this tournament right now. */
export function isVotingOpen(tournament: Tournament, now: Date): boolean {
  return tournamentStatusAt(tournament, now) === 'open';
}

/** The same decision taken from the injected clock, for callers that hold `Deps`. */
export function isVotingOpenNow(tournament: Tournament, clock: Clock): boolean {
  return isVotingOpen(tournament, clock.now());
}

/**
 * The public status, which collapses `draft` into "not listed at all".
 *
 * Returns `null` for a draft so a caller cannot accidentally serialise one: the wire enum is
 * `open | closed` and a draft has no public existence (FR-023).
 */
export function publicStatusAt(tournament: Tournament, now: Date): 'open' | 'closed' | null {
  const status = tournamentStatusAt(tournament, now);
  return status === 'draft' ? null : status;
}
