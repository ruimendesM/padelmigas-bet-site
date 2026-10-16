import { NextResponse } from 'next/server';
import { signInRequest } from '@padelmigas/contracts';
import { signIn } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../src/server/adapter.js';
import {
  enforceAuthRateLimit,
  requireSameSiteJson,
  presentSession,
  signedOutCookies,
} from '../../../../../src/server/account-routes.js';
import { getDeps } from '../../../../../src/server/deps.js';
import { deviceVoterId } from '../../../../../src/server/voter-cookie.js';

/**
 * `POST /api/v1/account/session` — sign in (FR-310 – FR-314, FR-317, FR-321).
 *
 * The device's anonymous voter is handed to the handler, which merges its ballots into the account in
 * one transaction (FR-312). After an organiser reset the same call carries `newPassword`.
 */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      requireSameSiteJson(request);
      enforceAuthRateLimit(request);
      return {
        request: await jsonBody(request, signInRequest),
        deviceVoterId: await deviceVoterId(request, getDeps()),
      };
    },
    run: signIn,
    present: presentSession,
  });
}

/**
 * `DELETE /api/v1/account/session` — sign out (FR-316).
 *
 * Clearing both cookies is the whole of it: sessions are stateless, and an account-owned voter id
 * left in a stale voter cookie is ignored by caller resolution anyway (research R4). Idempotent.
 */
export async function DELETE(): Promise<Response> {
  const response = NextResponse.json(
    { signedOut: true },
    { status: 200, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
  );
  for (const cookie of signedOutCookies()) response.headers.append('Set-Cookie', cookie);
  return response;
}
