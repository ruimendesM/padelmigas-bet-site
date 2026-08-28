import { z } from 'zod';

/**
 * Shared contract primitives.
 *
 * These schemas are the single source of truth for request/response validation, for the generated
 * TypeScript client, and for the generated OpenAPI document (constitution, Principle III). Nothing
 * here may import from another workspace package — the boundary gate enforces it — so this file
 * stays usable by a future React Native client and by a standalone API service unchanged.
 */

// ---------------------------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------------------------
// Every id is a uuid on the wire, but a TournamentId is not interchangeable with a GroupId. Zod's
// `.brand()` makes that a compile-time error rather than a runtime surprise at 2am.

export const tournamentId = z.string().uuid().brand<'TournamentId'>();
export const groupId = z.string().uuid().brand<'GroupId'>();
export const pairId = z.string().uuid().brand<'PairId'>();
export const playerId = z.string().uuid().brand<'PlayerId'>();
export const voterId = z.string().uuid().brand<'VoterId'>();
export const ballotId = z.string().uuid().brand<'BallotId'>();

export type TournamentId = z.infer<typeof tournamentId>;
export type GroupId = z.infer<typeof groupId>;
export type PairId = z.infer<typeof pairId>;
export type PlayerId = z.infer<typeof playerId>;
export type VoterId = z.infer<typeof voterId>;
export type BallotId = z.infer<typeof ballotId>;

/** The ranking sheet's `ID` column — the canonical external player identity (FR-004, ADR-007). */
export const externalPlayerId = z.number().int().positive();
export type ExternalPlayerId = z.infer<typeof externalPlayerId>;

// ---------------------------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------------------------
// Clients branch on `code`, never on `message`, which is localisable copy (contracts/README rule 5).

export const ERROR_CODES = [
  // Generic
  'NOT_FOUND',
  'UNAUTHORISED',
  'RATE_LIMITED',
  'MALFORMED_PAYLOAD',
  'INTERNAL_ERROR',

  // Publishing a lineup (FR-001 – FR-008)
  'UNRESOLVED_PLAYERS',
  'START_NOT_IN_FUTURE',
  'DUPLICATE_PLAYER',
  'POINTS_MISMATCH',
  'INVALID_GROUP_SIZE',
  'SLUG_TAKEN',
  'NOT_CONFIRMED',

  // Ranking import (FR-004)
  'DUPLICATE_MATCH_KEY',

  // Casting a ballot (FR-009 – FR-013)
  'INCOMPLETE_BALLOT',
  'DUPLICATE_POSITION',
  'UNKNOWN_PAIR',
  'MISSING_PAIR',
  'ALREADY_VOTED',
  'VOTING_CLOSED',

  // Reading results (FR-020, FR-021)
  'RESULTS_HIDDEN',
] as const;

export const errorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCode>;

// ---------------------------------------------------------------------------------------------
// Error envelopes
// ---------------------------------------------------------------------------------------------

export const apiError = z.object({
  code: errorCode,
  message: z.string(),
});
export type ApiError = z.infer<typeof apiError>;

/** One offending entry. `path` uses payload notation, e.g. `pairs[10].players[1].name`. */
export const errorIssue = z.object({
  path: z.string(),
  message: z.string(),
});
export type ErrorIssue = z.infer<typeof errorIssue>;

/**
 * Multi-problem envelope. FR-005 requires every offending entry, not just the first — an organiser
 * fixing a pasted lineup should not have to re-submit six times to discover six typos.
 */
export const apiErrorWithIssues = apiError.extend({
  issues: z.array(errorIssue).default([]),
});
export type ApiErrorWithIssues = z.infer<typeof apiErrorWithIssues>;

// ---------------------------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------------------------

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

/** Wraps any item schema in `{ items, nextCursor }` without repeating the shape per endpoint. */
export function paginated<TItem extends z.ZodTypeAny, TKey extends string>(
  key: TKey,
  item: TItem,
): z.ZodObject<{ [K in TKey]: z.ZodArray<TItem> } & { nextCursor: z.ZodNullable<z.ZodString> }> {
  return z.object({
    [key]: z.array(item),
    nextCursor: z.string().nullable(),
  }) as never;
}

// ---------------------------------------------------------------------------------------------
// Shared scalars
// ---------------------------------------------------------------------------------------------

/** An instant on the wire: ISO 8601, always UTC (constitution: Locale & time). */
export const isoInstant = z.string().datetime({ offset: true });

/** A URL slug: lower-case, hyphen-separated, matching the database CHECK on `tournaments.slug`. */
export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lower-case words separated by single hyphens');

/**
 * A finishing position. The bound of 6 is the largest group the spec allows (research D10) and is
 * also the CHECK on `ballot_entries.position`.
 */
export const position = z.number().int().min(1).max(6);

/** Group sizes the product supports: a full group of six, or a short final group of 3–5. */
export const MIN_GROUP_SIZE = 3;
export const MAX_GROUP_SIZE = 6;
