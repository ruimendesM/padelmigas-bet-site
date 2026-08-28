import { z } from 'zod';
import { externalPlayerId, playerId } from './common.js';
import { tournamentSummary } from './tournaments.js';

/**
 * Player history (FR-025, SC-008).
 *
 * One player record per real person; every tournament they played is an entry in `appearances`. The
 * shape makes the SC-008 property visible: a duplicate person would show as two `PlayerDetail`
 * documents, not as one document with a split history.
 */

export const appearance = z.object({
  tournament: tournamentSummary,
  groupLabel: z.string(),
  partner: z.object({
    id: playerId,
    name: z.string(),
  }),
  /** The player's points as captured at that tournament, not their points today (FR-007). */
  pointsAtTournament: z.number().int().min(0),
});
export type AppearanceDto = z.infer<typeof appearance>;

export const playerDetail = z.object({
  id: playerId,
  /**
   * The ranking sheet's ID. Informational only and NOT unique — the sheet reuses ids across
   * different people (FR-004 as amended 2026-08-28). `null` when the source row carried none.
   */
  externalId: externalPlayerId.nullable(),
  name: z.string(),
  club: z.string().nullable(),
  /** Most recent points on record from the ranking sheet; `null` when never synced. */
  currentPoints: z.number().int().min(0).nullable(),
  /** Newest tournament first. */
  appearances: z.array(appearance),
});
export type PlayerDetailDto = z.infer<typeof playerDetail>;
