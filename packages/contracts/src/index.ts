/**
 * Public surface of @padelmigas/contracts — the single source of truth for the HTTP contract.
 *
 * These Zod schemas generate both `packages/client` and the committed OpenAPI document
 * (constitution, Principle III). This package depends on Zod and nothing else, so a future React
 * Native client and a standalone API service consume it unchanged.
 */
export * from './common.js';
export * from './tournaments.js';
export * from './results.js';
export * from './ballots.js';
export * from './players.js';
export * from './endpoints.js';
