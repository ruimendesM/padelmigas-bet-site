/**
 * Public surface of @padelmigas/ui-logic — platform-free client logic shared with a future mobile
 * client (SC-010).
 *
 * Hooks, formatting and draft state only. No DOM, no renderer, no framework beyond React's hook
 * contract; `.dependency-cruiser.cjs` enforces it.
 */
export * from './format.js';
export * from './query.js';
export * from './ballot.js';
export * from './results.js';
