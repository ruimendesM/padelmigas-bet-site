import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `group_final_standings` is reserved, not used (FR-026).
 *
 * The table exists so that recording real finishing positions later is a migration nobody has to
 * plan for. Until a spec asks for it, no code may read or write it: a half-used table accumulates
 * rows that no feature maintains, and the first feature that does use it inherits them.
 *
 * Asserted rather than agreed, because "we'll remember not to" is not a constraint (Principle V).
 */

const RESERVED_TABLE = 'group_final_standings';

/** Where the table is legitimately named: the migration that creates it, and the test plumbing. */
const ALLOWED = [
  join('supabase', 'migrations'),
  join('tests', 'contract', 'harness.ts'),
  join('tests', 'architecture', 'reserved-tables.test.ts'),
];

const SEARCHED = ['packages', 'apps', 'tools', 'scripts'];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx|sql)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('reserved tables are not referenced by application code', () => {
  it('finds files to check, so a path change cannot make this test vacuous', () => {
    const files = SEARCHED.flatMap((root) => sourceFiles(join(process.cwd(), root)));
    expect(files.length).toBeGreaterThan(20);
  });

  it(`no source file references ${RESERVED_TABLE}`, () => {
    const offenders = SEARCHED.flatMap((root) => sourceFiles(join(process.cwd(), root)))
      .filter((file) => !ALLOWED.some((allowed) => file.includes(allowed)))
      .filter((file) => readFileSync(file, 'utf8').includes(RESERVED_TABLE));

    expect(offenders).toEqual([]);
  });
});
