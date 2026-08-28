import { z } from 'zod';
import {
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  externalPlayerId,
  groupId,
  isoInstant,
  pairId,
  playerId,
  slug,
  tournamentId,
} from './common.js';

/**
 * Lineup, tournament and preview schemas (FR-001, FR-003, FR-007, FR-023).
 *
 * These are the wire shapes only. Grouping, resolution and every validity rule live in
 * `packages/core/lineup` and `packages/core/matching`; Zod's job here is to reject a payload that is
 * not even the right shape, so the domain never has to defend against a missing key.
 */

// ---------------------------------------------------------------------------------------------
// Inbound: the pasted lineup payload
// ---------------------------------------------------------------------------------------------

export const lineupPlayer = z.object({
  name: z.string().min(1, 'O nome do jogador não pode estar vazio.'),
  points: z.number().int().min(0),
  /**
   * Ranking-list ID. Required only to disambiguate identical names — the ranking list has none today
   * (F2), but the check runs on every import and an organiser needs a way to resolve one when it
   * appears.
   */
  externalId: externalPlayerId.optional(),
});
export type LineupPlayer = z.infer<typeof lineupPlayer>;

export const lineupPair = z.object({
  club: z.string().min(1),
  /** Validated against the sum of both players' points in `core/lineup` (FR-003). */
  totalPoints: z.number().int().min(0),
  /** Optional explicit group label, overriding derivation from points order (research D10). */
  group: z.string().min(1).optional(),
  players: z.tuple([lineupPlayer, lineupPlayer]),
});
export type LineupPair = z.infer<typeof lineupPair>;

export const lineupPayload = z.object({
  name: z.string().min(3, 'O nome do torneio precisa de pelo menos 3 caracteres.'),
  /** Derived from `name` when omitted. */
  slug: slug.optional(),
  /** Must be in the future; also the voting deadline (FR-005, FR-011). */
  startsAt: isoInstant,
  pairs: z
    .array(lineupPair)
    .min(MIN_GROUP_SIZE, `Um torneio precisa de pelo menos ${MIN_GROUP_SIZE} duplas.`),
});
export type LineupPayload = z.infer<typeof lineupPayload>;

/** Publishing is the same payload plus an explicit confirmation (guards paste-and-publish, FR-002). */
export const publishRequest = lineupPayload.extend({
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'A publicação tem de ser confirmada explicitamente.' }),
  }),
});
export type PublishRequest = z.infer<typeof publishRequest>;

// ---------------------------------------------------------------------------------------------
// Outbound: pairs, groups, tournaments
// ---------------------------------------------------------------------------------------------

export const pairMember = z.object({
  id: playerId,
  name: z.string(),
  /** Captured at publish time, not the player's points today (FR-007). */
  points: z.number().int().min(0),
});
export type PairMemberDto = z.infer<typeof pairMember>;

export const pair = z.object({
  id: pairId,
  seed: z.number().int().min(1),
  club: z.string(),
  totalPoints: z.number().int().min(0),
  players: z.tuple([pairMember, pairMember]),
});
export type PairDto = z.infer<typeof pair>;

export const tournamentStatus = z.enum(['open', 'closed']);
export type TournamentStatusDto = z.infer<typeof tournamentStatus>;

export const tournamentSummary = z.object({
  id: tournamentId,
  slug: z.string(),
  name: z.string(),
  startsAt: isoInstant,
  /** Server-decided from the server clock (FR-011, SC-007). Drafts are never listed. */
  status: tournamentStatus,
  groupCount: z.number().int().min(0),
  /**
   * Ballots across the tournament's groups. A tournament total, never a per-group figure: a
   * per-group count here would reveal aggregate information for a group the caller has not earned
   * (SC-006).
   */
  ballotCount: z.number().int().min(0),
});
export type TournamentSummaryDto = z.infer<typeof tournamentSummary>;

export const tournamentListQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});
export type TournamentListQueryDto = z.infer<typeof tournamentListQuery>;

export const tournamentListResponse = z.object({
  tournaments: z.array(tournamentSummary),
  nextCursor: z.string().nullable(),
});
export type TournamentListResponse = z.infer<typeof tournamentListResponse>;

// ---------------------------------------------------------------------------------------------
// Outbound: the preview
// ---------------------------------------------------------------------------------------------

export const previewGroup = z.object({
  label: z.string(),
  pairs: z.array(pair).min(MIN_GROUP_SIZE).max(MAX_GROUP_SIZE),
});

export const resolvedPlayer = z.object({
  inputName: z.string(),
  externalId: externalPlayerId,
  displayName: z.string(),
  /** True when this ranking-list player had no local record yet — a new person, not a new identity. */
  isNew: z.boolean(),
});
export type ResolvedPlayerDto = z.infer<typeof resolvedPlayer>;

export const lineupPreview = z.object({
  name: z.string(),
  slug: z.string(),
  startsAt: isoInstant,
  groups: z.array(previewGroup),
  resolvedPlayers: z.array(resolvedPlayer),
});
export type LineupPreviewDto = z.infer<typeof lineupPreview>;

// ---------------------------------------------------------------------------------------------
// Outbound: the rankings sync report
// ---------------------------------------------------------------------------------------------

export const rankingsSyncResponse = z.object({
  rowsRead: z.number().int().min(0),
  playersCreated: z.number().int().min(0),
  playersUpdated: z.number().int().min(0),
  snapshotsWritten: z.number().int().min(0),
  sourceFetchedAt: isoInstant,
  /** True when the sheet was unreachable and the last stored snapshot was reused (Risk R3). */
  stale: z.boolean(),
});
export type RankingsSyncResponse = z.infer<typeof rankingsSyncResponse>;

/** Re-exported so a route can name the id types it parses without a second import. */
export { groupId, tournamentId };
