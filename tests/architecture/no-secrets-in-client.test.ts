import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No server secret is reachable from a client bundle (FR-022, T101).
 *
 * Two halves, because they fail differently:
 *  1. No server-only variable is read from a module that could be bundled into a client component.
 *     `apps/web/src/env.ts` is the only reader, and it is imported only by server modules.
 *  2. No variable is prefixed `NEXT_PUBLIC_`. That prefix is the mechanism by which a value reaches
 *     the browser, and this product has no value that should.
 *
 * The build output itself is checked in the security review (`docs/security/001-review.md`); this
 * test is the cheap version that runs on every commit.
 */

const SERVER_ONLY = [
  'DATABASE_URL',
  'CRON_SECRET',
  'ADMIN_PASSWORD_HASH',
  'VOTER_COOKIE_SECRET',
  'RATE_LIMIT_SALT',
  'RANKINGS_CSV_URL',
];

/** The one module allowed to read them, plus the config files that declare them. */
const ALLOWED = [join('apps', 'web', 'src', 'env.ts'), join('apps', 'web', 'next.config.ts')];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('server secrets stay on the server', () => {
  const files = [
    ...sourceFiles(join(process.cwd(), 'apps', 'web', 'app')),
    ...sourceFiles(join(process.cwd(), 'apps', 'web', 'src')),
    ...sourceFiles(join(process.cwd(), 'apps', 'web', 'components')),
  ];

  it('finds files to check, so a path change cannot make this test vacuous', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('reads server-only variables from apps/web/src/env.ts alone', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.some((allowed) => file.includes(allowed))) continue;
      const source = readFileSync(file, 'utf8');
      for (const name of SERVER_ONLY) {
        if (source.includes(`process.env.${name}`) || source.includes(`process.env['${name}']`)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no NEXT_PUBLIC_ variable anywhere', () => {
    const offenders = files.filter((file) =>
      /process\.env\.NEXT_PUBLIC_/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
