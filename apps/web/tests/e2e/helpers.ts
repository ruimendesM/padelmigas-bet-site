import type { APIRequestContext, Page } from '@playwright/test';

/**
 * E2E helpers.
 *
 * The two flows drive a real browser against a real server against a real database. Fixtures are
 * created through the product's own admin API rather than by writing rows, so the flow under test
 * starts from a world the product itself can produce (quickstart V1).
 */

/** A start instant comfortably in the future, so the window is open for the length of a test run. */
export function futureStart(): string {
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + oneWeek).toISOString();
}

export interface LineupPlayer {
  name: string;
  points: number;
}

/** Signs in as the organiser. The password comes from the environment, never from a fixture file. */
export async function signInAsOrganiser(request: APIRequestContext): Promise<void> {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('E2E_ADMIN_PASSWORD is not set; the publish flow cannot sign in.');
  }
  const response = await request.post('/api/admin/session', { data: { password } });
  if (!response.ok()) {
    throw new Error(`Organiser sign-in failed with ${response.status()}.`);
  }
}

/**
 * The name of the pair shown in a group card, as the page renders it.
 *
 * Kept here so both specs agree on the selector, and so a copy change breaks one file rather than
 * two.
 */
export async function groupHeadings(page: Page): Promise<string[]> {
  return page.getByRole('heading', { level: 3 }).allInnerTexts();
}
