import type {
  Appearance,
  Ballot,
  BallotEntry,
  Group,
  GroupWithPairs,
  Pair,
  PairMember,
  Player,
  PositionCount,
  Tournament,
  Voter,
} from '@padelmigas/core';

/**
 * Row → domain mapping.
 *
 * This module is the parse boundary. Everything above it works in domain types; everything below it
 * is `postgres.Row`, which is untyped by nature. The `any`-free way to say that is `unknown` plus
 * narrow readers, which is what the helpers at the top of this file do — so the constitution's ban
 * on `any` in `packages/**` holds without an escape hatch.
 */

/** A row as the driver hands it back: string keys, values of unknown shape. */
export type Row = Record<string, unknown>;

function fail(column: string, expected: string, actual: unknown): never {
  throw new Error(
    `Column "${column}" was expected to be ${expected} but was ${
      actual === null ? 'null' : typeof actual
    }. The schema and the mapper have drifted apart.`,
  );
}

export function str(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') fail(column, 'a string', value);
  return value;
}

export function strOrNull(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(column, 'a string or null', value);
  return value;
}

export function num(row: Row, column: string): number {
  const value = row[column];
  // Postgres `bigint` and `numeric` arrive as strings; smallint/int arrive as numbers.
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fail(column, 'a number', value);
}

export function numOrNull(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return num(row, column);
}

export function instant(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fail(column, 'a timestamptz', value);
}

export function instantOrNull(row: Row, column: string): Date | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return instant(row, column);
}

/** A `date` column: kept as a calendar day string, never widened to an instant. */
export function calendarDate(row: Row, column: string): string {
  const value = row[column];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return fail(column, 'a date', value);
}

/**
 * Reads a branded id.
 *
 * The brand is a compile-time construct with no runtime representation, so the cast is the whole
 * implementation. It is safe because the value is validated as a string here and as a uuid by the
 * contract schema at the edge.
 */
function id<T extends string>(row: Row, column: string): T {
  return str(row, column) as T;
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

export function toPlayer(row: Row): Player {
  return {
    id: id(row, 'id'),
    // Nullable and non-unique since the 2026-08-28 amendment (FR-004, migration 0006).
    externalId: numOrNull(row, 'external_id'),
    displayName: str(row, 'display_name'),
    matchKey: str(row, 'match_key'),
    club: strOrNull(row, 'club'),
  };
}

export function toTournament(row: Row): Tournament {
  return {
    id: id(row, 'id'),
    name: str(row, 'name'),
    slug: str(row, 'slug'),
    startsAt: instant(row, 'starts_at'),
    publishedAt: instantOrNull(row, 'published_at'),
  };
}

export function toGroup(row: Row): Group {
  return {
    id: id(row, 'id'),
    tournamentId: id(row, 'tournament_id'),
    label: str(row, 'label'),
    position: num(row, 'position'),
  };
}

/**
 * Maps a pair row that has been joined to both players.
 *
 * The joined column names are fixed by the queries in this package: `player_1_name` / `player_2_name`
 * alongside the `player_*_points` captured at publish time (FR-007).
 */
export function toPair(row: Row): Pair {
  const first: PairMember = {
    playerId: id(row, 'player_1_id'),
    displayName: str(row, 'player_1_name'),
    points: num(row, 'player_1_points'),
  };
  const second: PairMember = {
    playerId: id(row, 'player_2_id'),
    displayName: str(row, 'player_2_name'),
    points: num(row, 'player_2_points'),
  };
  return {
    id: id(row, 'id'),
    groupId: id(row, 'group_id'),
    club: str(row, 'club'),
    members: [first, second],
    totalPoints: num(row, 'total_points'),
    seed: num(row, 'seed'),
  };
}

export function toVoter(row: Row): Voter {
  return {
    id: id(row, 'id'),
    createdAt: instant(row, 'created_at'),
    lastSeenAt: instant(row, 'last_seen_at'),
  };
}

export function toBallotEntry(row: Row): BallotEntry {
  return {
    pairId: id(row, 'pair_id'),
    position: num(row, 'position'),
  };
}

export function toBallot(row: Row, ordering: readonly BallotEntry[]): Ballot {
  return {
    id: id(row, 'id'),
    groupId: id(row, 'group_id'),
    voterId: id(row, 'voter_id'),
    castAt: instant(row, 'cast_at'),
    // Positions ascending, so the caller never has to sort to display an ordering.
    ordering: [...ordering].sort((a, b) => a.position - b.position),
  };
}

export function toPositionCount(row: Row): PositionCount {
  return {
    pairId: id(row, 'pair_id'),
    position: num(row, 'position'),
    votes: num(row, 'votes'),
  };
}

/**
 * Assembles groups with their pairs from two flat result sets.
 *
 * Done here rather than with a lateral join because a join would repeat every group column once per
 * pair, and the page needs both shapes anyway.
 */
export function assembleGroups(
  groupRows: readonly Row[],
  pairRows: readonly Row[],
): GroupWithPairs[] {
  const pairsByGroup = new Map<string, Pair[]>();
  for (const row of pairRows) {
    const pair = toPair(row);
    const bucket = pairsByGroup.get(pair.groupId);
    if (bucket) bucket.push(pair);
    else pairsByGroup.set(pair.groupId, [pair]);
  }

  return groupRows
    .map(toGroup)
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      ...group,
      pairs: (pairsByGroup.get(group.id) ?? []).sort((a, b) => a.seed - b.seed),
    }));
}

export function toAppearance(row: Row): Appearance {
  return {
    tournament: toTournament(row),
    groupLabel: str(row, 'group_label'),
    partner: {
      id: id(row, 'partner_id'),
      name: str(row, 'partner_name'),
    },
    pointsAtTournament: num(row, 'points_at_tournament'),
    ballotCount: num(row, 'ballot_count'),
    groupCount: num(row, 'group_count'),
  };
}
