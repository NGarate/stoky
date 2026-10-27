import { test, expect, type Page } from "@playwright/test";
import { PASSWORD, register, signOut } from "./account";
import es from "../messages/es.json";

/**
 * Run by the `passkeys` project alone, at `localhost`: WebAuthn does not take
 * an IP address as a relying party (`playwright.config.ts` says why). The
 * authenticator is Chromium's virtual one, over the DevTools protocol, and it
 * lives as long as the page, so the whole journey is one page.
 */

const sec = es.security;

/** Asked from the page: `page.request` runs in Node, where `localhost` is not mapped. */
async function signedIn(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      cache: "no-store",
    });
    return (await response.json()) !== null;
  });
}

test("a passkey added in settings signs in from the login page", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await register(page, "passkey");
  await page.goto("/settings/security");
  const section = page.getByRole("region", { name: sec.passkeysTitle });
  await section
    .getByRole("button", { name: sec.passkeysAdd })
    .click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: sec.passkeysAddTitle });
  await dialog.getByLabel(es.reauth.password).fill(PASSWORD);
  await dialog
    .getByRole("button", { name: sec.passkeysAddAction, exact: true })
    .click();
  await expect(section.getByRole("listitem")).toHaveCount(1, {
    timeout: 30_000,
  });

  await signOut(page);
  await page.waitForTimeout(1500); // hydration, as in `signIn`
  await page.getByRole("button", { name: es.auth.passkeySignIn }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  expect(await signedIn(page)).toBe(true);
});
