import { defineConfig } from 'vitest/config';

/**
 * Coverage is deliberately scoped. The constitution requires 100% branch coverage on the four
 * modules where a wrong answer is a product defect the user can see, and sets no floor anywhere
 * else (ADR-009). Widening `include` here would be a silent policy change.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'packages/core/src/scoring/**/*.ts',
        'packages/core/src/ballot/**/*.ts',
        'packages/core/src/window/**/*.ts',
        'packages/core/src/matching/**/*.ts',
        // Added for feature 002: a misread the flags fail to mark reaches a public page looking
        // correct, which is the same class of user-visible defect as the four modules above.
        'packages/core/src/lineup-extraction/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts.map'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
