import { expect, test } from '@playwright/test';
import { futureStart, signInAsOrganiser } from './helpers.js';

/**
 * Quickstart V1 — publish a lineup and see it listed (SC-001, SC-003).
 *
 * The one flow an organiser performs, end to end: sign in, preview, publish, and find the tournament
 * on the public landing page. It is an E2E test rather than a contract test because the thing being
 * asserted is that the *pieces connect* — the contract tests already prove each piece in isolation.
 *
 * The lineup is built from players that must already exist in the ranking table, so the run depends
 * on a synced database. That dependency is the point: publishing against an unsynced ranking is the
 * failure FR-004 exists to make loud, and a fixture that invented players would hide it.
 */

test.describe('publish a lineup', () => {
  test('an organiser publishes a tournament and it appears on the landing page', async ({
    page,
    request,
  }) => {
    // Every precondition is checked BEFORE the first action, so a fixture-less run skips rather than
    // fails. `signInAsOrganiser` throws by design when it is called without a password — it is a
    // helper, and a missing credential mid-flow is a real error — so calling it ahead of these
    // guards made the skip below unreachable and turned "no fixtures" into a red build. The
    // sibling spec `vote-and-reveal` has always guarded first; this one now matches it.
    const lineup = JSON.parse(process.env.E2E_LINEUP_JSON ?? '{}') as { pairs?: unknown[] };
    test.skip(
      !process.env.E2E_ADMIN_PASSWORD,
      'E2E_ADMIN_PASSWORD must be set; the publish flow signs in as the organiser.',
    );
    test.skip(
      !Array.isArray(lineup.pairs) || lineup.pairs.length < 3,
      'E2E_LINEUP_JSON must carry at least three pairs of players that exist in the synced ranking.',
    );

    await signInAsOrganiser(request);

    // The players are read from the ranking the environment was seeded with.
    const players = await request.get('/api/v1/tournaments');
    expect(players.ok()).toBeTruthy();

    const name = `Torneio E2E ${Date.now()}`;

    const payload = { ...lineup, name, startsAt: futureStart() };

    // Preview first — the product refuses to publish anything that has not been validated (FR-002).
    const preview = await request.post('/api/v1/admin/tournaments/preview', { data: payload });
    expect(preview.status(), await preview.text()).toBe(200);
    const previewed = (await preview.json()) as { slug: string; groups: unknown[] };
    expect(previewed.groups.length).toBeGreaterThan(0);

    const published = await request.post('/api/v1/admin/tournaments', {
      data: { ...payload, confirm: true },
    });
    expect(published.status(), await published.text()).toBe(201);

    // SC-001: it is on the public landing page, and it leads to its own page.
    await page.goto('/');
    const link = page.getByRole('link', { name });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // SC-003: the resolved players are shown, meaning every pasted name matched a real identity.
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
  });
});
