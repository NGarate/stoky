import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import es from "../messages/es.json";

/**
 * A passkey added in *Seguridad y acceso* and then used to sign in from the
 * login page, against the real server and a real browser's WebAuthn
 * (PROGRESS D151).
 *
 * The pieces each have a test that stops short of the others.
 * `integration/passkeys.test.ts` drives the route with a software
 * authenticator that signs whatever the test hands it; the component tests
 * drive the screens with the auth API mocked. Neither has a browser in the
 * middle, and the browser is where a passkey ceremony is decided: whether
 * the page is a secure context, whether the relying party the server named
 * is one the page's origin may use, whether `Permissions-Policy` lets the
 * page ask, and whether what the browser made is what the server accepts.
 *
 * **The authenticator is Chromium's own virtual one**, over the DevTools
 * protocol: a platform authenticator with resident keys and user
 * verification, which says yes to every prompt. It lives as long as the
 * page's target, so the whole journey is one page.
 *
 * **At `localhost`, not 127.0.0.1**: the `passkeys` project in
 * `playwright.config.ts`, whose comment says why — the server lists
 * `localhost` first in `STOKY_URLS`, making it the relying party.
 *
 * **Its own account, registered here**, for the reason `session-revocation`
 * gives: the shared demo session must not end up with a passkey.
 */

const PASSWORD = "E2EPasskey12345!";
const sec = es.security;

function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `passkey.w${worker}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
}

async function register(page: Page): Promise<void> {
  const stamp = Date.now();
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `Passkey E2E ${stamp}`);
  await page.fill('input[name="email"]', freshEmail());
  await page.fill('input[name="password"]', PASSWORD);
  const householdField = page.locator('input[name="householdName"]');
  if (await householdField.count()) {
    await householdField.fill(`Passkey Household ${stamp}`);
  }
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
}

/**
 * Whether the server reads this page's cookies as a session. Asked from the
 * page rather than through `page.request`: that runs in Node, where
 * `localhost` is not mapped to 127.0.0.1 as it is for the browser.
 */
async function signedIn(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", { cache: "no-store" });
    return (await response.json()) !== null;
  });
}

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name.endsWith("session_token"));
}

test.describe("passkeys", () => {
  test("one added in settings signs in from the login page, with the box left alone", async ({
    page,
    context,
  }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        // 2.1, the version with credential management. The server asks for
        // a discoverable credential only as `residentKey: "preferred"`, and
        // the login page's sign-in names no account, so a credential that is
        // not discoverable could never be found; the assertion on
        // `isResidentCredential` below says so if this ever stops holding.
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    // ------------------------------------------------------------ add one --
    await register(page);
    await page.goto("/settings/security");
    const section = page.getByRole("region", { name: sec.passkeysTitle });
    await expect(section.getByText(sec.passkeysNone)).toBeVisible({ timeout: 30_000 });
    await section.getByRole("button", { name: sec.passkeysAdd }).click();
    const dialog = page.getByRole("dialog", { name: sec.passkeysAddTitle });
    // The step-up: the password, then the browser's prompt, which the
    // virtual authenticator answers.
    await dialog.getByLabel(es.reauth.password).fill(PASSWORD);
    await dialog.getByRole("button", { name: sec.passkeysAddAction, exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(section.getByRole("listitem")).toHaveCount(1, { timeout: 30_000 });

    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials, "the browser holds no passkey after adding one").toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);
    expect(credentials[0].rpId).toBe("localhost");

    // ----------------------------------------------------------- sign out --
    await page.goto("/settings");
    await page.getByRole("button", { name: es.session.signOut }).first().click();
    const confirm = page.getByRole("group", { name: es.session.signOutTitle });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole("button", { name: es.session.signOut }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    expect(await signedIn(page), "signing out left a session").toBe(false);

    // ---------------------------------------------- sign in with the key --
    await page.waitForSelector('input[name="email"]');
    await page.waitForTimeout(1500);
    await expect(page.getByRole("checkbox", { name: es.auth.rememberMe })).not.toBeChecked();
    await page.getByRole("button", { name: es.auth.passkeySignIn }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

    expect(await signedIn(page), "the passkey did not sign the browser in").toBe(true);
    const session = await sessionCookie(context);
    expect(session, "no session cookie after the passkey sign-in").toBeDefined();
    // The box was left alone, so the cookie dies with the browser (D141).
    expect(session!.expires).toBe(-1);
  });
});
