import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  /**
   * The VPS runs the server from a traced bundle rather than from an installed workspace
   * (ADR-010 § Amendment). `outputFileTracingRoot` must name the monorepo root: pnpm links
   * workspace dependencies through symlinks, and tracing from `apps/web` alone follows those
   * links out of the traced tree, producing a bundle that builds cleanly and then fails at
   * process start with a missing module.
   */
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  poweredByHeader: false,
  // The portable packages are consumed from source; Next compiles them with the app.
  transpilePackages: [
    '@padelmigas/api',
    '@padelmigas/client',
    '@padelmigas/contracts',
    '@padelmigas/core',
    '@padelmigas/db',
    '@padelmigas/ui-logic',
  ],
  // @node-rs/argon2 is a native addon and must not be bundled into the server chunk.
  serverExternalPackages: ['@node-rs/argon2'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },

  /**
   * Resolve ESM-style `.js` specifiers to the `.ts` sources they name.
   *
   * Every workspace package is `"type": "module"` and imports its siblings with the extension the
   * ES module spec requires (`./format.js`), while the file on disk is `./format.ts`. TypeScript and
   * Vitest understand that mapping natively; webpack does not, and without this the whole app fails
   * to compile even though typecheck, lint and both test suites pass.
   */
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return webpackConfig;
  },
};

export default config;
