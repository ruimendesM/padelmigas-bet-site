import { describe, expect, it } from 'vitest';
import type { AccountId, BallotId, GroupId, VoterId } from '@padelmigas/contracts/common';
import type { Account } from '../domain/index.js';
import {
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_LENGTH,
  TEMPORARY_PASSWORD_TTL_MS,
  generateTemporaryPassword,
  normaliseUsername,
  planDeviceMerge,
  temporaryPasswordState,
} from './index.js';

/**
 * Voter accounts (feature 004).
 *
 * 100% branch coverage is required: a wrong merge decision either counts one person twice in a
 * group or throws away a vote they cast, and both look correct on the public page.
 */

const ballotId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as BallotId;
const groupId = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}` as GroupId;

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: '00000000-0000-4000-b000-000000000001' as AccountId,
    username: 'rui.m',
    voterId: '00000000-0000-4000-c000-000000000001' as VoterId,
    sessionVersion: 1,
    temporaryPasswordExpiresAt: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

describe('normaliseUsername (FR-303)', () => {
  it('trims and lower-cases a valid username', () => {
    expect(normaliseUsername('  Rui.M  ')).toBe('rui.m');
  });

  it('accepts digits, dot, hyphen and underscore', () => {
    expect(normaliseUsername('a_b-c.9')).toBe('a_b-c.9');
  });

  it('accepts the length bounds', () => {
    expect(normaliseUsername('abc')).toBe('abc');
    expect(normaliseUsername('a'.repeat(30))).toBe('a'.repeat(30));
  });

  it('rejects too short and too long', () => {
    expect(normaliseUsername('ab')).toBeNull();
    expect(normaliseUsername('a'.repeat(31))).toBeNull();
  });

  it('rejects characters outside the allowed set', () => {
    expect(normaliseUsername('rui m')).toBeNull();
    expect(normaliseUsername('rui@m')).toBeNull();
    expect(normaliseUsername('joão')).toBeNull();
  });
});

describe('temporaryPasswordState (FR-320, FR-321)', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('is none when no temporary password is pending', () => {
    expect(temporaryPasswordState(account(), now)).toBe('none');
  });

  it('is pending before the expiry instant', () => {
    const expiresAt = new Date(now.getTime() + 1);
    expect(temporaryPasswordState(account({ temporaryPasswordExpiresAt: expiresAt }), now)).toBe(
      'pending',
    );
  });

  it('is expired at and after the expiry instant', () => {
    expect(temporaryPasswordState(account({ temporaryPasswordExpiresAt: now }), now)).toBe(
      'expired',
    );
    const past = new Date(now.getTime() - 1);
    expect(temporaryPasswordState(account({ temporaryPasswordExpiresAt: past }), now)).toBe(
      'expired',
    );
  });

  it('expires 24 hours after a reset', () => {
    expect(TEMPORARY_PASSWORD_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('planDeviceMerge (FR-310, FR-311)', () => {
  it('moves a ballot in a group the account has not voted in, open or closed', () => {
    const plan = planDeviceMerge(
      [
        { ballotId: ballotId(1), groupId: groupId(1), votingOpen: true },
        { ballotId: ballotId(2), groupId: groupId(2), votingOpen: false },
      ],
      new Set([groupId(9)]),
    );
    expect(plan).toEqual({ move: [ballotId(1), ballotId(2)], discard: [], leave: [] });
  });

  it('discards the device ballot on a conflict in an open group (the account wins)', () => {
    const plan = planDeviceMerge(
      [{ ballotId: ballotId(1), groupId: groupId(1), votingOpen: true }],
      new Set([groupId(1)]),
    );
    expect(plan).toEqual({ move: [], discard: [ballotId(1)], leave: [] });
  });

  it('leaves both ballots on a conflict in a closed group, so closed totals never change', () => {
    const plan = planDeviceMerge(
      [{ ballotId: ballotId(1), groupId: groupId(1), votingOpen: false }],
      new Set([groupId(1)]),
    );
    expect(plan).toEqual({ move: [], discard: [], leave: [ballotId(1)] });
  });

  it('returns an empty plan for a device with no ballots', () => {
    expect(planDeviceMerge([], new Set([groupId(1)]))).toEqual({
      move: [],
      discard: [],
      leave: [],
    });
  });
});

describe('generateTemporaryPassword (FR-320)', () => {
  it('has the fixed length and only unambiguous characters', () => {
    const value = generateTemporaryPassword((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(value).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    for (const character of value) expect(TEMPORARY_PASSWORD_ALPHABET).toContain(character);
    expect(TEMPORARY_PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/);
  });

  it('draws characters uniformly by rejecting bytes past the last full alphabet cycle', () => {
    const limit = 256 - (256 % TEMPORARY_PASSWORD_ALPHABET.length);
    // First call returns only rejected bytes; the second supplies usable ones.
    let call = 0;
    const value = generateTemporaryPassword((n) => {
      call += 1;
      return call === 1 ? new Uint8Array(n).fill(limit) : new Uint8Array(n).fill(0);
    });
    expect(call).toBe(2);
    expect(value).toBe(TEMPORARY_PASSWORD_ALPHABET[0]!.repeat(TEMPORARY_PASSWORD_LENGTH));
  });

  it('uses the platform random source by default', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    expect(a).not.toBe(b);
  });
});
