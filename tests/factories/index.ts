import type {
  ExternalPlayerId,
  GroupId,
  PairId,
  PlayerId,
  TournamentId,
  VoterId,
} from '@padelmigas/contracts';
import type { Sql } from '@padelmigas/db';

/**
 * Fixture factories.
 *
 * Every factory writes real rows through the driver, not through the API, so a test can arrange a
 * world the API has no endpoint to create — a closed tournament, a group with twelve ballots — and
 * then assert what the API says about it.
 *
 * Defaults are chosen so the common case needs no arguments, and every override is explicit. Names
 * are fictional: real player data is never committed (research F1).
 */

let sequence = 0;
/** Monotonic within a process; tests truncate between cases so collisions cannot span tests. */
function next(): number {
  sequence += 1;
  return sequence;
}

/** Resets the sequence. Called between suites that assert on generated names. */
export function resetFactorySequence(): void {
  sequence = 0;
}

// ---------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------

export interface PlayerOverrides {
  externalId?: number;
  displayName?: string;
  matchKey?: string;
  club?: string | null;
}

/** Mirrors `core/matching.toMatchKey`; duplicated here so a factory bug cannot mask a matching bug. */
function naiveMatchKey(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function createPlayer(
  sql: Sql,
  overrides: PlayerOverrides = {},
): Promise<{ id: PlayerId; externalId: ExternalPlayerId; displayName: string; matchKey: string }> {
  const n = next();
  const displayName = overrides.displayName ?? `Jogador Fictício ${n}`;
  const matchKey = overrides.matchKey ?? naiveMatchKey(displayName);
  const externalId = overrides.externalId ?? 900_000 + n;
  const club = overrides.club === undefined ? 'Clube de Teste' : overrides.club;

  const rows = await sql<{ id: string }[]>`
    insert into players (external_id, display_name, match_key, club)
    values (${externalId}, ${displayName}, ${matchKey}, ${club})
    returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createPlayer inserted no row.');
  return {
    id: id as PlayerId,
    externalId: externalId as ExternalPlayerId,
    displayName,
    matchKey,
  };
}

export async function createRating(
  sql: Sql,
  playerId: PlayerId,
  options: { ratedOn?: string; points?: number } = {},
): Promise<void> {
  await sql`
    insert into player_ratings (player_id, rated_on, points)
    values (${playerId}, ${options.ratedOn ?? '2026-08-26'}, ${options.points ?? 400})
    on conflict (player_id, rated_on) do update set points = excluded.points
  `;
}

// ---------------------------------------------------------------------------------------------
// Tournaments, groups, pairs
// ---------------------------------------------------------------------------------------------

export interface TournamentOverrides {
  name?: string;
  slug?: string;
  /** Also the voting deadline (FR-011). */
  startsAt?: Date;
  /** `null` leaves the tournament a draft — never publicly visible. */
  publishedAt?: Date | null;
}

export async function createTournament(
  sql: Sql,
  overrides: TournamentOverrides = {},
): Promise<{ id: TournamentId; slug: string; startsAt: Date; publishedAt: Date | null }> {
  const n = next();
  const name = overrides.name ?? `Torneio de Teste ${n}`;
  const slug = overrides.slug ?? `torneio-de-teste-${n}`;
  const startsAt = overrides.startsAt ?? new Date('2026-12-01T18:00:00.000Z');
  const publishedAt =
    overrides.publishedAt === undefined
      ? new Date('2026-09-01T10:00:00.000Z')
      : overrides.publishedAt;

  const rows = await sql<{ id: string }[]>`
    insert into tournaments (name, slug, starts_at, published_at)
    values (${name}, ${slug}, ${startsAt}, ${publishedAt})
    returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createTournament inserted no row.');
  return { id: id as TournamentId, slug, startsAt, publishedAt };
}

export async function createGroup(
  sql: Sql,
  tournamentId: TournamentId,
  options: { label?: string; position?: number } = {},
): Promise<{ id: GroupId; label: string; position: number }> {
  const position = options.position ?? 1;
  const label = options.label ?? String.fromCharCode('A'.charCodeAt(0) + position - 1);
  const rows = await sql<{ id: string }[]>`
    insert into groups (tournament_id, label, position)
    values (${tournamentId}, ${label}, ${position})
    returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createGroup inserted no row.');
  return { id: id as GroupId, label, position };
}

export interface PairOverrides {
  club?: string;
  seed?: number;
  player1Points?: number;
  player2Points?: number;
  player1Id?: PlayerId;
  player2Id?: PlayerId;
}

export async function createPair(
  sql: Sql,
  groupId: GroupId,
  overrides: PairOverrides = {},
): Promise<{ id: PairId; seed: number; totalPoints: number; playerIds: [PlayerId, PlayerId] }> {
  const seed = overrides.seed ?? 1;
  const player1Points = overrides.player1Points ?? 500 - seed * 10;
  const player2Points = overrides.player2Points ?? 480 - seed * 10;
  const player1Id = overrides.player1Id ?? (await createPlayer(sql)).id;
  const player2Id = overrides.player2Id ?? (await createPlayer(sql)).id;
  const totalPoints = player1Points + player2Points;

  const rows = await sql<{ id: string }[]>`
    insert into pairs (
      group_id, player_1_id, player_2_id, club,
      player_1_points, player_2_points, total_points, seed
    )
    values (
      ${groupId}, ${player1Id}, ${player2Id}, ${overrides.club ?? 'Clube de Teste'},
      ${player1Points}, ${player2Points}, ${totalPoints}, ${seed}
    )
    returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createPair inserted no row.');
  return { id: id as PairId, seed, totalPoints, playerIds: [player1Id, player2Id] };
}

/**
 * A group of `size` pairs, seeded 1..size with strictly descending total points.
 *
 * `size` defaults to 6 — a full group. Pass 3–5 to exercise a short final group (research D10).
 */
export async function createGroupWithPairs(
  sql: Sql,
  tournamentId: TournamentId,
  options: { size?: number; label?: string; position?: number } = {},
): Promise<{ groupId: GroupId; label: string; pairIds: PairId[] }> {
  const size = options.size ?? 6;
  const group = await createGroup(sql, tournamentId, {
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.position === undefined ? {} : { position: options.position }),
  });
  const pairIds: PairId[] = [];
  for (let seed = 1; seed <= size; seed += 1) {
    const pair = await createPair(sql, group.id, { seed });
    pairIds.push(pair.id);
  }
  return { groupId: group.id, label: group.label, pairIds };
}

// ---------------------------------------------------------------------------------------------
// Voters and ballots
// ---------------------------------------------------------------------------------------------

export async function createVoter(sql: Sql): Promise<VoterId> {
  const rows = await sql<{ id: string }[]>`
    insert into voters default values returning id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createVoter inserted no row.');
  return id as VoterId;
}

/**
 * Records one ballot.
 *
 * `ordering` is a list of pair ids in finishing order — index 0 finishes first. Expressing it that
 * way rather than as `{pairId, position}` pairs makes a test's intent readable and makes an
 * accidentally repeated position impossible to write by hand.
 */
export async function castBallot(
  sql: Sql,
  groupId: GroupId,
  ordering: readonly PairId[],
  options: { voterId?: VoterId; castAt?: Date } = {},
): Promise<{ ballotId: string; voterId: VoterId }> {
  const voterId = options.voterId ?? (await createVoter(sql));
  const castAt = options.castAt ?? new Date('2026-09-02T10:00:00.000Z');

  const rows = await sql<{ id: string }[]>`
    insert into ballots (group_id, voter_id, cast_at)
    values (${groupId}, ${voterId}, ${castAt})
    returning id
  `;
  const ballotId = rows[0]?.id;
  if (!ballotId) throw new Error('castBallot inserted no ballot.');

  await sql`
    insert into ballot_entries ${sql(
      ordering.map((pairId, index) => ({
        ballot_id: ballotId,
        pair_id: pairId,
        position: index + 1,
      })),
    )}
  `;

  return { ballotId, voterId };
}

/** Records `count` identical ballots, for exercising percentage arithmetic at a known N. */
export async function castBallots(
  sql: Sql,
  groupId: GroupId,
  ordering: readonly PairId[],
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await castBallot(sql, groupId, ordering);
  }
}

// ---------------------------------------------------------------------------------------------
// Ranking CSV
// ---------------------------------------------------------------------------------------------

/**
 * Builds a ranking-sheet CSV in the real shape observed on 2026-08-27 (research F1): `ID`, `Nome`,
 * then dated rating columns, most recent first, with the two date formats that actually occur.
 */
export function rankingCsv(
  rows: readonly { id: number; name: string; points: readonly number[] }[],
  options: { dateHeaders?: readonly string[] } = {},
): string {
  const dateHeaders = options.dateHeaders ?? ['26/08/2026', '22-08-2026'];
  const header = ['ID', 'Nome', ...dateHeaders].join(',');
  const body = rows.map((row) =>
    [
      String(row.id),
      // Quote the name: real club names and particles contain commas often enough to matter.
      `"${row.name.replace(/"/g, '""')}"`,
      ...dateHeaders.map((_, index) => String(row.points[index] ?? '')),
    ].join(','),
  );
  return [header, ...body].join('\n');
}
