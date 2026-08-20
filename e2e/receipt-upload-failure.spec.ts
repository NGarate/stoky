import { test, expect } from "@playwright/test";
import { SESSION_FILE } from "./session";

/**
 * A failed upload has to say so.
 *
 * It did not. `mutateAsync` was awaited inside `FileReader.onloadend`, a
 * callback in a different call stack from the `try` wrapped around it — so a
 * rejected upload was an unhandled rejection, the `catch` never ran, and the
 * screen sat on "subiendo" for ever with no message. The same shape cleared
 * the uploading flag in `finally` before the file had finished being read.
 *
 * Browser-tier because that is where the defect lives: both the broken and the
 * working version type-check, render, and pass every unit test.
 */
test.use({ storageState: SESSION_FILE });

test("says so when the upload fails, instead of waiting for ever", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("receipt.upload")) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });

  await page.goto("/receipts/upload");
  await page.getByRole("heading", { name: /ticket/i }).first().waitFor();

  await page.setInputFiles('input[type="file"]', {
    name: "ticket.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });

  await expect
    .poll(() => dialogs.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(dialogs[0]).toContain("No se ha podido subir el ticket");
});
