/**
 * Migration rollback lint (constitution: Quality Gates).
 *
 * "every migration MUST be applied against a scratch database in CI and MUST be accompanied by the
 * rollback statement or an explicit note that it is irreversible."
 *
 * This script enforces the second half: every file in supabase/migrations/ must contain either a
 * `-- rollback:` block or an `-- irreversible:` note explaining why it has none. CI runs the first
 * half by applying the migrations for real.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const ROLLBACK_MARKER = /^--\s*rollback:/im;
const IRREVERSIBLE_MARKER = /^--\s*irreversible:\s*\S+/im;

function main(): void {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error('No migrations found. Expected at least the initial schema migration.');
    process.exit(1);
  }

  const failures: string[] = [];

  for (const file of files.sort()) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const hasRollback = ROLLBACK_MARKER.test(body);
    const hasIrreversibleNote = IRREVERSIBLE_MARKER.test(body);

    if (!hasRollback && !hasIrreversibleNote) {
      failures.push(
        `${file}: no "-- rollback:" block and no "-- irreversible: <reason>" note. ` +
          'Add the rollback statements, or state why the change cannot be reversed.',
      );
      continue;
    }

    if (hasRollback) {
      // A rollback marker with nothing after it is worse than none: it reads as done.
      const afterMarker = body.slice(body.search(ROLLBACK_MARKER));
      const statements = afterMarker
        .split('\n')
        .slice(1)
        .map((line) => line.replace(/^--\s?/, '').trim())
        .filter((line) => line.length > 0);

      if (statements.length === 0) {
        failures.push(`${file}: "-- rollback:" block is empty.`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Migration rollback lint failed:\n');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }

  console.log(`Migration rollback lint passed for ${files.length} migration(s).`);
}

main();
