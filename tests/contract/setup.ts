import { afterAll, beforeAll, beforeEach } from 'vitest';
import { applyMigrations, closeHarness, schemaExists, truncateAll } from './harness.js';

/**
 * Per-file setup for the contract suite.
 *
 * The schema is applied once if absent and the tables are truncated before every test, so each test
 * starts from an empty database and no test can depend on another's rows. Vitest runs this project
 * single-threaded (see `vitest.workspace.ts`) precisely so truncation is safe.
 *
 * The environment below exists so `apps/web/src/env.ts` validates rather than throwing on import.
 * Every value is obviously fake and valid nowhere: `DATABASE_URL` is the scratch database and the
 * secrets are literals. The organiser password hash is argon2id for the literal password in
 * `TEST_ADMIN_PASSWORD`, generated once for the suite.
 */

export const TEST_ADMIN_PASSWORD = 'contract-test-password';

/**
 * argon2id hash of TEST_ADMIN_PASSWORD, at the same parameters `admin-auth` uses.
 * Regenerate with: pnpm tsx scripts/hash-admin-password.ts contract-test-password
 */
export const TEST_ADMIN_PASSWORD_HASH =
  process.env.TEST_ADMIN_PASSWORD_HASH ??
  '$argon2id$v=19$m=19456,t=2,p=1$JlhDuVvtaZEBp6sRmx3z8Q$usfRrPa15R0qZtuVx4/0DXUjLCnOif0lUaJQPbBXPYk';

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.VOTER_COOKIE_SECRET ??= 'contract-test-voter-cookie-secret-not-a-real-key-0000';
process.env.ADMIN_PASSWORD_HASH ??= TEST_ADMIN_PASSWORD_HASH;
process.env.RANKINGS_CSV_URL ??= 'http://ranking.invalid/never-fetched.csv';
process.env.CRON_SECRET ??= 'contract-test-cron-secret-not-a-real-secret-000';
process.env.RATE_LIMIT_SALT ??= 'contract-test-rate-limit-salt';

beforeAll(async () => {
  if (!(await schemaExists())) {
    await applyMigrations();
  }
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeHarness();
});
