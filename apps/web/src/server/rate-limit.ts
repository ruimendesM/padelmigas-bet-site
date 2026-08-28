import { createHash } from 'node:crypto';
import { domainError } from '@padelmigas/core';
import { serverEnv } from '../env.js';

/**
 * Per-IP rate limiting for ballot submission (constitution: Privacy).
 *
 * **Window: 10 votes per 10 minutes per client.** Generous by design — a household or a club on one
 * NAT shares an address, and the limit exists to blunt a script, not to police a group of friends
 * sharing a phone hotspot at the courts.
 *
 * The privacy rules this file exists to keep:
 *  - The IP is **never stored**. It is salted with `RATE_LIMIT_SALT` and hashed; only the hash is
 *    held, and only in memory.
 *  - Nothing here is **ever written to Postgres**. A per-IP row in the database would turn an
 *    anonymous ballot into an attributable one, which is precisely what ADR-004 refuses.
 *  - Nothing here is **ever logged**. Neither the address nor the hash appears in any log line.
 *
 * In-memory means the counter is per serverless instance and resets on a cold start. That is
 * accepted: a limiter that leaked identity to gain accuracy would be the wrong trade for this
 * product.
 */

/** Requests allowed per key per window. */
const LIMIT = 10;
/** The window itself. */
const WINDOW_MS = 10 * 60 * 1000;

interface Bucket {
  count: number;
  /** Epoch milliseconds at which this bucket resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Salted hash of the client address.
 *
 * The salt is a deployment secret, so the hashes cannot be reversed with a table of the whole IPv4
 * space — an unsalted hash of an IP is not an anonymisation, it is an encoding.
 */
function keyFor(address: string): string {
  return createHash('sha256').update(`${serverEnv().RATE_LIMIT_SALT}:${address}`).digest('hex');
}

/**
 * The client address as the hosting platform reports it.
 *
 * Only the first hop of `x-forwarded-for` is used: the rest is client-controlled and trusting it
 * would let a caller rotate their own key at will.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets, for `Retry-After`. */
  readonly retryAfterSeconds: number;
}

/**
 * Records one attempt and reports whether it is allowed.
 *
 * `now` is passed in rather than read here: `Clock` is the system's only source of time, and this
 * module is not it (SC-007).
 */
export function consume(request: Request, now: Date): RateLimitDecision {
  const key = keyFor(clientAddress(request));
  const nowMs = now.getTime();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + WINDOW_MS });
    return { allowed: true, remaining: LIMIT - 1, retryAfterSeconds: 0 };
  }

  // Opportunistic sweep: without it the map grows for the life of the instance. Bounded work per
  // call, and only when a bucket is already being touched.
  if (buckets.size > 10_000) {
    for (const [candidate, held] of buckets) {
      if (held.resetAt <= nowMs) buckets.delete(candidate);
    }
  }

  bucket.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
  return {
    allowed: bucket.count <= LIMIT,
    remaining: Math.max(0, LIMIT - bucket.count),
    retryAfterSeconds,
  };
}

/** Throws `RATE_LIMITED`, which the adapter maps to 429 with a `Retry-After`. */
export function enforce(request: Request, now: Date): { readonly retryAfterSeconds: number } {
  const decision = consume(request, now);
  if (!decision.allowed) {
    throw domainError('RATE_LIMITED', 'Demasiados votos em pouco tempo. Tenta daqui a pouco.');
  }
  return { retryAfterSeconds: decision.retryAfterSeconds };
}

/** Test seam: clears every bucket so one test's attempts cannot exhaust another's budget. */
export function resetRateLimits(): void {
  buckets.clear();
}
