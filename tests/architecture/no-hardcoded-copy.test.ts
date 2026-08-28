import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No visible string is written inline in a component (constitution: Locale & time).
 *
 * pt-PT is the product's language and `apps/web/src/i18n` is its only source. A string typed
 * straight into JSX is invisible to the English catalogue and to anyone reviewing the copy, so this
 * test looks for the two places one hides: text between tags, and a user-facing attribute.
 *
 * Written as a test rather than a review habit because copy drifts in exactly the commits nobody
 * reads closely (T092).
 */

const ROOTS = ['apps/web/app', 'apps/web/components'];

/** Attributes a screen reader or a tooltip would speak. */
const USER_FACING_ATTRIBUTES = /(?:aria-label|aria-description|placeholder|title|alt)="([^"]+)"/g;
/** Text sitting directly between two tags, e.g. `<p>Olá</p>`. */
const TEXT_BETWEEN_TAGS = />\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ ,.!?:-]{3,})\s*</g;

function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...tsxFiles(path));
    else if (entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

describe('visible copy comes from the message catalogue', () => {
  const files = ROOTS.flatMap((root) => tsxFiles(join(process.cwd(), root)));

  it('finds components to check, so a path change cannot make this test vacuous', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('has no hard-coded text between tags', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(TEXT_BETWEEN_TAGS)) {
        offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no hard-coded user-facing attribute', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(USER_FACING_ATTRIBUTES)) {
        offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
