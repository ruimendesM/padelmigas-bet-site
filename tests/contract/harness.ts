import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';
import type { Deps } from '@padelmigas/api';
import { createRepositories, createSql, fixedClock, type Sql } from '@padelmigas/db';
import type { Clock } from '@padelmigas/core';

/**
 * Contract-test harness.
 *
 * The constitution requires "a test asserting its documented success shape and its documented
 * failure shapes" for every `/api/v1` route. To be worth anything those tests must go through the
 * real route file, the real handler, the real repository and real SQL — a fake repository would pass
 * while the query was wrong, which is the failure mode contract tests exist to catch.
 *
 * So: one scratch Postgres, truncated between tests, with `apps/web`'s dependency container pointed
 * at it. The only thing stubbed is the clock, because the voting-window tests need to stand at a
 * chosen instant (SC-007), and the ranking source, because a test must not fetch the real sheet.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** Every table, child-first, so one TRUNCATE ... CASCADE is not needed and FK order is explicit. */
const TABLES_CHILD_FIRST = [
  'group_final_standings',
  'ballot_entries',
  'ballots',
  'voters',
  'pairs',
  'groups',
  'tournaments',
  'player_ratings',
  'players',
  'ranking_snapshots',
] as const;

let sharedSql: Sql | undefined;

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Contract tests need a scratch Postgres.\n' +
        'See .env.example, then run `pnpm db:apply`.',
    );
  }
  return url;
}

export function sql(): Sql {
  sharedSql ??= createSql({ connectionString: testDatabaseUrl(), max: 2 });
  return sharedSql;
}

/** Applies every migration. Called once per suite run from `setup.ts`. */
export async function applyMigrations(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = sql();
  for (const file of files) {
    await client.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

/** True when the schema is already present, so a suite run does not re-apply it needlessly. */
export async function schemaExists(): Promise<boolean> {
  const rows = await sql()<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ballots'
    ) as exists
  `;
  return rows[0]?.exists === true;
}

/**
 * Empties every table.
 *
 * `RESTART IDENTITY` is not needed (all keys are uuids) but `CASCADE` is deliberately absent: naming
 * the tables child-first means a new table with a foreign key fails loudly here rather than being
 * silently truncated in the wrong order.
 */
export async function truncateAll(): Promise<void> {
  const client = sql();
  await client.unsafe(`truncate table ${TABLES_CHILD_FIRST.join(', ')}`);
}

export interface FakeRankingSource {
  /** Set to make `fetchLatest` succeed with this CSV. */
  csv: string | null;
  /** Set to make `fetchLatest` throw, exercising the staleness fallback (Risk R3). */
  failure: Error | null;
  fetchedAt: Date;
  /** How many times the source was asked, so a test can assert the fallback avoided a second call. */
  fetchCount: number;
}

export interface TestDeps {
  readonly deps: Deps;
  /** Advance or freeze test time; the window tests stand exactly at the boundary instant. */
  setNow(instant: Date): void;
  now(): Date;
  readonly ranking: FakeRankingSource;
}

/**
 * Builds a dependency container against the scratch database.
 *
 * The clock is mutable so a single test can cross the voting deadline without waiting for it, and the
 * ranking source is a fake so no test reaches the public sheet — both are the seams the ports were
 * declared for (`Clock`, `RankingSource`).
 */
export function createTestDeps(options: { now?: Date } = {}): TestDeps {
  let current = options.now ?? new Date('2026-09-01T12:00:00.000Z');
  const clock: Clock = { now: () => new Date(current.getTime()) };

  const ranking: FakeRankingSource = {
    csv: null,
    failure: null,
    fetchedAt: new Date(current.getTime()),
    fetchCount: 0,
  };

  const client = sql();
  const base = createRepositories(client, {
    rankingsCsvUrl: 'http://ranking.invalid/never-fetched.csv',
    clock,
  });

  const deps: Deps = {
    ...base,
    rankings: {
      async fetchLatest() {
        ranking.fetchCount += 1;
        if (ranking.failure) throw ranking.failure;
        if (ranking.csv === null) {
          throw new Error('Test ranking source has no CSV configured.');
        }
        return { csv: ranking.csv, fetchedAt: ranking.fetchedAt };
      },
      storeSnapshot: base.rankings.storeSnapshot,
      lastSnapshot: base.rankings.lastSnapshot,
    },
  };

  return {
    deps,
    setNow(instant) {
      current = instant;
    },
    now: () => new Date(current.getTime()),
    ranking,
  };
}

/** A clock frozen at an instant, re-exported so tests do not import `packages/db` for one helper. */
export { fixedClock };

export async function closeHarness(): Promise<void> {
  if (!sharedSql) return;
  const client = sharedSql;
  sharedSql = undefined;
  await client.end({ timeout: 5 });
}

/** Direct driver access for assertions that must look past the API — e.g. "nothing was persisted". */
export function rawSql(): postgres.Sql<Record<string, never>> {
  return sql();
}
