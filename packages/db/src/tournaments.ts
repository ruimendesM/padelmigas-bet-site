import type { TournamentId } from '@padelmigas/contracts/common';
import type postgres from 'postgres';
import type {
  TournamentPublication,
  TournamentReplacement,
  TournamentReplacementOutcome,
  TournamentRepository,
  TournamentWithGroups,
} from '@padelmigas/core';
import { INVALIDATED_SLUG_INFIX, domainError, invalidatedSlug } from '@padelmigas/core';
import type { Sql } from './client.js';
import { assembleGroups, instant, num, str, toTournament, type Row } from './mappers.js';
import { PAIR_COLUMNS, PAIR_JOINS } from './sql-fragments.js';
import { listPublished } from './tournament-list.js';

/**
 * Tournaments, their groups and their pairs.
 *
 * Publishing and replacing (feature 003) are the only writes here, each one transaction (FR-007,
 * FR-204). Atomicity is not an
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

interface InsertedPublication {
  readonly row: Row;
  /** By group label: the new group id and its pair ids by seed, for the carry-over mapping. */
  readonly groups: ReadonlyMap<string, { id: string; pairIdsBySeed: ReadonlyMap<number, string> }>;
}

/** Inserts a tournament, its groups and pairs inside the caller's transaction (FR-007). */
async function insertPublication(
  tx: postgres.TransactionSql<Record<string, never>>,
  publication: TournamentPublication,
): Promise<InsertedPublication> {
  const inserted = await tx<Row[]>`
    insert into tournaments (name, slug, starts_at, published_at)
    values (
      ${publication.name},
      ${publication.slug},
      ${publication.startsAt},
      ${publication.publishedAt}
    )
    returning id, name, slug, starts_at, published_at, invalidated_at, replaced_by_id
  `;
  const tournament = inserted[0];
  if (!tournament) {
    throw new Error('Insert of tournament returned no row.');
  }
  const tournamentId = String(tournament['id']);

  const groups = new Map<string, { id: string; pairIdsBySeed: ReadonlyMap<number, string> }>();
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

    const pairIdsBySeed = new Map<number, string>();
    if (group.pairs.length > 0) {
      const pairRows = await tx<Row[]>`
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
        returning id, seed
      `;
      for (const pairRow of pairRows) pairIdsBySeed.set(num(pairRow, 'seed'), str(pairRow, 'id'));
    }
    groups.set(group.label, { id: groupId, pairIdsBySeed });
  }

  return { row: tournament, groups };
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
        select id, name, slug, starts_at, published_at, invalidated_at, replaced_by_id
        from tournaments
        where slug = ${slug}
      `;
      const row = rows[0];
      return row ? loadWithGroups(row) : null;
    },

    async findById(id: TournamentId) {
      const rows = await sql<Row[]>`
        select id, name, slug, starts_at, published_at, invalidated_at, replaced_by_id
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
        tournamentRow = await sql.begin(
          async (tx) => (await insertPublication(tx, publication)).row,
        );
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

    async replace(replacement: TournamentReplacement): Promise<TournamentReplacementOutcome> {
      const tournamentRow = await sql.begin(async (tx) => {
        // The lock is the whole concurrency story (research R4): a second replace waits here and then
        // sees the invalidation, and a ballot insert — which takes FOR SHARE on this row — either
        // committed before us and is copied below, or waits and then finds the tournament closed.
        const locked = await tx<Row[]>`
          select id, slug, starts_at, invalidated_at
          from tournaments
          where id = ${replacement.originalId} and published_at is not null
          for update
        `;
        const original = locked[0];
        if (
          !original ||
          original['invalidated_at'] !== null ||
          !(instant(original, 'starts_at').getTime() > replacement.now.getTime())
        ) {
          return null;
        }
        const originalId = str(original, 'id');
        const originalSlug = str(original, 'slug');

        // Slugs hold only [a-z0-9-], so LIKE has no wildcard to escape.
        const taken = await tx<Row[]>`
          select slug from tournaments
          where slug like ${`${originalSlug}${INVALIDATED_SLUG_INFIX}%`}
        `;
        await tx`
          update tournaments
          set slug = ${invalidatedSlug(
            originalSlug,
            taken.map((row) => str(row, 'slug')),
          )}
          where id = ${originalId}
        `;

        // The replacement takes over the address (FR-210), whatever slug the payload derived.
        const inserted = await insertPublication(tx, {
          ...replacement.publication,
          slug: originalSlug,
        });

        for (const decision of replacement.carryOver) {
          if (decision.carriedFrom === null) continue;
          const target = inserted.groups.get(decision.label);
          if (!target) {
            throw new Error(`Carry-over names group ${decision.label}, which was not published.`);
          }

          const fromPairIds = decision.carriedFrom.pairMap.map((entry) => entry.fromPairId);
          const toPairIds = decision.carriedFrom.pairMap.map((entry) => {
            const pairIdAtSeed = target.pairIdsBySeed.get(entry.toSeed);
            if (!pairIdAtSeed) {
              throw new Error(`Carry-over names seed ${entry.toSeed} of group ${decision.label}.`);
            }
            return pairIdAtSeed;
          });

          // Same voter, same instant, same position per pair (FR-207). The original's ballots stay
          // where they are as the frozen record.
          await tx`
            insert into ballots (group_id, voter_id, cast_at, carried_from_id)
            select ${target.id}, voter_id, cast_at, id
            from ballots
            where group_id = ${decision.carriedFrom.groupId}
          `;
          await tx`
            insert into ballot_entries (ballot_id, pair_id, position)
            select b.id, m.to_pair, e.position
            from ballots b
            join ballot_entries e on e.ballot_id = b.carried_from_id
            join unnest(
              ${tx.array(fromPairIds)}::uuid[],
              ${tx.array(toPairIds)}::uuid[]
            ) as m (from_pair, to_pair) on m.from_pair = e.pair_id
            where b.group_id = ${target.id}
          `;
        }

        await tx`
          update tournaments
          set invalidated_at = ${replacement.now},
              replaced_by_id = ${str(inserted.row, 'id')}
          where id = ${originalId}
        `;

        return inserted.row;
      });

      if (tournamentRow === null) return { kind: 'not-replaceable' };
      return { kind: 'replaced', tournament: await loadWithGroups(tournamentRow) };
    },

    async findLiveSuccessor(id: TournamentId) {
      // Only open tournaments can be replaced and a replacement is open at birth, so the chain ends
      // in exactly one live tournament (data-model.md). The depth guard is belt and braces against a
      // cycle the constraints already make impossible.
      const rows = await sql<Row[]>`
        with recursive chain (id, depth) as (
          select replaced_by_id, 1 from tournaments where id = ${id} and replaced_by_id is not null
          union all
          select t.replaced_by_id, c.depth + 1
          from chain c
          join tournaments t on t.id = c.id
          where t.replaced_by_id is not null and c.depth < 100
        )
        select t.id, t.name, t.slug, t.starts_at, t.published_at, t.invalidated_at, t.replaced_by_id
        from chain c
        join tournaments t on t.id = c.id
        where t.invalidated_at is null
        limit 1
      `;
      const row = rows[0];
      return row ? toTournament(row) : null;
    },

    listPublished: (query) => listPublished(sql, query),
  };
}
