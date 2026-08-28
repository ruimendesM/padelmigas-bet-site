/**
 * Proves every migration's rollback block is executable SQL, not an aspirational comment.
 *
 * `check-migration-rollback.ts` asserts a rollback block is *present*. This asserts it *works*:
 * against a scratch database with all migrations applied, it runs each rollback in reverse order,
 * checks the public schema came back empty, then re-applies the migrations so the database is ready
 * for the contract suite.
 *
 * Together the two satisfy the constitution's migration gate: "every migration MUST be applied
 * against a scratch database in CI and MUST be accompanied by the rollback statement or an explicit
 * note that it is irreversible."
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const ROLLBACK_MARKER = /^--\s*rollback:/im;

type Migration = { file: string; up: string; down: string };

function readMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const idx = body.search(ROLLBACK_MARKER);
      const down =
        idx === -1
          ? ''
          : body
              .slice(idx)
              .split('\n')
              .slice(1)
              // The block is stored commented out so `db push` never runs it. Strip one comment
              // level; SQL comments intended to survive are written with a second `--`.
              .map((line) => line.replace(/^--\s?/, ''))
              .join('\n');
      return { file, up: body, down };
    });
}

async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error('TEST_DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }

  const migrations = readMigrations();
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // Down, newest first.
    for (const { file, down } of [...migrations].reverse()) {
      if (!down.trim()) {
        console.log(`  ${file}: irreversible by declaration, skipped`);
        continue;
      }
      await sql.unsafe(down);
      console.log(`  rolled back ${file}`);
    }

    const leftovers = await sql<{ name: string }[]>`
      select table_name as name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;
    if (leftovers.length > 0) {
      console.error(
        `Rollback left objects behind in the public schema: ${leftovers.map((r) => r.name).join(', ')}`,
      );
      process.exit(1);
    }

    // Up again, so the database is usable by whatever runs next.
    for (const { file, up } of migrations) {
      await sql.unsafe(up);
      console.log(`  re-applied ${file}`);
    }

    console.log(
      `Rollback verification passed: ${migrations.length} migration(s) reverse cleanly and re-apply.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Rollback verification failed:', error);
  process.exit(1);
});
