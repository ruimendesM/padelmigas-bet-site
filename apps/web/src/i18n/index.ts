import { en } from './en.js';
import { pt, type Messages } from './pt.js';

/**
 * Copy selection.
 *
 * pt-PT is primary, en is the fallback (constitution: Locale & time). There is deliberately no
 * runtime language switcher in phase 1: the audience is a Portuguese club, and a switcher is a
 * feature no spec has asked for (Principle V). The `en` file exists so the copy is not welded to one
 * language and so the message shape is type-checked in two places rather than one.
 */
export type { Messages };
export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt';

const CATALOGUES: Record<Locale, Messages> = { pt, en };

export function messages(locale: Locale = DEFAULT_LOCALE): Messages {
  return CATALOGUES[locale];
}

/** The catalogue every server component uses. One call site keeps the default honest. */
export const t = messages(DEFAULT_LOCALE);
