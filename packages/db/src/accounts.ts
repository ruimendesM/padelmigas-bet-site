import type { BallotId, GroupId, VoterId } from '@padelmigas/contracts/common';
import {
  isVotingOpen,
  planDeviceMerge,
  type AccountCreateOutcome,
  type AccountRepository,
} from '@padelmigas/core';
import type { Sql } from './client.js';
import { str, toAccount, toTournament, type Row } from './mappers.js';

/**
 * Optional voter accounts (feature 004, ADR-012).
 *
 * Three properties are enforced here rather than hoped for:
 *  - **The hash stays in this file's reads that ask for it** (FR-306): `ACCOUNT_COLUMNS` omits it, and
 *    only the two `findCredentials*` reads select it.
 *  - **An owned voter is never adopted or merged by another account** (FR-313): both `create` and
 *    `mergeDeviceVoter` re-check ownership under a row lock on the voter.
 *  - **A merge is all-or-nothing** (FR-312): one transaction; a concurrent ballot that would make the
 *    move violate `UNIQUE (group_id, voter_id)` aborts the whole sign-in.
 */

const ACCOUNT_COLUMNS = `
  id, username, voter_id, session_version, temporary_password_expires_at, created_at
`;

const UNIQUE_VIOLATION = '23505';

function isUsernameTaken(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint_name?: unknown };
  return (
    candidate.code === UNIQUE_VIOLATION &&
    typeof candidate.constraint_name === 'string' &&
    candidate.constraint_name.includes('username')
  );
}

/** `%`, `_` and `\` are LIKE metacharacters; a username can contain `_`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function first(rows: readonly Row[]): Row | undefined {
  return rows[0];
}

export function createAccountRepository(sql: Sql): AccountRepository {
  return {
    async create(input) {
      try {
        return await sql.begin<AccountCreateOutcome>(async (tx) => {
          let voterId: VoterId | null = null;

          if (input.adoptVoterId !== null) {
            // FOR UPDATE on the voter: two registrations racing to adopt the same device voter must
            // not both see it unowned. The loser mints a fresh voter instead.
            const candidate = await tx<Row[]>`
              select v.id
              from voters v
              where v.id = ${input.adoptVoterId}
                and not exists (select 1 from accounts a where a.voter_id = v.id)
              for update of v
            `;
            const row = first(candidate);
            if (row) voterId = str(row, 'id') as VoterId;
          }

          if (voterId === null) {
            const minted = await tx<Row[]>`insert into voters default values returning id`;
            const row = first(minted);
            if (!row) throw new Error('Insert of voter returned no row.');
            voterId = str(row, 'id') as VoterId;
          }

          const rows = await tx<Row[]>`
            insert into accounts (username, password_hash, voter_id)
            values (${input.username}, ${input.passwordHash}, ${voterId})
            returning ${tx.unsafe(ACCOUNT_COLUMNS)}
          `;
          const row = first(rows);
          if (!row) throw new Error('Insert of account returned no row.');
          return { kind: 'created', account: toAccount(row) };
        });
      } catch (error) {
        if (isUsernameTaken(error)) return { kind: 'username-taken' };
        throw error;
      }
    },

    async findById(id) {
      const row = first(
        await sql<Row[]>`select ${sql.unsafe(ACCOUNT_COLUMNS)} from accounts where id = ${id}`,
      );
      return row ? toAccount(row) : null;
    },

    async findCredentialsById(id) {
      const row = first(
        await sql<Row[]>`
          select ${sql.unsafe(ACCOUNT_COLUMNS)}, password_hash from accounts where id = ${id}
        `,
      );
      return row ? { account: toAccount(row), passwordHash: str(row, 'password_hash') } : null;
    },

    async findCredentialsByUsername(username) {
      const row = first(
        await sql<Row[]>`
          select ${sql.unsafe(ACCOUNT_COLUMNS)}, password_hash
          from accounts
          where username = ${username}
        `,
      );
      return row ? { account: toAccount(row), passwordHash: str(row, 'password_hash') } : null;
    },

    async search(query, limit) {
      const pattern = `%${escapeLike(query.toLowerCase())}%`;
      const rows = await sql<Row[]>`
        select ${sql.unsafe(ACCOUNT_COLUMNS)}
        from accounts
        where username like ${pattern}
        order by created_at desc, username
        limit ${limit}
      `;
      return rows.map(toAccount);
    },

    async setPassword(id, passwordHash, now) {
      const row = first(
        await sql<Row[]>`
          update accounts
          set password_hash = ${passwordHash},
              temporary_password_expires_at = null,
              session_version = session_version + 1,
              password_changed_at = ${now}
          where id = ${id}
          returning ${sql.unsafe(ACCOUNT_COLUMNS)}
        `,
      );
      if (!row) throw new Error(`Account ${id} vanished during a password change.`);
      return toAccount(row);
    },

    async resetPassword(id, temporaryPasswordHash, expiresAt, now) {
      const row = first(
        await sql<Row[]>`
          update accounts
          set password_hash = ${temporaryPasswordHash},
              temporary_password_expires_at = ${expiresAt},
              session_version = session_version + 1,
              password_changed_at = ${now}
          where id = ${id}
          returning ${sql.unsafe(ACCOUNT_COLUMNS)}
        `,
      );
      return row ? toAccount(row) : null;
    },

    async mergeDeviceVoter({ accountVoterId, deviceVoterId, now }) {
      if (accountVoterId === deviceVoterId) return { moved: 0, discarded: 0, left: 0 };

      return sql.begin(async (tx) => {
        // Lock both voters in a fixed order so two merges touching the same pair cannot deadlock.
        const locked = await tx<Row[]>`
          select v.id,
                 exists (select 1 from accounts a where a.voter_id = v.id) as owned
          from voters v
          where v.id in (${accountVoterId}, ${deviceVoterId})
          order by v.id
          for update of v
        `;
        const device = locked.find((row) => str(row, 'id') === deviceVoterId);
        if (!device || device['owned'] === true) return { moved: 0, discarded: 0, left: 0 };

        const deviceRows = await tx<Row[]>`
          select b.id as ballot_id, b.group_id,
                 t.id, t.name, t.slug, t.starts_at, t.published_at, t.invalidated_at,
                 t.replaced_by_id
          from ballots b
          join groups g on g.id = b.group_id
          join tournaments t on t.id = g.tournament_id
          where b.voter_id = ${deviceVoterId}
          for update of b
        `;
        if (deviceRows.length === 0) return { moved: 0, discarded: 0, left: 0 };

        const accountRows = await tx<Row[]>`
          select group_id from ballots where voter_id = ${accountVoterId}
        `;
        const accountGroupIds = new Set(accountRows.map((row) => str(row, 'group_id') as GroupId));

        const plan = planDeviceMerge(
          deviceRows.map((row) => ({
            ballotId: str(row, 'ballot_id') as BallotId,
            groupId: str(row, 'group_id') as GroupId,
            votingOpen: isVotingOpen(toTournament(row), now),
          })),
          accountGroupIds,
        );

        if (plan.move.length > 0) {
          await tx`
            update ballots set voter_id = ${accountVoterId}
            where id = any(${tx.array([...plan.move])}::uuid[])
          `;
        }
        if (plan.discard.length > 0) {
          // Entries cascade (ballot_entries.ballot_id … on delete cascade).
          await tx`delete from ballots where id = any(${tx.array([...plan.discard])}::uuid[])`;
        }

        return { moved: plan.move.length, discarded: plan.discard.length, left: plan.leave.length };
      });
    },
  };
}
