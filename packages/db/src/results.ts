import type { GroupId } from '@padelmigas/contracts/common';
import type { GroupCounts, ResultsRepository } from '@padelmigas/core';
import type { Sql } from './client.js';
import { num, str, toPositionCount, type Row } from './mappers.js';

/**
 * Reads the aggregate views (FR-016).
 *
 * Counting only. Percentages, mean position, crowd ordering and tie-breaks are computed by
 * `packages/core/scoring` from what this returns (ADR-006), so the formula stays unit-testable and
 * identical on any future host.
 *
 * A group with no ballots yields `ballotCount: 0` and an empty `positionCounts` — no row exists in
 * `group_ballot_counts` for it. The scoring function reads that as "no votes yet" and produces no
 * results object at all, which is why division by zero is impossible by construction (FR-019).
 */

const EMPTY: GroupCounts = { ballotCount: 0, positionCounts: [] };

export function createResultsRepository(sql: Sql): ResultsRepository {
  return {
    async countsForGroup(groupId) {
      const [ballotRows, positionRows] = await Promise.all([
        sql<Row[]>`
          select ballot_count from group_ballot_counts where group_id = ${groupId}
        `,
        sql<Row[]>`
          select pair_id, position, votes
          from group_position_counts
          where group_id = ${groupId}
          order by pair_id, position
        `,
      ]);

      const ballotRow = ballotRows[0];
      if (!ballotRow) return EMPTY;

      return {
        ballotCount: num(ballotRow, 'ballot_count'),
        positionCounts: positionRows.map(toPositionCount),
      };
    },

    async countsForGroups(groupIds) {
      const result = new Map<GroupId, GroupCounts>();
      if (groupIds.length === 0) return result;

      const ids = sql.array([...groupIds]);
      const [ballotRows, positionRows] = await Promise.all([
        sql<Row[]>`
          select group_id, ballot_count
          from group_ballot_counts
          where group_id = any(${ids}::uuid[])
        `,
        sql<Row[]>`
          select group_id, pair_id, position, votes
          from group_position_counts
          where group_id = any(${ids}::uuid[])
          order by group_id, pair_id, position
        `,
      ]);

      const countsByGroup = new Map<GroupId, number>();
      for (const row of ballotRows) {
        countsByGroup.set(str(row, 'group_id') as GroupId, num(row, 'ballot_count'));
      }

      const positionsByGroup = new Map<GroupId, ReturnType<typeof toPositionCount>[]>();
      for (const row of positionRows) {
        const key = str(row, 'group_id') as GroupId;
        const bucket = positionsByGroup.get(key);
        if (bucket) bucket.push(toPositionCount(row));
        else positionsByGroup.set(key, [toPositionCount(row)]);
      }

      // Every requested group gets an entry, so a caller never has to distinguish "no ballots" from
      // "group not asked about".
      for (const groupId of groupIds) {
        result.set(groupId, {
          ballotCount: countsByGroup.get(groupId) ?? 0,
          positionCounts: positionsByGroup.get(groupId) ?? [],
        });
      }
      return result;
    },
  };
}
