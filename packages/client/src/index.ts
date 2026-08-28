/**
 * Public surface of @padelmigas/client — the generated, fetch-only HTTP client.
 *
 * `apps/web` today and a future `apps/mobile` both consume this; neither constructs a URL nor parses
 * a response by hand (constitution, Principle III). Regenerate with `pnpm generate:client` after any
 * change to the endpoint registry in `packages/contracts`.
 */
export { ApiRequestError, createClient } from './generated.js';
export type { ApiClient, ClientConfig, C } from './generated.js';
