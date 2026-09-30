import { describe, expect, it } from 'vitest';
import { calendarDayIn, chooseRatedOn } from './rated-on.js';

/**
 * Which date column C's points are stored under (FR-027, amended 2026-09-30).
 *
 * "Current points" is the newest-dated rating per player, so the date decides which value every
 * player page and lineup preview shows. A wrong date here is a wrong number on a public page.
 */

describe('calendarDayIn', () => {
  it('gives the Lisbon calendar day of an instant', () => {
    expect(calendarDayIn(new Date('2026-09-30T12:00:00.000Z'))).toBe('2026-09-30');
  });

  it('crosses midnight in Lisbon before it does in UTC during summer time', () => {
    // 23:30 UTC on 29 September is 00:30 on the 30th in Lisbon (UTC+1).
    expect(calendarDayIn(new Date('2026-09-29T23:30:00.000Z'))).toBe('2026-09-30');
  });

  it('matches UTC in winter', () => {
    // Lisbon is UTC+0 in winter, so 23:30 UTC on 31 December is still the 31st.
    expect(calendarDayIn(new Date('2026-12-31T23:30:00.000Z'))).toBe('2026-12-31');
  });

  it('accepts another time zone', () => {
    expect(calendarDayIn(new Date('2026-09-30T02:00:00.000Z'), 'America/New_York')).toBe(
      '2026-09-29',
    );
  });
});

describe('chooseRatedOn', () => {
  const syncDay = '2026-09-30';

  it("uses column C's header date when it is valid, not in the future and not older than stored", () => {
    expect(
      chooseRatedOn({ headerRatedOn: '2026-09-26', syncDay, latestStored: '2026-09-23' }),
    ).toEqual({ ratedOn: '2026-09-26', basis: 'header' });
  });

  it('uses the header on a first import, when nothing is stored', () => {
    expect(chooseRatedOn({ headerRatedOn: '2026-09-26', syncDay, latestStored: null })).toEqual({
      ratedOn: '2026-09-26',
      basis: 'header',
    });
  });

  it('uses the header when it equals the newest stored date, so a re-run stays idempotent', () => {
    expect(
      chooseRatedOn({ headerRatedOn: '2026-09-26', syncDay, latestStored: '2026-09-26' }),
    ).toEqual({ ratedOn: '2026-09-26', basis: 'header' });
  });

  it('uses the header when it is the sync day itself', () => {
    expect(chooseRatedOn({ headerRatedOn: syncDay, syncDay, latestStored: null })).toEqual({
      ratedOn: syncDay,
      basis: 'header',
    });
  });

  it('falls back to the sync day when the header is not a date', () => {
    // The sheet's `08-08-20262`.
    expect(chooseRatedOn({ headerRatedOn: null, syncDay, latestStored: '2026-09-23' })).toEqual({
      ratedOn: syncDay,
      basis: 'header-unparseable',
    });
  });

  it('falls back to the sync day when the header is in the future', () => {
    // `09-12-2026` is 12 September written month-first; read day-first it is 9 December.
    expect(
      chooseRatedOn({ headerRatedOn: '2026-12-09', syncDay, latestStored: '2026-09-23' }),
    ).toEqual({ ratedOn: syncDay, basis: 'header-in-future' });
  });

  it('falls back to the sync day when the header is older than the newest stored date', () => {
    // `10-03-2026` is 3 October written month-first; read day-first it is 10 March, which would sort
    // below September and leave the old points showing as current.
    expect(
      chooseRatedOn({ headerRatedOn: '2026-03-10', syncDay, latestStored: '2026-09-26' }),
    ).toEqual({ ratedOn: syncDay, basis: 'header-before-stored' });
  });

  it('checks the future before the stored date', () => {
    // Both are true of this header; the report names the reason a reader can act on first.
    expect(
      chooseRatedOn({ headerRatedOn: '2026-12-09', syncDay, latestStored: '2027-01-01' }),
    ).toEqual({ ratedOn: syncDay, basis: 'header-in-future' });
  });
});
