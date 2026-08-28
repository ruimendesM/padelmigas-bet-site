import { QueryClient } from '@tanstack/react-query';
import { createClient, type ApiClient, type ClientConfig } from '@padelmigas/client';

/**
 * Shared data layer (SC-010).
 *
 * Hooks and cache policy live here so `apps/web` and a future `apps/mobile` behave identically
 * without either re-implementing a rule. TanStack Query runs unchanged on React Native, which is why
 * it was chosen (research D7).
 *
 * This module imports only `@padelmigas/client` — never a handler, never a repository, never the
 * DOM. `.dependency-cruiser.cjs` rules `ui-logic-no-dom` and `ui-logic-client-only` enforce it.
 */

/**
 * Cache policy.
 *
 * `staleTime: 0` and `gcTime: 0` for voter-dependent reads is deliberate and not a performance
 * oversight: a cached tournament response would show a visitor results they have not earned after a
 * cookie change or a shared device (Risk R1, SC-006). Correctness beats a round trip here.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 0,
        gcTime: 0,
      },
      mutations: {
        // A ballot must never be retried automatically: a retry after a successful-but-unacknowledged
        // insert would surface as ALREADY_VOTED and read to the voter as a failure (FR-013).
        retry: 0,
      },
    },
  });
}

/** Query keys, centralised so an invalidation cannot miss a consumer. */
export const queryKeys = {
  tournaments: (params?: { status?: string; cursor?: string }) =>
    ['tournaments', params?.status ?? 'all', params?.cursor ?? null] as const,
  tournament: (slug: string) => ['tournament', slug] as const,
  groupResults: (groupId: string) => ['group-results', groupId] as const,
  player: (playerId: string) => ['player', playerId] as const,
} as const;

export interface ApiContext {
  readonly client: ApiClient;
}

/** Builds the client used by every hook. One per app, created at the root. */
export function createApi(config: ClientConfig): ApiClient {
  return createClient(config);
}

/** The base URL the web app uses. A native client passes an absolute origin instead. */
export const WEB_API_BASE_URL = '/api/v1';
