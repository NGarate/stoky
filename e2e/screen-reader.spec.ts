import { type CDPSession, type Page, expect, test } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

/**
 * The half of a screen-reader pass that is not a judgement call.
 *
 * DESIGN_AUDIT A4.6 says "one manual screen-reader pass per primary journey.
 * Not automatable, not optional." Half of that is right. A screen reader reads
 * the *accessibility tree* — the roles, names, states and order the browser
 * computes — and that tree is machine-readable through the DevTools protocol
 * (`Accessibility.getFullAXTree`). What needs a person is whether the result
 * *sounds* sensible: whether "Cantidad consumida" is the right words, whether
 * four announcements in a row are three too many. What does not need a person
 * is whether the information is in the tree at all.
 *
 * So this file walks the four primary journeys the way a user does — driving
 * the real controls, not `goto`-ing between steps that have a button — and at
 * each stop asserts four things about the tree:
 *
 * 1. **Every interactive node has a non-empty accessible name.** An unnamed
 *    control is announced as "button", and nothing else.
 * 2. **No accessible name is a raw translation key.** next-intl renders the key
 *    instead of throwing, so `receipts.dropzoneLabel` reaches production and
 *    gets read out as source code. `a11y-aaa.spec.ts` checks this for form
 *    fields; here it is every node in the tree.
 * 3. **Outcomes are announced.** After an action, some live region must appear
 *    or change — a page that silently succeeds tells a reader nothing. The
 *    refusals all do, and so does confirming a receipt line, once its count was
 *    made to move. Saving a stock movement used to not: it redirected to a
 *    route with no live region, so the whole confirmation was the route
 *    announcer reading "Inventario" — the same word it says if you just click
 *    the nav link. Closed: both stock forms now report what they wrote instead
 *    of redirecting, so the announcement names the product and the amount.
 *    It goes red the day someone fixes it, which is the only way a pin is
 *    honest.
 * 4. **Reading order matches visual order.** Tree order against bounding boxes.
 *
 * The rest — is the wording good, is it too chatty — is what the manual pass in
 * A4.6 is still for. This suite shrinks that pass; it does not replace it.
 *
 * Desktop only. Reading order at 1280px is a different assertion from reading
 * order at 390px, where the navigation is a different component; the tiers are
 * swept for structure in `a11y-structure.spec.ts`, and adding two more tiers
 * here would triple a suite that drives four multi-step journeys.
 *
 * **This suite writes.** Driving a journey means completing it: it adds stock,
 * and it confirms one receipt line per run. Confirming is irreversible through
 * the interface and the seed lays down three confirmable lines, so after three
 * runs the review journey stops having anything to confirm and says so rather
 * than passing quietly. `bunx prisma db seed` is the reset.
 */

/* ------------------------------------------------------------- the tree -- */

interface RawAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  backendDOMNodeId?: number;
  childIds?: string[];
}

interface RawDomNode {
  backendNodeId: number;
  nodeName: string;
  shadowRootType?: string;
  children?: RawDomNode[];
  shadowRoots?: RawDomNode[];
  contentDocument?: RawDomNode;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface AxNode {
  role: string;
  name: string;
  /** `aria-live` as the browser computed it, present only on the live root. */
  live: string | undefined;
  ignored: boolean;
  backendId: number | undefined;
  /** Index one past the last descendant, so a subtree is a slice. */
  subtreeEnd: number;
  /** Set only for the nodes whose geometry is asked for. */
  box?: Box;
  /** True for Next's own route announcer, which is not the app talking. */
  routeAnnouncer: boolean;
}

/**
 * Subtrees the app did not write and cannot be held to.
 *
 * `nextjs-portal` is the development overlay: it contributes a named button and
 * an unnamed image that exist on no deployed page, so counting them would be
 * measuring the dev server. User-agent shadow roots are Chrome's own controls —
 * `<input type=date>` alone contributes "Month", "Day", "Year" and "Show date
 * picker", in English regardless of the page's language. That is a real thing a
 * Spanish-speaking user meets, and it is worth knowing; it is not a defect this
 * codebase can fix, and reporting it here would bury the ones it can.
 */
async function excludedNodes(cdp: CDPSession): Promise<{
  skip: Set<number>;
  announcer: Set<number>;
}> {
  const { root } = (await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as unknown as { root: RawDomNode };

  const skip = new Set<number>();
  const announcer = new Set<number>();

  function walk(node: RawDomNode, skipping: boolean, announcing: boolean) {
    const tag = node.nodeName.toLowerCase();
    const nowSkipping =
      skipping || tag === "nextjs-portal" || node.shadowRootType === "user-agent";
    const nowAnnouncing = announcing || tag === "next-route-announcer";

    if (nowSkipping) skip.add(node.backendNodeId);
    if (nowAnnouncing) announcer.add(node.backendNodeId);

    for (const child of node.children ?? []) walk(child, nowSkipping, nowAnnouncing);
    for (const shadow of node.shadowRoots ?? [])
      walk(shadow, nowSkipping, nowAnnouncing);
    if (node.contentDocument) walk(node.contentDocument, nowSkipping, nowAnnouncing);
  }

  walk(root, false, false);
  return { skip, announcer };
}

function property(raw: RawAxNode, name: string): unknown {
  return raw.properties?.find((p) => p.name === name)?.value?.value;
}

/**
 * The tree in the order a screen reader walks it.
 *
 * `getFullAXTree` returns the nodes in its own serialisation order, which is not
 * document order — reading it as a flat list would compare the wrong sequence
 * against the wrong boxes. So it is re-walked depth-first from the root through
 * `childIds`, which is the order the reader traverses.
 *
 * Ignored nodes are kept in the walk and marked rather than pruned: a reader
 * skips the node, not its subtree, and pruning at one would silently drop
 * everything underneath it.
 */
async function snapshot(page: Page): Promise<AxNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Accessibility.enable");
    const { skip, announcer } = await excludedNodes(cdp);
    const { nodes } = (await cdp.send(
      "Accessibility.getFullAXTree",
    )) as unknown as { nodes: RawAxNode[] };

    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const out: AxNode[] = [];

    function walk(id: string): void {
      const raw = byId.get(id);
      if (!raw) return;
      if (raw.backendDOMNodeId !== undefined && skip.has(raw.backendDOMNodeId))
        return;

      const node: AxNode = {
        role: raw.role?.value ?? "",
        name: raw.name?.value ?? "",
        live: property(raw, "live") as string | undefined,
        ignored: raw.ignored === true,
        backendId: raw.backendDOMNodeId,
        subtreeEnd: 0,
        routeAnnouncer:
          raw.backendDOMNodeId !== undefined && announcer.has(raw.backendDOMNodeId),
      };
      out.push(node);
      for (const child of raw.childIds ?? []) walk(child);
      node.subtreeEnd = out.length;
    }

    const rootNode = nodes[0];
    if (rootNode) walk(rootNode.nodeId);

    await attachBoxes(cdp, out);
    return out;
  } finally {
    await cdp.detach();
  }
}

/** The roles whose geometry the reading-order check compares. */
const SPINE_ROLES = new Set([
  "heading",
  "link",
  "button",
  "combobox",
  "listbox",
  "textbox",
  "searchbox",
  "spinbutton",
  "checkbox",
  "radio",
  "switch",
  "slider",
]);

async function attachBoxes(cdp: CDPSession, nodes: AxNode[]): Promise<void> {
  for (const node of nodes) {
    if (node.ignored || node.backendId === undefined) continue;
    if (!SPINE_ROLES.has(node.role)) continue;
    try {
      const { model } = (await cdp.send("DOM.getBoxModel", {
        backendNodeId: node.backendId,
      })) as unknown as { model: { border: number[]; width: number; height: number } };
      const [x1, y1, , , x3, y3] = model.border as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      node.box = { left: x1, top: y1, right: x3, bottom: y3 };
    } catch {
      // No box: an <option> inside a closed native select, or anything else the
      // layout engine never placed. Not a finding — it is simply not on screen.
    }
  }
}

/* -------------------------------------------------------------- checks -- */

/**
 * The roles a person operates. `option` is deliberately absent: the options of a
 * closed native `<select>` are in the tree but not on screen, and a blank one is
 * the platform's "no selection" row rather than an unnamed control.
 */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
]);

/** "receipts.dropzoneLabel" — dotted, spaceless, camelCase segments. */
function isTranslationKey(text: string): boolean {
  return /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(text.trim());
}

function describe(node: AxNode): string {
  return `${node.role || "(no role)"} "${node.name}"`;
}

function unnamedControls(nodes: AxNode[]): string[] {
  return nodes
    .filter(
      (node) =>
        !node.ignored &&
        INTERACTIVE_ROLES.has(node.role) &&
        node.name.trim() === "",
    )
    .map(
      (node) =>
        `  ${node.role} — no accessible name (DOM node ${node.backendId}), announced as "${node.role}" and nothing else`,
    );
}

function keyNamedNodes(nodes: AxNode[]): string[] {
  return nodes
    .filter(
      (node) =>
        !node.ignored &&
        // A line box inside a text node. Nothing announces one on its own, and
        // counting them reports the same string once per rendered line.
        node.role !== "InlineTextBox" &&
        isTranslationKey(node.name),
    )
    .map((node) => `  ${node.role} — untranslated key as its name, "${node.name}"`);
}

/**
 * What a reader would hear announced right now, one entry per live region.
 *
 * The text is the region's own subtree rather than its accessible name: a
 * `role="alert"` wrapper has no name, and what gets read out is what is inside
 * it.
 */
interface Announcement {
  role: string;
  live: string;
  /** Every run of text inside the region, in the order it is read. */
  parts: string[];
  text: string;
  /** Next's route announcer, which says where you arrived, not what happened. */
  routeAnnouncer: boolean;
}

function announcements(nodes: AxNode[]): Announcement[] {
  const out: Announcement[] = [];
  nodes.forEach((node, index) => {
    if (node.ignored) return;
    if (!node.live || node.live === "off") return;

    const parts = nodes
      .slice(index + 1, node.subtreeEnd)
      .filter((child) => child.role === "StaticText")
      .map((child) => child.name.replace(/\s+/g, " ").trim())
      .filter((part) => part !== "");

    out.push({
      role: node.role,
      live: node.live,
      parts,
      text: parts.join(" "),
      routeAnnouncer: node.routeAnnouncer,
    });
  });
  return out;
}

/**
 * Announcements the application makes, as opposed to the framework's.
 *
 * Next's route announcer is held apart rather than counted, because it says the
 * same thing — the name of the page you landed on — whether you got there by
 * saving something or by clicking a link. It answers "where am I", never "what
 * just happened", so folding it in would make every navigation look like a
 * confirmation.
 */
function spoken(nodes: AxNode[]): string[] {
  return announcements(nodes)
    .filter((a) => !a.routeAnnouncer && a.text !== "")
    .map((a) => `${a.role || a.live}: ${a.text}`);
}

/** What is being said now that was not being said before the action. */
function newlySpoken(before: string[], after: string[]): string[] {
  return after.filter((line) => !before.includes(line));
}

/**
 * Tree order against visual order.
 *
 * Compared pairwise rather than by sorting the whole page, because a page is not
 * one column. Two rules, and both of them are about a reader being sent
 * backwards:
 *
 * - Going *up* the page is a finding only when the next element overlaps the
 *   current one horizontally. A two-column layout legitimately jumps from the
 *   bottom of the left column to the top of the right one, and `/login` does
 *   exactly that.
 * - Going *left* is a finding only within the same row, and only when the next
 *   element ends before the current one begins — anything else is two things
 *   sharing a line.
 *
 * The tolerance absorbs baseline differences: a section heading and the "see
 * all" link beside it sit 9px apart on `/dashboard` and are one row to a reader.
 */
const ROW_TOLERANCE = 16;

function readingOrderFindings(nodes: AxNode[]): string[] {
  const spine = nodes.filter(
    (node) =>
      !node.ignored &&
      node.box !== undefined &&
      // Off-canvas and 1×1: visually-hidden text has a box, and holding it to a
      // position on screen it deliberately does not have would be nonsense.
      node.box.right - node.box.left > 1 &&
      node.box.bottom - node.box.top > 1 &&
      node.box.left >= 0 &&
      node.box.top >= 0,
  );

  const findings: string[] = [];
  for (let i = 1; i < spine.length; i += 1) {
    const previous = spine[i - 1] as AxNode;
    const current = spine[i] as AxNode;
    const a = previous.box as Box;
    const b = current.box as Box;

    const sameRow = Math.abs(b.top - a.top) <= ROW_TOLERANCE;
    const overlapsHorizontally = b.left < a.right && b.right > a.left;

    if (b.top < a.top - ROW_TOLERANCE && overlapsHorizontally) {
      findings.push(
        `  read after ${describe(previous)} at y=${Math.round(a.top)}, but drawn ${Math.round(a.top - b.top)}px above it: ${describe(current)} at y=${Math.round(b.top)}`,
      );
      continue;
    }

    if (sameRow && b.right <= a.left) {
      findings.push(
        `  read after ${describe(previous)} at x=${Math.round(a.left)}, but drawn to its left on the same row: ${describe(current)} at x=${Math.round(b.left)}`,
      );
    }
  }
  return findings;
}

function report(where: string, what: string, lines: string[]): string {
  return `${lines.length} ${what} on ${where}:\n${lines.join("\n")}`;
}

/**
 * The three checks every stop on every journey gets. Split into three
 * expectations rather than one, so a failure names which of them broke.
 */
function assertTree(nodes: AxNode[], where: string): void {
  const unnamed = unnamedControls(nodes);
  expect(unnamed, report(where, "unnamed interactive node(s)", unnamed)).toEqual([]);

  const keys = keyNamedNodes(nodes);
  expect(keys, report(where, "untranslated key(s) in the tree", keys)).toEqual([]);

  const order = readingOrderFindings(nodes);
  expect(order, report(where, "reading-order finding(s)", order)).toEqual([]);
}

/* ------------------------------------------------------------ journeys -- */

test.describe("Screen-reader journeys", () => {
  // `newCDPSession` throws outright on anything but Chromium, so without this
  // the suite does not degrade on the other four projects — it fails them, and
  // CI runs every project. Skipped rather than guarded inside each test so the
  // reason appears in the report instead of the run looking thinner than it is.
  //
  // The tree this reads is the browser's, not the page's, so it does differ
  // between engines and one engine is not full coverage. It is the engine the
  // dominant screen readers pair with, and the alternative — no automated tree
  // check at all — is what this file replaced.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Accessibility.getFullAXTree is a Chrome DevTools Protocol API",
  );

  // The one journey that still drives the form. Everything below it starts from
  // the session `e2e/session.setup.ts` saved, which is the whole reason this
  // suite is not a sequence of sign-ins; this test is what keeps the form itself
  // covered, so it runs signed out like a first-time visitor.
  test("sign in", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector('input[name="email"]');
    await settle(page);
    const blank = await snapshot(page);
    assertTree(blank, "/login");

    // The rejected attempt first, because it is the same form and the same
    // controls: whatever the tree gets wrong here it gets wrong for everyone who
    // mistypes a password, which is more people than get it right first time.
    await page.fill('input[name="email"]', DEMO_EMAIL);
    await page.fill('input[name="password"]', "definitely-not-the-password");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/inválid|invalid/i)).toBeVisible({ timeout: 20_000 });

    const rejected = await snapshot(page);
    assertTree(rejected, "/login after a rejected sign-in");
    const rejection = newlySpoken(spoken(blank), spoken(rejected));
    expect(
      rejection,
      report(
        "/login after a rejected sign-in",
        "new live-region announcement(s) — a refusal that announces nothing leaves the reader on a form that looks unchanged",
        rejection,
      ),
    ).not.toEqual([]);

    await page.fill('input[name="password"]', DEMO_PASSWORD);
    await page.click('button[type="submit"]');
    // A fresh context is a device nobody has chosen a screen on, so signing
    // in asks (Journey 8) — the first screen a new reader actually meets.
    await page.waitForURL(/\/start/, { timeout: 30_000 });
    await settle(page);
    assertTree(await snapshot(page), "/start");
  });

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    test("add stock", async ({ page }) => {
      await page.goto("/inventory/add");
      await settle(page);
      const untouched = await snapshot(page);
      assertTree(untouched, "/inventory/add");

      // Submitting nothing: the branch where the form has to say why it refused.
      await page.click("form button[type=submit]");
      await page.waitForTimeout(1000);

      const refused = await snapshot(page);
      assertTree(refused, "/inventory/add after a refused save");
      const refusal = newlySpoken(spoken(untouched), spoken(refused));
      expect(
        refusal,
        report(
          "/inventory/add after a refused save",
          "new live-region announcement(s) — a form that refuses silently leaves the reader waiting",
          refusal,
        ),
      ).not.toEqual([]);

      // Now the real thing, through the controls rather than around them.
      const productId = await writableProductValue(page);
      await page.selectOption("select[name=productId]", productId);
      await page.fill("input[name=quantity]", "2");

      // The location picker lives behind the disclosure since Phase 8 item 3;
      // a reader reaches it the same way — through the summary. Open-if-closed
      // with a retry, because a click landing before hydration can be undone
      // when React recreates the subtree.
      await expect(async () => {
        if (!(await page.locator('[role="combobox"]').isVisible())) {
          await page.click("details > summary");
        }
        await expect(page.locator('[role="combobox"]')).toBeVisible({
          timeout: 1_000,
        });
      }).toPass({ timeout: 15_000 });
      await page.click('[role="combobox"][aria-haspopup="listbox"]');
      await page.waitForSelector('[role="listbox"]');
      const open = await snapshot(page);
      assertTree(open, "/inventory/add with the location picker open");

      // Row 0 is "no particular location", which is the same as not opening the
      // picker at all; row 1 is a real choice.
      await page.locator('[role="option"]').nth(1).click();
      await page.waitForTimeout(300);

      await page.click("form button[type=submit]");

      // A11Y-1, still flipped, now by a dialog rather than by a panel that
      // replaced the page. It used to redirect to /inventory, whose only
      // voice was Next's route announcer saying "Inventario" — the same word
      // it says for a navigation nobody meant as a confirmation.
      //
      // A dialog is a stronger guarantee than the live region it replaces,
      // not a weaker one: focus *moves into it*, so the confirmation is
      // announced by the focus change rather than depending on a region
      // being polled. That is also why this can no longer be measured with
      // `newlySpoken` — `announcements()` collects nodes whose computed
      // `aria-live` is not "off", and `role="dialog"` carries none.
      const dialog = page.getByRole("dialog", {
        name: es.inventory.add.successTitle,
      });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await settle(page);

      const saved = await snapshot(page);
      assertTree(saved, "/inventory/add after a save");

      // Focus is inside it, which is what makes the announcement happen.
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
        report(
          "/inventory/add after a save",
          "focus inside the confirmation — a dialog nobody is standing in announces nothing",
          [],
        ),
      ).toBe(true);

      // And it says *what*, not merely that something happened.
      await expect(dialog).toContainText("Arroz redondo");

    });

    test("consume stock", async ({ page }) => {
      await page.goto("/inventory/consume");
      await settle(page);
      const empty = await snapshot(page);
      assertTree(empty, "/inventory/consume");

      const productId = await firstProductValue(page);
      // The over-consume refusal is measured against the household's real stock,
      // which is fetched per product, so the ask has to wait for the figure.
      // Waited for on the wire rather than by watching a live region: the live
      // regions are what this test is judging, and a precondition that reads
      // them turns a missing announcement into a timeout instead of a finding.
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes("product.getById"),
          { timeout: 20_000 },
        ),
        page.selectOption("select[name=productId]", productId),
      ]);
      await page.waitForTimeout(500);

      const chosen = await snapshot(page);
      assertTree(chosen, "/inventory/consume with a product chosen");
      const availability = newlySpoken(spoken(empty), spoken(chosen));
      expect(
        availability,
        report(
          "/inventory/consume with a product chosen",
          "new live-region announcement(s) — the stock figure changed under the reader in silence",
          availability,
        ),
      ).not.toEqual([]);

      await page.fill("input[name=quantity]", "99999");
      await page.click("form button[type=submit]");
      await page.waitForTimeout(1000);

      const refused = await snapshot(page);
      assertTree(refused, "/inventory/consume after an over-consume");

      // An alert rather than any live region: this is an error interrupting a
      // task, which is what `role="alert"` is for, and a polite status queued
      // behind the availability figure would be read out after it.
      const alerts = announcements(refused).filter(
        (a) => a.role === "alert" && !a.routeAnnouncer && a.text !== "",
      );
      expect(
        alerts.map((a) => a.text),
        "/inventory/consume refused the amount without raising an alert — the refusal has to reach a reader who cannot see the red box",
      ).not.toEqual([]);

      // Naming the figure is the whole value of catching this on the client:
      // the server's own message cannot, so a refusal without a number in it
      // means the browser check was skipped and the reader is being told "no"
      // and left to guess by how much.
      const quantified = alerts.flatMap((a) => a.parts).filter((p) => /\d/.test(p));
      expect(
        quantified,
        `the refusal is announced but never says how much there actually is: ${alerts.map((a) => a.text).join(" / ")}`,
      ).not.toEqual([]);

      // And it must still be there for a reader who arrives at the quantity box
      // afterwards, rather than only shouted once and lost. Matched against the
      // announced sentence rather than merely "contains a digit", because the
      // field is also described by the availability figure — which contains a
      // digit whether or not the refusal is attached to it.
      const quantity = page.locator("input[name=quantity]");
      await expect(quantity).toHaveAttribute("aria-invalid", "true");
      const describedBy = (await quantity.getAttribute("aria-describedby")) ?? "";
      const described = await page.evaluate(
        (ids) =>
          ids
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" "),
        describedBy,
      );
      expect(
        quantified.filter((message) => described.includes(message)),
        `the quantity field does not carry the refusal it was rejected by. Announced: ${quantified.join(" / ")}. Described by: "${described}"`,
      ).not.toEqual([]);
    });

    test("review a receipt", async ({ page }) => {
      await page.goto("/receipts");
      await settle(page);
      assertTree(await snapshot(page), "/receipts");

      // Followed, not constructed: a receipt id typed into a URL would audit a
      // page nobody can reach, which is the blind spot dynamic-routes.spec.ts
      // exists to close.
      const firstRow = page.locator('a[href*="/receipts/"][href$="/review"]').first();
      await expect(firstRow).toBeVisible();
      await firstRow.click();
      await page.waitForURL(/\/receipts\/[^/]+\/review$/, { timeout: 30_000 });
      await settle(page);
      assertTree(await snapshot(page), "/receipts/[id]/review");

      // The row above leads to whichever receipt is newest, and the seed's
      // newest is the one already confirmed — its every line reads "Confirmado"
      // and there is nothing left to confirm on it. So the confirm step walks
      // back and takes the row that still has decisions in it, which is the
      // state this page was built for.
      await page.goto("/receipts");
      await settle(page);
      const reviewable = await withPendingItems(page);
      expect(
        reviewable,
        "no receipt in the list still has an item to confirm. Re-run `bunx prisma db seed`: " +
          "confirming is a write, and the fixture holds three confirmable lines.",
      ).not.toBeNull();

      await page.goto(reviewable as string);
      await settle(page);

      // ISSUES.md I18N-6. This receipt still has lines to decide, so the
      // button that finishes it — confirm and add to the inventory, one press —
      // is not offered at all: it finalises the receipt *after* the work rather
      // than instead of it. It used to be a disabled "Confirmar todos", which
      // promised a bulk action that skips the reviewing, and a disabled button
      // is one a keyboard cannot even reach to ask why. The pending count
      // beside it says what is left.
      await expect(
        page.getByRole("button", { name: es.receipts.applyToInventory }),
      ).toHaveCount(0);

      const count = page.getByRole("status").first();
      const wasSaying = ((await count.textContent()) ?? "").trim();
      const before = spoken(await snapshot(page));

      await confirmItemButton(page).first().click();

      // Confirming is two round trips, not one: the mutation resolves, and only
      // then does its `invalidate` issue the refetch that moves this number. A
      // flat pause after the click was tuned against an idle dev server and went
      // red under a parallel run as "confirming an item announced nothing new",
      // which is the message for a defect rather than for a fetch still in
      // flight. Waited for, bounded, and swallowed: if the sentence never
      // changes, the assertion below is still the one that speaks.
      await expect(count)
        .not.toHaveText(wasSaying, { timeout: 15_000 })
        .catch(() => {});

      const after = await snapshot(page);
      assertTree(after, "/receipts/[id]/review after confirming an item");

      // Confirming a line used to write to the database and change nothing at
      // all on the page: no `onSuccess`, no invalidation, so the card kept its
      // Confirmar button, the pending count kept its frozen number and no live
      // region said a word (ISSUES A11Y-2, UI-7). Pressing again is the natural
      // response to a button that does nothing, and that was a second write.
      //
      // The count is now the announcement: it is a `role="status"`, so the
      // sentence that already states the outcome is the thing that speaks.
      expect(
        spoken(after),
        "confirming an item announced nothing new",
      ).not.toEqual(before);
    });
  });
});

/**
 * A seeded product this journey may add stock to without breaking anyone else.
 *
 * It used to take the first product in the select, which is "Aceite de oliva
 * virgen extra" — one of the three the seed puts *below* its minimum, and one
 * that `critical-paths.spec.ts` asserts is marked low. Adding 2 units took it
 * from 1 of 2 to 3 of 2 and the low-stock test failed on four of five browser
 * projects, deterministically once the write had happened, because the
 * pollution outlives the run (ISSUES.md TEST-3).
 *
 * "Arroz redondo" is the seed's well-stocked product, at 5 of a minimum of 2,
 * and `critical-paths.spec.ts` asserts it is *not* marked. Adding to it keeps
 * that true. Named rather than positional so the coupling is visible: if the
 * seed drops it, this fails loudly here instead of silently over there.
 */
const WRITABLE_PRODUCT = "Arroz redondo";

/**
 * The first real product in the picker, skipping its "choose one" row.
 *
 * Still used by the consume journey, which is safe on the first product for
 * the opposite reason: consuming can only push a product further below its
 * minimum, and the assertions elsewhere are that the seed's three low products
 * are marked low. Adding is what breaks them.
 */
async function firstProductValue(page: Page): Promise<string> {
  const values = await page.$$eval("select[name=productId] option", (options) =>
    options.map((option) => option.getAttribute("value") ?? ""),
  );
  const value = values.find((candidate) => candidate !== "");
  expect(value, "the product picker offered no products to choose from").toBeTruthy();
  return value as string;
}

async function writableProductValue(page: Page): Promise<string> {
  const value = await page.$eval(
    "select[name=productId]",
    (select, name) => {
      const options = Array.from((select as HTMLSelectElement).options);
      const match = options.find((option) => option.textContent?.includes(name as string));
      return match?.value ?? "";
    },
    WRITABLE_PRODUCT,
  );

  expect(
    value,
    `the product picker did not offer "${WRITABLE_PRODUCT}" — has the seed changed?`,
  ).toBeTruthy();
  return value;
}

/**
 * The per-line confirm button, anchored so it cannot also match "Confirmar
 * ticket" or the button that ends the review. Both catalogues, because the
 * account's language is a stored preference and a suite that only knows one of
 * them fails as a language change rather than as a finding (PROGRESS D10 makes
 * the same argument for hrefs over link text).
 */
function confirmItemButton(page: Page) {
  return page.getByRole("button", { name: /^(confirmar|confirm)$/i });
}

/**
 * The first receipt in the list whose review page still has something to
 * confirm. Opened and inspected rather than inferred from the badge, because the
 * badge is the receipt's status and the buttons are per line — a receipt can be
 * CONFIRMED with lines still untouched (PROGRESS D18).
 */
async function withPendingItems(page: Page): Promise<string | null> {
  const hrefs = await page.$$eval('a[href$="/review"]', (anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );

  for (const href of hrefs) {
    await page.goto(href);
    await settle(page);
    if ((await confirmItemButton(page).count()) > 0) return href;
  }
  return null;
}
