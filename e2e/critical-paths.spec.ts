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
    // A new account is asked which screen it wants (Journey 8).
    await expect(this.page).toHaveURL(/\/start/, { timeout: 15_000 });
  }

  async expectErrorMessage(message: string) {
    await expect(this.page.getByText(message)).toBeVisible();
  }
}

class DashboardPage {
  constructor(private page: Page) {}

  /**
   * Arrive on the panel after registering or signing in.
   *
   * Signing in lands on `/`, which sends a device nobody has chosen a screen
   * on to `/start` (Journey 8) — and every account these journeys create is
   * new to this browser context. So they answer the question the way a person
   * does, by choosing the panel, rather than typing its URL. A second sign-in
   * on the same context has already answered and goes straight there.
   */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/(start|dashboard)/, { timeout: 15_000 });
    if (new URL(this.page.url()).pathname === "/start") {
      await this.page
        .getByRole("button", { name: new RegExp(es.start.dashboard) })
        .click();
    }
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
    const link = this.page.locator(`nav a[href="/${section}"]:visible`).first();
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
    await this.page.click('a[href="/products/new"]:visible');
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

    // The confirmation names what was created and offers where to go next.
    // Taking its "ver todos los productos" exit is what a person does, and it
    // leaves this journey on the list — which is where every caller looks
    // afterwards. Escape would leave it on an emptied form.
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(name);
    await dialog.getByRole("link", { name: es.products.new.successViewProducts }).click();
    await this.page.waitForURL(/\/products$/);
  }

  async expectProductInList(name: string) {
    // `exact`, and by role. A `text=` locator matches the row's three action
    // links — "Ajustar de «X»", "Historial de «X»", "Precios de «X»" — and the
    // hidden `aria-live` region that names a product too, so `.first()` was
    // picking whichever the DOM happened to order first. It resolved to eight
    // elements at a phone viewport and to a hidden one first (ISSUES.md
    // TEST-6). Only the row's title link is named exactly the product.
    await expect(
      this.page.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
}

class InventoryPage {
  constructor(private page: Page) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/inventory/);
  }

  async clickAddStock() {
    await this.page.click('a[href="/inventory/add"]:visible');
    await this.page.waitForURL(/\/inventory\/add/);
  }

  /**
   * The product picker is a native select populated from a tRPC query, so the
   * options arrive after the element does. Waiting only for the select yields a
   * lone placeholder and a silent mis-selection.
   */
  async selectProduct(productName: string) {
    const select = this.page.locator('select[name="productId"]:visible');
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
    await this.page.fill(
      'input[name="quantity"]:visible, input[type="number"]:visible',
      quantity,
    );
  }

  async clickSave() {
    await this.page.click(
      'button[type="submit"]:visible, button:visible:has-text("Save"), button:visible:has-text("Guardar")',
    );
  }

  async addStock(productName: string, quantity: string) {
    await this.clickAddStock();
    await this.selectProduct(productName);
    await this.fillQuantity(quantity);
    await this.clickSave();

    // Wait for the confirmation before returning, because that dialog is the
    // only thing that says the write reached the server. Callers used to move
    // straight on to the next screen, which navigated away from a mutation
    // still in flight and aborted it — the stock never landed, and the next
    // step failed with "solo quedan 0" as though the product were empty.
    // It was a race the whole time; instant navigation is simply fast enough
    // to lose it every run instead of rarely.
    await expect(this.page.getByRole("dialog")).toBeVisible({
      timeout: 30_000,
    });
  }

  /**
   * Read inside the confirmation, not on the page behind it.
   *
   * The form is still mounted under the dialog, so `text=NAME` also matches
   * the `<option>` in the product picker — an element with a zero-size
   * rectangle inside a closed native select, which never becomes visible.
   */
  async expectStockEntry(productName: string) {
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(productName);
  }

  async clickConsumeStock() {
    // The stock forms confirm in a dialog rather than redirecting to
    // /inventory (ISSUES.md A11Y-1). It is modal, so it must be answered
    // before this journey can go anywhere else.
    const dialog = this.page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await this.page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    if (!this.page.url().includes("/inventory/consume")) {
      // Dismissing the dialog starts a client navigation of its own — back to
      // `/inventory/add`, the form it confirmed — and a `goto` issued into that
      // window dies with "interrupted by another navigation". `waitForLoadState`
      // is not enough: the app's navigation begins *after* the current load has
      // settled, so the wait returns before there is anything to wait for.
      // Waiting for the URL it is heading to is what actually lands it. Caught,
      // because on a desktop viewport it has usually happened already
      // (ISSUES.md TEST-6).
      await this.page
        .waitForURL(/\/inventory\/add/, { timeout: 2000 })
        .catch(() => {});
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
 * 1. Onboarding Flow: Register → Create household → Choose a screen → Land on dashboard
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

    // Asked which screen to start on, then on the one chosen
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
  // Not skipped on mobile any more, and not run there either: no project with
  // `isMobile` matches this file at all. Mobile Safari runs the two layout
  // specs and nothing else, which is D33's deliberate scoping — one engine's
  // worth of phone-width layout coverage rather than a matrix. The guard that
  // used to sit here cited "Phone UI is Phase 4", a phase that closed, and
  // could not fire either way (ISSUES.md TEST-6).
  //
  // The eight tests in these two describes were run at an iPhone 12 viewport
  // once, on 2026-08-27, to find out what the guard had been hiding: four
  // failed, all four on locators, none on anything the product does.

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

  test("should edit a product and see the change on its detail", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);

    // Its own household and its own product: the seeded products are asserted
    // by name elsewhere (TEST-3's lesson), so the edit journey brings the state
    // it mutates.
    await registerPage.goto();
    await registerPage.register(
      generateTestName("E2E Edit User"),
      generateTestEmail("e2e-edit"),
      "E2ETestPassword123!",
      generateTestName("E2E Edit Household"),
    );
    await dashboardPage.expectLoaded();

    await dashboardPage.navigateToProducts();
    await productsPage.expectLoaded();

    const originalName = generateTestName("E2E Editable");
    await productsPage.createProduct(originalName);

    // Start where a person would: the product's own page, reached by its name.
    await page.goto("/products");
    await page.getByRole("link", { name: originalName, exact: true }).click();
    await page.waitForURL(/\/products\/[^/]+$/);

    // No second screen to go to: the fields are edited where they are read.
    await page.getByRole("button", { name: es.products.detail.editFields }).click();

    const editedName = `${originalName} (editado)`;
    await page.getByLabel(es.products.edit.nameLabel).fill(editedName);
    await page.getByLabel(es.products.edit.brandLabel).fill("Marca E2E");
    await page.getByRole("button", { name: es.products.edit.submit }).click();

    // The save announces itself instead of redirecting into silence (A11Y-1).
    await expect(page.getByTestId("snackbar")).toContainText(
      es.products.edit.saved.replace("{name}", editedName),
    );

    // And the page it was made on carries the change without going anywhere.
    await expect(
      page.getByRole("heading", { level: 1, name: editedName }),
    ).toBeVisible();
    await expect(page.getByText("Marca E2E")).toBeVisible();
  });

  test("should delete an unused product, as the household's admin, twice asked", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);

    // Its own household: the registrant is its OWNER, which is what the
    // admin-only delete needs (D90). The product never gets stock, so its
    // ledger is empty and the button is offered at all.
    await registerPage.goto();
    await registerPage.register(
      generateTestName("E2E Delete User"),
      generateTestEmail("e2e-delete"),
      "E2ETestPassword123!",
      generateTestName("E2E Delete Household"),
    );
    await dashboardPage.expectLoaded();

    await dashboardPage.navigateToProducts();
    await productsPage.expectLoaded();

    const productName = generateTestName("E2E Borrable");
    await productsPage.createProduct(productName);

    await page.goto("/products");
    await page.getByRole("link", { name: productName, exact: true }).click();
    await page.waitForURL(/\/products\/[^/]+$/);

    // Two presses, deliberately: the first opens the confirmation that names
    // the product, the second is the one that fires.
    await page.click(`button:has-text("${es.products.detail.deleteButton}")`);
    await expect(
      page.getByText(es.products.detail.deleteConfirmBody),
    ).toBeVisible();
    await page.click(
      `button:has-text("${es.products.detail.deleteConfirm}")`,
    );

    // The page described a product that no longer exists, so it leaves — and
    // the confirmation travels with it, because the snackbar is mounted above
    // every route rather than inside the screen that raised it.
    await page.waitForURL(/\/products$/);
    await expect(page.getByTestId("snackbar")).toContainText(
      es.products.detail.deletedBody.replace("{name}", productName),
    );

    // And the catalogue no longer lists it.
    await page.goto("/products");
    await settle(page);
    await expect(page.getByRole("link", { name: productName, exact: true })).toHaveCount(0);
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
  // Not skipped on mobile any more, and not run there either: no project with
  // `isMobile` matches this file at all. Mobile Safari runs the two layout
  // specs and nothing else, which is D33's deliberate scoping — one engine's
  // worth of phone-width layout coverage rather than a matrix. The guard that
  // used to sit here cited "Phone UI is Phase 4", a phase that closed, and
  // could not fire either way (ISSUES.md TEST-6).
  //
  // The eight tests in these two describes were run at an iPhone 12 viewport
  // once, on 2026-08-27, to find out what the guard had been hiding: four
  // failed, all four on locators, none on anything the product does.

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

test.describe("Journey 4 — stock changes without a form", () => {
  /**
   * §3 flow 3: on the product's own page, plus and minus change stock in
   * place. What the browser alone can prove: the presses compose with the
   * real queue and its ten-second hold, the confirmation carries a working
   * undo affordance, and — the property Journey 6 depends on — the ledger
   * receives **two purchases of one**, not one write that set the total.
   */
  test("the ± stepper books deltas, confirmed in words with undo", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);

    // Its own household and its own product, so no seeded state is disturbed
    // and no other test can disturb this one (TEST-3's lesson).
    await registerPage.goto();
    await registerPage.register(
      generateTestName("E2E Stepper User"),
      generateTestEmail("e2e-stepper"),
      "E2ETestPassword123!",
      generateTestName("E2E Stepper Household"),
    );
    await dashboardPage.expectLoaded();

    await dashboardPage.navigateToProducts();
    const productName = generateTestName("E2E Escalonable");
    await productsPage.createProduct(productName);

    await page.goto("/products");
    await page.getByRole("link", { name: productName, exact: true }).click();
    await page.waitForURL(/\/products\/[^/]+$/);

    // Before: nothing in stock, said in words — and minus is disabled, because
    // taking from nothing is a refusal the server would have to make otherwise.
    await expect(page.getByText(es.products.detail.stockEmpty)).toBeVisible();
    const minus = page.getByRole("button", {
      name: new RegExp(`^Usar 1 .+ de «${productName}»$`),
    });
    const plus = page.getByRole("button", {
      name: new RegExp(`^Añadir 1 .+ de «${productName}»$`),
    });
    await expect(minus).toBeDisabled();

    // Two presses. No form, no navigation — the URL must not move.
    await plus.click();
    // The confirmation is a sentence with its undo, not a dialog to answer.
    await expect(page.getByTestId("snackbar")).toContainText("Añadiste 1");
    await expect(
      page.getByRole("button", { name: es.snackbar.undo }).first(),
    ).toBeVisible();
    await plus.click();

    // The number moved in place, the empty warning went, and we never left.
    await expect(page.getByTestId("stepper-value")).toContainText("2");
    await expect(page.getByText(es.products.detail.stockEmpty)).toBeHidden();
    expect(page.url()).toMatch(/\/products\/[^/]+$/);

    // After the hold drains: the ledger says two purchases of +1, not one
    // write of two. The queue holds each press ten seconds for its undo, so
    // the rows are allowed to take that long to arrive.
    await page.getByRole("link", { name: es.products.detail.stockHistoryLink }).click();
    await page.waitForURL(/\/history$/);
    await expect(
      page.getByRole("cell", { name: es.products.history.opPURCHASE, exact: true }),
    ).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole("cell", { name: /^\+1\b/ })).toHaveCount(2);
  });
});


test("a recount leaves unknown details blank and two kitchen taps consume two eggs", async ({ page }) => {
  const register = new RegisterPage(page);
  const dashboard = new DashboardPage(page);
  const products = new ProductsPage(page);
  await register.goto();
  await register.register(generateTestName("Stock integrity"), generateTestEmail("stock-integrity"), "E2ETestPassword123!", generateTestName("Stock household"));
  await dashboard.expectLoaded();
  await dashboard.navigateToProducts();
  await products.clickAddProduct();
  const name = generateTestName("Huevos de prueba");
  await products.fillProductName(name);
  await page.locator('[name="defaultUnit"]').fill("docena");
  await products.clickSave();
  await page.getByRole("dialog").getByRole("link", { name: es.products.new.successViewProducts }).click();
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForURL(/\/products\/[^/]+$/);
  const productUrl = page.url();

  await page.goto("/inventory/add");
  await page.locator('[name="productId"]').selectOption({ label: name });
  await page.locator('[name="quantity"]').fill("3");
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.locator('[name="expirationDate"]').fill(date);
  await page.locator("summary").click();
  await page.locator('[name="unit"]').fill("docena");
  await page.getByRole("button", { name: es.inventory.add.submit, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.goto("/kitchen");
  const use = page.getByRole("button", { name: new RegExp(`He usado.*${name}`) });
  const card = page.locator("li").filter({ has: use });
  await expect(card).toContainText("Quedan 36 unidades");
  for (const left of [35, 34]) {
    const saved = page.waitForResponse((response) => response.url().includes("inventory.consumeStock") && response.request().method() === "POST");
    await use.click();
    expect((await saved).ok()).toBe(true);
    await expect(card).toContainText(`Quedan ${left} unidades`);
  }
  await page.reload();
  await expect(card).toContainText("Quedan 34 unidades");
  await page.goto(`${productUrl}/history`);
  await expect(page.getByRole("cell", { name: es.products.history.opCONSUME, exact: true })).toHaveCount(2);

  await page.goto("/products");
  const row = page.locator("tr:visible, li:visible").filter({ has: page.getByRole("link", { name, exact: true }) });
  await row.getByRole("link", { name: /^Ajustar/ }).click();
  await page.getByLabel(es.products.adjust.actualLabel, { exact: true }).fill("35");
  await page.getByLabel(es.products.adjust.reasonLabel, { exact: true }).fill("Recuento real");
  await page.getByRole("button", { name: es.products.adjust.submit, exact: true }).click();
  await expect(page.getByTestId("snackbar")).toContainText("35 unidades");
  await page.goto(productUrl);
  await expect(page.getByTestId("stepper-value")).toContainText("35");
  // Only the 34 eggs left in the dated purchase have a known expiry. The
  // recounted extra egg acquires neither its date nor a location.
  await expect(page.getByText("34 unidades · Sin ubicación", { exact: true })).toBeVisible();
  await expect(page.getByText("35 unidades · Sin ubicación", { exact: true })).toHaveCount(0);
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

    // Already answered on this context, so straight to the panel
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
test.describe("The Panel summarises; its lists are the doors", () => {
  // Desktop width for the same reason as the low-stock suite below: the
  // filtered list renders a table at lg and cards under it, and the row-based
  // assertions need the visible copy to be the table.
  test.use({ storageState: SESSION_FILE, viewport: { width: 1280, height: 900 } });

  test("what needs attention is the sections, not a count above them", async ({ page }) => {
    // Three owner passes each cut a layer of the same redundancy: the alert
    // rows went in the second, the sentence that replaced them in the third.
    // "3 productos por reponer" above a section headed "Necesita reposición"
    // listing three products is the same count twice.
    await page.goto("/dashboard");
    await settle(page);

    await expect(page.getByText(/por reponer/)).toHaveCount(0);
    await expect(page.getByText(/lotes? caduca/)).toHaveCount(0);

    // What survives is Phase 8 item 2's invariant, not its wording: the rows
    // here come from the same `needsRestock` question the filtered inventory
    // asks, so the two cannot disagree. The seed holds three such products.
    const section = page.getByRole("region", { name: es.dashboard.restockTitle });
    await expect(section).toBeVisible();
    for (const product of [
      "Leche entera",
      "Aceite de oliva virgen extra",
      "Café molido natural",
    ]) {
      await expect(
        section.getByRole("link", { name: product }),
        `${product} needs restocking in the seed and should be listed`,
      ).toBeVisible();
    }
  });

  test("the restock filter shows exactly the summarised set", async ({ page }) => {
    // Reached from the Panel's overflow note when its five rows are not
    // everything; driven by URL here because the seed's three below-minimum
    // products all fit on the Panel.
    await page.goto("/inventory?filter=restock");
    await settle(page);

    // The filter is loud: it names itself and offers the way back.
    await expect(page.getByText(es.inventory.filterRestockActive)).toBeVisible();
    await expect(
      page.getByRole("link", { name: es.inventory.filterClear }),
    ).toBeVisible();

    // The seed's below-minimum products are the set; Arroz redondo sits at 5
    // of a minimum of 2 and must not be here — a filter that shows everything
    // is the quiet failure this test exists for.
    const table = page.locator("table");
    for (const product of [
      "Leche entera",
      "Aceite de oliva virgen extra",
      "Café molido natural",
    ]) {
      await expect(table.getByRole("link", { name: product })).toBeVisible();
    }
    await expect(table.getByText("Arroz redondo")).toHaveCount(0);
  });
});

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

    // The seed guarantees three below their minimum: Leche entera at 2 of 6,
    // Aceite at 1 of 2, Café at 0 of 2. Named rather than counted — "three
    // badges are showing" passes just as well when they are attached to the
    // wrong products.
    //
    // Café is at zero, and run out beats low: it wears "Sin stock" (UI-11).
    // Both words mean it needs restocking; which one is shown is the stronger
    // statement about the same product.
    const lowStock = page.getByText(es.inventory.lowStock, { exact: false });
    await expect(lowStock.first()).toBeVisible();

    for (const [product, badge] of [
      ["Leche entera", es.inventory.lowStock],
      ["Aceite de oliva virgen extra", es.inventory.lowStock],
      ["Café molido natural", es.inventory.noStock],
    ] as const) {
      await expect(
        page.getByRole("row", { name: new RegExp(product) }).getByText(badge),
        `${product} needs restocking in the seed and should be marked`,
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

    // Café is at zero, so it wears "Sin stock" — run out beats low (UI-11),
    // and the card tier shares the component that decides.
    for (const [product, badge] of [
      ["Leche entera", es.inventory.lowStock],
      ["Aceite de oliva virgen extra", es.inventory.lowStock],
      ["Café molido natural", es.inventory.noStock],
    ] as const) {
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: product })
          .getByText(badge),
        `${product} needs restocking and should be marked on the card tier`,
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
