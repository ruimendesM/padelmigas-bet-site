/**
 * Applies every file in supabase/migrations/ in order against TEST_DATABASE_URL.
 *
 * Used by CI to satisfy the constitution's migration gate ("every migration MUST be applied against
 * a scratch database in CI") and locally to prepare the contract-test database. This is deliberately
 * not the production path — that is `supabase db push`, which tracks applied migrations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error('TEST_DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // A scratch database starts clean every run, so ordering is the only requirement.
    for (const file of files) {
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // The rollback block is commented-out SQL; it is never executed here.
      await sql.unsafe(body);
      console.log(`  applied ${file}`);
    }
    console.log(`Applied ${files.length} migration(s) to the scratch database.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Migration application failed:', error);
  process.exit(1);
});
