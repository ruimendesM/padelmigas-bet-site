import { cookies } from 'next/headers';
import {
  getPlayer,
  getTournamentDetail,
  listTournaments,
  type CallerContext,
} from '@padelmigas/api';
import type {
  AccountDto,
  PlayerDetailDto,
  TournamentDetailDto,
  TournamentListResponse,
} from '@padelmigas/contracts';
import type { PlayerId } from '@padelmigas/contracts/common';
import { getDeps } from './deps.js';
import { ACCOUNT_COOKIE_NAME } from './account-session.js';
import { VOTER_COOKIE_NAME, resolveCaller, type ResolvedCaller } from './voter-cookie.js';

/**
 * Server-component reads.
 *
 * Pages call the same handlers the `/api/v1` routes call, in-process, skipping an HTTP hop to the
 * app's own origin (plan.md — Architecture Overview, ADR-002). Interactive components still go over
 * HTTP through `@padelmigas/client`, so the contract stays the one surface a mobile client would
 * consume (SC-010).
 *
 * Every page built on these is `dynamic = 'force-dynamic'`: the answers depend on the caller's
 * cookie, and a statically rendered reveal is Risk R1.
 */

async function resolvedCaller(): Promise<ResolvedCaller> {
  const store = await cookies();
  return resolveCaller(
    {
      voter: store.get(VOTER_COOKIE_NAME)?.value ?? null,
      account: store.get(ACCOUNT_COOKIE_NAME)?.value ?? null,
    },
    getDeps(),
  );
}

/**
 * The caller as the handlers understand them. Reads never mint an identity — see `voter-cookie`.
 *
 * Resolved exactly as the `/api/v1` routes resolve it (feature 004): a page that trusted a bare voter
 * cookie for an account-owned voter would keep showing that account's ballots after sign-out.
 */
export async function caller(): Promise<CallerContext> {
  return resolvedCaller();
}

/** The signed-in account for the header (FR-322), or `null` for a logged-out visitor. */
export async function fetchSignedInAccount(): Promise<AccountDto | null> {
  const { accountId } = await resolvedCaller();
  if (!accountId) return null;
  const account = await getDeps().accounts.findById(accountId);
  return account ? { username: account.username } : null;
}

export async function fetchTournaments(
  query: { status?: 'open' | 'closed' | 'all'; limit?: number; includeInvalidated?: boolean } = {},
): Promise<TournamentListResponse> {
  return listTournaments(
    {
      status: query.status ?? 'all',
      limit: query.limit ?? 20,
      cursor: undefined,
      // Off unless asked for: only history lists replaced tournaments (feature 003, FR-211).
      includeInvalidated: query.includeInvalidated ?? false,
    },
    getDeps(),
  );
}

export async function fetchTournament(slug: string): Promise<TournamentDetailDto> {
  return getTournamentDetail({ slug, caller: await caller() }, getDeps());
}

export async function fetchPlayer(playerId: string): Promise<PlayerDetailDto> {
  return getPlayer({ playerId: playerId as PlayerId }, getDeps());
}
