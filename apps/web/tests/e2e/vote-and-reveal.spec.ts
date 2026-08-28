import { expect, test } from '@playwright/test';

/**
 * Quickstart V2 — vote and see the crowd immediately (FR-012, FR-014, SC-005, SC-006).
 *
 * Four assertions, each one a requirement that only a browser can check:
 *  1. Before voting, the page carries **no counts at all** — asserted against the network response,
 *     not the rendered DOM, because "not rendered" and "not sent" are different guarantees (SC-006).
 *  2. Results appear within two seconds of the ballot being accepted (SC-005).
 *  3. After a full reload in the same browser, the group still shows results and the voter's own
 *     ordering — the cookie identity survives (FR-012, FR-014).
 *  4. A second attempt in the same session is refused (FR-013).
 */

const TOURNAMENT_SLUG = process.env.E2E_TOURNAMENT_SLUG;

test.describe('vote and reveal', () => {
  test.skip(
    !TOURNAMENT_SLUG,
    'E2E_TOURNAMENT_SLUG must name an open tournament with at least one group.',
  );

  test('a voter submits a ballot and sees the crowd immediately', async ({ page }) => {
    const detailResponses: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes(`/api/v1/tournaments/${TOURNAMENT_SLUG}`)) {
        detailResponses.push(await response.text().catch(() => ''));
      }
    });

    await page.goto(`/torneios/${TOURNAMENT_SLUG}`);

    // (1) Nothing about anyone's aggregate has been sent to this browser yet.
    for (const payload of detailResponses) {
      expect(payload).not.toContain('standings');
      expect(payload).not.toContain('positionShares');
    }

    // The form is one tap per position: assign every position of the first group in order.
    const firstGroup = page
      .getByRole('region')
      .filter({ has: page.getByRole('group') })
      .first();
    const pairRows = firstGroup.getByRole('group');
    const pairCount = await pairRows.count();
    expect(pairCount).toBeGreaterThanOrEqual(3);

    for (let index = 0; index < pairCount; index += 1) {
      await pairRows.nth(index).getByRole('button').nth(index).click();
    }

    const started = Date.now();
    await page
      .getByRole('button', { name: /confirmar/i })
      .first()
      .click();

    // (2) SC-005: the payoff is immediate.
    await expect(page.getByText(/votos?$/i).first()).toBeVisible({ timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(5000);

    // (3) FR-012 / FR-014: the identity and the reveal survive a full reload.
    await page.reload();
    await expect(page.getByText(/voto registado/i).first()).toBeVisible();
    await expect(page.getByText(/posição média/i).first()).toBeVisible();

    // (4) FR-013: no second ballot from this device.
    await expect(page.getByRole('button', { name: /confirmar/i })).toHaveCount(0);
  });
});
