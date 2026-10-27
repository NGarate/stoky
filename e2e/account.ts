import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";

export const PASSWORD = "E2ETestPassword123!";

/** Unique per worker and per call, so tests running in parallel never share an account. */
export function freshEmail(prefix: string): string {
  return `${prefix}.w${test.info().parallelIndex}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
}

/** Registers an account with a household of its own, and waits on `/start`. */
export async function register(
  page: Page,
  prefix: string,
  password = PASSWORD,
): Promise<string> {
  const email = freshEmail(prefix);
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `E2E ${prefix}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill(
    'input[name="householdName"]',
    `Hogar ${prefix} ${Date.now()}`,
  );
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
  return email;
}

export async function signIn(
  page: Page,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("button", { name: es.session.signOut }).first().click();
  await page
    .getByRole("group", { name: es.session.signOutTitle })
    .getByRole("button", { name: es.session.signOut })
    .click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
}

/** Asks the server, so a page that merely looks signed in does not count. */
export async function signedIn(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) !== null;
}
