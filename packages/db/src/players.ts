import type { ExternalPlayerId, PlayerId } from '@padelmigas/contracts/common';
import type {
  Player,
  PlayerRepository,
  PlayerUpsert,
  PlayerUpsertResult,
  RatingRepository,
  RatingSnapshot,
} from '@padelmigas/core';
import type { Sql } from './client.js';
import { calendarDate, num, str, toPlayer, type Row } from './mappers.js';

/**
 * Players and their dated ratings.
 *
 * The importer's contract (FR-004, ADR-007) shapes this file: a name that does not resolve is an
 * error a human fixes, never a silent auto-create, and re-running a sync must be a no-op rather than
 * a source of duplicates.
 */

export function createPlayerRepository(sql: Sql): PlayerRepository {
  return {
    async findByMatchKeys(matchKeys) {
      if (matchKeys.length === 0) return [];
      const rows = await sql<Row[]>`
        select id, external_id, display_name, match_key, club
        from players
        where match_key = any(${sql.array([...matchKeys])}::text[])
      `;
      return rows.map(toPlayer);
    },

    async findById(id) {
      const rows = await sql<Row[]>`
        select id, external_id, display_name, match_key, club
        from players
        where id = ${id}
      `;
      const row = rows[0];
      return row ? toPlayer(row) : null;
    },

    async upsertMany(players) {
      if (players.length === 0) return { created: 0, updated: 0, players: [] };

      // One transaction: a half-applied import would leave local identities disagreeing with the
      // ranking source, which is exactly the state ADR-007 exists to prevent.
      return sql.begin(async (tx) => {
        const rows = await tx<Row[]>`
          insert into players ${tx(
            players.map((p) => ({
              external_id: p.externalId,
              display_name: p.displayName,
              match_key: p.matchKey,
              club: p.club,
            })),
          )}
          -- Conflict on match_key, never on external_id (FR-004 as amended 2026-08-28, migration
          -- 0006). The sheet reuses ids across different people, so upserting on external_id would
          -- silently collapse two real people into one row — and invisibly, because the row count
          -- would simply stop growing. match_key is the only column that has ever identified a
          -- person, and it is the only remaining UNIQUE constraint on the table.
          on conflict (match_key) do update
            set display_name = excluded.display_name,
                external_id  = excluded.external_id,
                club         = excluded.club
          returning id, external_id, display_name, match_key, club,
                    -- xmax is 0 on a fresh insert and non-zero when the row was updated. It is the
                    -- only way to distinguish the two halves of an upsert in a single statement.
                    (xmax = 0) as inserted
        `;

        let created = 0;
        let updated = 0;
        const result: Player[] = [];
        for (const row of rows) {
          if (row['inserted'] === true) created += 1;
          else updated += 1;
          result.push(toPlayer(row));
        }
        return { created, updated, players: result } satisfies PlayerUpsertResult;
      });
    },
  };
}

export function createRatingRepository(sql: Sql): RatingRepository {
  return {
    async upsertSnapshots(snapshots) {
      if (snapshots.length === 0) return 0;

      // Idempotent by primary key (player_id, rated_on): a second sync of the same sheet rewrites
      // the same rows rather than accumulating (FR-004).
      const rows = await sql<Row[]>`
        insert into player_ratings ${sql(
          snapshots.map((s) => ({
            player_id: s.playerId,
            rated_on: s.ratedOn,
            points: s.points,
          })),
        )}
        on conflict (player_id, rated_on) do update
          set points = excluded.points
        returning player_id
      `;
      return rows.length;
    },

    async latestPointsFor(playerIds) {
      const map = new Map<PlayerId, number>();
      if (playerIds.length === 0) return map;

      // DISTINCT ON gives the newest snapshot per player in one pass.
      const rows = await sql<Row[]>`
        select distinct on (player_id) player_id, points
        from player_ratings
        where player_id = any(${sql.array([...playerIds])}::uuid[])
        order by player_id, rated_on desc
      `;
      for (const row of rows) {
        map.set(str(row, 'player_id') as PlayerId, num(row, 'points'));
      }
      return map;
    },

    async latestRatedOn() {
      const rows = await sql<Row[]>`
        select max(rated_on) as rated_on from player_ratings
      `;
      const row = rows[0];
      if (!row || row['rated_on'] === null || row['rated_on'] === undefined) return null;
      return calendarDate(row, 'rated_on');
    },
  };
}

/** Narrowing helpers used by the ranking sync when it needs both repositories at once. */
export type { ExternalPlayerId, PlayerUpsert, RatingSnapshot };
