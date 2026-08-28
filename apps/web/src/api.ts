import { createApi, WEB_API_BASE_URL } from '@padelmigas/ui-logic';

/**
 * The browser's single entry point to the product API (Principle III).
 *
 * The constitution requires clients to consume the generated client rather than hand-rolled `fetch`
 * calls, so that a contract change becomes a type error here instead of a runtime surprise in
 * production. `tests/architecture/boundaries.test.ts` greps for `fetch('/api/v1/...')` outside
 * `packages/client` and fails the build when one reappears.
 *
 * The client is a value, not a hook: it holds no state beyond its base URL, so a module-level
 * instance is correct and avoids threading a provider through every interactive component. A future
 * `apps/mobile` builds its own with an absolute origin instead — that is the whole reason the base
 * URL is a parameter (SC-010).
 *
 * `POST /api/admin/session` is deliberately NOT here. Signing in exchanges a password for a cookie;
 * it is host plumbing rather than a product endpoint, so it is absent from
 * `packages/contracts/src/endpoints.ts` and therefore from the generated client (ADR-002).
 */
export const api = createApi({ baseUrl: WEB_API_BASE_URL });
