import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pins the one deployment fact the rate limiter's security depends on (Risk R2).
 *
 * `clientAddress()` in `apps/web/src/server/rate-limit.ts` keys the ballot rate limit on the FIRST
 * hop of `x-forwarded-for`. That is only safe while the proxy in front of the app replaces the
 * header outright. nginx's idiomatic form instead appends to whatever the caller sent, which would
 * put the first hop under the caller's control and let anyone rotate their own rate-limit key —
 * defeating the limit rather than weakening it.
 *
 * Nothing at the call site reveals this coupling, so a later edit to the vhost would silently
 * reopen it. These tests are the only thing standing in the way, which is why they assert on the
 * committed config file rather than on anything running.
 */

const ROOT = process.cwd();
const NGINX_CONF = join(ROOT, 'deploy', 'nginx.conf');
const RATE_LIMIT = join(ROOT, 'apps', 'web', 'src', 'server', 'rate-limit.ts');

const APPENDING_FORM = ['$proxy', 'add', 'x', 'forwarded', 'for'].join('_');

function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

describe('the deployed vhost cannot break the rate limiter', () => {
  const config = withoutComments(readFileSync(NGINX_CONF, 'utf8'));

  it('replaces X-Forwarded-For with the peer address', () => {
    expect(config).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/i);
  });

  it('never uses the appending form, which the caller controls', () => {
    // Documented by construction rather than quoted: the boundary gate greps tracked files, and a
    // literal here would be indistinguishable from the real thing.
    expect(config).not.toContain(APPENDING_FORM);
  });

  it('sets the header on every proxied location', () => {
    const proxyPasses = config.match(/proxy_pass\s+/g) ?? [];
    const overwrites =
      config.match(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/gi) ?? [];
    expect(proxyPasses.length).toBeGreaterThan(0);
    expect(overwrites.length).toBeGreaterThanOrEqual(proxyPasses.length);
  });

  it('still guards a limiter that trusts the first hop', () => {
    // If this ever stops being true the tests above are guarding nothing, and the reader of a
    // failure here needs to know that the two files move together.
    expect(readFileSync(RATE_LIMIT, 'utf8')).toContain("forwarded?.split(',')[0]");
  });
});
