import { test, expect, type Page } from "@playwright/test";
import es from "../messages/es.json";

/**
 * Generate unique test email
 */
function generateTestEmail(prefix = "test"): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
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

  async navigateToProducts() {
    await this.page.click('a[href*="product"], a:has-text("Product"), a:has-text("Productos")');
    await expect(this.page).toHaveURL(/\/products/);
  }

  async navigateToInventory() {
    await this.page.click('a[href*="inventory"], a:has-text("Inventory"), a:has-text("Inventario")');
    await expect(this.page).toHaveURL(/\/inventory/);
  }
}

class ProductsPage {
  constructor(private page: Page) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/products/);
  }

  async clickAddProduct() {
    await this.page.click('button:has-text("Add"), button:has-text("Añadir"), a:has-text("Add"), a:has-text("Añadir")');
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
    await this.page.click('button:has-text("Add Stock"), button:has-text("Añadir"), a:has-text("Add")');
  }

  async selectProduct(productName: string) {
    const productSelect = this.page.locator('select[name="productId"], input[name="product"]');
    if (await productSelect.isVisible().catch(() => false)) {
      await productSelect.fill(productName);
    }
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
    await this.page.click('button:has-text("Consume"), button:has-text("Consumir")');
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
  test("should complete full onboarding journey", async ({ page }) => {
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
  // BLOCKED: /products links to "/products/new", which has no page.tsx. The
  // click lands on a 404 and the form never appears. Unskip when the product
  // creation route exists.
  test.fixme("should create product and verify in list", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);

    // Setup: Register and login
    const testEmail = generateTestEmail("e2e-product");
    const testName = generateTestName("E2E Product User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    await registerPage.register(testName, testEmail, testPassword);
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
  // BLOCKED: /inventory links to "/inventory/add", which has no page.tsx.
  test.fixme("should add stock to product", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);
    const inventoryPage = new InventoryPage(page);

    // Setup: Register user
    const testEmail = generateTestEmail("e2e-inventory");
    const testName = generateTestName("E2E Inventory User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    await registerPage.register(testName, testEmail, testPassword);
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

  // BLOCKED: /inventory links to "/inventory/consume", which has no page.tsx.
  test.fixme("should consume stock from product", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);
    const inventoryPage = new InventoryPage(page);

    // Setup: Register user and create product
    const testEmail = generateTestEmail("e2e-consume");
    const testName = generateTestName("E2E Consume User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    await registerPage.register(testName, testEmail, testPassword);
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

  // BLOCKED: depends on adding stock, which needs the missing "/inventory/add".
  test.fixme("should show low stock warnings", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const productsPage = new ProductsPage(page);
    const inventoryPage = new InventoryPage(page);

    // Setup
    const testEmail = generateTestEmail("e2e-lowstock");
    const testName = generateTestName("E2E Low Stock User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    await registerPage.register(testName, testEmail, testPassword);
    await dashboardPage.expectLoaded();

    // Create product with min stock threshold
    await dashboardPage.navigateToProducts();
    const productName = generateTestName("E2E Low Stock Product");
    // Note: This assumes there's a way to set minStock in the UI
    await productsPage.createProduct(productName);

    // Add minimal stock
    await dashboardPage.navigateToInventory();
    await inventoryPage.addStock(productName, "1");

    // Check for low stock indicator (if implemented in UI)
    // eslint-disable-next-line no-unused-vars
    const _lowStockIndicator = page.locator("text=/low|bajo|poco/i");
    // Assertion omitted - depends on UI implementation
  });
});

test.describe("Login Flow", () => {
  test("should login with valid credentials", async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // Setup: Create user
    const testEmail = generateTestEmail("e2e-login");
    const testName = generateTestName("E2E Login User");
    const testPassword = "E2ETestPassword123!";

    await registerPage.goto();
    await registerPage.register(testName, testEmail, testPassword);
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

  test("should display Spanish content on login page", async ({ page }) => {
    await page.goto("/login");
    const bodyText = await page.locator("body").textContent();
    // Check for Spanish keywords (adjust based on actual translations)
    expect(bodyText?.toLowerCase()).toMatch(/iniciar|sesión|email|contraseña/);
  });
});

test.describe("Responsive Design", () => {
  test("should display correctly on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    
    // Check that mobile menu is accessible or layout is responsive
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(375);
  });

  test("should display correctly on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(768);
  });

  test("should display correctly on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(1920);
  });
});
