import type { ExtractedRowDto, ExtractionFlag, LineupPayload } from '@padelmigas/contracts';
import { DISPLAY_TIME_ZONE } from './format.js';

/**
 * The organiser's working state between an extraction and the mandatory preview (FR-103, FR-109 –
 * FR-111).
 *
 * Pure and platform-free, so the interesting rules — a corrected cell clears its flag, an incomplete
 * draft cannot be serialised, `TOTAL_MISMATCH` never blocks — are testable without a renderer and
 * reusable by a mobile client (Principle II, research D7).
 *
 * The draft is never persisted anywhere: not on the server, not in storage. Leaving the page
 * discards it (FR-121, research D8).
 */

export interface LineupDraft {
  /** Empty on arrival. The image cannot supply it (FR-103). */
  readonly name: string;
  /** `Europe/Lisbon` local date-time, as an `<input type="datetime-local">` value. */
  readonly startsAtLocal: string;
  readonly rows: readonly ExtractedRowDto[];
}

export type DraftCell =
  | { readonly kind: 'playerName'; readonly player: 0 | 1 }
  | { readonly kind: 'playerPoints'; readonly player: 0 | 1 }
  | { readonly kind: 'totalPoints' }
  | { readonly kind: 'club' };

export function createLineupDraft(rows: readonly ExtractedRowDto[]): LineupDraft {
  return { name: '', startsAtLocal: '', rows };
}

/** Empty means "not known", never zero — a zero would be a value the organiser never typed. */
function parseText(value: string): string | null {
  const trimmed = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parsePoints(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Re-derives a row's flags after an edit.
 *
 * Deliberately a copy of the rule in `core/lineup-extraction`, not an import: `packages/ui-logic`
 * may not depend on `packages/core`, and the server re-derives nothing from what the client says
 * anyway — these flags only decide what the organiser sees (FR-112). The server's own copy stays
 * authoritative for what arrives from a reader.
 */
function flagsFor(row: Omit<ExtractedRowDto, 'flags'>): ExtractionFlag[] {
  const flags: ExtractionFlag[] = [];
  const [first, second] = row.players;

  if (first.name === null || second.name === null) flags.push('MISSING_NAME');
  if (first.points === null || second.points === null) flags.push('MISSING_POINTS');
  if (row.club === null) flags.push('MISSING_CLUB');
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

/** Descending by total, rows with no total last, ties stable — the order groups are derived in. */
function byTotalDescending(a: ExtractedRowDto, b: ExtractedRowDto): number {
  if (a.totalPoints === null && b.totalPoints === null) return 0;
  if (a.totalPoints === null) return 1;
  if (b.totalPoints === null) return -1;
  return b.totalPoints - a.totalPoints;
}

function applyCell(row: ExtractedRowDto, cell: DraftCell, value: string): ExtractedRowDto {
  const players: [ExtractedRowDto['players'][0], ExtractedRowDto['players'][1]] = [
    { ...row.players[0] },
    { ...row.players[1] },
  ];
  let totalPoints = row.totalPoints;
  let club = row.club;

  switch (cell.kind) {
    case 'playerName':
      players[cell.player] = { ...players[cell.player], name: parseText(value) };
      break;
    case 'playerPoints':
      players[cell.player] = { ...players[cell.player], points: parsePoints(value) };
      break;
    case 'totalPoints':
      totalPoints = parsePoints(value);
      break;
    case 'club':
      club = parseText(value);
      break;
  }

  const edited = { sourceIndex: row.sourceIndex, players, totalPoints, club };
  return { ...edited, flags: flagsFor(edited) };
}

/**
 * Edits one cell, re-derives that row's flags, and keeps the table in grouping order.
 *
 * Flags are recomputed rather than cleared, so correcting a value clears exactly the flag it fixes
 * and leaves any other flag on that row standing (FR-109). Re-sorting on every edit means a
 * corrected total moves its row to where the lineup will actually be grouped.
 */
export function editCell(
  draft: LineupDraft,
  sourceIndex: number,
  cell: DraftCell,
  value: string,
): LineupDraft {
  if (!draft.rows.some((row) => row.sourceIndex === sourceIndex)) return draft;

  const rows = draft.rows
    .map((row) => (row.sourceIndex === sourceIndex ? applyCell(row, cell, value) : row))
    .sort(byTotalDescending);

  return { ...draft, rows };
}

/** Adds an empty row — fully unknown, and therefore fully flagged. */
export function addRow(draft: LineupDraft): LineupDraft {
  const nextIndex = draft.rows.reduce((max, row) => Math.max(max, row.sourceIndex + 1), 0);
  const empty = {
    sourceIndex: nextIndex,
    players: [
      { name: null, points: null },
      { name: null, points: null },
    ] as [ExtractedRowDto['players'][0], ExtractedRowDto['players'][1]],
    totalPoints: null,
    club: null,
  };

  return { ...draft, rows: [...draft.rows, { ...empty, flags: flagsFor(empty) }] };
}

export function removeRow(draft: LineupDraft, sourceIndex: number): LineupDraft {
  return { ...draft, rows: draft.rows.filter((row) => row.sourceIndex !== sourceIndex) };
}

/** Every value a row must have before it can be part of a payload. */
function rowIsComplete(row: ExtractedRowDto): boolean {
  return (
    row.players.every((player) => player.name !== null && player.points !== null) &&
    row.totalPoints !== null &&
    row.club !== null
  );
}

/** The rows the organiser still has to fix, by source index (FR-110). */
export function incompleteRows(draft: LineupDraft): readonly number[] {
  return draft.rows.filter((row) => !rowIsComplete(row)).map((row) => row.sourceIndex);
}

/**
 * Whether the draft can go to preview.
 *
 * `TOTAL_MISMATCH` is deliberately not part of this: the sheet's own total is authoritative for
 * seeding and can legitimately disagree with the sum, so it is a warning the organiser acknowledges
 * rather than a value that must change (research D3).
 */
export function isLineupDraftComplete(draft: LineupDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.startsAtLocal.trim().length > 0 &&
    draft.rows.length > 0 &&
    incompleteRows(draft).length === 0
  );
}

/**
 * Converts a `Europe/Lisbon` wall-clock value to a UTC instant.
 *
 * The organiser types local time, and every instant in the system is stored UTC. Doing it here
 * rather than in the component keeps the one conversion in the layer that is unit-tested, and reads
 * no clock — the input instant is given, so DST is resolved for the date being entered rather than
 * for today.
 */
function lisbonLocalToUtcIso(localValue: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localValue);
  if (match === null) {
    throw new Error(`Not a datetime-local value: "${localValue}"`);
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];

  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);

  // How far Lisbon is from UTC at that moment. Applied twice because the first correction can land
  // on the other side of a DST transition, and the second settles it.
  let instant = asIfUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = asIfUtc - lisbonOffsetMs(instant);
  }

  return new Date(instant).toISOString();
}

function lisbonOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asLisbonWallClock = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );

  return asLisbonWallClock - instant;
}

/**
 * Serialises the draft into the **existing** lineup payload (FR-111, FR-113, FR-114).
 *
 * No `slug` (derived from the name), no `group` labels (grouping stays derived from points order),
 * no external player ids (identity is resolved server-side against the ranking sheet). This feature
 * changes what fills the payload, not the payload.
 *
 * Throws on an incomplete draft rather than substituting anything. The caller gates on
 * `isLineupDraftComplete` first; reaching here incomplete is a programming error, not organiser input.
 */
export function toLineupPayload(draft: LineupDraft): LineupPayload {
  if (!isLineupDraftComplete(draft)) {
    throw new Error('Refusing to serialise an incomplete lineup draft.');
  }

  return {
    name: draft.name.trim(),
    startsAt: lisbonLocalToUtcIso(draft.startsAtLocal),
    pairs: draft.rows.map((row) => ({
      club: row.club as string,
      totalPoints: row.totalPoints as number,
      players: [
        { name: row.players[0].name as string, points: row.players[0].points as number },
        { name: row.players[1].name as string, points: row.players[1].points as number },
      ] as [{ name: string; points: number }, { name: string; points: number }],
    })),
  };
}
