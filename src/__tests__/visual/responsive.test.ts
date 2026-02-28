import { test, expect } from "@playwright/test";

/**
 * Visual Regression Test Suite
 * 
 * Responsive design testing across multiple viewports
 * Screenshots for visual regression baseline
 * Location: src/__tests__/visual/responsive.test.ts
 */

const viewports = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test.describe("Responsive Design Tests", () => {
  for (const viewport of viewports) {
    test.describe(`${viewport.name} viewport (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test("Button component renders correctly", async ({ page }) => {
        // Navigate to a page with buttons or create a test page
        await page.goto("http://localhost:3000/test/components");
        
        // Take screenshot of button variants
        const button = page.locator('[data-testid="button-default"]').first();
        await expect(button).toBeVisible();
        
        await expect(page).toHaveScreenshot(`button-${viewport.name}.png`, {
          fullPage: false,
        });
      });

      test("Input component renders correctly", async ({ page }) => {
        await page.goto("http://localhost:3000/test/components");
        
        const input = page.locator('[data-testid="input-text"]').first();
        await expect(input).toBeVisible();
        
        await expect(page).toHaveScreenshot(`input-${viewport.name}.png`, {
          fullPage: false,
        });
      });

      test("LocationPicker component renders correctly", async ({ page }) => {
        await page.goto("http://localhost:3000/test/components");
        
        const picker = page.locator('[data-testid="location-picker"]').first();
        await expect(picker).toBeVisible();
        
        await expect(page).toHaveScreenshot(`location-picker-${viewport.name}.png`, {
          fullPage: false,
        });
      });

      test("Dashboard navigation renders correctly", async ({ page }) => {
        await page.goto("http://localhost:3000/dashboard");
        
        const nav = page.locator("nav").first();
        await expect(nav).toBeVisible();
        
        await expect(page).toHaveScreenshot(`dashboard-nav-${viewport.name}.png`, {
          fullPage: false,
        });
      });

      test("Receipt upload zone renders correctly", async ({ page }) => {
        await page.goto("http://localhost:3000/receipts/new");
        
        const uploadZone = page.locator('[data-testid="upload-zone"]').first();
        await expect(uploadZone).toBeVisible();
        
        await expect(page).toHaveScreenshot(`upload-zone-${viewport.name}.png`, {
          fullPage: false,
        });
      });

      test("Shopping list renders correctly", async ({ page }) => {
        await page.goto("http://localhost:3000/shopping");
        
        const shoppingList = page.locator('[data-testid="shopping-list"]').first();
        await expect(shoppingList).toBeVisible();
        
        await expect(page).toHaveScreenshot(`shopping-list-${viewport.name}.png`, {
          fullPage: false,
        });
      });
    });
  }
});

test.describe("Component States Visual Tests", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Button variants", async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
    
    const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"];
    
    for (const variant of variants) {
      const button = page.locator(`[data-testid="button-${variant}"]`);
      await expect(button).toBeVisible();
      await expect(button).toHaveScreenshot(`button-variant-${variant}.png`);
    }
  });

  test("Button states", async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
    
    // Default state
    const defaultButton = page.locator('[data-testid="button-default"]');
    await expect(defaultButton).toHaveScreenshot("button-state-default.png");
    
    // Hover state
    await defaultButton.hover();
    await expect(defaultButton).toHaveScreenshot("button-state-hover.png");
    
    // Focus state
    await defaultButton.focus();
    await expect(defaultButton).toHaveScreenshot("button-state-focus.png");
    
    // Disabled state
    const disabledButton = page.locator('[data-testid="button-disabled"]');
    await expect(disabledButton).toHaveScreenshot("button-state-disabled.png");
  });

  test("Input states", async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
    
    // Default state
    const input = page.locator('[data-testid="input-text"]');
    await expect(input).toHaveScreenshot("input-state-default.png");
    
    // Focus state
    await input.focus();
    await expect(input).toHaveScreenshot("input-state-focus.png");
    
    // With value
    await input.fill("Test value");
    await expect(input).toHaveScreenshot("input-state-filled.png");
    
    // Disabled state
    const disabledInput = page.locator('[data-testid="input-disabled"]');
    await expect(disabledInput).toHaveScreenshot("input-state-disabled.png");
  });

  test("LocationPicker dropdown", async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
    
    const picker = page.locator('[data-testid="location-picker"]');
    await expect(picker).toHaveScreenshot("location-picker-closed.png");
    
    // Open dropdown
    await picker.click();
    await page.waitForTimeout(100);
    await expect(picker).toHaveScreenshot("location-picker-open.png");
  });

  test("Receipt status badges", async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
    
    const statuses = [
      "uploading",
      "processing",
      "parsed",
      "needs-review",
      "confirmed",
      "applied",
      "failed",
    ];
    
    for (const status of statuses) {
      const badge = page.locator(`[data-testid="receipt-status-${status}"]`);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveScreenshot(`receipt-status-${status}.png`);
    }
  });
});

test.describe("Dark Mode Visual Tests", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Components in dark mode", async ({ page }) => {
    // Enable dark mode
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("http://localhost:3000/test/components");
    
    // Take screenshot of components in dark mode
    await expect(page).toHaveScreenshot("components-dark-mode.png", {
      fullPage: true,
    });
  });
});

test.describe("High Contrast Mode", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Components in high contrast", async ({ page }) => {
    // Enable high contrast mode
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("http://localhost:3000/test/components");
    
    await expect(page).toHaveScreenshot("components-high-contrast.png", {
      fullPage: true,
    });
  });
});
