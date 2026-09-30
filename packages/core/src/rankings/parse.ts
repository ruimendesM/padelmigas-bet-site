import type { ExternalPlayerId } from '@padelmigas/contracts';
import { DomainError } from '../errors.js';
import { toMatchKey } from '../matching/index.js';

/**
 * Ranking-sheet CSV parsing (FR-004, FR-027, research F1, ADR-007).
 *
 * The sheet's real shape: `ID`, `Nome`, then dated rating columns, most recent first. Only column C —
 * the current points — is read (FR-027, amended 2026-09-30). The later columns were once imported as
 * history, until their headers turned out to mix day-first and month-first dates that no parser can
 * tell apart. So the parser is tolerant about *format*, strict about *identity*, and suspicious of
 * column C:
 *
 *  - A malformed column C cell drops that player's points; the player still imports.
 *  - More than one malformed cell in ten means column C is probably not points any more, and
 *    **aborts the whole import**, as does finding the id or name column in column C.
 *  - A row without a usable id or name is skipped and counted, so the sync can report it.
 *  - Two rows that normalise to the same name **abort the whole import**. Guessing which identity a
 *    lineup name refers to is the one failure this system must never have.
 *
 * The parser reports column C's header and its parsed date but does not decide the date the points
 * are stored under: that needs the clock and the store, so `chooseRatedOn` makes it in the handler.
 *
 * Hand-written rather than a CSV library: the format is one file with quoted fields and the rules
 * above are the interesting part, so a dependency would carry more risk than code (Principle V).
 */

export interface ParsedPlayer {
  readonly externalId: ExternalPlayerId;
  readonly displayName: string;
  /** Produced by `core/matching`, so the sheet and a lineup normalise identically. */
  readonly matchKey: string;
}

export interface ParsedSnapshot {
  /**
   * Identifies the player this rating belongs to.
   *
   * `matchKey`, not `externalId` (FR-004 as amended 2026-08-28). Keying a snapshot by the sheet's id
   * was ambiguous the moment two rows shared one: both people resolved to a single player, and the
   * import failed with `ON CONFLICT DO UPDATE command cannot affect row a second time`.
   */
  readonly matchKey: string;
  /** Column C's value. Undated here; the handler dates it (FR-027). */
  readonly points: number;
}

export interface ParsedRankings {
  readonly players: readonly ParsedPlayer[];
  readonly snapshots: readonly ParsedSnapshot[];
  /** Data rows the parser accepted. */
  readonly rowsRead: number;
  /** Rows dropped for an unusable id or name — surfaced so a shape change is visible. */
  readonly skippedRows: number;
  /** Column C's header exactly as the sheet has it, for the sync report. */
  readonly ratingHeader: string;
  /** Column C's header parsed as a day-first date, or `null` when it is not one. */
  readonly headerRatedOn: string | null;
}

/** Column C, zero-based: `ID` and `Nome` come first (FR-027). */
const RATING_COLUMN = 2;

/**
 * Parses a dated column header into `YYYY-MM-DD`, or `null` when it is not a date.
 *
 * Accepts `dd/mm/yyyy` and `dd-mm-yyyy` because both appear in the same sheet. Day-first, not
 * month-first: the sheet is Portuguese, so `26/08/2026` is 26 August. Some headers are in fact
 * month-first (`09-12-2026` is 12 September); they parse to a different valid date, which this
 * function cannot detect. `chooseRatedOn` is where that is caught (FR-027).
 */
export function parseSheetDateHeader(header: string): string | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(header.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) return null;

  // Day 0 of the following month is the last day of this one, leap years included.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Splits one CSV line, honouring quoted fields and `""` escapes. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Guesses the delimiter from the header.
 *
 * Some locales export with semicolons. Counting on the header rather than the whole file avoids
 * being fooled by a semicolon inside a club name.
 */
function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function fail(message: string, issues: { path: string; message: string }[] = []): never {
  throw new DomainError('MALFORMED_PAYLOAD', message, issues);
}

export function parseRankingCsv(csv: string): ParsedRankings {
  // Strip a UTF-8 BOM: Google Sheets emits one, and it would otherwise become part of "ID".
  const text = csv.replace(/^\ufeff/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const headerLine = lines[0];
  if (headerLine === undefined) {
    fail('A folha de ranking está vazia.', [
      { path: 'csv', message: 'Nenhuma linha encontrada. A importação foi abortada.' },
    ]);
  }

  const delimiter = detectDelimiter(headerLine);
  const header = splitLine(headerLine, delimiter);

  const idIndex = header.findIndex((cell) => cell.toUpperCase() === 'ID');
  if (idIndex === -1) {
    fail('A folha de ranking não tem coluna "ID".', [
      {
        path: 'csv',
        message:
          `Cabeçalho encontrado: ${header.join(', ')}. A coluna "ID" é a identidade canónica ` +
          'do jogador (ADR-007) e sem ela a importação não é segura.',
      },
    ]);
  }

  const nameIndex = header.findIndex((cell) => {
    const upper = cell.toUpperCase();
    return upper === 'NOME' || upper === 'NAME';
  });
  if (nameIndex === -1) {
    fail('A folha de ranking não tem coluna "Nome".', [
      { path: 'csv', message: `Cabeçalho encontrado: ${header.join(', ')}.` },
    ]);
  }

  // Column C is found by position, because that is what the sheet's maintainer means by "current
  // points" (FR-027). The guards below exist because a position, unlike a header, cannot say it has
  // moved: without them an inserted column would be imported as points with no complaint.
  const ratingHeader = header[RATING_COLUMN];
  if (ratingHeader === undefined) {
    fail('A folha de ranking não tem coluna C.', [
      {
        path: 'csv',
        message:
          `Cabeçalho encontrado: ${header.join(', ')}. A coluna C tem os pontos atuais; a sua ` +
          'ausência significa que a folha mudou de formato.',
      },
    ]);
  }
  if (idIndex === RATING_COLUMN || nameIndex === RATING_COLUMN) {
    fail('A coluna C da folha de ranking não tem pontos.', [
      {
        path: 'csv',
        message:
          `Cabeçalho encontrado: ${header.join(', ')}. A coluna C é a de "${ratingHeader}", ` +
          'não a dos pontos atuais. A importação foi abortada.',
      },
    ]);
  }

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    fail('A folha de ranking só tem cabeçalho.', [
      { path: 'csv', message: 'Nenhuma linha de dados encontrada. A importação foi abortada.' },
    ]);
  }

  const players: ParsedPlayer[] = [];
  const snapshots: ParsedSnapshot[] = [];
  const seenMatchKeys = new Map<string, ExternalPlayerId[]>();
  let skippedRows = 0;
  let filledCells = 0;
  let badCells = 0;

  for (const line of dataLines) {
    const cells = splitLine(line, delimiter);

    const rawId = cells[idIndex] ?? '';
    const externalId = Number(rawId);
    if (rawId.length === 0 || !Number.isInteger(externalId) || externalId <= 0) {
      skippedRows += 1;
      continue;
    }

    const displayName = cells[nameIndex] ?? '';
    if (displayName.trim().length === 0) {
      skippedRows += 1;
      continue;
    }

    // A repeated `ID` is expected, not an error (FR-004 as amended 2026-08-28). The sheet is
    // third-party maintained and reuses ids across different people; this loop previously skipped
    // every repeat, so those people were dropped from the import entirely before the abort below
    // ever fired. Identity is decided by `matchKey` alone.
    const matchKey = toMatchKey(displayName);
    const existing = seenMatchKeys.get(matchKey);
    if (existing) existing.push(externalId as ExternalPlayerId);
    else seenMatchKeys.set(matchKey, [externalId as ExternalPlayerId]);

    players.push({
      externalId: externalId as ExternalPlayerId,
      displayName: displayName.trim(),
      matchKey,
    });

    const raw = cells[RATING_COLUMN] ?? '';
    // A blank means "not rated", which is not zero points.
    if (raw.length === 0) continue;
    filledCells += 1;
    // Some exports use a comma as the decimal separator; points are integers, so a stray comma
    // means the cell is not a plain number and is dropped rather than reinterpreted.
    const points = Number(raw);
    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) {
      badCells += 1;
      continue;
    }
    snapshots.push({ matchKey, points });
  }

  // One bad cell is a typo; more than one in ten means column C is not points any more (FR-027).
  // Integer arithmetic, so the threshold is exact rather than subject to rounding.
  if (badCells * 10 > filledCells) {
    fail('A coluna C da folha de ranking não parece ter pontos.', [
      {
        path: 'csv',
        message:
          `${badCells} de ${filledCells} células da coluna "${ratingHeader}" não são pontos ` +
          'válidos (mais de uma em dez). A importação foi abortada.',
      },
    ]);
  }

  // Identity collisions abort the import. This is the whole point of ADR-007: a duplicate name means
  // no lineup name can be resolved with confidence, so importing anything would be a guess.
  //
  // Since the 2026-08-28 amendment this is the *only* guard on identity — the `external_id`
  // uniqueness check that used to sit beside it is gone, because the source violates it by design.
  // A regression here merges two real people silently, so it is load-bearing, not defensive.
  const collisions = [...seenMatchKeys.entries()].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    throw new DomainError(
      'DUPLICATE_MATCH_KEY',
      'A folha de ranking tem identidades ambíguas. A importação foi abortada e nada foi escrito.',
      collisions.map(([matchKey, ids]) => ({
        path: 'csv',
        // The ids are printed to help an organiser find the offending rows, not because they
        // identify anyone.
        message: `O nome "${matchKey}" aparece em mais do que uma linha (IDs ${ids.join(', ')}).`,
      })),
    );
  }

  return {
    players,
    snapshots,
    rowsRead: players.length,
    skippedRows,
    ratingHeader,
    headerRatedOn: parseSheetDateHeader(ratingHeader),
  };
}
