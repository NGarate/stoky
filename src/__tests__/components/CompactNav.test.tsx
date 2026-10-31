import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * The phone bottom bar, the tablet rail and the "Más" sheet.
 *
 * This is the control every route below `lg` depends on — before it existed,
 * the only page reachable on a phone was the one you landed on (ISSUES.md
 * NAV-1) — so the accessibility contract from DESIGN_AUDIT A3.6 is asserted
 * here rather than assumed: a named landmark, `aria-current="page"`, a sheet
 * that traps focus, closes on Escape, and hands focus back.
 */

let pathname = "/dashboard";

// Complete, per D50 — a partial mock of a shared module deletes exports for
// every file that runs after it.
mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

mock.module("@/lib/i18n/cookies", () => ({
  setLocalePreference: async () => {},
}));

// The account panel's sign-out asks the queue what is unsent. Complete, with
// a real context, for the reason ShoppingItem.test.tsx gives.
mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true as const, id: "x" }),
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush: async () => 0,
    purgeAll: () => {},
  }),
}));

const ACCOUNT = { name: "Noa García", email: "noa@example.com" };

/** The shell's providers the account panel needs: a query client. */
function renderNav(ui: ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
}

const { CompactNav } = await import("@/components/dashboard/CompactNav");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The bottom bar and the rail carry the same four items. */
function bars(): HTMLElement[] {
  return screen.getAllByRole("navigation", { name: "Navegación principal" });
}

function openSheet(): Promise<void> {
  return userEvent.click(
    within(bars()[0]).getByRole("button", { name: /Más/ }),
  );
}

describe("CompactNav", () => {
  it("renders a phone bar and a tablet rail, both named", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    // Only one is ever visible, which is why they can share the name: a
    // display:none landmark is not in the accessibility tree.
    expect(bars()).toHaveLength(2);
  });

  it("starts with three destinations and Más, Spanish and short", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    const bar = within(bars()[0]);
    expect(
      bar
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Compra", "/shopping"],
      ["Inventario", "/inventory"],
      ["Panel", "/dashboard"],
    ]);
    expect(bar.getByRole("button", { name: "Más" })).toBeInTheDocument();
    // Scanning is offered where a product is chosen, not as a place to go.
    expect(screen.queryByRole("link", { name: "Escanear" })).toBeAbsent();
  });

  it("marks the current destination with aria-current, not colour alone", () => {
    pathname = "/inventory";
    renderNav(<CompactNav account={ACCOUNT} />);

    const link = within(bars()[0]).getByRole("link", { name: "Inventario" });
    expect(link).toHaveAttribute("aria-current", "page");
    // Weight and a solid edge indicator carry the state as well as the fill.
    expect(link.className).toContain("font-semibold");
    expect(link.className).toContain("border-primary");
  });

  it("keeps a destination current on its nested routes", () => {
    pathname = "/shopping/list-1";
    renderNav(<CompactNav account={ACCOUNT} />);

    expect(
      within(bars()[0]).getByRole("link", { name: "Compra" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("marks exactly one destination as current", async () => {
    pathname = "/products/scan";
    renderNav(<CompactNav account={ACCOUNT} />);

    await within(bars()[0]).findByRole("link", { name: "Productos" });
    const current = within(bars()[0])
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/products");
  });

  /**
   * The bar used to answer "where am I" on these screens with a dot on Más.
   * The screen takes the slot least recently used instead, and Más is never
   * the current item (owner's report, 2026-10-31).
   */
  it("gives the screen you are on a slot in the bar, never Más", async () => {
    pathname = "/receipts";
    renderNav(<CompactNav account={ACCOUNT} />);

    const bar = within(bars()[0]);
    const tickets = await bar.findByRole("link", { name: "Tickets" });
    expect(tickets).toHaveAttribute("aria-current", "page");
    // The least recently used of the three went; the other two kept their
    // places.
    expect(bar.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Compra",
      "Inventario",
      "Tickets",
    ]);
    const more = bar.getByRole("button", { name: "Más" });
    expect(more.className).not.toContain("border-primary");
  });

  it("remembers the bar on this device from one visit to the next", async () => {
    pathname = "/prices";
    renderNav(<CompactNav account={ACCOUNT} />);
    await within(bars()[0]).findByRole("link", { name: "Precios" });
    cleanup();

    pathname = "/shopping";
    renderNav(<CompactNav account={ACCOUNT} />);

    // Shopping was in the bar already, so nothing was replaced.
    await waitFor(() => {
      expect(
        within(bars()[0])
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Compra", "Inventario", "Precios"]);
    });
  });

  it("starts again from the default when what it stored is not a bar", async () => {
    localStorage.setItem("stoky.nav-slots", '{"hrefs":["https://x"]}');
    pathname = "/inventory";
    renderNav(<CompactNav account={ACCOUNT} />);

    await waitFor(() => {
      expect(
        within(bars()[0])
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Compra", "Inventario", "Panel"]);
    });
  });

  it("keeps the sheet closed, and its links out of the tab order, until asked", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    expect(screen.queryByRole("dialog")).toBeAbsent();
    expect(screen.queryByRole("link", { name: "Tickets" })).toBeAbsent();
    expect(
      within(bars()[0]).getByRole("button", { name: /Más/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a named dialog holding the remaining destinations", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();

    const sheet = screen.getByRole("dialog", { name: "Más secciones" });
    expect(sheet).toHaveAttribute("aria-modal", "true");

    // What the bar does not show, and nothing it does.
    expect(within(sheet).queryByRole("link", { name: "Panel" })).toBeAbsent();
    const expected = [
      ["Cocina", "/kitchen"],
      ["Productos", "/products"],
      ["Tickets", "/receipts"],
      ["Precios", "/prices"],
      ["Configuración", "/settings"],
    ];
    for (const [label, href] of expected) {
      expect(within(sheet).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  /**
   * The sheet used to carry theme and language at the bottom of 85vh. A
   * settings control inside a navigation panel is one somebody changes by
   * accident while looking for a page; `/settings` is a destination in the
   * same list and is where they belong.
   */
  it("carries destinations and nothing else", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByLabelText("Idioma")).toBeAbsent();
    expect(within(sheet).queryByRole("group", { name: "Tema" })).toBeAbsent();
    expect(
      within(sheet).getByRole("link", { name: "Configuración" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("keeps the current page out of the sheet: it is in the bar", async () => {
    pathname = "/settings/stores";
    renderNav(<CompactNav account={ACCOUNT} />);

    await within(bars()[0]).findByRole("link", { name: "Configuración" });
    await openSheet();

    expect(
      within(screen.getByRole("dialog")).queryByRole("link", {
        name: "Configuración",
      }),
    ).toBeAbsent();
  });

  it("says who is signed in at the head of the sheet, with the way out", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();

    const account = within(screen.getByRole("dialog")).getByRole("region", {
      name: "Tu cuenta",
    });
    expect(within(account).getByText("Noa García")).toBeInTheDocument();
    expect(within(account).getByText("noa@example.com")).toBeInTheDocument();
    expect(
      within(account).getByRole("link", { name: "Seguridad y acceso" }),
    ).toHaveAttribute("href", "/settings/security");
    expect(
      within(account).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  it("moves focus into the sheet when it opens", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveFocus();
    });
  });

  it("closes on Escape and gives focus back to the button that opened it", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    const trigger = within(bars()[0]).getByRole("button", { name: /Más/ });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
    expect(trigger).toHaveFocus();
  });

  it("closes from its own button", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cerrar",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
  });

  it("traps Tab inside the sheet", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    const sheet = screen.getByRole("dialog");

    // Walk past the end of the panel; focus must come back round rather than
    // land on the bar underneath, which is covered.
    for (let step = 0; step < 24; step += 1) {
      await userEvent.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  it("never wraps onto a control Tab cannot reach", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    const sheet = screen.getByRole("dialog");

    // shift+Tab from the panel wraps to what the trap believes is its last
    // stop. If that belief counts every radio in a group rather than the one
    // the browser visits, the target is an element focus never lands on, the
    // wrap silently fails, and focus leaves the sheet. The panel's preference
    // controls are radio groups, so this is not hypothetical — it is what
    // happens the moment a radio group is the last thing in the sheet.
    await userEvent.tab({ shift: true });
    const landed = document.activeElement;

    expect(sheet.contains(landed)).toBe(true);
    if (landed instanceof HTMLInputElement && landed.type === "radio") {
      expect(landed.checked).toBe(true);
    }
  });

  it("wraps backwards from the first control to the last", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    const sheet = screen.getByRole("dialog");

    await userEvent.tab({ shift: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});
