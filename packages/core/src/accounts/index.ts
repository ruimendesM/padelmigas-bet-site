import type { BallotId, GroupId } from '@padelmigas/contracts/common';
import { USERNAME_PATTERN } from '@padelmigas/contracts';
import type { Account } from '../domain/index.js';

/**
 * Optional voter accounts — the rules (feature 004, ADR-012).
 *
 * Pure: no clock, no store, no hashing. The handlers in `packages/api` feed these the server time and
 * the repository's reads; the merge itself is executed by `packages/db` inside one transaction
 * (FR-312).
 */

// ---------------------------------------------------------------------------------------------
// Usernames (FR-303)
// ---------------------------------------------------------------------------------------------

/**
 * Trims and lower-cases, then applies the username rules. `null` when the result is not a valid
 * username. Lower-casing first is what makes uniqueness case-insensitive with a plain unique
 * constraint (research R9).
 */
export function normaliseUsername(raw: string): string | null {
  const candidate = raw.trim().toLowerCase();
  return USERNAME_PATTERN.test(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------------------------
// Temporary passwords (FR-320, FR-321)
// ---------------------------------------------------------------------------------------------

/** How long an organiser-issued temporary password stays usable (clarification 2026-10-12). */
export const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

export type TemporaryPasswordState = 'none' | 'pending' | 'expired';

/**
 * Whether the account's stored password is a temporary one, and whether it still works.
 *
 * The expiry instant itself is already expired: "24 hours" means strictly less than 24 hours.
 */
export function temporaryPasswordState(account: Account, now: Date): TemporaryPasswordState {
  const expiresAt = account.temporaryPasswordExpiresAt;
  if (expiresAt === null) return 'none';
  return now.getTime() < expiresAt.getTime() ? 'pending' : 'expired';
}

/** No `0/O`, `1/l/I`: the organiser reads this aloud or pastes it into a chat (research R8). */
export const TEMPORARY_PASSWORD_ALPHABET =
  'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TEMPORARY_PASSWORD_LENGTH = 12;

/** Fills `length` random bytes. Injected so the rejection path is testable. */
export type RandomBytes = (length: number) => Uint8Array;

const platformRandomBytes: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/**
 * A fresh temporary password.
 *
 * Bytes at or above the last whole multiple of the alphabet size are discarded, so every character is
 * equally likely — a plain `byte % size` would favour the first characters.
 */
export function generateTemporaryPassword(random: RandomBytes = platformRandomBytes): string {
  const size = TEMPORARY_PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % size);
  let result = '';
  while (result.length < TEMPORARY_PASSWORD_LENGTH) {
    for (const byte of random(TEMPORARY_PASSWORD_LENGTH)) {
      if (byte >= limit) continue;
      result += TEMPORARY_PASSWORD_ALPHABET[byte % size];
      if (result.length === TEMPORARY_PASSWORD_LENGTH) break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Merging a device's logged-out ballots into an account (FR-310, FR-311)
// ---------------------------------------------------------------------------------------------

export interface DeviceBallot {
  readonly ballotId: BallotId;
  readonly groupId: GroupId;
  /** Decided by `core/window` from the server clock, never by the client. */
  readonly votingOpen: boolean;
}

export interface DeviceMergePlan {
  /** Becomes the account's: the account has no ballot in that group. */
  readonly move: readonly BallotId[];
  /** Deleted: the account already voted in that open group, and the account's ballot wins. */
  readonly discard: readonly BallotId[];
  /**
   * Untouched: the account already voted in that group and its voting has closed. Both ballots keep
   * counting, so a closed group's totals never change because of a sign-in.
   */
  readonly leave: readonly BallotId[];
}

export function planDeviceMerge(
  deviceBallots: readonly DeviceBallot[],
  accountGroupIds: ReadonlySet<GroupId>,
): DeviceMergePlan {
  const move: BallotId[] = [];
  const discard: BallotId[] = [];
  const leave: BallotId[] = [];
  for (const ballot of deviceBallots) {
    if (!accountGroupIds.has(ballot.groupId)) move.push(ballot.ballotId);
    else if (ballot.votingOpen) discard.push(ballot.ballotId);
    else leave.push(ballot.ballotId);
  }
  return { move, discard, leave };
}
