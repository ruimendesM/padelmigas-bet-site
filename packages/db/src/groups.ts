import type { GroupRepository, PairRepository } from '@padelmigas/core';
import type { Sql } from './client.js';
import { assembleGroups, toPair, toTournament, type Row } from './mappers.js';
import { PAIR_COLUMNS, PAIR_JOINS } from './sql-fragments.js';

/**
 * Groups and pairs.
 *
 * `findTournamentForGroup` exists so the ballot path can decide the voting window without a second
 * round trip — the window decision happens on every submission (FR-011) and is the hottest read on
 * the vote path.
 */

export function createGroupRepository(sql: Sql): GroupRepository {
  return {
    async findById(id) {
      const groupRows = await sql<Row[]>`
        select id, tournament_id, label, position
        from groups
        where id = ${id}
      `;
      if (groupRows.length === 0) return null;

      const pairRows = await sql<Row[]>`
        select ${sql.unsafe(PAIR_COLUMNS)}
        ${sql.unsafe(PAIR_JOINS)}
        where p.group_id = ${id}
        order by p.seed
      `;
      return assembleGroups(groupRows, pairRows)[0] ?? null;
    },

    async findByTournament(tournamentId) {
      const groupRows = await sql<Row[]>`
        select id, tournament_id, label, position
        from groups
        where tournament_id = ${tournamentId}
        order by position
      `;
      if (groupRows.length === 0) return [];

      const pairRows = await sql<Row[]>`
        select ${sql.unsafe(PAIR_COLUMNS)}
        ${sql.unsafe(PAIR_JOINS)}
        where p.group_id = any(${sql.array(groupRows.map((r) => String(r['id'])))}::uuid[])
        order by p.seed
      `;
      return assembleGroups(groupRows, pairRows);
    },

    async findTournamentForGroup(id) {
      const rows = await sql<Row[]>`
        select t.id, t.name, t.slug, t.starts_at, t.published_at
        from groups g
        join tournaments t on t.id = g.tournament_id
        where g.id = ${id}
      `;
      const row = rows[0];
      return row ? toTournament(row) : null;
    },
  };
}

export function createPairRepository(sql: Sql): PairRepository {
  return {
    async findByGroup(groupId) {
      const rows = await sql<Row[]>`
        select ${sql.unsafe(PAIR_COLUMNS)}
        ${sql.unsafe(PAIR_JOINS)}
        where p.group_id = ${groupId}
        order by p.seed
      `;
      return rows.map(toPair);
    },

    async findById(id) {
      const rows = await sql<Row[]>`
        select ${sql.unsafe(PAIR_COLUMNS)}
        ${sql.unsafe(PAIR_JOINS)}
        where p.id = ${id}
      `;
      const row = rows[0];
      return row ? toPair(row) : null;
    },
  };
}
