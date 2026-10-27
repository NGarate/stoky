import { test, expect } from "@playwright/test";
import { PASSWORD, freshEmail, register, signIn } from "./account";
import es from "../messages/es.json";

const h = es.household;

test("an admin creates a member's account, and the member signs in", async ({
  page,
  browser,
}) => {
  await register(page, "owner");
  const memberEmail = freshEmail("member");
  const memberName = `Miembro E2E ${Date.now()}`;

  await page.goto("/settings/people");
  await page.getByLabel(h.addName, { exact: true }).fill(memberName);
  await page.getByLabel(h.addEmail, { exact: true }).fill(memberEmail);
  await page.getByLabel(h.addPassword, { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: h.addSubmit }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: memberName })
      .filter({
        has: page.getByRole("button", { name: h.memberSessionsButton }),
      }),
  ).toBeVisible({ timeout: 30_000 });

  const context = await browser.newContext();
  const member = await context.newPage();
  await signIn(member, memberEmail);
  await expect(member).toHaveURL(/\/kitchen/, { timeout: 30_000 });
  await context.close();
});
