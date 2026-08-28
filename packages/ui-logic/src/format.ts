/**
 * Presentation formatting shared by every client (SC-010).
 *
 * Two rules the constitution fixes and this module implements once:
 *  - **Instants are stored UTC, presented `Europe/Lisbon`.** The timezone is not the device's: a
 *    club member checking from abroad must see the tournament's local start time, not theirs.
 *  - **Percentages are rounded at render only.** Ordering and tie-breaks run on unrounded values in
 *    `core/scoring`; rounding earlier lets two pairs tie on a displayed number and then sort
 *    inconsistently between reloads (SC-004).
 *
 * No DOM, no React Native, no framework — this file runs unchanged in a browser and in Hermes.
 */

export const DISPLAY_TIME_ZONE = 'Europe/Lisbon';
export const DEFAULT_LOCALE = 'pt-PT';

/** `12 set 2026, 19:00` — the form used wherever a start time appears. */
export function formatStartsAt(instant: Date | string, locale: string = DEFAULT_LOCALE): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat(locale, {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Date only, for a history list where the hour adds nothing. */
export function formatDate(instant: Date | string, locale: string = DEFAULT_LOCALE): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat(locale, {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * A share (0–1) as a percentage string.
 *
 * Whole numbers by default: at club ballot counts, a decimal place implies precision the sample does
 * not support (Risk R6).
 */
export function formatShare(
  share: number,
  { locale = DEFAULT_LOCALE, decimals = 0 }: { locale?: string; decimals?: number } = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(share);
}

/** A mean predicted position, e.g. `2,35`. Two decimals — the differences are genuinely small. */
export function formatMeanPosition(mean: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(mean);
}

/** `Ana Silva / Bruno Costa` — the canonical way to name a pair. */
export function formatPairName(players: readonly { name: string }[]): string {
  return players.map((p) => p.name).join(' / ');
}

/** Points with a thousands separator. */
export function formatPoints(points: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(points);
}

/**
 * Derives a URL slug from a tournament name.
 *
 * Kept here rather than in the API so the organiser page can show the resulting address before
 * submitting. The server derives it identically from the same function, so the preview is not a
 * guess (FR-001).
 */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      // Strip combining marks so "Histórico" and "Historico" produce the same slug.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
      .replace(/-+$/g, '')
  );
}
