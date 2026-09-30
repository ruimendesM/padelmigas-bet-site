import { describe, expect, it } from 'vitest';
import type { TournamentId } from '@padelmigas/contracts';
import type { Tournament } from '../domain/index.js';
import { isRevealed } from './index.js';

/**
 * The reveal gate (FR-020, FR-021).
 *
 * Four cells — open/closed × voted/not — and all four are asserted, because the one that leaks is
 * the one nobody wrote a case for (Risk R1, SC-006).
 */

const START = new Date('2026-12-01T18:00:00.000Z');
const BEFORE = new Date(START.getTime() - 1);
const AT = new Date(START.getTime());

const tournament: Tournament = {
  id: '00000000-0000-4000-8000-000000000001' as TournamentId,
  name: 'Torneio Fictício',
  slug: 'torneio-ficticio',
  startsAt: START,
  publishedAt: new Date('2026-11-01T10:00:00.000Z'),
  invalidatedAt: null,
  replacedById: null,
};

describe('isRevealed', () => {
  it('hides results from a non-voter while voting is open', () => {
    expect(isRevealed({ tournament, hasVoted: false, now: BEFORE })).toBe(false);
  });

  it('reveals results to a voter while voting is open', () => {
    expect(isRevealed({ tournament, hasVoted: true, now: BEFORE })).toBe(true);
  });

  it('reveals results to everyone once voting has closed', () => {
    expect(isRevealed({ tournament, hasVoted: false, now: AT })).toBe(true);
  });

  it('still reveals to a voter after close', () => {
    expect(isRevealed({ tournament, hasVoted: true, now: AT })).toBe(true);
  });

  it('never reveals an unpublished draft, whose start instant has no meaning yet', () => {
    // The naive gate ("not open ⇒ closed ⇒ reveal") would expose a draft whose start has passed.
    const draft: Tournament = { ...tournament, publishedAt: null };
    expect(isRevealed({ tournament: draft, hasVoted: false, now: BEFORE })).toBe(false);
    expect(isRevealed({ tournament: draft, hasVoted: false, now: AT })).toBe(false);
    expect(isRevealed({ tournament: draft, hasVoted: true, now: AT })).toBe(false);
  });
});

describe('isRevealed for an invalidated tournament (feature 003, FR-213)', () => {
  // The replacement starts later than the original, so "original closed, replacement open" is a
  // reachable instant and the one where a leak would happen.
  const SUCCESSOR_START = new Date(START.getTime() + 86_400_000);

  const invalidated: Tournament = {
    ...tournament,
    slug: 'torneio-ficticio-invalidado-1',
    invalidatedAt: new Date('2026-11-15T10:00:00.000Z'),
    replacedById: '00000000-0000-4000-8000-000000000002' as TournamentId,
  };
  const successor: Tournament = {
    ...tournament,
    id: '00000000-0000-4000-8000-000000000002' as TournamentId,
    startsAt: SUCCESSOR_START,
  };

  it('withholds results from a voter of the original while the successor is open', () => {
    // A carried-over group is still votable in the successor: showing the frozen crowd here would be
    // a way to see it without voting.
    expect(
      isRevealed({
        tournament: invalidated,
        hasVoted: true,
        now: BEFORE,
        liveSuccessor: successor,
      }),
    ).toBe(false);
  });

  it('withholds results while the successor is open even after the original start', () => {
    expect(
      isRevealed({ tournament: invalidated, hasVoted: false, now: AT, liveSuccessor: successor }),
    ).toBe(false);
  });

  it('reveals the frozen results to everyone once the successor has closed', () => {
    expect(
      isRevealed({
        tournament: invalidated,
        hasVoted: false,
        now: SUCCESSOR_START,
        liveSuccessor: successor,
      }),
    ).toBe(true);
  });

  it('fails closed when no successor is supplied', () => {
    expect(isRevealed({ tournament: invalidated, hasVoted: true, now: SUCCESSOR_START })).toBe(
      false,
    );
    expect(
      isRevealed({
        tournament: invalidated,
        hasVoted: true,
        now: SUCCESSOR_START,
        liveSuccessor: null,
      }),
    ).toBe(false);
  });
});
