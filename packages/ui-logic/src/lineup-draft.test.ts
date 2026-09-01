import { describe, expect, it } from 'vitest';
import type { ExtractedRowDto } from '@padelmigas/contracts';
import {
  addRow,
  createLineupDraft,
  editCell,
  incompleteRows,
  isLineupDraftComplete,
  removeRow,
  toLineupPayload,
  type LineupDraft,
} from './lineup-draft.js';

/**
 * The organiser's working state between extraction and preview (FR-103, FR-109, FR-110).
 *
 * Pure on purpose: these are the transitions a mobile client would need too, and keeping them out
 * of the component is what makes flag clearing and the completeness rule testable without a DOM
 * (Principle II, research D7).
 */

function row(overrides: Partial<ExtractedRowDto> = {}): ExtractedRowDto {
  return {
    sourceIndex: 0,
    players: [
      { name: 'Afonso Bastos', points: 500 },
      { name: 'Vasco Trindade', points: 400 },
    ],
    totalPoints: 900,
    club: 'Clube Padel Norte',
    flags: [],
    ...overrides,
  };
}

function draftOf(...rows: ExtractedRowDto[]): LineupDraft {
  return {
    ...createLineupDraft(rows),
    name: 'Torneio de Setembro',
    startsAtLocal: '2026-09-12T18:00',
  };
}

describe('createLineupDraft', () => {
  it('starts with the two fields the image cannot supply empty', () => {
    const draft = createLineupDraft([row()]);

    expect(draft.name).toBe('');
    expect(draft.startsAtLocal).toBe('');
    expect(draft.rows).toHaveLength(1);
  });
});

describe('editCell', () => {
  it('edits a player name in place, leaving every other row untouched', () => {
    const draft = draftOf(row({ sourceIndex: 0 }), row({ sourceIndex: 1 }));

    const next = editCell(draft, 0, { kind: 'playerName', player: 1 }, 'Duarte Vilaça');

    expect(next.rows[0]?.players[1].name).toBe('Duarte Vilaça');
    expect(next.rows[1]).toEqual(draft.rows[1]);
  });

  it('edits points as a number, and treats an emptied field as unknown rather than zero', () => {
    const draft = draftOf(row());

    expect(
      editCell(draft, 0, { kind: 'playerPoints', player: 0 }, '480').rows[0]?.players[0].points,
    ).toBe(480);
    expect(
      editCell(draft, 0, { kind: 'playerPoints', player: 0 }, '').rows[0]?.players[0].points,
    ).toBeNull();
  });

  it('edits the club and the total', () => {
    const draft = draftOf(row());

    expect(editCell(draft, 0, { kind: 'club' }, 'Clube Padel Sul').rows[0]?.club).toBe(
      'Clube Padel Sul',
    );
    expect(editCell(draft, 0, { kind: 'totalPoints' }, '880').rows[0]?.totalPoints).toBe(880);
  });

  it('ignores an edit to a row that is not in the draft', () => {
    const draft = draftOf(row({ sourceIndex: 0 }));

    expect(editCell(draft, 42, { kind: 'club' }, 'nowhere')).toEqual(draft);
  });
});

describe('addRow and removeRow', () => {
  it('adds an empty row that does not collide with an existing source index', () => {
    const draft = draftOf(row({ sourceIndex: 0 }), row({ sourceIndex: 3 }));

    const next = addRow(draft);
    const added = next.rows[next.rows.length - 1];

    expect(next.rows).toHaveLength(3);
    expect(added?.sourceIndex).toBe(4);
    expect(added?.players.map((p) => p.name)).toEqual([null, null]);
    expect(added?.totalPoints).toBeNull();
  });

  it('removes the named row and only that row', () => {
    const draft = draftOf(row({ sourceIndex: 0 }), row({ sourceIndex: 1, club: 'keep me' }));

    const next = removeRow(draft, 0);

    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]?.club).toBe('keep me');
  });
});

describe('toLineupPayload', () => {
  it('produces the existing lineup payload shape, with a UTC instant', () => {
    const draft = draftOf(
      row({ sourceIndex: 0, totalPoints: 900 }),
      row({
        sourceIndex: 1,
        totalPoints: 800,
        club: 'Clube Padel Sul',
        players: [
          { name: 'Otávio Chaves', points: 420 },
          { name: 'Rodrigo da Costa', points: 380 },
        ],
      }),
    );

    const payload = toLineupPayload(draft);

    expect(payload).toEqual({
      name: 'Torneio de Setembro',
      // 18:00 Lisbon in September is 17:00Z — WEST, UTC+1.
      startsAt: '2026-09-12T17:00:00.000Z',
      pairs: [
        {
          club: 'Clube Padel Norte',
          totalPoints: 900,
          players: [
            { name: 'Afonso Bastos', points: 500 },
            { name: 'Vasco Trindade', points: 400 },
          ],
        },
        {
          club: 'Clube Padel Sul',
          totalPoints: 800,
          players: [
            { name: 'Otávio Chaves', points: 420 },
            { name: 'Rodrigo da Costa', points: 380 },
          ],
        },
      ],
    });
  });

  it('carries no slug, no group labels and no external ids — all of those stay derived', () => {
    const payload = toLineupPayload(draftOf(row()));

    expect(payload).not.toHaveProperty('slug');
    expect(payload.pairs[0]).not.toHaveProperty('group');
    expect(payload.pairs[0]?.players[0]).not.toHaveProperty('externalId');
  });

  it('refuses to serialise an incomplete draft rather than inventing values', () => {
    const draft = draftOf(
      row({
        players: [
          { name: null, points: 500 },
          { name: 'x', points: 1 },
        ],
      }),
    );

    expect(() => toLineupPayload(draft)).toThrow();
  });
});

describe('flags on the draft', () => {
  it('clears exactly the flag an edit fixes, leaving the rest standing', () => {
    const draft = draftOf(
      row({
        players: [
          { name: null, points: null },
          { name: 'Vasco Trindade', points: 400 },
        ],
        club: null,
        totalPoints: 900,
      }),
    );
    expect(draft.rows[0]?.flags).toEqual([]);

    const named = editCell(draft, 0, { kind: 'playerName', player: 0 }, 'Afonso Bastos');
    expect(named.rows[0]?.flags).toEqual(['MISSING_POINTS', 'MISSING_CLUB']);

    const pointed = editCell(named, 0, { kind: 'playerPoints', player: 0 }, '500');
    expect(pointed.rows[0]?.flags).toEqual(['MISSING_CLUB']);

    const clubbed = editCell(pointed, 0, { kind: 'club' }, 'Clube Padel Norte');
    expect(clubbed.rows[0]?.flags).toEqual([]);
  });

  it('raises TOTAL_MISMATCH when an edit makes the total disagree, and clears it on repair', () => {
    const draft = draftOf(row());

    const broken = editCell(draft, 0, { kind: 'totalPoints' }, '950');
    expect(broken.rows[0]?.flags).toEqual(['TOTAL_MISMATCH']);

    const repaired = editCell(broken, 0, { kind: 'totalPoints' }, '900');
    expect(repaired.rows[0]?.flags).toEqual([]);
  });

  it('re-sorts when an edited total changes the order', () => {
    const draft = draftOf(
      row({ sourceIndex: 0, totalPoints: 900 }),
      row({ sourceIndex: 1, totalPoints: 800 }),
    );

    const next = editCell(draft, 1, { kind: 'totalPoints' }, '1000');

    expect(next.rows.map((r) => r.sourceIndex)).toEqual([1, 0]);
  });

  it('gives an added row every missing-value flag', () => {
    const added = addRow(draftOf(row()));

    expect(added.rows[1]?.flags).toEqual(['MISSING_NAME', 'MISSING_POINTS', 'MISSING_CLUB']);
  });
});

describe('completeness', () => {
  it('is incomplete while a required value is missing, and names the rows', () => {
    const draft = draftOf(
      row({ sourceIndex: 0 }),
      row({
        sourceIndex: 1,
        players: [
          { name: 'x', points: null },
          { name: 'y', points: 1 },
        ],
      }),
    );

    expect(isLineupDraftComplete(draft)).toBe(false);
    expect(incompleteRows(draft)).toEqual([1]);
  });

  it('is incomplete without a tournament name or a start time', () => {
    const rows = [row()];

    expect(isLineupDraftComplete({ name: '', startsAtLocal: '2026-09-12T18:00', rows })).toBe(
      false,
    );
    expect(isLineupDraftComplete({ name: 'Torneio', startsAtLocal: '  ', rows })).toBe(false);
    expect(
      isLineupDraftComplete({ name: 'Torneio', startsAtLocal: '2026-09-12T18:00', rows }),
    ).toBe(true);
  });

  it('is incomplete with no rows at all', () => {
    expect(isLineupDraftComplete(draftOf())).toBe(false);
  });

  it('is complete with only a TOTAL_MISMATCH outstanding', () => {
    // The sheet's own total is what the club seeds by, so a mismatch is acknowledged, not fixed.
    const draft = draftOf(row({ totalPoints: 950 }));

    expect(draft.rows).toHaveLength(1);
    expect(isLineupDraftComplete(draft)).toBe(true);
    expect(incompleteRows(draft)).toEqual([]);
  });
});

describe('start time conversion', () => {
  it('resolves DST for the date entered, not for today', () => {
    const summer = toLineupPayload({
      ...draftOf(row()),
      startsAtLocal: '2026-07-01T18:00',
    });
    const winter = toLineupPayload({
      ...draftOf(row()),
      startsAtLocal: '2026-12-01T18:00',
    });

    // Lisbon is UTC+1 in July (WEST) and UTC+0 in December (WET).
    expect(summer.startsAt).toBe('2026-07-01T17:00:00.000Z');
    expect(winter.startsAt).toBe('2026-12-01T18:00:00.000Z');
  });

  it('refuses a start time that is not a datetime-local value', () => {
    expect(() => toLineupPayload({ ...draftOf(row()), startsAtLocal: 'next Tuesday' })).toThrow();
  });
});
