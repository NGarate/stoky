import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { createCredentialUser } from "../src/lib/auth/credentials";
import { hashPassword } from "../src/lib/auth/password-hash";
import { createPrismaClient } from "../src/lib/prisma";
import { e2eDatabaseUrl } from "./db-url";

export const PASSWORD = "E2ETestPassword123!";

/** Unique per worker and per call, so tests running in parallel never share an account. */
export function freshEmail(prefix: string): string {
  return `${prefix}.w${test.info().parallelIndex}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
}

/**
 * Creates an account with a household of its own, straight in the suite's
 * database, then signs in as it and waits on `/start`.
 *
 * Not through `/register`: registration is a once-per-installation step, and
 * the suite's database already holds the seeded demo account. A household per
 * spec is test isolation, as in the integration suites, not the product. The
 * account is made the way the application makes one (`createCredentialUser`
 * with `hashPassword`), or sign-in would not find its password.
 */
export async function freshAccount(
  page: Page,
  prefix: string,
  password = PASSWORD,
): Promise<string> {
  const email = freshEmail(prefix);
  const db = createPrismaClient(e2eDatabaseUrl());
  try {
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: { name: `Hogar ${prefix} ${Date.now()}` },
      });
      await createCredentialUser(
        tx,
        {
          email,
          name: `E2E ${prefix}`,
          role: "OWNER",
          householdId: household.id,
        },
        passwordHash,
      );
    });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, email, password);
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
