/**
 * Where to send a visitor after signing in or registering (feature 004).
 *
 * Only same-site paths: the `?depois=` parameter must never become an open redirect, so anything that
 * is not a single-slash absolute path — including protocol-relative `//host` and `/\host` — falls
 * back to the landing page.
 */
export const RETURN_PARAM = 'depois';

export function safeReturnPath(raw: string | readonly string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
