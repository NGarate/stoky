import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import es from "../messages/es.json";

/**
 * Changing your own password, through the browser, against the real server
 * (PROGRESS D144).
 *
 * `integration/auth.flow.test.ts` proves the procedure: a wrong current
 * password changes nothing, a right one replaces the hash, every other
 * session ends, and this one's row is replaced by one that keeps its sign-in
 * time and kind. `components/EndSession.test.tsx` proves the form with the
 * server mocked. Neither can see the one thing a person depends on most here:
 * that **the new cookie reaches this browser**. Better Auth sets it while the
 * procedure runs, and only an answer whose headers are written afterwards
 * carries it — which is why the call goes by a link that does not stream
 * (`src/lib/trpc/links.ts`). Without that, this device would be presenting
 * the deleted token, and the change meant to keep it signed in would sign it
 * out on its next read.
 *
 * Four browsers, each asked of the server rather than read off the address
 * bar (`session-revocation.spec.ts` says why: a signed-out
 * `page.goto("/dashboard")` lands on the prerendered shell first):
 *
 * - **this one**, which changed it, is still signed in, still on the page,
 *   and holds a new cookie of the same kind — a browser session's, with no
 *   expiry, as the registration left it;
 * - **another device**, signed in on its own, is signed out;
 * - **a copy of this device's cookie taken before the change** is refused —
 *   the token rotated, it was not merely kept;
 * - and then the old password is refused and the new one accepted.
 *
 * **Its own account, registered here**, for `session-revocation.spec.ts`'s
 * reason: the change ends every other session the account has, and every
 * other signed-in suite shares the demo account's.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: whether a
 * server accepts a password has one engine's answer.
 */

const OLD_PASSWORD = "E2EPasswordOld123!";
const NEW_PASSWORD = "tarro de garbanzos azul";
const t = es.password;

/** Unique per worker and per run, so two runs cannot collide on the address. */
function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `pwchange.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST, the same
  // reason `session.setup.ts` waits here.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

/** Whether the server reads this browser's cookies as a session. */
async function signedIn(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) !== null;
}

/** This browser's session cookie: its value, and its expiry (-1: none). */
async function sessionCookie(
  context: BrowserContext,
): Promise<{ value: string; expires: number }> {
  const cookie = (await context.cookies()).find((c) =>
    c.name.endsWith("session_token"),
  );
  expect(cookie, "no session cookie in this browser").toBeDefined();
  return { value: cookie!.value, expires: cookie!.expires };
}

/** Another device: its own browser, signing in with the form. */
async function secondDevice(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, OLD_PASSWORD);
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
  return { context, page };
}

test.describe("changing your own password", () => {
  test("keeps this device signed in, signs every other out, and only the new password works", async ({
    page,
    browser,
  }) => {
    const email = freshEmail();
    const stamp = Date.now();

    // ---------------------------------------------------------------- given --
    await page.goto("/register");
    await page.waitForSelector('input[name="email"]');
    await page.waitForTimeout(1500);
    await page.fill('input[name="name"]', `Password E2E ${stamp}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', OLD_PASSWORD);
    const householdField = page.locator('input[name="householdName"]');
    if (await householdField.count()) {
      await householdField.fill(`Password Household ${stamp}`);
    }
    await page.click('button[type="submit"]');
    // A new account is asked which screen it wants (Journey 8).
    await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });

    const other = await secondDevice(browser, email);

    // Registering signs in for a browser session, so the cookie has no
    // expiry and goes when the browser closes — a kitchen tablet left with
    // the box unticked (`remember-me.spec.ts`).
    const beforeChange = await sessionCookie(page.context());
    expect(
      beforeChange.expires,
      "the registered device did not start as a browser session",
    ).toBe(-1);

    // A copy of this device's cookies as they are before the change: what a
    // thief who lifted the cookie would hold.
    const copy = await browser.newContext();
    await copy.addCookies(await page.context().cookies());
    const copyPage = await copy.newPage();

    // The controls. Without them the refusals below are equally well
    // explained by those browsers never having been signed in.
    expect(
      await signedIn(other.page),
      "the other device was not signed in to begin with",
    ).toBe(true);
    expect(
      await signedIn(copyPage),
      "the copied cookie was not a session to begin with",
    ).toBe(true);

    // ----------------------------------------------------------------- when --
    await page.goto("/settings/security");
    // Both sessions are listed, so "Cerrar las demás" is offered.
    await expect(
      page.getByRole("button", { name: es.security.endOthers }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel(t.current).fill(OLD_PASSWORD);
    await page.getByLabel(t.new, { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel(t.confirm).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: t.submit }).click();

    // ----------------------------------------------------------------- then --
    // Done, said in place, and this device is where it was.
    await expect(
      page.getByRole("status").filter({ hasText: t.changedTitle }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/settings\/security/);
    expect(
      await signedIn(page),
      "this device was signed out by the change — the rotated cookie did not arrive",
    ).toBe(true);
    // A new cookie, of the same kind: Better Auth decides its Max-Age from
    // the `dont_remember` cookie this browser sent, and a browser session
    // that came back with ninety days would outlive the browser closing.
    const afterChange = await sessionCookie(page.context());
    expect(afterChange.value, "the session cookie was not replaced").not.toBe(
      beforeChange.value,
    );
    expect(
      afterChange.expires,
      "the change turned a browser session's cookie into an expiring one",
    ).toBe(-1);
    // The list, read again with the new cookie, holds this device alone.
    await expect(
      page.getByRole("button", { name: es.security.endOthers }),
    ).toBeHidden({
      timeout: 30_000,
    });
    // And it survives a reload, which a cookie kept only in memory would not.
    await page.reload();
    expect(
      await signedIn(page),
      "this device was signed out after a reload",
    ).toBe(true);

    // The other device is signed out.
    expect(
      await signedIn(other.page),
      "the other device was still signed in",
    ).toBe(false);
    await other.page.goto("/dashboard");
    await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });

    // The copy of the old cookie is refused: the token rotated.
    expect(
      await signedIn(copyPage),
      "a copy of this device's cookie from before the change still worked",
    ).toBe(false);
    await copyPage.goto("/dashboard");
    await expect(copyPage).toHaveURL(/\/login/, { timeout: 30_000 });

    // The old password is refused...
    await signIn(other.page, email, OLD_PASSWORD);
    await expect(
      other.page
        .getByRole("status")
        .filter({ hasText: "El correo o la contraseña no son correctos" }),
      "the old password was not refused after the change",
    ).toBeVisible({ timeout: 30_000 });
    await expect(other.page).toHaveURL(/\/login/);

    // ...and the new one gets in.
    await signIn(other.page, email, NEW_PASSWORD);
    await expect(
      other.page,
      "the new password did not sign in — the change refused the old one by breaking the account",
    ).toHaveURL(/\/start/, { timeout: 30_000 });

    await copy.close();
    await other.context.close();
  });
});
