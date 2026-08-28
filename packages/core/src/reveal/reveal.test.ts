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
