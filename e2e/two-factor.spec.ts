import { createHmac } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PASSWORD, register, signIn, signedIn } from "./account";
import es from "../messages/es.json";

const t = es.twoFactorSettings;

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

/** RFC 6238 with the authenticator defaults: SHA-1, six digits, 30 seconds. */
function totp(key: Buffer, steps = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + steps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

test("is set up in settings, then asked for at sign-in", async ({
  page,
  browser,
}) => {
  const email = await register(page, "twofa");

  await page.goto("/settings/security");
  const section = page.getByRole("region", { name: es.auth.twoFactorTitle });
  await section
    .getByRole("button", { name: t.turnOn })
    .click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(es.reauth.password).fill(PASSWORD);
  await dialog
    .getByRole("button", { name: t.turnOnAction, exact: true })
    .click();

  const code = section.locator("code");
  await expect(code).toBeVisible({ timeout: 30_000 });
  const key = base32Decode((await code.innerText()).trim());
  await section.getByLabel(t.codeLabel).fill(totp(key));
  await section.getByRole("button", { name: t.verify }).click();
  await section
    .getByRole("button", { name: t.codesDone })
    .click({ timeout: 30_000 });
  await expect(section.getByText(t.statusOn, { exact: true })).toBeVisible();

  const context = await browser.newContext();
  const other = await context.newPage();
  await signIn(other, email);
  await other.getByLabel(es.auth.totpLabel).fill(totp(key, 1)); // the enrolment code is spent
  await other.getByRole("button", { name: es.auth.twoFactorVerify }).click();
  await expect(other).not.toHaveURL(/\/login/, { timeout: 30_000 });
  expect(await signedIn(other)).toBe(true);
  await context.close();
});
