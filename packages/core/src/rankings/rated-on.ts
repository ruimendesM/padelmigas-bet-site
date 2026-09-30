import type { RatedOnBasis } from '@padelmigas/contracts';

/**
 * The date column C's points are stored under (FR-027, amended 2026-09-30).
 *
 * "Current points" is the newest-dated rating per player, so this date decides which value every
 * player page and lineup preview shows. The sheet's headers cannot be trusted for that on their own:
 * for days 1–12 some are written month-first, and a day-first reading turns 12 September into
 * 9 December without complaint. So the header is used only when nothing contradicts it, and the
 * sync day stands in otherwise.
 *
 * Pure: the caller supplies the sync day and the newest stored date. Time enters only through
 * `Clock` (SC-007), and reading the store is the handler's job (Principle II).
 */

/** The club's time zone. A sync day is a calendar day where the club is, not where the server is. */
export const CLUB_TIME_ZONE = 'Europe/Lisbon';

export interface RatedOnChoice {
  /** `YYYY-MM-DD`. */
  readonly ratedOn: string;
  readonly basis: RatedOnBasis;
}

/** The `YYYY-MM-DD` calendar day of an instant in the given time zone. */
export function calendarDayIn(instant: Date, timeZone: string = CLUB_TIME_ZONE): string {
  // `en-CA` formats a date as `YYYY-MM-DD`, which is also the order that sorts as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Chooses the date for this sync's points.
 *
 * `YYYY-MM-DD` strings compare correctly as strings, so no date arithmetic is needed. A header equal
 * to the newest stored date is kept, which is what makes re-running a sync on an unchanged sheet
 * rewrite the same rows.
 */
export function chooseRatedOn(input: {
  readonly headerRatedOn: string | null;
  readonly syncDay: string;
  readonly latestStored: string | null;
}): RatedOnChoice {
  const { headerRatedOn, syncDay, latestStored } = input;

  if (headerRatedOn === null) return { ratedOn: syncDay, basis: 'header-unparseable' };
  // Checked before the stored date: a future header is the more specific reason, and the one an
  // organiser can recognise in the sheet.
  if (headerRatedOn > syncDay) return { ratedOn: syncDay, basis: 'header-in-future' };
  // An older header would sort below the points already stored and leave them showing as current.
  if (latestStored !== null && headerRatedOn < latestStored) {
    return { ratedOn: syncDay, basis: 'header-before-stored' };
  }
  return { ratedOn: headerRatedOn, basis: 'header' };
}
