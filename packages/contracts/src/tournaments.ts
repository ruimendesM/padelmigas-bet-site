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
  /** Informational only and NOT unique; identity is the normalised name (FR-004, amended). */
  externalId: externalPlayerId.nullable(),
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
// Inbound: a lineup screenshot to extract from (FR-101, FR-117)
// ---------------------------------------------------------------------------------------------

/** Accepted upload types. Anything else is refused before extraction is attempted (FR-117). */
export const LINEUP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Decoded upload ceiling, 5 MB.
 *
 * Checked against the base64 length *before* decoding, so an oversized body is rejected without
 * allocating it, and again after. A screenshot of a lineup table is comfortably under this.
 */
export const MAX_LINEUP_IMAGE_BYTES = 5 * 1024 * 1024;

export const lineupImage = z.object({
  mimeType: z.enum(LINEUP_IMAGE_MIME_TYPES),
  /** Base64, with no `data:` prefix. Never stored, never logged, never echoed back (FR-118). */
  dataBase64: z.string().min(1),
});
export type LineupImage = z.infer<typeof lineupImage>;

export const extractLineupBody = z.object({ image: lineupImage });
export type ExtractLineupBody = z.infer<typeof extractLineupBody>;

// ---------------------------------------------------------------------------------------------
// Outbound: the extraction result (FR-102, FR-105 – FR-108)
// ---------------------------------------------------------------------------------------------

/**
 * Per-value reasons a extracted value is suspect.
 *
 * Advisory to the organiser, never a publication decision: publishing is still gated by the
 * mandatory preview, which re-validates the submitted draft (FR-111, FR-112). `TOTAL_MISMATCH` in
 * particular does not block — the sheet's own total is what the club seeds by, and recomputing it
 * would silently change the order (research D3).
 */
export const EXTRACTION_FLAGS = [
  'MISSING_NAME',
  'MISSING_POINTS',
  'MISSING_CLUB',
  'TOTAL_MISMATCH',
] as const;
export const extractionFlag = z.enum(EXTRACTION_FLAGS);
export type ExtractionFlag = z.infer<typeof extractionFlag>;

/** Row-set level problems, reported separately from per-value flags (FR-108). */
export const EXTRACTION_WARNINGS = ['NO_ROWS_FOUND', 'ODD_ROW_COUNT'] as const;
export const extractionWarning = z.enum(EXTRACTION_WARNINGS);
export type ExtractionWarning = z.infer<typeof extractionWarning>;

/** A value the reader could not read is `null`, never a guess (FR-107, ADR-011). */
export const extractedPlayer = z.object({
  name: z.string().nullable(),
  points: z.number().int().min(0).nullable(),
});
export type ExtractedPlayerDto = z.infer<typeof extractedPlayer>;

export const extractedRow = z.object({
  /** Position in the image, top to bottom, so an issue can point back at what was uploaded. */
  sourceIndex: z.number().int().min(0),
  players: z.tuple([extractedPlayer, extractedPlayer]),
  /** As read from the total column — never computed from the two player values (FR-107). */
  totalPoints: z.number().int().min(0).nullable(),
  /** Informational only; it never determines groups (FR-113). */
  club: z.string().nullable(),
  flags: z.array(extractionFlag),
});
export type ExtractedRowDto = z.infer<typeof extractedRow>;

export const lineupExtraction = z.object({
  /** Ordered by `totalPoints` descending; rows without a total come last. */
  rows: z.array(extractedRow),
  warnings: z.array(extractionWarning),
});
export type LineupExtractionDto = z.infer<typeof lineupExtraction>;

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
