import { setDeps } from '../../apps/web/src/server/deps.js';
import {
  adminSessionCookie,
  createAdminSessionToken,
} from '../../apps/web/src/server/admin-auth.js';
import { resetRateLimits } from '../../apps/web/src/server/rate-limit.js';
import { createTestDeps, type TestDeps } from './harness.js';

/**
 * Shared plumbing for the contract suite.
 *
 * Contract tests go through the **real route module**, which means the real adapter, the real
 * handler, the real repository and real SQL. A fake repository would let a test pass while the query
 * was wrong — the one failure mode contract tests exist to catch.
 *
 * Route modules are plain exported functions, so they run outside a Next server; `NextResponse` is a
 * `Response` subclass and needs no host.
 */

let installed: TestDeps | undefined;

/** Installs a container against the scratch database and returns the seams a test can move. */
export function install(options: { now?: Date } = {}): TestDeps {
  const testDeps = createTestDeps(options);
  setDeps(testDeps.deps);
  // The limiter is process-global by design (it must be, to work at all), so one test's attempts
  // would otherwise eat another's budget.
  resetRateLimits();
  installed = testDeps;
  return testDeps;
}

export function current(): TestDeps {
  if (!installed) throw new Error('install() was not called for this test.');
  return installed;
}

/** A `Request` with a JSON body, and whatever cookies the case needs. */
export function jsonRequest(
  url: string,
  body: unknown,
  options: { method?: string; cookie?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(url, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
}

export function getRequest(
  url: string,
  options: { cookie?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
  });
}

/** Next 15 passes route params as a promise; tests build the same shape. */
export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

/** A valid organiser session cookie, minted the way the login route mints it (FR-006). */
export async function organiserCookie(): Promise<string> {
  // `adminSessionCookie` returns a full Set-Cookie value; a request needs only the name=value pair.
  return adminSessionCookie(await createAdminSessionToken()).split(';')[0] ?? '';
}

/** The parsed JSON body of a response, typed at the call site. */
export async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Asserts a response is `no-store`; used wherever the answer depends on who is asking (SC-006). */
export function isNoStore(response: Response): boolean {
  return (response.headers.get('cache-control') ?? '').includes('no-store');
}

/**
 * The `name=value` pair from a response's `Set-Cookie`, ready to send on the next request.
 *
 * Voting tests must carry the identity the ballot route minted, because "one ballot per device" is
 * only observable across two requests (FR-012, FR-013).
 */
export function cookieFrom(response: Response, name: string): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const pair = header.split(';')[0] ?? '';
  return pair.startsWith(`${name}=`) ? pair : null;
}
