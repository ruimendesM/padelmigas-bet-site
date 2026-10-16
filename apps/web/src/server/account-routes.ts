import type { SessionGrant } from '@padelmigas/api';
import { domainError } from '@padelmigas/core';
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

/**
 * Refuses a cross-site write to an account route (FR-324, analysis finding S1).
 *
 * Without it, a form on another site could post a JSON-shaped `text/plain` body to sign-in: the
 * browser would accept the account cookie in the response, and the visitor's phone would be silently
 * signed in to someone else's account — every later vote theirs. Two checks, each enough alone:
 *
 *  - **`Content-Type: application/json`.** A cross-site page cannot send it without a CORS preflight,
 *    which this app never answers.
 *  - **Same-site `Origin`.** Browsers send `Origin` on every cross-site POST/PUT; when present it must
 *    name this host (nginx forwards `Host`, deploy/nginx.conf). Absent means a non-browser client,
 *    such as a future mobile app, which carries no ambient cookies to abuse.
 */
export function requireSameSiteJson(request: Request): void {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(contentType.trim())) {
    throw domainError('MALFORMED_PAYLOAD', 'O pedido tem de ser enviado como JSON.');
  }

  const origin = request.headers.get('origin');
  if (origin === null) return;
  let originHost: string | null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Includes the literal `null` origin of sandboxed frames and file:// pages.
    originHost = null;
  }
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (originHost === null || originHost !== host) {
    throw domainError('UNAUTHORISED', 'Pedido recusado: tem de vir deste site.');
  }
}

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
