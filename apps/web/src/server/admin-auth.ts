import { verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { domainError } from '@padelmigas/core';
import { serverEnv } from '../env.js';
import { ARGON2_OPTIONS } from './argon2-options.js';

/**
 * Organiser access (FR-006).
 *
 * One password, hashed with argon2id, exchanged for a short-lived signed session cookie. No accounts,
 * no roles, no password reset — the spec has one organiser and Principle V forbids building for the
 * second one before a spec asks for it.
 *
 * The rankings-sync route additionally accepts a bearer `CRON_SECRET`, and **only** that route
 * (contracts/README rule 7): the scheduler must run without a human session, and widening that
 * credential to the publish route would put a public tournament one leaked secret away.
 */

export const ADMIN_COOKIE_NAME = 'pm_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const ISSUER = 'padelmigas-bet';
const AUDIENCE = 'organiser';

function sessionKey(): Uint8Array {
  // Reuses the voter cookie secret's sibling: the admin session is signed with its own purpose
  // claim, so one secret cannot produce a token the other accepts.
  return new TextEncoder().encode(serverEnv().VOTER_COOKIE_SECRET);
}

/**
 * Verifies the organiser password against `ADMIN_PASSWORD_HASH`.
 *
 * A verification failure and a malformed hash are both reported as "wrong password": distinguishing
 * them would tell an attacker whether the deployment is configured.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    return await verify(serverEnv().ADMIN_PASSWORD_HASH, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Mints a signed organiser session. Returns the token; the caller sets the cookie. */
export async function createAdminSessionToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: 'organiser-session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(sessionKey());
}

/** The `Set-Cookie` value for a freshly minted session. */
export function adminSessionCookie(token: string): string {
  return [
    `${ADMIN_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    // Strict, not Lax: no third-party context should ever carry an organiser session.
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ');
}

/** Clears the session cookie. */
export function clearAdminSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

async function hasValidSession(request: Request): Promise<boolean> {
  const token = readCookie(request, ADMIN_COOKIE_NAME);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload['purpose'] === 'organiser-session';
  } catch {
    return false;
  }
}

/** Constant-time comparison, so a bearer secret cannot be recovered a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Compare a fixed number of bytes regardless of length, then fold the length into the result.
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

function hasValidCronSecret(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1];
  if (!presented) return false;
  return timingSafeEqual(presented, serverEnv().CRON_SECRET);
}

/**
 * Guard for every admin route except the rankings sync.
 *
 * Throws `UNAUTHORISED`, which the route adapter maps to 401 — the route itself never branches on
 * auth, keeping it to parse/call/respond (Principle II).
 */
export async function requireOrganiser(request: Request): Promise<void> {
  if (await hasValidSession(request)) return;
  throw domainError('UNAUTHORISED', 'Esta ação requer sessão de organizador.');
}

/**
 * Guard for the rankings-sync route alone: organiser session OR bearer `CRON_SECRET`.
 *
 * Deliberately not reusable by any other route — the narrowness is the security property
 * (contracts/README rule 7).
 */
export async function requireOrganiserOrCron(request: Request): Promise<void> {
  if (hasValidCronSecret(request)) return;
  if (await hasValidSession(request)) return;
  throw domainError(
    'UNAUTHORISED',
    'Esta ação requer sessão de organizador ou o segredo do agendador.',
  );
}
