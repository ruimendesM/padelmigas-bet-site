import type { GroupId } from '@padelmigas/contracts/common';
import type { BallotInsertOutcome, BallotRepository, VoterRepository } from '@padelmigas/core';
import type { Sql } from './client.js';
import { str, toBallot, toBallotEntry, toVoter, type Row } from './mappers.js';

/**
 * Voters and ballots — the write path the whole product turns on.
 *
 * Three properties are enforced here rather than hoped for:
 *  - **One transaction per ballot** (FR-010): the ballot row and every entry land together, so a
 *    rejected ballot leaves nothing behind and no group is ever scored from a partial ordering.
 *  - **A duplicate is an outcome, not a crash** (Risk R7, SC-009): the `UNIQUE (group_id, voter_id)`
 *    violation is caught and returned as `already-voted`, so two simultaneous submissions produce
 *    exactly one ballot and a 409 rather than a 500.
 *  - **`touch` never fails the request** (ADR-004): refreshing `last_seen_at` is bookkeeping; losing
 *    it must not cost a voter their vote.
 */

const UNIQUE_VIOLATION = '23505';

function isDuplicateBallot(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint_name?: unknown; detail?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  const constraint = typeof candidate.constraint_name === 'string' ? candidate.constraint_name : '';
  const detail = typeof candidate.detail === 'string' ? candidate.detail : '';
  // The constraint is unnamed in the migration, so Postgres names it `ballots_group_id_voter_id_key`.
  return (
    constraint.includes('group_id') || (detail.includes('group_id') && detail.includes('voter_id'))
  );
}

export function createVoterRepository(sql: Sql): VoterRepository {
  return {
    async create() {
      const rows = await sql<Row[]>`
        insert into voters default values
        returning id, created_at, last_seen_at
      `;
      const row = rows[0];
      if (!row) throw new Error('Insert of voter returned no row.');
      return toVoter(row);
    },

    async findById(id) {
      const rows = await sql<Row[]>`
        select id, created_at, last_seen_at
        from voters
        where id = ${id}
      `;
      const row = rows[0];
      return row ? toVoter(row) : null;
    },

    async touch(id) {
      try {
        await sql`update voters set last_seen_at = now() where id = ${id}`;
      } catch (error) {
        // Best effort by contract: a stale last_seen_at is harmless, a failed vote is not.
        console.warn('Failed to refresh voter last_seen_at; continuing.', error);
      }
    },
  };
}

export function createBallotRepository(sql: Sql): BallotRepository {
  return {
    async insert(ballot) {
      try {
        return await sql.begin<BallotInsertOutcome>(async (tx) => {
          const ballotRows = await tx<Row[]>`
            insert into ballots (group_id, voter_id)
            values (${ballot.groupId}, ${ballot.voterId})
            returning id, group_id, voter_id, cast_at
          `;
          const ballotRow = ballotRows[0];
          if (!ballotRow) throw new Error('Insert of ballot returned no row.');
          const ballotId = str(ballotRow, 'id');

          await tx`
            insert into ballot_entries ${tx(
              ballot.ordering.map((entry) => ({
                ballot_id: ballotId,
                pair_id: entry.pairId,
                position: entry.position,
              })),
            )}
          `;

          return { kind: 'inserted', ballot: toBallot(ballotRow, ballot.ordering) };
        });
      } catch (error) {
        if (isDuplicateBallot(error)) return { kind: 'already-voted' };
        throw error;
      }
    },

    async findOwn(groupId, voterId) {
      const ballotRows = await sql<Row[]>`
        select id, group_id, voter_id, cast_at
        from ballots
        where group_id = ${groupId} and voter_id = ${voterId}
      `;
      const ballotRow = ballotRows[0];
      if (!ballotRow) return null;

      const entryRows = await sql<Row[]>`
        select pair_id, position
        from ballot_entries
        where ballot_id = ${str(ballotRow, 'id')}
        order by position
      `;
      return toBallot(ballotRow, entryRows.map(toBallotEntry));
    },

    async votedGroupIds(groupIds, voterId) {
      const voted = new Set<GroupId>();
      if (groupIds.length === 0) return voted;

      const rows = await sql<Row[]>`
        select group_id
        from ballots
        where voter_id = ${voterId}
          and group_id = any(${sql.array([...groupIds])}::uuid[])
      `;
      for (const row of rows) voted.add(str(row, 'group_id') as GroupId);
      return voted;
    },
  };
}
