/**
 * Public surface of @padelmigas/core — the portable domain.
 *
 * Nothing here imports a host framework, a UI runtime, or a vendor SDK; `.dependency-cruiser.cjs`
 * enforces that in CI (Principle II).
 */
export * from './domain/index.js';
export * from './errors.js';
export * from './ports/index.js';
export * from './matching/index.js';
export * from './lineup/index.js';
export * from './lineup-extraction/index.js';
export * from './rankings/parse.js';
export * from './window/index.js';
export * from './ballot/index.js';
export * from './scoring/index.js';
export * from './reveal/index.js';
