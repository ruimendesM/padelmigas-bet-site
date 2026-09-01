'use client';

import type { ExtractedRowDto, ExtractionFlag } from '@padelmigas/contracts';
import {
  addRow,
  editCell,
  removeRow,
  type DraftCell,
  type LineupDraft,
} from '@padelmigas/ui-logic';
import { t } from '../../src/i18n/index.js';

/**
 * The editable draft read from an image (FR-103, FR-106, FR-109).
 *
 * Every transition lives in `@padelmigas/ui-logic`; this component renders state and reports edits.
 * That split is what lets the interesting rules — a corrected cell clears its flag, order follows
 * pair total — be unit-tested without a DOM, and reused by a mobile client (Principle II).
 *
 * Flags are shown per cell with the reason spelled out, never as a code. A marked cell is a request
 * to look, not a refusal: `TOTAL_MISMATCH` in particular does not block the preview, because the
 * sheet's own total is what the club seeds by.
 */

interface Props {
  readonly draft: LineupDraft;
  readonly onChange: (draft: LineupDraft) => void;
  readonly disabled: boolean;
}

const FLAG_MESSAGES: Record<ExtractionFlag, string> = {
  MISSING_NAME: t.admin.flagMISSING_NAME,
  MISSING_POINTS: t.admin.flagMISSING_POINTS,
  MISSING_CLUB: t.admin.flagMISSING_CLUB,
  TOTAL_MISMATCH: t.admin.flagTOTAL_MISMATCH,
};

/** A cell is suspect when the flag that covers it is present and the value is still unusable. */
function cellFlag(row: ExtractedRowDto, cell: DraftCell): ExtractionFlag | null {
  switch (cell.kind) {
    case 'playerName':
      return row.players[cell.player].name === null ? 'MISSING_NAME' : null;
    case 'playerPoints':
      return row.players[cell.player].points === null ? 'MISSING_POINTS' : null;
    case 'club':
      return row.club === null ? 'MISSING_CLUB' : null;
    case 'totalPoints':
      if (row.totalPoints === null) return 'MISSING_POINTS';
      return row.flags.includes('TOTAL_MISMATCH') ? 'TOTAL_MISMATCH' : null;
  }
}

export function LineupDraftTable({ draft, onChange, disabled }: Props) {
  function cellProps(row: ExtractedRowDto, cell: DraftCell, value: string | number | null) {
    const flag = cellFlag(row, cell);
    return {
      value: value === null ? '' : String(value),
      disabled,
      onChange: (event: { target: { value: string } }) =>
        onChange(editCell(draft, row.sourceIndex, cell, event.target.value)),
      'aria-invalid': flag !== null,
      title: flag === null ? undefined : FLAG_MESSAGES[flag],
      className: [
        'bg-surface min-h-9 w-full rounded border px-2 text-xs',
        flag === null ? 'border-border' : 'border-danger',
      ].join(' '),
    };
  }

  return (
    <section className="mt-6" aria-label={t.admin.draftHeading}>
      <h2 className="text-sm font-semibold">{t.admin.draftHeading}</h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-separate border-spacing-1 text-xs">
          <thead className="text-ink-muted text-left">
            <tr>
              <th scope="col">{t.admin.draftPlayer1}</th>
              <th scope="col">{t.admin.draftPoints1}</th>
              <th scope="col">{t.admin.draftPlayer2}</th>
              <th scope="col">{t.admin.draftPoints2}</th>
              <th scope="col">{t.admin.draftTotal}</th>
              <th scope="col">{t.admin.draftClub}</th>
              <th scope="col" className="sr-only">
                {t.admin.draftRemoveRow}
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row) => (
              <tr key={row.sourceIndex}>
                <td>
                  <input
                    aria-label={`${t.admin.draftPlayer1} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'playerName', player: 0 }, row.players[0].name)}
                  />
                </td>
                <td className="w-20">
                  <input
                    inputMode="numeric"
                    aria-label={`${t.admin.draftPoints1} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'playerPoints', player: 0 }, row.players[0].points)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${t.admin.draftPlayer2} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'playerName', player: 1 }, row.players[1].name)}
                  />
                </td>
                <td className="w-20">
                  <input
                    inputMode="numeric"
                    aria-label={`${t.admin.draftPoints2} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'playerPoints', player: 1 }, row.players[1].points)}
                  />
                </td>
                <td className="w-24">
                  <input
                    inputMode="numeric"
                    aria-label={`${t.admin.draftTotal} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'totalPoints' }, row.totalPoints)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${t.admin.draftClub} ${row.sourceIndex + 1}`}
                    {...cellProps(row, { kind: 'club' }, row.club)}
                  />
                </td>
                <td className="w-10">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(removeRow(draft, row.sourceIndex))}
                    aria-label={`${t.admin.draftRemoveRow} ${row.sourceIndex + 1}`}
                    className="border-border text-ink-muted min-h-9 w-full rounded border text-xs"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Every flag on the table, spelled out once, so the reasons are readable without hovering. */}
      {draft.rows.some((row) => row.flags.length > 0) ? (
        <ul className="text-danger mt-2 space-y-1 text-xs">
          {draft.rows.flatMap((row) =>
            row.flags.map((flag) => (
              <li key={`${row.sourceIndex}-${flag}`}>
                #{row.sourceIndex + 1}: {FLAG_MESSAGES[flag]}
              </li>
            )),
          )}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(addRow(draft))}
        className="border-border text-ink-muted mt-3 min-h-11 rounded-md border px-3 text-xs"
      >
        {t.admin.draftAddRow}
      </button>
    </section>
  );
}
