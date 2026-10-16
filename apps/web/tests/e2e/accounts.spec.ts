import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Optional voter accounts (feature 004, quickstart scenarios 1–8).
 *
 * Several browser contexts stand in for several devices, because every account rule is about what
 * one device sees after another one acted: a vote that follows the person (FR-308), a logged-out vote
 * carried into the account (FR-309, FR-310), sign-out returning the device to a stranger (FR-316),
 * and a password change or reset ending the other sessions (FR-318, FR-320).
 */

const TOURNAMENT_SLUG = process.env.E2E_TOURNAMENT_SLUG;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const PASSWORD = 'palavra-passe-e2e';

/** Unique per run, so the spec can run against a database that already holds earlier runs. */
function uniqueUsername(): string {
  return `e2e.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

async function newDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

function group(page: Page, index: number) {
  return page
    .getByRole('region')
    .filter({ has: page.getByRole('heading', { level: 3 }) })
    .nth(index);
}

/** Votes on the nth group with the pairs in listed order. */
async function voteOn(page: Page, index: number): Promise<void> {
  const target = group(page, index);
  const pairRows = target.getByRole('group');
  const pairCount = await pairRows.count();
  for (let row = 0; row < pairCount; row += 1) {
    await pairRows.nth(row).getByRole('button').nth(row).click();
  }
  await target.getByRole('button', { name: /confirmar/i }).click();
  await expect(target.getByText(/voto registado/i)).toBeVisible();
}

async function expectVoted(page: Page, index: number, voted: boolean): Promise<void> {
  const recorded = group(page, index).getByText(/voto registado/i);
  if (voted) await expect(recorded).toBeVisible();
  else await expect(recorded).toHaveCount(0);
}

async function register(page: Page, username: string): Promise<void> {
  await page.goto(`/registar?depois=/torneios/${TOURNAMENT_SLUG}`);
  await page.getByLabel('Nome de utilizador').fill(username);
  await page.getByLabel('Palavra-passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(new RegExp(`/torneios/${TOURNAMENT_SLUG}$`));
  await expect(page.getByRole('link', { name: username })).toBeVisible();
}

async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto(`/entrar?depois=/torneios/${TOURNAMENT_SLUG}`);
  await page.getByLabel('Nome de utilizador').fill(username);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test.describe('voter accounts', () => {
  test.skip(
    !TOURNAMENT_SLUG,
    'E2E_TOURNAMENT_SLUG must name an open tournament with at least two groups nobody in this run has voted on.',
  );

  test('logged-out vote carries into a new account, follows it to another device, and leaves on sign-out', async ({
    browser,
  }) => {
    const username = uniqueUsername();

    // Scenario 1: logged-out voting is unchanged — no prompt in the way.
    const home = await newDevice(browser);
    await home.goto(`/torneios/${TOURNAMENT_SLUG}`);
    await voteOn(home, 0);

    // Scenario 2: registering on this device adopts the vote just cast.
    await register(home, username);
    await expectVoted(home, 0, true);

    // Scenario 3: another device signed in sees it.
    const phone = await newDevice(browser);
    await signIn(phone, username);
    await expect(phone).toHaveURL(new RegExp(`/torneios/${TOURNAMENT_SLUG}$`));
    await expectVoted(phone, 0, true);

    // Scenario 6: sign-out returns the device to a stranger.
    await phone.getByRole('button', { name: 'Sair' }).click();
    await expect(phone.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await phone.goto(`/torneios/${TOURNAMENT_SLUG}`);
    await expectVoted(phone, 0, false);
  });

  test('signing in merges a logged-out vote into the account', async ({ browser }) => {
    const username = uniqueUsername();
    const home = await newDevice(browser);
    await register(home, username);

    // Scenario 4: a different device votes logged out on group B, then signs in.
    const phone = await newDevice(browser);
    await phone.goto(`/torneios/${TOURNAMENT_SLUG}`);
    await voteOn(phone, 1);
    await signIn(phone, username);
    await expect(phone.getByRole('link', { name: username })).toBeVisible();

    await home.reload();
    await expectVoted(home, 1, true);
  });

  test('changing the password signs out the other devices', async ({ browser }) => {
    const username = uniqueUsername();
    const one = await newDevice(browser);
    await register(one, username);
    const two = await newDevice(browser);
    await signIn(two, username);
    await expect(two.getByRole('link', { name: username })).toBeVisible();

    // Scenario 7.
    await one.goto('/conta');
    await one.getByLabel('Palavra-passe atual').fill(PASSWORD);
    await one.getByLabel('Nova palavra-passe').fill('outra-palavra-e2e');
    await one.getByRole('button', { name: 'Alterar palavra-passe' }).click();
    await expect(one.getByText(/palavra-passe alterada/i)).toBeVisible();

    await two.reload();
    await expect(two.getByRole('link', { name: 'Entrar' })).toBeVisible();
  });

  test('an organiser reset forces a new password at sign-in', async ({ browser, request }) => {
    test.skip(!ADMIN_PASSWORD, 'E2E_ADMIN_PASSWORD is needed to drive the organiser reset.');
    const username = uniqueUsername();
    const device = await newDevice(browser);
    await register(device, username);

    // Scenario 8, organiser side, through the product API.
    const admin = await request.post('/api/admin/session', { data: { password: ADMIN_PASSWORD } });
    expect(admin.ok()).toBe(true);
    const search = await request.get(`/api/v1/admin/accounts?q=${encodeURIComponent(username)}`);
    const { accounts } = (await search.json()) as { accounts: { id: string; username: string }[] };
    const id = accounts.find((account) => account.username === username)?.id;
    expect(id).toBeDefined();
    const reset = await request.post(`/api/v1/admin/accounts/${id}/password-reset`);
    const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };

    // The existing session ended.
    await device.reload();
    await expect(device.getByRole('link', { name: 'Entrar' })).toBeVisible();

    // The temporary password asks for a new one before anything else.
    await signIn(device, username, temporaryPassword);
    await expect(device.getByText(/palavra-passe temporária/i)).toBeVisible();
    await device.getByLabel('Nova palavra-passe').fill('nova-depois-de-repor');
    await device.getByRole('button', { name: 'Guardar e entrar' }).click();
    await expect(device.getByRole('link', { name: username })).toBeVisible();
  });
});
