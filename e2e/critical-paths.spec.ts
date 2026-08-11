import { test, expect, type Page } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

/**
 * An address no other test can produce.
 *
 * The timestamp was unique enough while the suite ran one test at a time. With
 * files running in parallel two registrations can begin in the same
 * millisecond, and the collision does not surface as a collision: it surfaces as
 * "email already registered" inside a test that is not about duplicates, in
 * whichever of the two lost the race. The worker index makes it impossible
 * rather than unlikely — no two tests running at once share one.
 *
 * This file never signs in with the stored session (`e2e/session.ts`): these are
 * the tests that exercise registration and the login form themselves, so they
 * start signed out, which is what Playwright does by default.
 */
function generateTestEmail(prefix = "test"): string {
  const worker = test.info().parallelIndex;
  return `${prefix}.w${worker}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
}

/**
 * Generate unique test name
 */
function generateTestName(prefix = "Test"): string {
  return `${prefix} ${Date.now()}`;
}

/**
 * Page Object Models for maintainability
 */
class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/login");
  }

  async fillEmail(email: string) {
    await this.page.fill('input[type="email"], input[name="email"]', email);
  }

  async fillPassword(password: string) {
    await this.page.fill('input[type="password"], input[name="password"]', password);
  }

  async clickSubmit() {
    await this.page.click('button[type="submit"], button:has-text("Login"), button:has-text("Iniciar sesión")');
  }

  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickSubmit();
  }

  async expectErrorMessage(message: string = es.auth.invalidCredentials) {
    await expect(this.page.getByText(message)).toBeVisible();
  }
}

class RegisterPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/register");
  }

  async fillName(name: string) {
    await this.page.fill('input[name="name"], input[placeholder*="nombre" i]', name);
  }

  async fillEmail(email: string) {
    await this.page.fill('input[type="email"], input[name="email"]', email);
  }

  async fillPassword(password: string) {
    await this.page.fill('input[type="password"], input[name="password"]', password);
  }

  async fillHouseholdName(name: string) {
    const householdInput = this.page.locator('input[name="householdName"], input[placeholder*="hogar" i]');
    if (await householdInput.isVisible().catch(() => false)) {
      await householdInput.fill(name);
    }
  }

  async clickSubmit() {
    await this.page.click('button[type="submit"], button:has-text("Register"), button:has-text("Registrarse")');
  }

  async register(name: string, email: string, password: string, householdName?: string) {
    await this.fillName(name);
    await this.fillEmail(email);
    await this.fillPassword(password);
    if (householdName) {
      await this.fillHouseholdName(householdName);
    }
    await this.clickSubmit();
  }

  /**
   * Register and wait for the resulting redirect to settle.
   *
   * `clickSubmit` only fires the request. Navigating before it resolves aborts
   * it, leaving no user behind — which silently turned the duplicate-email test
   * into two independent first-time registrations.
   */
  async registerAndWait(
    name: string,
    email: string,
    password: string,
    householdName?: string,
  ) {
    await this.register(name, email, password, householdName);
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  }

  async expectErrorMessage(message: string) {
    await expect(this.page.getByText(message)).toBeVisible();
  }
}

class DashboardPage {
  constructor(private page: Page) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/dashboard/);
    // Wait for dashboard content to load
    await this.page.waitForLoadState("networkidle");
  }

  async getNavigationItems() {
    return this.page.locator("nav a, nav button, [role=navigation] a");
  }

  /**
   * Navigates by clicking when the navigation is reachable, and by URL when it
   * is not.
   *
   * DashboardNav hides its links below the `md` breakpoint and no mobile
   * navigation exists (ISSUES.md NAV-1), so on a phone viewport there is
   * nothing to click. These tests are about stock, not about navigation, so
   * they fall back rather than failing on an unrelated gap. The onboarding test
   * still asserts the desktop navigation renders.
   */
  private async goToSection(section: "products" | "inventory") {
    const link = this.page.locator(`nav a[href="/${section}"]`).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
    } else {
      await this.page.goto(`/${section}`);
    }
    await expect(this.page).toHaveURL(new RegExp(`/${section}`));
  }

  async navigateToProducts() {
    await this.goToSection("products");
  }

  async navigateToInventory() {
    await this.goToSection("inventory");
  }
}

class ProductsPage {
  constructor(private page: Page) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/products/);
  }

  // Selectors target hrefs rather than link text. The app ships in Spanish and
  // English, so text matching would pass in one language and fail in the other.
  async clickAddProduct() {
    await this.page.click('a[href="/products/new"]');
    await this.page.waitForURL(/\/products\/new/);
  }

  async fillProductName(name: string) {
    await this.page.fill('input[name="name"], input[placeholder*="nombre" i]', name);
  }

  async selectCategory(category: string) {
    const categorySelect = this.page.locator('select[name="category"], input[name="category"]');
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.fill(category);
    }
  }

  async fillBarcode(barcode: string) {
    const barcodeInput = this.page.locator('input[name="barcode"], input[placeholder*="código" i]');
    if (await barcodeInput.isVisible().catch(() => false)) {
      await barcodeInput.fill(barcode);
    }
  }

  async clickSave() {
    await this.page.click('button[type="submit"], button:has-text("Save"), button:has-text("Guardar")');
  }

  async createProduct(name: string, category?: string, barcode?: string) {
    await this.clickAddProduct();
    await this.fillProductName(name);
    if (category) {
      await this.selectCategory(category);
    }
    if (barcode) {
      await this.fillBarcode(barcode);
    }
    await this.clickSave();
  }

  async expectProductInList(name: string) {
    await expect(this.page.locator(`text=${name}`).first()).toBeVisible();
  }
}

class InventoryPage {
  constructor(private page: Page) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/inventory/);
  }

  async clickAddStock() {
    await this.page.click('a[href="/inventory/add"]');
    await this.page.waitForURL(/\/inventory\/add/);
  }

  /**
   * The product picker is a native select populated from a tRPC query, so the
   * options arrive after the element does. Waiting only for the select yields a
   * lone placeholder and a silent mis-selection.
   */
  async selectProduct(productName: string) {
    const select = this.page.locator('select[name="productId"]');
    await select.waitFor();
    await this.page.waitForFunction(
      () =>
        (document.querySelector('select[name="productId"]') as HTMLSelectElement | null)
          ?.options.length ?? 0,
      undefined,
      { timeout: 30_000 },
    );
    await this.page.waitForFunction(
      (name) =>
        Array.from(
          (document.querySelector('select[name="productId"]') as HTMLSelectElement | null)
            ?.options ?? [],
        ).some((o) => o.text.includes(name)),
      productName,
      { timeout: 30_000 },
    );
    const labels = await select.locator("option").allTextContents();
    const match = labels.find((t) => t.includes(productName));
    if (!match) throw new Error(`Product "${productName}" not in the picker`);
    await select.selectOption({ label: match });
  }

  async fillQuantity(quantity: string) {
    await this.page.fill('input[name="quantity"], input[type="number"]', quantity);
  }

  async clickSave() {
    await this.page.click('button[type="submit"], button:has-text("Save"), button:has-text("Guardar")');
  }

  async addStock(productName: string, quantity: string) {
    await this.clickAddStock();
    await this.selectProduct(productName);
    await this.fillQuantity(quantity);
    await this.clickSave();
  }

  async expectStockEntry(productName: string) {
    await expect(this.page.locator(`text=${productName}`).first()).toBeVisible();
  }

  async clickConsumeStock() {
    // The stock forms report what they wrote instead of redirecting to
    // /inventory (ISSUES.md A11Y-1), so this may be called from the
    // confirmation panel, which has no navigation of its own.
    if (!this.page.url().includes("/inventory/consume")) {
      await this.page.goto("/inventory/consume");
    }
    await this.page.waitForURL(/\/inventory\/consume/);
  }

  async consumeStock(productName: string, quantity: string) {
    await this.clickConsumeStock();
    await this.selectProduct(productName);
    await this.fillQuantity(quantity);
    await this.clickSave();
  }
}



/**
 * E2E Critical Path Tests
 * 
 * These tests cover the most important user flows:
 * 1. Onboarding Flow: Register → Create household → Land on dashboard
 * 2. Product Creation: Login → Navigate to products → Add product → Verify in list
 * 3. Inventory Management: Login → Add stock → View inventory → Consume stock
 */

test.describe("Onboarding Flow", () => {
  test("should complete full onboarding journey", { tag: "@smoke" }, async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);

    const testEmail = generateTestEmail("e2e-onboarding");
    const testName = generateTestName("E2E Test User");
    const testPassword = "E2ETestPassword123!";
    const householdName = generateTestName("E2E Test Household");

    // Navigate to registration
    await registerPage.goto();
    await expect(page).toHaveURL(/\/register/);

    // Fill registration form with household
    await registerPage.register(testName, testEmail, testPassword, householdName);

    // Should redirect to dashboard after successful registration
    await dashboardPage.expectLoaded();

    // Verify navigation items are present
    const navItems = await dashboardPage.getNavigationItems();
    expect(await navItems.count()).toBeGreaterThan(0);
  });

  test("should redirect unauthenticated users to login", async ({ page }) => {
    // Try to access dashboard directly
    await page.goto("/dashboard");
    
    // Should be redirected to login
    await expect(page).toHaveURL(/\/login/);
  });

  test("should show error for duplicate email registration", async ({ page }) => {
    const registerPage = new RegisterPage(page);

    const testEmail = generateTestEmail("e2e-duplicate");
    const testName = generateTestName("E2E Duplicate User");
    const testPassword = "E2ETestPassword123!";

    // First registration — must be allowed to finish. Navigating away while it
    // is in flight aborts the request, so no user is created and the "duplicate"
    // attempt below simply succeeds.
    await registerPage.goto();
    await registerPage.registerAndWait(testName, testEmail, testPassword);

    // Second registration with same email
    await registerPage.goto();
    await registerPage.register("Different Name", testEmail, "DifferentPassword123!");

    // Should surface the duplicate-email message rather than signing in
    await registerPage.expectErrorMessage(es.auth.emailExists);
    await expect(page).toHaveURL(/\/register/);
  });
});

test.describe("Product Creation Flow", () => {
  // Same reason as Inventory Management: see the note there.
  test.skip(({ isMobile }) => Boolean(isMobile), "Phone UI is Phase 4");

  test("should create product and verify in list", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);

    // Setup: Register and login
    const testEmail = generateTestEmail("e2e-product");
    const testName = generateTestName("E2E Product User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    // A household is required, not optional decoration: every product and stock
    // procedure resolves through householdId. Registering without one produces
    // an account that cannot use these screens at all — see ISSUES.md HOUSE-1.
    await registerPage.register(
      testName,
      testEmail,
      testPassword,
      generateTestName("E2E Household"),
    );
    await dashboardPage.expectLoaded();

    // Navigate to products
    await dashboardPage.navigateToProducts();
    await productsPage.expectLoaded();

    // Create product
    const productName = generateTestName("E2E Test Product");
    await productsPage.createProduct(productName, "Food", `E2E-${Date.now()}`);

    // Verify product appears in list
    await productsPage.expectProductInList(productName);
  });

  test("should require authentication for product pages", async ({ page }) => {
    // Try to access products without authentication
    await page.goto("/products");
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Inventory Management Flow", () => {
  // These drive multi-step forms that have had no mobile design work: the
  // dashboard has no mobile navigation (ISSUES.md NAV-1) and the stock forms
  // were built desktop-first under decision D1. Building the phone experience
  // is Phase 4 of docs/REDESIGN_PLAN.md; until then, running them on a phone
  // viewport measures an absence rather than a regression. Remove this skip as
  // part of that phase — it is the point at which they should start passing.
  test.skip(({ isMobile }) => Boolean(isMobile), "Phone UI is Phase 4");

  test("should add stock to product", { tag: "@smoke" }, async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);
    const inventoryPage = new InventoryPage(page);

    // Setup: Register user
    const testEmail = generateTestEmail("e2e-inventory");
    const testName = generateTestName("E2E Inventory User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    // A household is required, not optional decoration: every product and stock
    // procedure resolves through householdId. Registering without one produces
    // an account that cannot use these screens at all — see ISSUES.md HOUSE-1.
    await registerPage.register(
      testName,
      testEmail,
      testPassword,
      generateTestName("E2E Household"),
    );
    await dashboardPage.expectLoaded();

    // Create a product first
    await dashboardPage.navigateToProducts();
    const productName = generateTestName("E2E Inventory Product");
    await productsPage.createProduct(productName);

    // Navigate to inventory
    await dashboardPage.navigateToInventory();
    await inventoryPage.expectLoaded();

    // Add stock
    await inventoryPage.addStock(productName, "5");

    // Verify stock entry
    await inventoryPage.expectStockEntry(productName);
  });

  test("should consume stock from product", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);
    const inventoryPage = new InventoryPage(page);

    // Setup: Register user and create product
    const testEmail = generateTestEmail("e2e-consume");
    const testName = generateTestName("E2E Consume User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    // A household is required, not optional decoration: every product and stock
    // procedure resolves through householdId. Registering without one produces
    // an account that cannot use these screens at all — see ISSUES.md HOUSE-1.
    await registerPage.register(
      testName,
      testEmail,
      testPassword,
      generateTestName("E2E Household"),
    );
    await dashboardPage.expectLoaded();

    // Create product
    await dashboardPage.navigateToProducts();
    const productName = generateTestName("E2E Consume Product");
    await productsPage.createProduct(productName);

    // Add initial stock
    await dashboardPage.navigateToInventory();
    await inventoryPage.addStock(productName, "10");

    // Consume stock
    await inventoryPage.consumeStock(productName, "3");

    // Verify the operation completed (no error)
    await inventoryPage.expectStockEntry(productName);
  });
});

test.describe("Login Flow", () => {
  test("should login with valid credentials", { tag: "@smoke" }, async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // Setup: Create user
    const testEmail = generateTestEmail("e2e-login");
    const testName = generateTestName("E2E Login User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    // A household is required, not optional decoration: every product and stock
    // procedure resolves through householdId. Registering without one produces
    // an account that cannot use these screens at all — see ISSUES.md HOUSE-1.
    await registerPage.register(
      testName,
      testEmail,
      testPassword,
      generateTestName("E2E Household"),
    );
    await dashboardPage.expectLoaded();

    // Logout first (if there's a logout button)
    // Then login again
    await page.goto("/login");
    await loginPage.login(testEmail, testPassword);

    // Should redirect to dashboard
    await dashboardPage.expectLoaded();
  });

  test("should show error for invalid credentials", async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login("nonexistent@example.com", "wrongpassword");

    await loginPage.expectErrorMessage();
  });

  test("should show error for empty fields", async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.clickSubmit();

    // Both inputs are `required`, so the browser blocks submission natively and
    // the app never renders an error of its own. Assert the native guard held.
    const email = page.locator('input[name="email"]');
    await expect(email).toHaveJSProperty("validity.valid", false);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(es.auth.invalidCredentials)).toBeHidden();
  });
});

test.describe("Internationalization", () => {
  test("should default to Spanish locale", async ({ page }) => {
    await page.goto("/");
    const html = await page.locator("html").getAttribute("lang");
    expect(html).toBe("es");
  });

  test("should display Spanish content on login page", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/login");
    const bodyText = await page.locator("body").textContent();
    // Check for Spanish keywords (adjust based on actual translations)
    expect(bodyText?.toLowerCase()).toMatch(/iniciar|sesión|email|contraseña/);
  });
});

/**
 * The three "Responsive Design" tests that stood here have been removed.
 *
 * Each set a viewport, went to `/`, asserted `body` was visible, and then
 * asserted that `page.viewportSize()?.width` equalled the width it had just
 * passed to `setViewportSize`. That is a test of Playwright, not of Stoky: it
 * cannot fail for any change to this application.
 *
 * What they were reaching for is covered properly now, and by measurement
 * rather than by assertion of a value already known: `a11y-structure.spec.ts`
 * sweeps sixteen routes at phone, tablet and desktop, `dynamic-routes.spec.ts`
 * does the same for the routes with an id in them, and both fail on horizontal
 * overflow — which is the thing a responsive layout actually gets wrong.
 */

/**
 * The low-stock display, read as the seeded household.
 *
 * It sits in its own block because it needs the opposite setup from its
 * neighbours: they register a fresh account precisely to prove onboarding
 * works, and a fresh account has an empty inventory. The condition being
 * checked here only exists in seeded data.
 *
 * The version this replaces registered an account, created a product, added one
 * unit and then asserted nothing at all — it ended on
 * `// Assertion omitted - depends on UI implementation`. It could not have
 * worked in any case: a product created through `/products/new` carries no
 * minimum, so nothing about it is ever low. I rewrote it against the seeded
 * products and left it registering, which failed for exactly that reason —
 * the new household cannot see them.
 */
test.describe("Low stock, as the seeded household", () => {
  // Desktop width, deliberately. The page renders the same products twice —
  // a table from `lg` and cards below it — and only one is ever displayed.
  // `src/app/(dashboard)/inventory/page.tsx` says so at the top of the table:
  // source order decides which copy a `.first()` selector resolves to, and on a
  // phone that is the hidden one. The row-based assertions below need the table
  // to exist at all.
  //
  // The card tier gets its own test below, at its own width, rather than a
  // selector here that matches whichever copy happens to be visible — that
  // would hide the next instance of this instead of catching it (TEST-4).
  test.use({ storageState: SESSION_FILE, viewport: { width: 1280, height: 900 } });

  test("marks the products that are below their minimum", async ({ page }) => {
    await page.goto("/inventory");
    await settle(page);

    // The seed guarantees three: Leche entera at 2 of 6, Aceite at 1 of 2,
    // Café at 0 of 2. Named rather than counted — "three badges are showing"
    // passes just as well when they are attached to the wrong products.
    const lowStock = page.getByText(es.inventory.lowStock, { exact: false });
    await expect(lowStock.first()).toBeVisible();

    for (const product of [
      "Leche entera",
      "Aceite de oliva virgen extra",
      "Café molido natural",
    ]) {
      await expect(
        page.getByRole("row", { name: new RegExp(product) }).getByText(es.inventory.lowStock),
        `${product} is below its minimum in the seed and should be marked`,
      ).toBeVisible();
    }

    // Arroz is at 5 of a minimum of 2. If everything were marked, the assertions
    // above would pass while meaning nothing.
    await expect(
      page.getByRole("row", { name: /Arroz redondo/ }).getByText(es.inventory.lowStock),
    ).toHaveCount(0);
  });
});

/**
 * ISSUES.md TEST-4 — the same products, at the width most people read them.
 *
 * `/inventory` renders every product twice and shows one: a table from `lg`,
 * cards below it. The suite asserted the badge only through
 * `getByRole("row", …)`, which exists solely in the table, so the card tier —
 * the phone and the kitchen tablet — was covered by nothing.
 *
 * This belongs in a browser and nowhere cheaper. Which copy is visible is
 * decided by a CSS media query, and happy-dom has no layout engine: both copies
 * are in its DOM and every rectangle is 0×0, so the rendered tier cannot tell
 * them apart (PROGRESS D34).
 */
test.describe("Low stock on the card tier", () => {
  test.use({ storageState: SESSION_FILE, viewport: { width: 390, height: 844 } });

  test("marks the same products on a phone", async ({ page }) => {
    await page.goto("/inventory");
    await settle(page);

    // The table must be gone, or the assertions below could be reading it.
    await expect(page.getByRole("table")).toBeHidden();

    for (const product of [
      "Leche entera",
      "Aceite de oliva virgen extra",
      "Café molido natural",
    ]) {
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: product })
          .getByText(es.inventory.lowStock),
        `${product} is below its minimum and should be marked on the card tier`,
      ).toBeVisible();
    }

    // Arroz is at 5 of a minimum of 2. Without this the loop above would pass
    // just as well if every card carried a badge.
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Arroz redondo" })
        .getByText(es.inventory.lowStock),
    ).toHaveCount(0);
  });
});
