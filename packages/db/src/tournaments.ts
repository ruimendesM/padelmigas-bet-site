import type { TournamentId } from '@padelmigas/contracts/common';
import type {
  TournamentPublication,
  TournamentRepository,
  TournamentWithGroups,
} from '@padelmigas/core';
import { domainError } from '@padelmigas/core';
import type { Sql } from './client.js';
import { assembleGroups, toTournament, type Row } from './mappers.js';
import { PAIR_COLUMNS, PAIR_JOINS } from './sql-fragments.js';
import { listPublished } from './tournament-list.js';

/**
 * Tournaments, their groups and their pairs.
 *
 * The publish path is the only write here and it is one transaction (FR-007). Atomicity is not an
 * optimisation: a half-published tournament appears on the public landing page with groups missing,
 * and Risk R9 is specifically about bad public data reaching an audience.
 */

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown, constraintHint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint_name?: unknown; detail?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  const constraint = typeof candidate.constraint_name === 'string' ? candidate.constraint_name : '';
  const detail = typeof candidate.detail === 'string' ? candidate.detail : '';
  return constraint.includes(constraintHint) || detail.includes(constraintHint);
}

export function createTournamentRepository(sql: Sql): TournamentRepository {
  async function loadWithGroups(tournamentRow: Row): Promise<TournamentWithGroups> {
    const tournament = toTournament(tournamentRow);
    const groupRows = await sql<Row[]>`
      select id, tournament_id, label, position
      from groups
      where tournament_id = ${tournament.id}
      order by position
    `;
    const pairRows =
      groupRows.length === 0
        ? []
        : await sql<Row[]>`
            select ${sql.unsafe(PAIR_COLUMNS)}
            ${sql.unsafe(PAIR_JOINS)}
            where p.group_id = any(${sql.array(groupRows.map((r) => String(r['id'])))}::uuid[])
            order by p.seed
          `;
    return { ...tournament, groups: assembleGroups(groupRows, pairRows) };
  }

  return {
    async findBySlug(slug) {
      const rows = await sql<Row[]>`
        select id, name, slug, starts_at, published_at
        from tournaments
        where slug = ${slug}
      `;
      const row = rows[0];
      return row ? loadWithGroups(row) : null;
    },

    async findById(id: TournamentId) {
      const rows = await sql<Row[]>`
        select id, name, slug, starts_at, published_at
        from tournaments
        where id = ${id}
      `;
      const row = rows[0];
      return row ? toTournament(row) : null;
    },

    async slugExists(slug) {
      const rows = await sql<{ exists: boolean }[]>`
        select exists (select 1 from tournaments where slug = ${slug}) as exists
      `;
      return rows[0]?.exists === true;
    },

    async publish(publication: TournamentPublication) {
      let tournamentRow: Row;
      try {
        tournamentRow = await sql.begin(async (tx) => {
          const inserted = await tx<Row[]>`
            insert into tournaments (name, slug, starts_at, published_at)
            values (
              ${publication.name},
              ${publication.slug},
              ${publication.startsAt},
              ${publication.publishedAt}
            )
            returning id, name, slug, starts_at, published_at
          `;
          const tournament = inserted[0];
          if (!tournament) {
            throw new Error('Insert of tournament returned no row.');
          }
          const tournamentId = String(tournament['id']);

          for (const group of publication.groups) {
            const groupRows = await tx<Row[]>`
              insert into groups (tournament_id, label, position)
              values (${tournamentId}, ${group.label}, ${group.position})
              returning id
            `;
            const groupId = groupRows[0]?.['id'];
            if (typeof groupId !== 'string') {
              throw new Error('Insert of group returned no id.');
            }

            if (group.pairs.length > 0) {
              await tx`
                insert into pairs ${tx(
                  group.pairs.map((pair) => ({
                    group_id: groupId,
                    player_1_id: pair.members[0].playerId,
                    player_2_id: pair.members[1].playerId,
                    club: pair.club,
                    player_1_points: pair.members[0].points,
                    player_2_points: pair.members[1].points,
                    total_points: pair.totalPoints,
                    seed: pair.seed,
                  })),
                )}
              `;
            }
          }

          return tournament;
        });
      } catch (error) {
        // A racing publish of the same slug is a conflict with existing state, not a server fault.
        if (isUniqueViolation(error, 'slug')) {
          throw domainError(
            'SLUG_TAKEN',
            `Já existe um torneio com o endereço "${publication.slug}".`,
          );
        }
        throw error;
      }

      return loadWithGroups(tournamentRow);
    },

    listPublished: (query) => listPublished(sql, query),
  };
}
