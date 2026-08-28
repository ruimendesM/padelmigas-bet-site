import { defineWorkspace } from 'vitest/config';

/**
 * Two projects, two gates (ADR-009):
 *  - `unit`    — pure modules, no I/O. Carries the 100% branch threshold on the core rules.
 *  - `contract`— every /api/v1 route against a scratch Postgres, success shape + each failure code.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/src/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
      environment: 'node',
      globals: false,
    },
  },
  {
    test: {
      name: 'contract',
      include: ['tests/contract/**/*.test.ts'],
      environment: 'node',
      globals: false,
      setupFiles: ['tests/contract/setup.ts'],
      // Contract tests share one scratch database and truncate between tests, so they must not run
      // concurrently with each other. This setting covers tests within a file; ACROSS files it is
      // `--no-file-parallelism` on the `test:contract` script that does it, because a workspace
      // project does not honour `fileParallelism` here. Without it, two files truncate each other's
      // rows mid-test and every suite passes alone while the suite as a whole fails.
      sequence: { concurrent: false },
      maxConcurrency: 1,
      poolOptions: { threads: { singleThread: true } },
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  },
]);
