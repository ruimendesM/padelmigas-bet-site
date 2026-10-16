import { SignJWT, jwtVerify } from 'jose';
import type { AccountId } from '@padelmigas/contracts/common';
import { serverEnv } from '../env.js';

/**
 * The voter-account session (feature 004, ADR-012, research R2).
 *
 * A signed cookie carrying the account id and the account's session version. Stateless: there is no
 * session table. Ending sessions is done by bumping `accounts.session_version` (password change,
 * organiser reset), which makes every token carrying the old value fail the caller resolution in
 * `voter-cookie.ts` (research R3).
 *
 * Signed with the voter cookie secret, like the organiser session: the audience claim is what keeps
 * one token type from being accepted as another.
 */

export const ACCOUNT_COOKIE_NAME = 'pm_account';
/** 90 days (FR-315). */
const ACCOUNT_TTL_SECONDS = 60 * 60 * 24 * 90;
const ISSUER = 'padelmigas-bet';
const AUDIENCE = 'account';

function sessionKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv().VOTER_COOKIE_SECRET);
}

export interface AccountSessionClaims {
  readonly accountId: AccountId;
  readonly sessionVersion: number;
}

export async function signAccountSession(claims: AccountSessionClaims): Promise<string> {
  // The JWT's own lifetime, not the voting window — this file is on the `no-restricted-syntax`
  // allowlist for the same reason as `voter-cookie.ts` (see eslint.config.js).
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ sv: claims.sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.accountId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCOUNT_TTL_SECONDS)
    .sign(sessionKey());
}

/** The claims of a validly signed, unexpired session token, or `null`. Not yet checked against the store. */
export async function readAccountSession(
  token: string | null,
): Promise<AccountSessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const subject = payload.sub;
    const version = payload['sv'];
    if (typeof subject !== 'string' || subject.length === 0) return null;
    if (typeof version !== 'number' || !Number.isInteger(version)) return null;
    return { accountId: subject as AccountId, sessionVersion: version };
  } catch {
    return null;
  }
}

export function accountSessionCookie(token: string): string {
  return [
    `${ACCOUNT_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    // Lax, like the voter cookie: a signed-in person following a shared link must arrive recognised.
    'SameSite=Lax',
    `Max-Age=${ACCOUNT_TTL_SECONDS}`,
  ].join('; ');
}

export function clearAccountSessionCookie(): string {
  return `${ACCOUNT_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
