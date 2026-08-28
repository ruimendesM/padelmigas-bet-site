import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Meta-test for the import-boundary gate.
 *
 * `pnpm boundaries` passing proves nothing on its own — a misconfigured rule set passes everything.
 * These tests plant a deliberate violation and assert the gate rejects it, so Constitution
 * Principle II is enforced by something that has itself been tested (SC-010).
 *
 * Each case writes a temporary file, runs dependency-cruiser over the affected package, and deletes
 * the file. A failure to delete would leave the repository broken, so cleanup is in `afterEach`.
 */

const ROOT = process.cwd();
const CONFIG = join(ROOT, '.dependency-cruiser.cjs');

interface CruiseResult {
  readonly exitCode: number;
  readonly output: string;
}

function cruise(...targets: string[]): CruiseResult {
  try {
    const output = execFileSync(
      'node',
      [
        join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs'),
        '--config',
        CONFIG,
        '--output-type',
        'err',
        ...targets,
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { exitCode: 0, output };
  } catch (error) {
    const shaped = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: shaped.status ?? 1,
      output: `${shaped.stdout ?? ''}${shaped.stderr ?? ''}`,
    };
  }
}

const planted: string[] = [];

function plant(relativePath: string, source: string): void {
  const absolute = join(ROOT, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, source, 'utf8');
  planted.push(absolute);
}

afterEach(() => {
  while (planted.length > 0) {
    const file = planted.pop();
    if (file) rmSync(file, { force: true });
  }
});

describe('the boundary gate rejects what Principle II forbids', () => {
  it('passes on the real tree', () => {
    const result = cruise('packages', 'apps', 'tools');
    expect(result.output).not.toMatch(/\berror\b/);
    expect(result.exitCode).toBe(0);
  });

  it('rejects a framework import inside packages/core', () => {
    plant(
      'packages/core/src/__boundary_probe__.ts',
      [
        '// Planted by tests/architecture/boundaries.test.ts. Deleted after the assertion.',
        "import { NextResponse } from 'next/server';",
        'export const probe = NextResponse;',
      ].join('\n'),
    );

    const result = cruise('packages/core');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('core-no-framework');
  });

  it('rejects a database client constructed outside packages/db', () => {
    plant(
      'packages/api/src/__boundary_probe__.ts',
      [
        '// Planted by tests/architecture/boundaries.test.ts. Deleted after the assertion.',
        "import postgres from 'postgres';",
        'export const probe = postgres;',
      ].join('\n'),
    );

    const result = cruise('packages/api');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('no-db-client-outside-db');
  });

  it('rejects apps/web reaching past the handlers into packages/db', () => {
    plant(
      'apps/web/app/__boundary_probe__.ts',
      [
        '// Planted by tests/architecture/boundaries.test.ts. Deleted after the assertion.',
        "import { createSql } from '@padelmigas/db';",
        'export const probe = createSql;',
      ].join('\n'),
    );

    const result = cruise('apps/web');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('web-no-db');
  });

  it('rejects a packages/** module importing from apps/**', () => {
    plant(
      'packages/core/src/__boundary_probe__.ts',
      [
        '// Planted by tests/architecture/boundaries.test.ts. Deleted after the assertion.',
        "import { serverEnv } from '../../../apps/web/src/env.js';",
        'export const probe = serverEnv;',
      ].join('\n'),
    );

    const result = cruise('packages/core');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('packages-no-apps');
  });

  it('rejects packages/ui-logic importing a handler instead of the generated client', () => {
    plant(
      'packages/ui-logic/src/__boundary_probe__.ts',
      [
        '// Planted by tests/architecture/boundaries.test.ts. Deleted after the assertion.',
        "import type { Deps } from '@padelmigas/api';",
        'export type Probe = Deps;',
      ].join('\n'),
    );

    const result = cruise('packages/ui-logic');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('ui-logic-client-only');
  });
});

describe('apps/web reaches the API only through the generated client', () => {
  it('has no hand-rolled fetch to /api/v1 outside packages/client', () => {
    // The constitution forbids hand-rolled fetch calls and hard-coded URLs outside the generated
    // client (Principle III). grep is the right tool: this is a textual property, not a graph one.
    //
    // Scoped to `/api/v1/` — the versioned product API — rather than all of `/api/`. The one route
    // outside it is `POST /api/admin/session`, the organiser sign-in: it is host plumbing that
    // exchanges a password for a cookie, not a product endpoint, so it is deliberately absent from
    // `packages/contracts/src/endpoints.ts` and therefore from the generated client (ADR-002).
    // Matching bare `/api/` flagged it and made this assertion stricter than both its own name and
    // the design it is guarding.
    //
    // NOTE: `git grep` searches tracked files only. This assertion is therefore vacuous for any file
    // that has not been committed — which is exactly why it went green through the whole of
    // phases 1-7, when the tree was still untracked, and only started reporting on 2026-08-28.
    let matches = '';
    try {
      matches = execFileSync(
        'git',
        ['grep', '-n', '-E', 'fetch\\([\'"`]/api/v1/', '--', 'apps/', 'packages/'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    } catch {
      // `git grep` exits 1 when nothing matches. That is the passing case.
      matches = '';
    }
    expect(matches).toBe('');
  });
});
