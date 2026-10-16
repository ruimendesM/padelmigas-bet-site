import { SignJWT, jwtVerify } from 'jose';
import type { AccountId, VoterId } from '@padelmigas/contracts/common';
import type { Deps } from '@padelmigas/api';
import { serverEnv } from '../env.js';
import { ACCOUNT_COOKIE_NAME, readAccountSession } from './account-session.js';

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
 *
 * Feature 004 adds an optional account in front of it: see `resolveCaller` for the order in which the
 * two cookies are believed.
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

/** Exported for the contract suite, which needs a cookie pointing at an account-owned voter. */
export async function signVoterToken(voterId: VoterId): Promise<string> {
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

/**
 * Clears the anonymous voter cookie.
 *
 * Sent on register and sign-in, where the account session becomes the identity, and on sign-out, where
 * the device becomes a brand-new visitor (FR-316).
 */
export function clearVoterCookie(): string {
  return `${VOTER_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** The raw cookie values a caller presented. Pages read them from `next/headers`, routes from the request. */
export interface CallerTokens {
  readonly voter: string | null;
  readonly account: string | null;
}

export function callerTokens(request: Request): CallerTokens {
  return {
    voter: readCookie(request, VOTER_COOKIE_NAME),
    account: readCookie(request, ACCOUNT_COOKIE_NAME),
  };
}

export interface ResolvedCaller {
  readonly voterId: VoterId | null;
  readonly accountId: AccountId | null;
}

const NOBODY: ResolvedCaller = { voterId: null, accountId: null };

/**
 * Who is asking, in the one order every route and page uses (feature 004, plan.md "Caller
 * resolution"):
 *
 *  1. A valid account session whose version still matches the account's → that account's voter.
 *  2. Otherwise a valid anonymous voter cookie, **unless an account owns that voter** → that voter.
 *     A device that once held an account's voter id must not keep seeing the account's ballots after
 *     its session ended by sign-out, password change or reset (research R4).
 *  3. Otherwise nobody.
 *
 * Reads never mint (see `recogniseVoter`). `last_seen_at` is refreshed best-effort.
 */
export async function resolveCaller(tokens: CallerTokens, deps: Deps): Promise<ResolvedCaller> {
  const session = await readAccountSession(tokens.account);
  if (session) {
    const account = await deps.accounts.findById(session.accountId);
    if (account && account.sessionVersion === session.sessionVersion) {
      await deps.voters.touch(account.voterId).catch(() => undefined);
      return { voterId: account.voterId, accountId: account.id };
    }
  }

  const voterId = await readVoterIdFromToken(tokens.voter);
  if (!voterId) return NOBODY;

  const voter = await deps.voters.findById(voterId);
  // A signed id for a row that no longer exists (a truncated database, a restored backup) is treated
  // as unrecognised rather than trusted into a foreign-key failure at insert time.
  if (!voter) return NOBODY;
  if (await deps.voters.isOwned(voterId)) return NOBODY;

  await deps.voters.touch(voterId).catch(() => undefined);
  return { voterId, accountId: null };
}

/**
 * The device's anonymous voter, for register and sign-in to adopt or merge (FR-309, FR-310).
 *
 * Signature and existence only: whether an account already owns it is re-checked by the repository
 * under a row lock, which is the check that matters (FR-313).
 */
export async function deviceVoterId(request: Request, deps: Deps): Promise<VoterId | null> {
  const voterId = await readVoterId(request);
  if (!voterId) return null;
  return (await deps.voters.findById(voterId)) ? voterId : null;
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
  return (await resolveCaller(callerTokens(request), deps)).voterId;
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

  // Nobody recognised — including a device whose cookie points at an account-owned voter after its
  // session ended. Minting replaces that cookie, so the device votes as a new anonymous visitor.

  const voter = await deps.voters.create();
  return { voterId: voter.id, setCookie: voterCookie(await signVoterToken(voter.id)) };
}
