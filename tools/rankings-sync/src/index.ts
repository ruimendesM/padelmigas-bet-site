import type { Deps } from '@padelmigas/api';
import { syncRankings } from '@padelmigas/api';
import type { RankingsSyncResponse } from '@padelmigas/contracts';
import { createRepositories, getSql } from '@padelmigas/db';

/**
 * The rankings import as a runnable job (FR-004).
 *
 * The import *logic* is `syncRankings` in `packages/api` — the same function the HTTP route and the
 * scheduler call — so this tool cannot drift from what production does. What lives here is only the
 * part a CLI needs and a request does not: reading configuration from the environment and building a
 * dependency container without a web host.
 *
 * Two configuration values, no more:
 *  - `DATABASE_URL` — the pooler connection string (ADR-003 as amended, Risk R8).
 *  - `RANKINGS_CSV_URL` — the public sheet's CSV export (F1).
 */

export interface RankingsSyncConfig {
  readonly databaseUrl: string;
  readonly rankingsCsvUrl: string;
}

/** Reads configuration, failing loudly rather than importing against a half-configured target. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RankingsSyncConfig {
  const databaseUrl = env['DATABASE_URL'];
  const rankingsCsvUrl = env['RANKINGS_CSV_URL'];
  const missing = [
    databaseUrl ? null : 'DATABASE_URL',
    rankingsCsvUrl ? null : 'RANKINGS_CSV_URL',
  ].filter((name): name is string => name !== null);
  if (missing.length > 0 || !databaseUrl || !rankingsCsvUrl) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return { databaseUrl, rankingsCsvUrl };
}

export function buildDeps(config: RankingsSyncConfig): Deps {
  return createRepositories(getSql({ connectionString: config.databaseUrl }), {
    rankingsCsvUrl: config.rankingsCsvUrl,
  });
}

/** Runs the import against an already-assembled container. Kept separate so a test can pass fakes. */
export async function runRankingsSync(deps: Deps): Promise<RankingsSyncResponse> {
  return syncRankings(deps);
}
