import { cookies } from 'next/headers';
import {
  getPlayer,
  getTournamentDetail,
  listTournaments,
  type CallerContext,
} from '@padelmigas/api';
import type {
  PlayerDetailDto,
  TournamentDetailDto,
  TournamentListResponse,
} from '@padelmigas/contracts';
import type { PlayerId } from '@padelmigas/contracts/common';
import { getDeps } from './deps.js';
import { VOTER_COOKIE_NAME, readVoterIdFromToken } from './voter-cookie.js';

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

/** The caller as the handlers understand them. Reads never mint an identity — see `voter-cookie`. */
export async function caller(): Promise<CallerContext> {
  const store = await cookies();
  const token = store.get(VOTER_COOKIE_NAME)?.value ?? null;
  return { voterId: await readVoterIdFromToken(token) };
}

export async function fetchTournaments(
  query: { status?: 'open' | 'closed' | 'all'; limit?: number } = {},
): Promise<TournamentListResponse> {
  return listTournaments(
    { status: query.status ?? 'all', limit: query.limit ?? 20, cursor: undefined },
    getDeps(),
  );
}

export async function fetchTournament(slug: string): Promise<TournamentDetailDto> {
  return getTournamentDetail({ slug, caller: await caller() }, getDeps());
}

export async function fetchPlayer(playerId: string): Promise<PlayerDetailDto> {
  return getPlayer({ playerId: playerId as PlayerId }, getDeps());
}
