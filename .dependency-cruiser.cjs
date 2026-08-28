/**
 * Import-boundary gate — the machine-checkable half of Constitution Principle II.
 *
 * Convention does not survive a busy week; these rules run in CI (`pnpm boundaries`) and a
 * meta-test in `tests/architecture/boundaries.test.ts` asserts they actually fail on a
 * deliberate violation.
 */

/**
 * Matches an external package by name, whichever form dependency-cruiser reports.
 *
 * A bare specifier appears as its own name when it cannot be resolved from the importing package
 * (the common case for a framework a portable package must not depend on), and as a
 * `node_modules/...` path when it happens to be installed somewhere reachable — for example a root
 * devDependency under pnpm. Matching only one form silently disables the rule in the other case,
 * which is exactly the hole the meta-test caught.
 */
function externalPackages(...names) {
  const alternatives = names
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .map((escaped) => `(?:^${escaped}(?:/|$))|(?:(?:^|/)node_modules/${escaped}/)`)
    .join('|');
  return alternatives;
}

module.exports = {
  forbidden: [
    {
      name: 'core-no-framework',
      comment:
        'packages/core is the portable domain: it must not import a host framework or UI runtime (Principle II).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        path: externalPackages('next', 'react', 'react-dom', 'react-native', 'expo'),
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'core-no-vendor-sdk',
      comment:
        'packages/core must not import a vendor SDK or a database driver; data access is expressed as repository interfaces in core/ports (Principle II).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: externalPackages('@supabase/supabase-js', 'postgres', 'pg') },
    },
    {
      name: 'core-no-node-builtins',
      comment:
        'packages/core may use `crypto` and nothing else from Node — it has to run unchanged on React Native (Principle II).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        dependencyTypes: ['core'],
        pathNot: '^(crypto|node:crypto)$',
      },
    },
    {
      name: 'core-no-db',
      comment: 'packages/core defines the ports; packages/db implements them. Never the reverse.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(db|api|client|ui-logic)/' },
    },
    {
      name: 'packages-no-apps',
      comment: 'Nothing in packages/** may import from apps/** (Principle II).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-no-db',
      comment:
        'apps/web is a host, not the application: it reaches data only through packages/api handlers, never packages/db directly.',
      severity: 'error',
      from: { path: '^apps/web/', pathNot: '^apps/web/src/server/deps\\.ts$' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'no-db-client-outside-db',
      comment:
        'packages/db is the only module allowed to construct a database client (Principle II, ADR-003 amendment). Covers the Postgres driver and any Supabase SDK.',
      severity: 'error',
      from: { pathNot: '^(packages/db/|scripts/|tests/(contract|factories)/)' },
      to: { path: externalPackages('@supabase/supabase-js', 'postgres', 'pg') },
    },
    {
      name: 'contracts-standalone',
      comment:
        'packages/contracts is the contract spine and must depend on nothing but Zod. Its own files may import each other.',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: {
        path: `^packages/|^apps/|${externalPackages('next', 'react', 'react-dom', 'react-native', 'expo')}`,
        pathNot: '^packages/contracts/',
      },
    },
    {
      name: 'ui-logic-no-dom',
      comment:
        'packages/ui-logic is shared with a future React Native client: no DOM, no platform renderer (Principle II).',
      severity: 'error',
      from: { path: '^packages/ui-logic/' },
      to: { path: externalPackages('react-dom', 'next', 'expo', 'react-native') },
    },
    {
      name: 'ui-logic-client-only',
      comment: 'packages/ui-logic talks to the API through the generated client, never a handler.',
      severity: 'error',
      from: { path: '^packages/ui-logic/' },
      to: { path: '^packages/(api|db)/' },
    },
    {
      name: 'client-fetch-only',
      comment:
        'packages/client is a generated fetch client and must import no other workspace package.',
      severity: 'error',
      from: { path: '^packages/client/' },
      to: { path: '^packages/(core|api|db|ui-logic)/' },
    },
    {
      name: 'api-no-framework',
      comment:
        'packages/api handlers are (input, deps) => output — no host framework (Principle II).',
      severity: 'error',
      from: { path: '^packages/api/' },
      to: { path: externalPackages('next', 'react', 'react-dom', 'react-native', 'expo') },
    },
    {
      name: 'api-no-db-impl',
      comment:
        'packages/api depends on the ports in packages/core, not on their Supabase implementations.',
      severity: 'error',
      from: { path: '^packages/api/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'An unresolvable import is invisible to every other rule here, so a boundary violation could hide behind a typo. Fail on it instead.',
      severity: 'error',
      // `next-env.d.ts` is generated by Next and references a types-only path that exists only
      // inside the framework's own type graph. It is not application code.
      from: { pathNot: '(^|/)next-env\\.d\\.ts$' },
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(index|types)\\.ts$',
          '^apps/web/app/',
          '^apps/web/tests/',
          '^tests/',
          '^scripts/',
          // Tool configs are entry points for their own tools, not orphans.
          '(^|/)(next|tailwind|postcss|playwright|vitest)\\.config\\.(ts|mjs|js)$',
          '(^|/)vitest\\.workspace\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    // `doNotFollow` stops the crawl at a package boundary without removing the edge that reaches it.
    // `exclude` must NOT list node_modules: excluding it deletes every external dependency from the
    // graph, which silently disables every rule about `next`, `react`, `postgres` and `@supabase/*`
    // — the exact rules Principle II depends on. The meta-test in tests/architecture caught this.
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '\\.test\\.tsx?$',
        '^apps/web/tests/',
        '^apps/web/\\.next/',
        'dist/',
        'coverage/',
        // The k6 load test runs in k6's own runtime, not Node: its `k6/*` imports are provided by
        // the host and are unresolvable here by design. It is not part of the application graph.
        '^tools/loadtest/',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
