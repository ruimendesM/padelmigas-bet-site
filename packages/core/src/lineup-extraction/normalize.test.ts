import { describe, expect, it } from 'vitest';
import type { RawExtractedRow } from '../ports/index.js';
import { normalizeExtraction } from './index.js';

/**
 * `normalizeExtraction` is the whole of the extraction domain (FR-105 – FR-108).
 *
 * Two properties are asserted throughout, because both are rules rather than conveniences:
 *  - **Nothing is repaired.** A missing value stays missing, a total that disagrees with its parts
 *    keeps the value that was read. Silent repair hides a misread behind a plausible number.
 *  - **Order is the grouping order.** Rows come out ordered by pair total descending, because that
 *    is the order `deriveLineup` will group them in, and the organiser should be reviewing what
 *    will actually happen (FR-113).
 */

function raw(overrides: Partial<RawExtractedRow> = {}): RawExtractedRow {
  return {
    player1Name: 'Afonso Bastos',
    player1Points: 500,
    player2Name: 'Vasco Trindade',
    player2Points: 400,
    totalPoints: 900,
    club: 'Clube Padel Norte',
    ...overrides,
  };
}

describe('normalizeExtraction', () => {
  it('maps clean rows through unchanged, with no flags and no warnings', () => {
    // Two rows, not one: a lineup is pairs, so an odd count is itself a warning (ODD_ROW_COUNT).
    const { rows, warnings } = normalizeExtraction([raw(), raw({ totalPoints: 800 })]);

    expect(warnings).toEqual([]);
    expect(rows[0]).toEqual({
      sourceIndex: 0,
      players: [
        { name: 'Afonso Bastos', points: 500 },
        { name: 'Vasco Trindade', points: 400 },
      ],
      totalPoints: 900,
      club: 'Clube Padel Norte',
      flags: [],
    });
  });

  it('trims and collapses whitespace in names and clubs', () => {
    const { rows } = normalizeExtraction([
      raw({ player1Name: '  Duarte   Vilaça ', club: ' Clube  Padel   Sul  ' }),
    ]);

    expect(rows[0]?.players[0].name).toBe('Duarte Vilaça');
    expect(rows[0]?.club).toBe('Clube Padel Sul');
  });

  it('normalises names to NFC so a decomposed accent matches a composed one', () => {
    // "Vila\u00e7a" written with a combining cedilla (U+0327) instead of the precomposed \u00e7 \u2014 what
    // some spreadsheet exports and some model outputs produce. Two byte sequences, one name.
    const decomposed = 'Vilac\u0327a';
    expect(decomposed).not.toBe('Vila\u00e7a');

    const { rows } = normalizeExtraction([raw({ player1Name: decomposed })]);

    expect(rows[0]?.players[0].name).toBe('Vila\u00e7a');
  });

  it('orders rows by pair total descending, regardless of the order read', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: 800, player1Points: 400, player2Points: 400 }),
      raw({ totalPoints: 1000, player1Points: 500, player2Points: 500 }),
      raw({ totalPoints: 900, player1Points: 450, player2Points: 450 }),
    ]);

    expect(rows.map((row) => row.totalPoints)).toEqual([1000, 900, 800]);
  });

  it('places rows with no readable total last, keeping their relative order', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: null, club: 'first unreadable' }),
      raw({ totalPoints: 900 }),
      raw({ totalPoints: null, club: 'second unreadable' }),
      raw({ totalPoints: 1000 }),
    ]);

    expect(rows.map((row) => row.totalPoints)).toEqual([1000, 900, null, null]);
    expect(rows[2]?.club).toBe('first unreadable');
    expect(rows[3]?.club).toBe('second unreadable');
  });

  it('preserves each row position in the image through the sort', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: 800 }),
      raw({ totalPoints: 1000 }),
      raw({ totalPoints: 900 }),
    ]);

    // Ordered 1000, 900, 800 — so source positions 1, 2, 0.
    expect(rows.map((row) => row.sourceIndex)).toEqual([1, 2, 0]);
  });

  it('keeps ties in the order they were read, so a stable list stays stable', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: 900, club: 'read first' }),
      raw({ totalPoints: 900, club: 'read second' }),
    ]);

    expect(rows.map((row) => row.club)).toEqual(['read first', 'read second']);
  });

  it('never computes a missing total from the two player values', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: null, player1Points: 500, player2Points: 400 }),
    ]);

    expect(rows[0]?.totalPoints).toBeNull();
  });

  it('keeps a total that disagrees with the sum of its two players', () => {
    const { rows } = normalizeExtraction([
      raw({ totalPoints: 950, player1Points: 500, player2Points: 400 }),
    ]);

    expect(rows[0]?.totalPoints).toBe(950);
    expect(rows[0]?.players.map((p) => p.points)).toEqual([500, 400]);
  });
});

describe('normalizeExtraction flags', () => {
  it('flags a missing name, on either side of the pair', () => {
    const first = normalizeExtraction([raw({ player1Name: null }), raw({ totalPoints: 800 })]);
    const second = normalizeExtraction([raw({ player2Name: '   ' }), raw({ totalPoints: 800 })]);

    expect(first.rows[0]?.flags).toEqual(['MISSING_NAME']);
    // Whitespace is not a name: it normalises to null and flags the same way.
    expect(second.rows[0]?.flags).toEqual(['MISSING_NAME']);
  });

  it('flags missing points, on either side of the pair', () => {
    const first = normalizeExtraction([raw({ player1Points: null, totalPoints: null })]);
    const second = normalizeExtraction([raw({ player2Points: null, totalPoints: null })]);

    expect(first.rows[0]?.flags).toEqual(['MISSING_POINTS']);
    expect(second.rows[0]?.flags).toEqual(['MISSING_POINTS']);
  });

  it('flags a missing club', () => {
    expect(normalizeExtraction([raw({ club: null })]).rows[0]?.flags).toEqual(['MISSING_CLUB']);
    expect(normalizeExtraction([raw({ club: '  ' })]).rows[0]?.flags).toEqual(['MISSING_CLUB']);
  });

  it('flags a total that disagrees with the sum of its two players', () => {
    expect(normalizeExtraction([raw({ totalPoints: 950 })]).rows[0]?.flags).toEqual([
      'TOTAL_MISMATCH',
    ]);
  });

  it('does not claim a mismatch when the total was not read', () => {
    const { rows } = normalizeExtraction([raw({ totalPoints: null })]);

    expect(rows[0]?.flags).toEqual([]);
  });

  it('does not claim a mismatch when a player value was not read', () => {
    // 900 may well be right; with one operand unknown, asserting a mismatch would be a guess.
    const { rows } = normalizeExtraction([raw({ player1Points: null })]);

    expect(rows[0]?.flags).toEqual(['MISSING_POINTS']);
  });

  it('treats a negative or fractional points value as unread rather than coercing it', () => {
    const negative = normalizeExtraction([raw({ player1Points: -5, totalPoints: null })]);
    const fractional = normalizeExtraction([raw({ player2Points: 12.5, totalPoints: null })]);
    const fractionalTotal = normalizeExtraction([raw({ totalPoints: 900.5 })]);

    expect(negative.rows[0]?.players[0].points).toBeNull();
    expect(negative.rows[0]?.flags).toEqual(['MISSING_POINTS']);
    expect(fractional.rows[0]?.players[1].points).toBeNull();
    expect(fractionalTotal.rows[0]?.totalPoints).toBeNull();
  });

  it('reports every flag a row has earned, in a stable order', () => {
    const { rows } = normalizeExtraction([
      raw({ player1Name: null, player2Points: null, club: null, totalPoints: 900 }),
    ]);

    expect(rows[0]?.flags).toEqual(['MISSING_NAME', 'MISSING_POINTS', 'MISSING_CLUB']);
  });

  it('flags an entirely unreadable row without dropping it', () => {
    const { rows } = normalizeExtraction([
      {
        player1Name: null,
        player2Name: null,
        player1Points: null,
        player2Points: null,
        totalPoints: null,
        club: null,
      },
      raw(),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]?.flags).toEqual(['MISSING_NAME', 'MISSING_POINTS', 'MISSING_CLUB']);
  });
});

describe('normalizeExtraction warnings', () => {
  it('warns when nothing table-like was found', () => {
    expect(normalizeExtraction([])).toEqual({ rows: [], warnings: ['NO_ROWS_FOUND'] });
  });

  it('warns on an odd row count, because a lineup is pairs', () => {
    const { warnings } = normalizeExtraction([
      raw(),
      raw({ totalPoints: 800 }),
      raw({ totalPoints: 700 }),
    ]);

    expect(warnings).toEqual(['ODD_ROW_COUNT']);
  });

  it('does not warn on an even row count', () => {
    expect(normalizeExtraction([raw(), raw({ totalPoints: 800 })]).warnings).toEqual([]);
  });
});
