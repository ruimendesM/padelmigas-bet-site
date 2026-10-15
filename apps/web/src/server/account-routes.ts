import type { SessionGrant } from '@padelmigas/api';
import { getDeps } from './deps.js';
import { enforce } from './rate-limit.js';
import {
  accountSessionCookie,
  clearAccountSessionCookie,
  signAccountSession,
} from './account-session.js';
import {
  callerTokens,
  clearVoterCookie,
  resolveCaller,
  type ResolvedCaller,
} from './voter-cookie.js';

/**
 * Host plumbing shared by the `/api/v1/account*` routes (feature 004).
 *
 * Kept out of the route files so each stays parse → one handler → respond (Principle II), and out of
 * `voter-cookie.ts` / `account-session.ts` so neither has to import the other's cookie writer.
 */

/** Register and sign-in share the `auth` rate-limit bucket (FR-317). Throws `RATE_LIMITED`. */
export function enforceAuthRateLimit(request: Request): void {
  enforce(request, getDeps().clock.now(), 'auth');
}

export async function currentCaller(request: Request): Promise<ResolvedCaller> {
  return resolveCaller(callerTokens(request), getDeps());
}

/**
 * Body and cookies for a granted session: the signed account cookie, and the anonymous voter cookie
 * cleared — from here on the account session is this device's identity (research R4).
 */
export async function presentSession(
  grant: SessionGrant,
): Promise<{ readonly body: unknown; readonly cookies: readonly string[] }> {
  const token = await signAccountSession(grant.session);
  return { body: grant.response, cookies: [accountSessionCookie(token), clearVoterCookie()] };
}

/** Sign-out clears both cookies: the device becomes a brand-new visitor (FR-316). */
export function signedOutCookies(): readonly string[] {
  return [clearAccountSessionCookie(), clearVoterCookie()];
}
