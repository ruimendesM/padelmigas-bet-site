import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { parseRankingCsv, parseSheetDateHeader } from './parse.js';

/**
 * Ranking CSV parsing (FR-004, research F1).
 *
 * The shape is not hypothetical — it was observed on 2026-08-27: `ID`, `Nome`, then 17 dated rating
 * columns, most recent first, with date headers inconsistently formatted (`26/08/2026` and
 * `22-08-2026` both occur). Parsing must be tolerant of that and intolerant of everything that would
 * let a wrong identity through.
 */

describe('parseSheetDateHeader', () => {
  it('parses the slash form', () => {
    expect(parseSheetDateHeader('26/08/2026')).toBe('2026-08-26');
  });

  it('parses the hyphen form', () => {
    // Both formats genuinely appear in the same sheet (research F1).
    expect(parseSheetDateHeader('22-08-2026')).toBe('2026-08-22');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSheetDateHeader('  26/08/2026 ')).toBe('2026-08-26');
  });

  it('rejects a non-date header', () => {
    expect(parseSheetDateHeader('Nome')).toBeNull();
  });

  it('rejects an impossible day', () => {
    expect(parseSheetDateHeader('32/08/2026')).toBeNull();
  });

  it('rejects an impossible month', () => {
    expect(parseSheetDateHeader('26/13/2026')).toBeNull();
  });

  it('rejects a day that does not exist in that month', () => {
    // 2026 is not a leap year.
    expect(parseSheetDateHeader('29/02/2026')).toBeNull();
  });

  it('accepts a leap day in a leap year', () => {
    expect(parseSheetDateHeader('29/02/2024')).toBe('2024-02-29');
  });
});

describe('parseRankingCsv', () => {
  const csv = [
    'ID,Nome,26/08/2026,22-08-2026',
    '101,"Afonso Bastos",533,530',
    '102,"Vasco Trindade",660,655',
  ].join('\n');

  it('reads players with their dated snapshots', () => {
    const result = parseRankingCsv(csv);

    expect(result.rowsRead).toBe(2);
    expect(result.players).toHaveLength(2);
    expect(result.players[0]).toMatchObject({
      externalId: 101,
      displayName: 'Afonso Bastos',
      matchKey: 'afonso bastos',
    });
    expect(result.snapshots.filter((s) => s.externalId === 101)).toEqual([
      { externalId: 101, ratedOn: '2026-08-26', points: 533 },
      { externalId: 101, ratedOn: '2026-08-22', points: 530 },
    ]);
  });

  it('reports the newest rated date it saw', () => {
    expect(parseRankingCsv(csv).latestRatedOn).toBe('2026-08-26');
  });

  it('handles CRLF line endings', () => {
    const crlf = csv.replace(/\n/g, '\r\n');
    expect(parseRankingCsv(crlf).players).toHaveLength(2);
  });

  it('ignores a trailing blank line', () => {
    expect(parseRankingCsv(`${csv}\n`).rowsRead).toBe(2);
  });

  it('handles a quoted name containing a comma', () => {
    const withComma = ['ID,Nome,26/08/2026', '103,"Neves, Salvador",507'].join('\n');
    expect(parseRankingCsv(withComma).players[0]?.displayName).toBe('Neves, Salvador');
  });

  it('handles an escaped quote inside a name', () => {
    const withQuote = ['ID,Nome,26/08/2026', '104,"O""Brien",500'].join('\n');
    expect(parseRankingCsv(withQuote).players[0]?.displayName).toBe('O"Brien');
  });

  it('handles an unquoted name', () => {
    const unquoted = ['ID,Nome,26/08/2026', '105,Duarte Vilaça,495'].join('\n');
    expect(parseRankingCsv(unquoted).players[0]?.displayName).toBe('Duarte Vilaça');
  });

  it('skips a blank rating cell rather than recording zero', () => {
    // A blank means "not rated on that date", which is not the same as zero points.
    const sparse = ['ID,Nome,26/08/2026,22-08-2026', '106,"Xavier Lourenço",449,'].join('\n');
    const result = parseRankingCsv(sparse);
    expect(result.snapshots).toEqual([{ externalId: 106, ratedOn: '2026-08-26', points: 449 }]);
  });

  it('ignores a non-date column between the name and the ratings', () => {
    const withExtra = ['ID,Nome,Clube,26/08/2026', '107,"Gabriel Rebelo","Clube Norte",481'].join(
      '\n',
    );
    const result = parseRankingCsv(withExtra);
    expect(result.snapshots).toEqual([{ externalId: 107, ratedOn: '2026-08-26', points: 481 }]);
  });

  it('rejects two rows whose names normalise identically', () => {
    // ADR-007: uniqueness is today's data, not a guarantee. The check runs on every import and the
    // import aborts rather than guessing which identity a lineup name refers to.
    const colliding = ['ID,Nome,26/08/2026', '201,"Ana Silva",400', '202,"ANA  SILVA",410'].join(
      '\n',
    );

    let caught: DomainError | undefined;
    try {
      parseRankingCsv(colliding);
    } catch (error) {
      caught = error as DomainError;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(caught?.code).toBe('DUPLICATE_MATCH_KEY');
    expect(caught?.issues[0]?.message).toContain('ana silva');
    expect(caught?.issues[0]?.message).toContain('201');
    expect(caught?.issues[0]?.message).toContain('202');
  });

  it('rejects two rows sharing an ID', () => {
    const colliding = ['ID,Nome,26/08/2026', '301,"Um Nome",400', '301,"Outro Nome",410'].join(
      '\n',
    );
    expect(() => parseRankingCsv(colliding)).toThrow(DomainError);
  });

  it('rejects a header without an ID column', () => {
    expect(() => parseRankingCsv('Nome,26/08/2026\n"Ana",400')).toThrow(DomainError);
  });

  it('rejects a header without a name column', () => {
    expect(() => parseRankingCsv('ID,26/08/2026\n101,400')).toThrow(DomainError);
  });

  it('rejects a header with no dated columns at all', () => {
    // Without a date there is no rating history to import, which means the sheet changed shape.
    expect(() => parseRankingCsv('ID,Nome\n101,"Ana"')).toThrow(DomainError);
  });

  it('rejects an empty document', () => {
    expect(() => parseRankingCsv('')).toThrow(DomainError);
  });

  it('rejects a document with only a header', () => {
    expect(() => parseRankingCsv('ID,Nome,26/08/2026')).toThrow(DomainError);
  });

  it('skips a row whose ID is not a positive integer', () => {
    const bad = ['ID,Nome,26/08/2026', ',"Sem ID",400', '0,"Zero",400', '108,"Válido",400'].join(
      '\n',
    );
    const result = parseRankingCsv(bad);
    expect(result.players.map((p) => p.externalId)).toEqual([108]);
    expect(result.skippedRows).toBe(2);
  });

  it('skips a row with an empty name', () => {
    const bad = ['ID,Nome,26/08/2026', '109,"",400', '110,"Válido",400'].join('\n');
    const result = parseRankingCsv(bad);
    expect(result.players.map((p) => p.externalId)).toEqual([110]);
    expect(result.skippedRows).toBe(1);
  });

  it('tolerates a row with fewer cells than the header', () => {
    const short = ['ID,Nome,26/08/2026,22-08-2026', '111,"Curto",420'].join('\n');
    const result = parseRankingCsv(short);
    expect(result.snapshots).toHaveLength(1);
  });

  it('accepts a semicolon-delimited export', () => {
    // Some locales export CSV with semicolons; failing on it would be a support call, not a bug.
    const semi = ['ID;Nome;26/08/2026', '112;"Ponto e vírgula";430'].join('\n');
    const result = parseRankingCsv(semi);
    expect(result.players[0]?.externalId).toBe(112);
    expect(result.snapshots[0]?.points).toBe(430);
  });

  it('rejects a rating that is not a number', () => {
    const bad = ['ID,Nome,26/08/2026', '113,"Texto",n/a'].join('\n');
    const result = parseRankingCsv(bad);
    // The player is still valid; only that snapshot is dropped.
    expect(result.players).toHaveLength(1);
    expect(result.snapshots).toEqual([]);
  });

  it('rejects a negative rating', () => {
    const bad = ['ID,Nome,26/08/2026', '114,"Negativo",-5'].join('\n');
    expect(parseRankingCsv(bad).snapshots).toEqual([]);
  });

  it('strips a UTF-8 byte order mark from the header', () => {
    const withBom = `\ufeffID,Nome,26/08/2026\n115,"Com BOM",440`;
    expect(parseRankingCsv(withBom).players[0]?.externalId).toBe(115);
  });
});
