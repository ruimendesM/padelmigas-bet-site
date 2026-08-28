import { SignJWT, jwtVerify } from 'jose';
import type { VoterId } from '@padelmigas/contracts/common';
import type { Deps } from '@padelmigas/api';
import { serverEnv } from '../env.js';

/**
 * The anonymous voter identity (FR-012, ADR-004).
 *
 * One signed cookie holding one opaque voter id. No account, no email, no IP, no user agent — the
 * cookie is the whole identity, and `voters` stores nothing but the id and two timestamps.
 *
 * Signed rather than a bare uuid so a voter cannot mint themselves a second identity by editing the
 * cookie: forging one requires the server secret. Duplicate voting via a fresh browser profile is
 * accepted and stated in the spec — this is a friendly local prediction game, not an election, and
 * the alternative is collecting personal data to prevent it (ADR-004).
 *
 * The id never appears in a response body or header other than this cookie (FR-022).
 */

export const VOTER_COOKIE_NAME = 'pm_voter';
/** One year: the identity must survive between tournaments, which are months apart. */
const VOTER_TTL_SECONDS = 60 * 60 * 24 * 365;
const ISSUER = 'padelmigas-bet';
const AUDIENCE = 'voter';

function voterKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv().VOTER_COOKIE_SECRET);
}

export function readCookie(request: Request, name: string): string | null {
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

/** Verifies the cookie and returns the voter id it carries, or `null` for anyone unrecognised. */
export async function readVoterId(request: Request): Promise<VoterId | null> {
  return readVoterIdFromToken(readCookie(request, VOTER_COOKIE_NAME));
}

/**
 * The same, from a raw cookie value.
 *
 * Server components read cookies through `next/headers` rather than a `Request`, and both paths must
 * verify the signature identically — a page that trusted an unverified id would hand one voter's
 * reveal to another.
 */
export async function readVoterIdFromToken(token: string | null): Promise<VoterId | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, voterKey(), { issuer: ISSUER, audience: AUDIENCE });
    const subject = payload.sub;
    return typeof subject === 'string' && subject.length > 0 ? (subject as VoterId) : null;
  } catch {
    // An expired or tampered cookie is treated as no cookie: the visitor simply gets a new identity
    // the next time they vote, rather than an error page for something they cannot fix.
    return null;
  }
}

async function signVoterToken(voterId: VoterId): Promise<string> {
  // The JWT's own lifetime, not the voting window — this file is on the `no-restricted-syntax`
  // allowlist for exactly that reason (see eslint.config.js).
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(voterId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + VOTER_TTL_SECONDS)
    .sign(voterKey());
}

export function voterCookie(token: string): string {
  return [
    `${VOTER_COOKIE_NAME}=${token}`,
    'Path=/',
    // Not readable from JavaScript: the id is the vote-once key, so page script has no use for it.
    'HttpOnly',
    'Secure',
    // Lax, not Strict: a voter following a shared WhatsApp link must arrive already recognised, or
    // they would appear never to have voted (FR-014).
    'SameSite=Lax',
    `Max-Age=${VOTER_TTL_SECONDS}`,
  ].join('; ');
}

export interface VoterContext {
  readonly voterId: VoterId;
  /** Present only when a new identity was minted, in which case the route must send this cookie. */
  readonly setCookie: string | null;
}

/**
 * The caller's voter identity for a read: recognised or nobody.
 *
 * Reads never mint. A visitor who only browses should not be given an identity — the `voters` table
 * would fill with rows for people who never voted, and minting on a cached-looking GET is how a
 * shared link ends up handing one identity to several people.
 *
 * `last_seen_at` is refreshed best-effort: a failure here must never fail the request the visitor
 * actually made.
 */
export async function recogniseVoter(request: Request, deps: Deps): Promise<VoterId | null> {
  const voterId = await readVoterId(request);
  if (!voterId) return null;

  const voter = await deps.voters.findById(voterId);
  // A signed id for a row that no longer exists (a truncated database, a restored backup) is treated
  // as unrecognised rather than trusted into a foreign-key failure at insert time.
  if (!voter) return null;

  await deps.voters.touch(voterId).catch(() => undefined);
  return voterId;
}

/**
 * The caller's voter identity for a write, minting one if needed.
 *
 * Called only by the ballot route: that is the one moment an identity is genuinely required, and
 * minting it there means the row and the cookie are created together (FR-012).
 */
export async function requireVoter(request: Request, deps: Deps): Promise<VoterContext> {
  const existing = await recogniseVoter(request, deps);
  if (existing) return { voterId: existing, setCookie: null };

  const voter = await deps.voters.create();
  return { voterId: voter.id, setCookie: voterCookie(await signVoterToken(voter.id)) };
}
