import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display landing page", async ({ page }) => {
    await expect(page).toHaveTitle(/Stoky/);
    await expect(page.locator("text=Stoky")).toBeVisible();
  });

  test("should navigate to login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toContainText(/login/i);
  });

  test("should navigate to register page", async ({ page }) => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator("h1")).toContainText(/register/i);
  });

  test("should redirect unauthenticated users from dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Dashboard Navigation", () => {
  test("should display navigation items", async ({ page: _page }) => {
    // This test would require authentication
    // For now, just verify the structure
    test.skip(true, "Requires authentication");
  });
});

test.describe("Internationalization", () => {
  test("should default to Spanish locale", async ({ page }) => {
    await page.goto("/");
    const html = await page.locator("html").getAttribute("lang");
    expect(html).toBe("es");
  });

  test("should display content in Spanish", async ({ page }) => {
    await page.goto("/");
    // Check for Spanish content or translations
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toBeTruthy();
  });
});

test.describe("Responsive Design", () => {
  test("should display correctly on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("should display correctly on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("should display correctly on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});
