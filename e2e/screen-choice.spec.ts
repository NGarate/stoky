import { test, expect, type Page } from "@playwright/test";
import { settle } from "./settle";
import es from "../messages/es.json";

/**
 * Journey 8 — the screen choice is remembered per person *and* per device
 * (`REDESIGN_PLAN.md` §5.1).
 *
 * The journey's proof is two accounts and two devices, and the interesting
 * half is the shared tablet: account A chooses the kitchen on it, and account
 * B signing in on the *same* tablet must be **asked**, not silently placed in
 * kitchen mode. A preference keyed on the account alone would pass every other
 * assertion here and fail that one.
 *
 * Playwright's browser *contexts* are the two devices: each gets its own cookie
 * jar, so each gets its own device id, which is exactly what the production
 * mechanism keys on. Two contexts is a truer model of two devices than two
 * tabs, and cheaper than two browsers.
 *
 * These tests sign in themselves rather than using the stored session, because
 * what they are about is what happens *at* sign-in.
 */

function email(prefix: string): string {
  const worker = test.info().parallelIndex;
  return `${prefix}.w${worker}.${Date.now()}.${Math.random().toString(36).slice(7)}@example.com`;
}

const PASSWORD = "E2ETestPassword123!";

/** Register, which signs in and lands wherever §5.1 decides. */
async function register(page: Page, address: string): Promise<void> {
  await page.goto("/register");
  await page.fill('input[name="name"]', "E2E Screen Choice");
  await page.fill('input[name="email"]', address);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="householdName"]', `Hogar ${Date.now()}`);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|start|shopping|kitchen)/, {
    timeout: 30_000,
  });
}

async function signIn(page: Page, address: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', address);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|start|shopping|kitchen)/, {
    timeout: 30_000,
  });
}

/** Answer the question, by the name of the screen. */
async function choose(page: Page, name: string): Promise<void> {
  await page.goto("/start");
  await settle(page);
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test.describe("Journey 8 — the screen choice", () => {
  test("asks once, then stops asking on that device", async ({ page }) => {
    const address = email("e2e-choice-once");
    await register(page, address);

    // A device nobody has been asked about: the question, not a default.
    await page.goto("/");
    await expect(page).toHaveURL(/\/start/);
    await expect(
      page.getByRole("heading", { level: 1, name: es.start.title }),
    ).toBeVisible();

    await choose(page, es.start.kitchen);
    await expect(page).toHaveURL(/\/kitchen/);

    // Asked once. Every arrival after this goes straight there.
    await page.goto("/");
    await expect(page).toHaveURL(/\/kitchen/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/kitchen/);
  });

  test("does not hand one person's choice to the next on a shared tablet", async ({
    browser,
  }) => {
    // One context, one cookie jar, one device id — the house tablet.
    const tablet = await browser.newContext();
    const page = await tablet.newPage();

    const a = email("e2e-choice-a");
    const b = email("e2e-choice-b");

    await register(page, a);
    await choose(page, es.start.kitchen);
    await expect(page).toHaveURL(/\/kitchen/);

    // Account A leaves; account B arrives on the same tablet.
    await page.goto("/settings");
    await settle(page);
    // Two presses: signing out asks first, because it discards anything the
    // queue has not sent. With a clean queue the confirmation is the second
    // button with the same label, so it is addressed inside the group that
    // asks rather than by position.
    await page.getByRole("button", { name: es.session.signOut }).first().click();
    const confirm = page.getByRole("group", { name: es.session.signOutTitle });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole("button", { name: es.session.signOut }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    await register(page, b);
    await page.goto("/");

    // The whole point of keying on the pair. A preference stored per device
    // would put B in the kitchen; one stored per account would be right here
    // and wrong in the next test.
    await expect(page).toHaveURL(/\/start/);

    await tablet.close();
  });

  test("does not follow one person from their tablet to their phone", async ({
    browser,
  }) => {
    const address = email("e2e-choice-devices");

    const tablet = await browser.newContext();
    const tabletPage = await tablet.newPage();
    await register(tabletPage, address);
    await choose(tabletPage, es.start.kitchen);
    await expect(tabletPage).toHaveURL(/\/kitchen/);

    // The same person, a different cookie jar: their own phone.
    const phone = await browser.newContext();
    const phonePage = await phone.newPage();
    await signIn(phonePage, address);
    await phonePage.goto("/");

    // "A person must not be forced into kitchen mode because they picked up
    // the house tablet once."
    await expect(phonePage).toHaveURL(/\/start/);

    // And the two devices keep separate answers.
    await choose(phonePage, es.start.shopping);
    await expect(phonePage).toHaveURL(/\/shopping/);

    await tabletPage.goto("/");
    await expect(tabletPage).toHaveURL(/\/kitchen/);

    await tablet.close();
    await phone.close();
  });

  test("is changeable from settings, per device, and says it saved", async ({
    browser,
  }) => {
    // §5.1's other half. The row and the action existed before this screen did;
    // what it adds is the only way to change your mind without clearing a
    // cookie.
    const tablet = await browser.newContext();
    const page = await tablet.newPage();

    const address = email("e2e-choice-settings");
    await register(page, address);
    await choose(page, es.start.kitchen);
    await expect(page).toHaveURL(/\/kitchen/);

    await page.goto("/settings/screen");
    await settle(page);

    // The current answer is visible before it is changed, and in words rather
    // than by which button is filled.
    await expect(
      page.getByRole("button", { name: new RegExp(es.start.currentSuffix) }),
    ).toBeVisible();

    await page.getByRole("button", { name: new RegExp(es.start.shopping) }).click();

    // Changing a setting must not also walk you out of settings.
    await expect(page).toHaveURL(/\/settings\/screen/);

    // The confirmation is the live region's own sentence changing, which is
    // where D101 puts a persistent state. Addressed by its text rather than by
    // role, because the dashboard shell mounts the sync indicator's own empty
    // `role="status"` on every screen.
    const shown = es.start.currentlyStartingAt.replace(
      "{screen}",
      es.start.shopping,
    );
    const live = page.getByText(shown);
    await expect(live).toBeVisible({ timeout: 30_000 });
    // Announced, not merely shown — the only other visible change is which
    // button is filled, which says nothing to somebody who cannot see it.
    await expect(live).toHaveRole("status");

    // And it is the choice that changed, not just the message.
    await page.goto("/");
    await expect(page).toHaveURL(/\/shopping/);

    // Still per device: a second device is unaffected and still unasked.
    const phone = await browser.newContext();
    const phonePage = await phone.newPage();
    await signIn(phonePage, address);
    await phonePage.goto("/");
    await expect(phonePage).toHaveURL(/\/start/);

    await tablet.close();
    await phone.close();
  });

  test("works with no JavaScript, because it is a form and a redirect", async ({
    browser,
  }) => {
    // The one screen a person meets before they have any reason to trust this
    // application, and the reason it is three submit buttons rather than a
    // client component.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    const address = email("e2e-choice-nojs");
    // Registration needs scripting, so borrow a session made with it.
    const scripted = await browser.newContext();
    const scriptedPage = await scripted.newPage();
    await register(scriptedPage, address);
    await context.addCookies(await scripted.cookies());
    await scripted.close();

    await page.goto("/start");
    await expect(
      page.getByRole("heading", { level: 1, name: es.start.title }),
    ).toBeVisible();

    await page.getByRole("button", { name: new RegExp(es.start.shopping) }).click();
    await page.waitForURL(/\/shopping/, { timeout: 30_000 });

    await context.close();
  });
});
