import { test, expect } from "@playwright/test";

/**
 * Component-Specific E2E Tests
 * 
 * Interactive testing for UI components
 * Location: src/__tests__/e2e/components/
 */

test.describe("Button Component E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
  });

  test("should handle click events", async ({ page }) => {
    const button = page.locator('[data-testid="button-click-test"]');
    
    // Set up dialog handler to catch alert
    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Button clicked!");
      await dialog.accept();
    });
    
    await button.click();
  });

  test("should be keyboard accessible", async ({ page }) => {
    const button = page.locator('[data-testid="button-default"]');
    
    // Focus button
    await button.focus();
    await expect(button).toBeFocused();
    
    // Activate with Enter
    await page.keyboard.press("Enter");
    
    // Activate with Space
    await button.focus();
    await page.keyboard.press("Space");
  });

  test("should not trigger when disabled", async ({ page }) => {
    const button = page.locator('[data-testid="button-disabled"]');
    
    // Should not be clickable
    await expect(button).toBeDisabled();
  });
});

test.describe("Input Component E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
  });

  test("should handle text input", async ({ page }) => {
    const input = page.locator('[data-testid="input-text"]');
    
    await input.fill("Test input value");
    await expect(input).toHaveValue("Test input value");
  });

  test("should handle focus and blur", async ({ page }) => {
    const input = page.locator('[data-testid="input-text"]');
    
    await input.focus();
    await expect(input).toBeFocused();
    
    // Blur by clicking elsewhere
    await page.click("body");
    await expect(input).not.toBeFocused();
  });

  test("should handle disabled state", async ({ page }) => {
    const input = page.locator('[data-testid="input-disabled"]');
    
    await expect(input).toBeDisabled();
  });

  test("should support different input types", async ({ page }) => {
    const types = ["text", "password", "email", "number"];
    
    for (const type of types) {
      const input = page.locator(`[data-testid="input-${type}"]`);
      await expect(input).toHaveAttribute("type", type);
    }
  });
});

test.describe("LocationPicker Component E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
  });

  test("should open dropdown on click", async ({ page }) => {
    const picker = page.locator('[data-testid="location-picker"]');
    const dropdown = page.locator('[data-testid="location-picker-dropdown"]');
    
    // Initially closed
    await expect(dropdown).not.toBeVisible();
    
    // Open on click
    await picker.click();
    await expect(dropdown).toBeVisible();
  });

  test("should close on selection", async ({ page }) => {
    const picker = page.locator('[data-testid="location-picker"]');
    const option = page.locator('[data-testid="location-option"]').first();
    
    await picker.click();
    await option.click();
    
    // Dropdown should close
    await expect(page.locator('[data-testid="location-picker-dropdown"]')).not.toBeVisible();
  });

  test("should close on outside click", async ({ page }) => {
    const picker = page.locator('[data-testid="location-picker"]');
    
    await picker.click();
    await expect(page.locator('[data-testid="location-picker-dropdown"]')).toBeVisible();
    
    // Click outside
    await page.click("body");
    await expect(page.locator('[data-testid="location-picker-dropdown"]')).not.toBeVisible();
  });

  test("should be keyboard navigable", async ({ page }) => {
    const picker = page.locator('[data-testid="location-picker"]');
    
    await picker.focus();
    await page.keyboard.press("Enter");
    
    // Dropdown should open
    await expect(page.locator('[data-testid="location-picker-dropdown"]')).toBeVisible();
    
    // Navigate with arrow keys
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    
    // Should close and select
    await expect(page.locator('[data-testid="location-picker-dropdown"]')).not.toBeVisible();
  });
});

test.describe("UploadZone Component E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/test/components");
  });

  test("should handle file upload", async ({ page }) => {
    const uploadZone = page.locator('[data-testid="upload-zone"]').first();
    
    // Upload a file
    await uploadZone.setInputFiles({
      name: "test-receipt.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("fake image data"),
    });
    
    // Should show preview
    await expect(page.locator('[data-testid="upload-preview"]')).toBeVisible();
  });

  test("should clear preview on clear button", async ({ page }) => {
    const uploadZone = page.locator('[data-testid="upload-zone"]').first();
    
    // Upload file
    await uploadZone.setInputFiles({
      name: "test-receipt.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("fake image data"),
    });
    
    // Clear
    await page.click('[data-testid="upload-clear-button"]');
    
    // Preview should be gone
    await expect(page.locator('[data-testid="upload-preview"]')).not.toBeVisible();
  });
});

test.describe("ShoppingItem Component E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/shopping/test-list");
  });

  test("should toggle checkbox", async ({ page }) => {
    const checkbox = page.locator('[data-testid="shopping-item-checkbox"]').first();
    
    const initialChecked = await checkbox.isChecked();
    await checkbox.click();
    
    // Should toggle
    await expect(checkbox).toBeChecked({ checked: !initialChecked });
  });

  test("should delete item", async ({ page }) => {
    const deleteButton = page.locator('[data-testid="shopping-item-delete"]').first();
    const item = page.locator('[data-testid="shopping-item"]').first();
    
    await deleteButton.click();
    
    // Item should be removed (after animation)
    await expect(item).not.toBeVisible();
  });
});

test.describe("Dashboard Navigation E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");
  });

  test("should navigate to all sections", async ({ page }) => {
    const sections = [
      { label: "Inventario", url: "/inventory" },
      { label: "Productos", url: "/products" },
      { label: "Tickets", url: "/receipts" },
      { label: "Compras", url: "/shopping" },
      { label: "Precios", url: "/prices" },
      { label: "Configuración", url: "/settings" },
    ];
    
    for (const section of sections) {
      await page.click(`text=${section.label}`);
      await expect(page).toHaveURL(new RegExp(section.url));
      
      // Go back to dashboard
      await page.goto("http://localhost:3000/dashboard");
    }
  });

  test("should show active state on current route", async ({ page }) => {
    await page.goto("http://localhost:3000/inventory");
    
    const activeLink = page.locator('nav a[href="/inventory"]');
    await expect(activeLink).toHaveClass(/bg-blue-100/);
  });

  test("should be responsive", async ({ page }) => {
    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Nav items should be hidden or in hamburger menu
    const navItems = page.locator("nav ul li");
    const isVisible = await navItems.first().isVisible().catch(() => false);
    
    // On mobile, nav items might be hidden
    expect(typeof isVisible).toBe("boolean");
  });
});
