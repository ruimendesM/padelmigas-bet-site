import type { Deps } from '@padelmigas/api';
import { createRepositories, getSql } from '@padelmigas/db';
import { serverEnv } from '../env.js';

/**
 * The ONLY module in `apps/web` permitted to import `packages/db`.
 *
 * `.dependency-cruiser.cjs` rule `web-no-db` names this file as its single exception, so a page or a
 * route that reaches for a repository directly fails CI rather than review (Principle II). Everything
 * else in the host receives capabilities as `Deps` and cannot tell which store is behind them.
 */

let cached: Deps | undefined;

/**
 * Assembles dependencies once per process.
 *
 * Cached because a serverless instance is reused across invocations; rebuilding the pool per request
 * is the fastest route to the connection ceiling (Risk R8). `serverEnv()` throws here if the
 * configuration is incomplete, which is the intended fail-fast behaviour — a request served with a
 * missing secret is worse than a 500.
 */
export function getDeps(): Deps {
  if (cached) return cached;

  const env = serverEnv();
  const sql = getSql({ connectionString: env.DATABASE_URL });

  cached = createRepositories(sql, { rankingsCsvUrl: env.RANKINGS_CSV_URL });
  return cached;
}

/** Test seam: lets a suite install fakes or a scratch-database assembly. */
export function setDeps(deps: Deps): void {
  cached = deps;
}

/** Test seam: forces the next `getDeps()` to rebuild. */
export function resetDeps(): void {
  cached = undefined;
}
