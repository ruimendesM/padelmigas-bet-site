import { expect, test } from '@playwright/test';
import { signInAsOrganiser } from './helpers.js';

/**
 * Quickstart V1 and V2 — import a lineup from an image, correct what came back marked, publish.
 *
 * The extraction endpoint is intercepted, so no vision provider is called and the rows are fixed:
 * what is under test is that the pieces connect — upload, draft table, flag marking, correction,
 * then the *existing* preview and publish — not a model's accuracy, which is checked by hand
 * against real screenshots (SC-103, research D10).
 *
 * The uploaded bytes are a 1×1 PNG built here rather than a committed binary: with the reader
 * intercepted, the image's content is irrelevant, and a committed screenshot of a real lineup would
 * put real player names in the repository, which feature 001 deliberately avoids.
 */

/** A valid 1×1 PNG. Only its type and size matter to the code under test. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

interface LineupPair {
  club: string;
  totalPoints: number;
  players: [{ name: string; points: number }, { name: string; points: number }];
}

test.describe('import a lineup from an image', () => {
  test('an organiser uploads a screenshot, corrects a marked cell, and publishes', async ({
    page,
    request,
  }) => {
    // Every precondition first, so a fixture-less run skips rather than fails, matching the sibling
    // specs.
    const lineup = JSON.parse(process.env.E2E_LINEUP_JSON ?? '{}') as { pairs?: LineupPair[] };
    test.skip(
      !process.env.E2E_ADMIN_PASSWORD,
      'E2E_ADMIN_PASSWORD must be set; the import flow signs in as the organiser.',
    );
    test.skip(
      !Array.isArray(lineup.pairs) || lineup.pairs.length < 3,
      'E2E_LINEUP_JSON must carry at least three pairs of players that exist in the synced ranking.',
    );

    const pairs = lineup.pairs as LineupPair[];

    // What the server would return for the uploaded image: the fixture lineup, with one player's
    // points unread on the first row so the correction path has something real to fix (FR-105).
    const extraction = {
      rows: pairs.map((pair, index) => ({
        sourceIndex: index,
        players: [
          { name: pair.players[0].name, points: index === 0 ? null : pair.players[0].points },
          { name: pair.players[1].name, points: pair.players[1].points },
        ],
        totalPoints: pair.totalPoints,
        club: pair.club,
        flags: index === 0 ? ['MISSING_POINTS'] : [],
      })),
      warnings: pairs.length % 2 === 1 ? ['ODD_ROW_COUNT'] : [],
    };

    await page.route('**/api/v1/admin/tournaments/extract', async (route) => {
      // The request really carries the image; asserting it here proves the upload path encoded it.
      const body = route.request().postDataJSON() as { image?: { mimeType?: string } };
      expect(body.image?.mimeType).toBe('image/png');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(extraction),
      });
    });

    await signInAsOrganiser(request);
    await page.goto('/admin');

    await page.setInputFiles('#lineup-image', {
      name: 'alinhamento.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });

    // Every row from the image is on the page, and the two fields it could not supply are empty.
    await expect(page.getByLabel(/Jogador 1 1/)).toHaveValue(pairs[0]!.players[0].name);
    await expect(page.getByLabel('Nome do torneio')).toHaveValue('');
    await expect(page.getByLabel(/Início/)).toHaveValue('');

    // The unread points cell is marked, and the flag's reason is spelled out on the page (FR-106).
    const markedCell = page.getByLabel(/PTS J1 1/);
    await expect(markedCell).toHaveValue('');
    await expect(markedCell).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Pontos não lidos na imagem.')).toBeVisible();

    // While a required value is missing, the preview is not offered (FR-110).
    const previewButton = page.getByRole('button', { name: 'Pré-visualizar' });
    await expect(previewButton).toBeDisabled();

    // Correcting the cell clears its mark, with no re-upload (FR-109).
    await markedCell.fill(String(pairs[0]!.players[0].points));
    await expect(markedCell).toHaveAttribute('aria-invalid', 'false');

    const name = `Torneio E2E imagem ${Date.now()}`;
    await page.getByLabel('Nome do torneio').fill(name);
    // A week out, so the voting window is open for the length of the run.
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await page.getByLabel(/Início/).fill(`${start.toISOString().slice(0, 10)}T18:00`);

    // From here the flow is the existing one, unchanged: preview must succeed before publish
    // appears (FR-111).
    await expect(previewButton).toBeEnabled();
    await previewButton.click();

    const publishButton = page.getByRole('button', { name: 'Publicar torneio' });
    await expect(publishButton).toBeVisible();
    await publishButton.click();

    await expect(page.getByText('Torneio publicado.')).toBeVisible();

    // And it is on the public landing page, like any other published tournament.
    await page.goto('/');
    await expect(page.getByRole('link', { name })).toBeVisible();
  });
});
