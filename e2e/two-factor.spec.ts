import { createHmac } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import es from "../messages/es.json";

/**
 * Two-step verification, set up from `/settings/security` and then asked for
 * at the next sign-in, against the real server (PROGRESS D148).
 *
 * The pieces each have a test that stops short of the others.
 * `components/TotpSetup.test.tsx` drives the section with the auth API mocked;
 * `integration/two-factor.test.ts` drives the route with the codes made from
 * the secret read out of the database. Nothing else proved the chain a person
 * goes through: the password in the dialog, the key **as the page shows it**
 * typed into an authenticator, its first code turning the second step on, and
 * the login form then asking for a code and taking one.
 *
 * **The authenticator is this file.** It reads the key off the page — the
 * same key the QR code carries — and computes the codes an app would (RFC
 * 6238: HMAC-SHA-1, 30 seconds, six digits). A code the server accepts is
 * proof the page showed the right key.
 *
 * **A code works once.** The first code turns the second step on and is used
 * up doing it, so the sign-in uses the next step's code, which the server's
 * window of one step either side accepts; and that same code, sent again from
 * a fresh browser, is refused (ASVS 5.0.0 6.5.1).
 *
 * **Its own account, registered here**, for the reason `session-revocation`
 * gives: the shared demo session must not end up asking for a code.
 *
 * The second test is the way back from a lost phone (PROGRESS D150): a
 * household admin removes a member's two-step verification from **Personas
 * del hogar** with the admin's own password, the member's browser is signed
 * out, and the member signs in with the password alone.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: whether a
 * server accepts a code has one engine's answer.
 */

const PASSWORD = "E2ETwoFactor123!";
const t = es.twoFactorSettings;

function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `twofa.w${worker}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
}

/** RFC 4648 base32, as the `otpauth:` key is written. */
function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code an authenticator holding `key` shows, `steps` steps from now. */
function totp(key: Buffer, steps = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + steps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function register(page: Page): Promise<string> {
  const email = freshEmail();
  const stamp = Date.now();
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `TwoFactor E2E ${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  const householdField = page.locator('input[name="householdName"]');
  if (await householdField.count()) {
    await householdField.fill(`TwoFactor Household ${stamp}`);
  }
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
  return email;
}

/** Whether the server reads this browser's cookies as a session. */
async function signedIn(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) !== null;
}

/** A fresh browser's password step, which must stop for the code. */
async function passwordStep(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: es.auth.twoFactorTitle })).toBeVisible({
    timeout: 30_000,
  });
  expect(await signedIn(page), "the password alone signed this browser in").toBe(false);
  return { context, page };
}

/**
 * Two-step verification turned on from `/settings/security` with `password`,
 * through the key the page shows; the key, as the authenticator holds it.
 * Leaves the page on the section, with it on.
 */
async function enrol(page: Page, password: string): Promise<Buffer> {
  await page.goto("/settings/security");
  const section = page.getByRole("region", { name: es.auth.twoFactorTitle });
  await expect(section.getByText(t.statusOff, { exact: true })).toBeVisible({ timeout: 30_000 });
  await section.getByRole("button", { name: t.turnOn }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(es.reauth.password).fill(password);
  await dialog.getByRole("button", { name: t.turnOnAction, exact: true }).click();

  await expect(section.getByRole("heading", { name: t.scanTitle })).toBeVisible({
    timeout: 30_000,
  });
  await expect(section.getByRole("img", { name: t.qrLabel })).toBeVisible();
  const key = base32Decode((await section.locator("code").innerText()).trim());
  expect(key.length, "the key on the page is not a whole secret").toBeGreaterThanOrEqual(20);

  await section.getByLabel(t.codeLabel).fill(totp(key));
  await section.getByRole("button", { name: t.verify }).click();
  const codes = section.getByRole("list", { name: t.codesListLabel });
  await expect(codes).toBeVisible({ timeout: 30_000 });
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  await section.getByRole("button", { name: t.codesDone }).click();
  await expect(section.getByText(t.changedEnabled)).toBeVisible();
  await expect(section.getByText(t.statusOn, { exact: true })).toBeVisible();
  await expect(codes).toBeHidden();
  return key;
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel(es.auth.totpLabel).fill(code);
  await page.getByRole("button", { name: es.auth.twoFactorVerify }).click();
}

test.describe("two-step verification", () => {
  test("is set up in settings, then asked for at sign-in, and a code works once", async ({
    page,
    browser,
  }) => {
    const email = await register(page);

    // ----------------------------------------------------------- set up --
    const key = await enrol(page, PASSWORD);

    // This browser stayed signed in through it.
    expect(await signedIn(page), "turning it on signed this browser out").toBe(true);

    // --------------------------------------------------------- sign in --
    const first = await passwordStep(browser, email);
    // The step after the one the setup used up.
    const code = totp(key, 1);
    await enterCode(first.page, code);
    await expect(first.page).not.toHaveURL(/\/login/, { timeout: 30_000 });
    expect(await signedIn(first.page), "the code did not sign the browser in").toBe(true);

    // ------------------------------------------- the same code, again --
    const second = await passwordStep(browser, email);
    await enterCode(second.page, code);
    await expect(second.page.getByText(es.auth.twoFactorInvalidCode)).toBeVisible({
      timeout: 30_000,
    });
    expect(await signedIn(second.page), "a used code signed a second browser in").toBe(false);

    await first.context.close();
    await second.context.close();
  });
});

test.describe("a lost authenticator", () => {
  const h = es.household;
  const MEMBER_PASSWORD = "E2ELostPhone123!";

  test("an admin removes a member's, who is signed out and signs in with the password alone", async ({
    page,
    browser,
  }) => {
    // ---------------------------------------------------------------- given --
    // The owner, and a kitchen account (the form's default) they create.
    await register(page);
    const memberEmail = freshEmail();
    const memberName = `Movil perdido E2E ${Date.now()}`;
    await page.goto("/settings/people");
    await page.getByLabel(h.addName, { exact: true }).fill(memberName);
    await page.getByLabel(h.addEmail, { exact: true }).fill(memberEmail);
    await page.getByLabel(h.addPassword, { exact: true }).fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: h.addSubmit }).click();
    const row = page
      .getByRole("listitem")
      .filter({ hasText: memberName })
      .filter({ has: page.getByRole("button", { name: h.memberSessionsButton }) });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The member signs in on their own browser and sets it up.
    const context = await browser.newContext();
    const member = await context.newPage();
    await member.goto("/login");
    await member.waitForSelector('input[name="email"]');
    await member.waitForTimeout(1500);
    await member.fill('input[name="email"]', memberEmail);
    await member.fill('input[name="password"]', MEMBER_PASSWORD);
    await member.click('button[type="submit"]');
    await expect(member).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await enrol(member, MEMBER_PASSWORD);
    expect(await signedIn(member), "the member's browser was not signed in to begin with").toBe(true);

    // ----------------------------------------------------------------- when --
    await page.reload();
    await expect(row.getByText(h.twoFactorOn, { exact: true })).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: h.removeTwoFactorButton }).click();
    const dialog = page.getByRole("dialog", {
      name: h.removeTwoFactorTitle.replace("{name}", memberName),
    });
    await dialog.getByLabel(es.reauth.password).fill(PASSWORD);
    await dialog.getByRole("button", { name: h.removeTwoFactorAction, exact: true }).click();

    // ----------------------------------------------------------------- then --
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(row.getByText(h.twoFactorOff, { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await signedIn(page), "removing it signed the admin out").toBe(true);
    expect(await signedIn(member), "the member's browser was still signed in").toBe(false);

    // The password alone signs the member in again: no step for a code.
    await member.goto("/login");
    await member.waitForSelector('input[name="email"]');
    await member.waitForTimeout(1500);
    await member.fill('input[name="email"]', memberEmail);
    await member.fill('input[name="password"]', MEMBER_PASSWORD);
    await member.click('button[type="submit"]');
    await expect(member).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(member.getByRole("heading", { name: es.auth.twoFactorTitle })).toHaveCount(0);
    expect(await signedIn(member), "the password alone did not sign the member in").toBe(true);

    await context.close();
  });
});
