import type { ExternalPlayerId } from '@padelmigas/contracts';
import { DomainError } from '../errors.js';
import { toMatchKey } from '../matching/index.js';

/**
 * Ranking-sheet CSV parsing (FR-004, research F1, ADR-007).
 *
 * The sheet's real shape, observed on 2026-08-27: `ID`, `Nome`, then 17 dated rating columns, most
 * recent first, with date headers inconsistently formatted — `26/08/2026` and `22-08-2026` both
 * occur. So the parser is tolerant about *format* and strict about *identity*:
 *
 *  - A malformed rating cell drops that snapshot; the player still imports.
 *  - A row without a usable id or name is skipped and counted, so the sync can report it.
 *  - Two rows that normalise to the same name, or share an id, **abort the whole import**. Guessing
 *    which identity a lineup name refers to is the one failure this system must never have.
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
  readonly externalId: ExternalPlayerId;
  /** `YYYY-MM-DD`, parsed from the column header. */
  readonly ratedOn: string;
  readonly points: number;
}

export interface ParsedRankings {
  readonly players: readonly ParsedPlayer[];
  readonly snapshots: readonly ParsedSnapshot[];
  /** Data rows the parser accepted. */
  readonly rowsRead: number;
  /** Rows dropped for an unusable id or name — surfaced so a shape change is visible. */
  readonly skippedRows: number;
  /** Newest date seen in the headers, or `null` when the sheet had no usable dates. */
  readonly latestRatedOn: string | null;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Parses a dated column header into `YYYY-MM-DD`, or `null` when it is not a date.
 *
 * Accepts `dd/mm/yyyy` and `dd-mm-yyyy` because both appear in the same sheet. Day-first, not
 * month-first: the sheet is Portuguese, so `26/08/2026` is 26 August.
 */
export function parseSheetDateHeader(header: string): string | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(header.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) return null;

  const monthIndex = month - 1;
  const maxDay = monthIndex === 1 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[monthIndex] ?? 0);
  if (day < 1 || day > maxDay) return null;

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

  // Every remaining column that parses as a date is a rating column. Anything else (a club column,
  // a stray note) is ignored rather than guessed at.
  const dateColumns: { index: number; ratedOn: string }[] = [];
  header.forEach((cell, index) => {
    if (index === idIndex || index === nameIndex) return;
    const ratedOn = parseSheetDateHeader(cell);
    if (ratedOn !== null) dateColumns.push({ index, ratedOn });
  });

  if (dateColumns.length === 0) {
    fail('A folha de ranking não tem nenhuma coluna com data.', [
      {
        path: 'csv',
        message:
          `Cabeçalho encontrado: ${header.join(', ')}. As colunas datadas são a origem do ` +
          'histórico de pontos; a sua ausência significa que a folha mudou de formato.',
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
  const seenIds = new Set<number>();
  const duplicateIds: number[] = [];
  let skippedRows = 0;

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

    if (seenIds.has(externalId)) {
      duplicateIds.push(externalId);
      continue;
    }
    seenIds.add(externalId);

    const matchKey = toMatchKey(displayName);
    const existing = seenMatchKeys.get(matchKey);
    if (existing) existing.push(externalId as ExternalPlayerId);
    else seenMatchKeys.set(matchKey, [externalId as ExternalPlayerId]);

    players.push({
      externalId: externalId as ExternalPlayerId,
      displayName: displayName.trim(),
      matchKey,
    });

    for (const column of dateColumns) {
      const raw = cells[column.index] ?? '';
      if (raw.length === 0) continue;
      // Some exports use a comma as the decimal separator; points are integers, so a stray comma
      // means the cell is not a plain number and is dropped rather than reinterpreted.
      const points = Number(raw);
      if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) continue;
      snapshots.push({
        externalId: externalId as ExternalPlayerId,
        ratedOn: column.ratedOn,
        points,
      });
    }
  }

  // Identity collisions abort the import. This is the whole point of ADR-007: a duplicate name means
  // no lineup name can be resolved with confidence, so importing anything would be a guess.
  const collisions = [...seenMatchKeys.entries()].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0 || duplicateIds.length > 0) {
    throw new DomainError(
      'DUPLICATE_MATCH_KEY',
      'A folha de ranking tem identidades ambíguas. A importação foi abortada e nada foi escrito.',
      [
        ...collisions.map(([matchKey, ids]) => ({
          path: 'csv',
          message: `O nome "${matchKey}" aparece em mais do que uma linha (IDs ${ids.join(', ')}).`,
        })),
        ...duplicateIds.map((id) => ({
          path: 'csv',
          message: `O ID ${id} aparece em mais do que uma linha.`,
        })),
      ],
    );
  }

  const latestRatedOn =
    dateColumns
      .map((column) => column.ratedOn)
      .sort()
      .at(-1) ?? null;

  return {
    players,
    snapshots,
    rowsRead: players.length,
    skippedRows,
    latestRatedOn,
  };
}
