import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { parseRankingCsv, parseSheetDateHeader } from './parse.js';

/**
 * Ranking CSV parsing (FR-004, FR-027, research F1).
 *
 * The shape is not hypothetical: `ID`, `Nome`, then dated rating columns, most recent first. By
 * 2026-09-28 the headers mixed day-first and month-first dates that no parser can tell apart, so only
 * column C — the current points — is read (FR-027, amended 2026-09-30). Parsing must be tolerant of
 * everything after column C and intolerant of everything that would let a wrong identity or a wrong
 * number through.
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

  /** Ten valid rows, so a single bad column C cell stays under the one-in-ten abort threshold. */
  function tenRows(columnC: (index: number) => string): string {
    const rows = Array.from(
      { length: 10 },
      (_, index) => `${500 + index},"Jogador ${index}",${columnC(index)}`,
    );
    return ['ID,Nome,26/08/2026', ...rows].join('\n');
  }

  function caught(run: () => unknown): DomainError | undefined {
    try {
      run();
    } catch (error) {
      return error as DomainError;
    }
    return undefined;
  }

  it('reads players with one snapshot each, from column C', () => {
    const result = parseRankingCsv(csv);

    expect(result.rowsRead).toBe(2);
    expect(result.players).toHaveLength(2);
    expect(result.players[0]).toMatchObject({
      externalId: 101,
      displayName: 'Afonso Bastos',
      matchKey: 'afonso bastos',
    });
    // The 530 in column D is not read: history is no longer collected from the sheet (FR-027).
    expect(result.snapshots).toEqual([
      { matchKey: 'afonso bastos', points: 533 },
      { matchKey: 'vasco trindade', points: 660 },
    ]);
  });

  it("reports column C's raw header and its parsed date", () => {
    const result = parseRankingCsv(csv);
    expect(result.ratingHeader).toBe('26/08/2026');
    expect(result.headerRatedOn).toBe('2026-08-26');
  });

  it("reports a null date when column C's header is not a date", () => {
    // The date rule falls back to the sync day; the parser only reports what it saw (FR-027).
    const typo = ['ID,Nome,08-08-20262', '101,"Afonso Bastos",533'].join('\n');
    const result = parseRankingCsv(typo);
    expect(result.ratingHeader).toBe('08-08-20262');
    expect(result.headerRatedOn).toBeNull();
    expect(result.snapshots).toEqual([{ matchKey: 'afonso bastos', points: 533 }]);
  });

  it('ignores every column after C, even when its header or cells are broken', () => {
    // The real sheet on 2026-09-28: a mistyped year and a month-first date after column C.
    const broken = [
      'ID,Nome,26/09/2026,08-08-20262,09-12-2026,Notas',
      '101,"Afonso Bastos",533,lixo,-4,"qualquer, coisa"',
    ].join('\n');
    expect(parseRankingCsv(broken).snapshots).toEqual([{ matchKey: 'afonso bastos', points: 533 }]);
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

  it('skips a blank column C cell rather than recording zero', () => {
    // A blank means "not rated", which is not the same as zero points.
    const sparse = ['ID,Nome,26/08/2026', '106,"Xavier Lourenço",', '107,"Rita Sá",449'].join('\n');
    const result = parseRankingCsv(sparse);
    expect(result.players).toHaveLength(2);
    expect(result.snapshots).toEqual([{ matchKey: 'rita sá', points: 449 }]);
  });

  it('imports every player and no points when column C is entirely empty', () => {
    // FR-027: players still import; current points keep their last stored values.
    const empty = ['ID,Nome,26/08/2026', '106,"Xavier Lourenço",', '107,"Rita Sá",'].join('\n');
    const result = parseRankingCsv(empty);
    expect(result.players).toHaveLength(2);
    expect(result.snapshots).toEqual([]);
  });

  it('drops a single bad cell when it is at most one in ten', () => {
    const oneBad = tenRows((index) => (index === 0 ? 'n/a' : String(400 + index)));
    const result = parseRankingCsv(oneBad);
    expect(result.players).toHaveLength(10);
    expect(result.snapshots).toHaveLength(9);
    expect(result.snapshots.map((s) => s.matchKey)).not.toContain('jogador 0');
  });

  it('aborts when more than one in ten column C cells is not a number', () => {
    // Two of ten: column C is probably not points any more, so importing it would be a guess.
    const twoBad = tenRows((index) => (index < 2 ? 'n/a' : String(400 + index)));
    const error = caught(() => parseRankingCsv(twoBad));
    expect(error).toBeInstanceOf(DomainError);
    expect(error?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('counts negative and fractional points as not a number', () => {
    const bad = tenRows((index) => (index === 0 ? '-5' : index === 1 ? '4.5' : '400'));
    expect(caught(() => parseRankingCsv(bad))?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('aborts when a text column has been inserted at C', () => {
    // A "Clube" column landing at C would otherwise import club names as points.
    const withClub = [
      'ID,Nome,Clube,26/08/2026',
      '107,"Gabriel Rebelo","Clube Norte",481',
      '108,"Ines Moura","Clube Sul",470',
    ].join('\n');
    expect(caught(() => parseRankingCsv(withClub))?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('aborts when the name column sits in column C', () => {
    const shifted = ['Clube,ID,Nome,26/08/2026', 'Norte,101,"Ana",400'].join('\n');
    expect(caught(() => parseRankingCsv(shifted))?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('aborts when the ID column sits in column C', () => {
    const shifted = ['Nome,Clube,ID,26/08/2026', '"Ana",Norte,101,400'].join('\n');
    expect(caught(() => parseRankingCsv(shifted))?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('aborts when the header has no column C', () => {
    // Without column C there are no current points to import, which means the sheet changed shape.
    expect(caught(() => parseRankingCsv('ID,Nome\n101,"Ana"'))?.code).toBe('MALFORMED_PAYLOAD');
  });

  it('rejects two rows whose names normalise identically', () => {
    // ADR-007: uniqueness is today's data, not a guarantee. The check runs on every import and the
    // import aborts rather than guessing which identity a lineup name refers to.
    const colliding = ['ID,Nome,26/08/2026', '201,"Ana Silva",400', '202,"ANA  SILVA",410'].join(
      '\n',
    );

    const error = caught(() => parseRankingCsv(colliding));

    expect(error).toBeInstanceOf(DomainError);
    expect(error?.code).toBe('DUPLICATE_MATCH_KEY');
    expect(error?.issues[0]?.message).toContain('ana silva');
    expect(error?.issues[0]?.message).toContain('201');
    expect(error?.issues[0]?.message).toContain('202');
  });

  it('accepts two rows sharing an ID, because the real sheet is full of them', () => {
    // FR-004 as amended 2026-08-28. The live sheet had 784 rows carrying only 756 distinct ids: 18
    // were shared by 46 rows describing different people. Rejecting a repeat meant every import of
    // the real sheet aborted.
    const shared = ['ID,Nome,26/08/2026', '301,"Um Nome",400', '301,"Outro Nome",410'].join('\n');
    const result = parseRankingCsv(shared);

    expect(result.players).toHaveLength(2);
    expect(result.players.map((p) => p.matchKey)).toEqual(['um nome', 'outro nome']);
    expect(result.players.map((p) => p.externalId)).toEqual([301, 301]);
    // Both people keep their own rating, keyed by match key rather than by the shared id.
    expect(result.snapshots).toEqual([
      { matchKey: 'um nome', points: 400 },
      { matchKey: 'outro nome', points: 410 },
    ]);
  });

  it('rejects a header without an ID column', () => {
    expect(() => parseRankingCsv('Nome,X,26/08/2026\n"Ana",x,400')).toThrow(DomainError);
  });

  it('rejects a header without a name column', () => {
    expect(() => parseRankingCsv('ID,X,26/08/2026\n101,x,400')).toThrow(DomainError);
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

  it('skips a row too short to reach an ID or name column placed after C', () => {
    // Nothing requires `ID` and `Nome` to come first, only that neither sits in column C.
    const late = [
      'Clube,X,26/08/2026,ID,Nome',
      'Norte,x,400',
      'Sul,x,410,120',
      'Este,x,420,121,"Ana"',
    ];
    const result = parseRankingCsv(late.join('\n'));
    expect(result.players.map((p) => p.externalId)).toEqual([121]);
    expect(result.skippedRows).toBe(2);
  });

  it('does not count a skipped row towards the bad-cell threshold', () => {
    // A row without an id is already reported as skipped; its column C must not also abort the sync.
    const skipped = ['ID,Nome,26/08/2026', ',"Sem ID",lixo', '110,"Válido",400'].join('\n');
    expect(parseRankingCsv(skipped).snapshots).toEqual([{ matchKey: 'válido', points: 400 }]);
  });

  it('tolerates a row with fewer cells than the header', () => {
    const short = ['ID,Nome,26/08/2026,22-08-2026', '111,"Curto",420', '112,"Mais Curto"'].join(
      '\n',
    );
    const result = parseRankingCsv(short);
    expect(result.players).toHaveLength(2);
    expect(result.snapshots).toEqual([{ matchKey: 'curto', points: 420 }]);
  });

  it('accepts a semicolon-delimited export', () => {
    // Some locales export CSV with semicolons; failing on it would be a support call, not a bug.
    const semi = ['ID;Nome;26/08/2026', '112;"Ponto e vírgula";430'].join('\n');
    const result = parseRankingCsv(semi);
    expect(result.players[0]?.externalId).toBe(112);
    expect(result.snapshots[0]?.points).toBe(430);
  });

  it('strips a UTF-8 byte order mark from the header', () => {
    const withBom = `\ufeffID,Nome,26/08/2026\n115,"Com BOM",440`;
    expect(parseRankingCsv(withBom).players[0]?.externalId).toBe(115);
  });
});
