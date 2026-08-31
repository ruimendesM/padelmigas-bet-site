import type { RawExtractedRow } from '../ports/index.js';

/**
 * Turns what a reader saw in a lineup screenshot into reviewable rows (FR-105 – FR-108).
 *
 * Everything impure happened upstream, in the reader. This module is the part that must be exactly
 * right, and it obeys two rules:
 *
 *  - **Never repair.** A value the reader could not read stays `null`; a total that disagrees with
 *    the sum of its two players keeps the value that was read. Recomputing it would change the
 *    seeding order silently, and the sheet's own total is what the club seeds by (research D3).
 *  - **Order by what will happen.** Rows come out ordered by pair total descending, because that is
 *    the order `deriveLineup` groups them in (FR-113). The organiser reviews the real order, not the
 *    order a screenshot happened to be in.
 *
 * Flags are advisory. They tell the organiser which cells to look at; they never decide whether
 * anything may be published — the mandatory preview does that, on the submitted draft (FR-111).
 */

export type ExtractionFlag = 'MISSING_NAME' | 'MISSING_POINTS' | 'MISSING_CLUB' | 'TOTAL_MISMATCH';

export type ExtractionWarning = 'NO_ROWS_FOUND' | 'ODD_ROW_COUNT';

export interface ExtractedPlayer {
  readonly name: string | null;
  readonly points: number | null;
}

export interface ExtractedRow {
  /** Position in the image, top to bottom, preserved through the sort. */
  readonly sourceIndex: number;
  readonly players: readonly [ExtractedPlayer, ExtractedPlayer];
  readonly totalPoints: number | null;
  readonly club: string | null;
  readonly flags: readonly ExtractionFlag[];
}

export interface ExtractedLineup {
  readonly rows: readonly ExtractedRow[];
  readonly warnings: readonly ExtractionWarning[];
}

/**
 * Trims, collapses internal whitespace, and normalises to NFC.
 *
 * NFC because the same name can arrive as two byte sequences — a precomposed `ç` from one export, a
 * combining cedilla from another — and player matching downstream compares normalised names
 * (`toMatchKey`). Normalising here means the organiser is shown, and submits, the same bytes the
 * matcher will use.
 */
function normalizeText(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * Accepts a non-negative integer and rejects everything else as unknown.
 *
 * A negative or fractional points value is not a value with a problem, it is a misread — and an
 * unknown is flaggable while a silently coerced number is not.
 */
function normalizePoints(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Derives every flag for one already-normalised row. Total, deterministic, order-stable. */
function flagsFor(row: Omit<ExtractedRow, 'flags'>): ExtractionFlag[] {
  const flags: ExtractionFlag[] = [];

  if (row.players[0].name === null || row.players[1].name === null) {
    flags.push('MISSING_NAME');
  }
  if (row.players[0].points === null || row.players[1].points === null) {
    flags.push('MISSING_POINTS');
  }
  if (row.club === null) {
    flags.push('MISSING_CLUB');
  }

  const [first, second] = row.players;
  // Only comparable when all three numbers are known. An absent total is MISSING_POINTS' problem,
  // not a mismatch — claiming a mismatch against a value nobody read would be a guess.
  if (
    row.totalPoints !== null &&
    first.points !== null &&
    second.points !== null &&
    row.totalPoints !== first.points + second.points
  ) {
    flags.push('TOTAL_MISMATCH');
  }

  return flags;
}

export function normalizeExtraction(rawRows: readonly RawExtractedRow[]): ExtractedLineup {
  const rows = rawRows
    .map((raw, sourceIndex): ExtractedRow => {
      const normalised = {
        sourceIndex,
        players: [
          { name: normalizeText(raw.player1Name), points: normalizePoints(raw.player1Points) },
          { name: normalizeText(raw.player2Name), points: normalizePoints(raw.player2Points) },
        ] as const satisfies readonly [ExtractedPlayer, ExtractedPlayer],
        totalPoints: normalizePoints(raw.totalPoints),
        club: normalizeText(raw.club),
      };

      return { ...normalised, flags: flagsFor(normalised) };
    })
    // Descending by total, rows with no readable total last. `sort` is stable, so ties and the
    // unreadable tail keep the order they were read in — a re-extraction of the same image does not
    // shuffle the table under the organiser.
    .sort((a, b) => {
      if (a.totalPoints === null && b.totalPoints === null) return 0;
      if (a.totalPoints === null) return 1;
      if (b.totalPoints === null) return -1;
      return b.totalPoints - a.totalPoints;
    });

  const warnings: ExtractionWarning[] = [];
  if (rows.length === 0) {
    warnings.push('NO_ROWS_FOUND');
  } else if (rows.length % 2 === 1) {
    // A lineup is pairs. An odd count means a row was lost or invented, which is worth saying out
    // loud even though every individual row may look fine (FR-108).
    warnings.push('ODD_ROW_COUNT');
  }

  return { rows, warnings };
}
