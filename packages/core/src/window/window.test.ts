import { describe, expect, it } from 'vitest';
import type { TournamentId } from '@padelmigas/contracts';
import type { Tournament } from '../domain/index.js';
import { isVotingOpen, isVotingOpenNow, publicStatusAt, tournamentStatusAt } from './index.js';

/**
 * The voting window (FR-011, SC-007).
 *
 * 100% branch coverage is required here because every branch is a way for a voter to be wrongly
 * allowed or wrongly refused. The boundary instant — now exactly equal to `startsAt` — is asserted
 * directly rather than approached, because "closed at the start" is the requirement and an
 * off-by-one comparison is the whole of Risk R5.
 */

const START = new Date('2026-12-01T18:00:00.000Z');

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: '00000000-0000-4000-8000-000000000001' as TournamentId,
    name: 'Torneio Fictício',
    slug: 'torneio-ficticio',
    startsAt: overrides.startsAt ?? START,
    publishedAt:
      overrides.publishedAt === undefined
        ? new Date('2026-11-01T10:00:00.000Z')
        : overrides.publishedAt,
  };
}

describe('tournamentStatusAt', () => {
  it('is open one millisecond before the start instant', () => {
    expect(tournamentStatusAt(tournament(), new Date(START.getTime() - 1))).toBe('open');
  });

  it('is closed exactly at the start instant', () => {
    // The requirement is "voting closes when the tournament starts" (FR-011). At the instant it
    // starts, it has started.
    expect(tournamentStatusAt(tournament(), new Date(START.getTime()))).toBe('closed');
  });

  it('is closed after the start instant', () => {
    expect(tournamentStatusAt(tournament(), new Date(START.getTime() + 1))).toBe('closed');
  });

  it('is draft while unpublished, however far in the future the start is', () => {
    const draft = tournament({ publishedAt: null });
    expect(tournamentStatusAt(draft, new Date(START.getTime() - 86_400_000))).toBe('draft');
  });

  it('is draft while unpublished even after the start instant has passed', () => {
    // A draft has no public existence at all; the clock cannot promote it (FR-023).
    const draft = tournament({ publishedAt: null });
    expect(tournamentStatusAt(draft, new Date(START.getTime() + 86_400_000))).toBe('draft');
  });
});

describe('isVotingOpen', () => {
  it('accepts a ballot before the start', () => {
    expect(isVotingOpen(tournament(), new Date(START.getTime() - 1))).toBe(true);
  });

  it('refuses a ballot at the boundary instant', () => {
    expect(isVotingOpen(tournament(), new Date(START.getTime()))).toBe(false);
  });

  it('never opens for an unpublished tournament', () => {
    expect(isVotingOpen(tournament({ publishedAt: null }), new Date(START.getTime() - 1))).toBe(
      false,
    );
  });
});

describe('isVotingOpenNow', () => {
  it('reads the injected clock and nothing else', () => {
    // The point of the port: a client-supplied "now" cannot reach this decision (SC-007).
    const clock = { now: () => new Date(START.getTime() - 1000) };
    expect(isVotingOpenNow(tournament(), clock)).toBe(true);

    const late = { now: () => new Date(START.getTime()) };
    expect(isVotingOpenNow(tournament(), late)).toBe(false);
  });
});

describe('publicStatusAt', () => {
  it('reports open and closed for a published tournament', () => {
    expect(publicStatusAt(tournament(), new Date(START.getTime() - 1))).toBe('open');
    expect(publicStatusAt(tournament(), new Date(START.getTime()))).toBe('closed');
  });

  it('returns null for a draft so it cannot be serialised as a public status', () => {
    expect(publicStatusAt(tournament({ publishedAt: null }), new Date(START.getTime() - 1))).toBe(
      null,
    );
  });
});
