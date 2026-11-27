import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * The phone bottom bar, the tablet rail and the account sheet.
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

/** The bottom bar and the rail, in DOM order: the phone's, then the tablet's. */
function bars(): HTMLElement[] {
  return screen.getAllByRole("navigation", { name: "Navegación principal" });
}

function links(nav: HTMLElement): [string, string | null][] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => [link.textContent ?? "", link.getAttribute("href")]);
}

function current(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent ?? "");
}

function accountCircle(): HTMLElement {
  return screen.getByRole("button", { name: "Tu cuenta: Noa García" });
}

function openSheet(): Promise<void> {
  return userEvent.click(accountCircle());
}

describe("CompactNav", () => {
  it("renders a phone bar and a tablet rail, both named", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    // Only one is ever visible, which is why they can share the name: a
    // display:none landmark is not in the accessibility tree.
    expect(bars()).toHaveLength(2);
  });

  it("gives the phone four fixed destinations and nothing to open", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    const [phone] = bars();
    expect(links(phone)).toEqual([
      ["Inicio", "/dashboard"],
      ["Compra", "/shopping"],
      ["Inventario", "/inventory"],
      ["Tickets", "/receipts"],
    ]);
    // No "Más": everything else is in the account panel.
    expect(within(phone).queryByRole("button")).toBeAbsent();
  });

  it("gives the tablet the same four, the kitchen, and the account at the foot", () => {
    pathname = "/kitchen";
    renderNav(<CompactNav account={ACCOUNT} />);

    const [, rail] = bars();
    expect(links(rail)).toEqual([
      ["Inicio", "/dashboard"],
      ["Compra", "/shopping"],
      ["Inventario", "/inventory"],
      ["Tickets", "/receipts"],
      ["Cocina", "/kitchen"],
    ]);
    const account = within(rail).getByRole("button", { name: "Tu cuenta" });
    expect(account).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("never reorders itself, wherever you have been", () => {
    // The bar used to hold the three screens last used on the device.
    for (const route of ["/receipts", "/prices", "/kitchen", "/settings"]) {
      pathname = route;
      renderNav(<CompactNav account={ACCOUNT} />);
      expect(links(bars()[0]).map(([label]) => label)).toEqual([
        "Inicio",
        "Compra",
        "Inventario",
        "Tickets",
      ]);
      cleanup();
    }
    expect(localStorage.getItem("stoky.nav-slots")).toBeNull();
  });

  it("marks the section you are in, in both tiers, and only that one", () => {
    pathname = "/inventory";
    renderNav(<CompactNav account={ACCOUNT} />);

    for (const nav of bars()) expect(current(nav)).toEqual(["Inventario"]);
  });

  it("marks a folded view's section: Productos is Inventario, Precios is Compra", () => {
    pathname = "/products/scan";
    renderNav(<CompactNav account={ACCOUNT} />);
    for (const nav of bars()) expect(current(nav)).toEqual(["Inventario"]);
    cleanup();

    pathname = "/prices/product-1";
    renderNav(<CompactNav account={ACCOUNT} />);
    for (const nav of bars()) expect(current(nav)).toEqual(["Compra"]);
  });

  it("marks nothing in Configuración, and the kitchen only where it has a button", () => {
    pathname = "/settings/stores";
    renderNav(<CompactNav account={ACCOUNT} />);
    for (const nav of bars()) expect(current(nav)).toEqual([]);
    cleanup();

    pathname = "/kitchen";
    renderNav(<CompactNav account={ACCOUNT} />);
    const [phone, rail] = bars();
    expect(current(phone)).toEqual([]);
    expect(current(rail)).toEqual(["Cocina"]);
  });

  it("draws the current destination's pill in the primary fill, and bolds its label", () => {
    pathname = "/receipts";
    renderNav(<CompactNav account={ACCOUNT} />);

    const link = within(bars()[0]).getByRole("link", { name: "Tickets" });
    expect(link.className).toContain("font-bold");
    expect(link.querySelector("span")?.className).toContain("bg-primary");
    const other = within(bars()[0]).getByRole("link", { name: "Compra" });
    expect(other.querySelector("span")?.className).not.toContain("bg-primary");
  });

  it("puts the phone's account circle in the page's banner, with the wordmark, on the phone only", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Stoky" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(within(banner).getByRole("button")).toBe(accountCircle());
    // The rail has its own account button, and the desktop its circle.
    expect(banner.className).toContain("md:hidden");
  });

  it("lets the rail scroll, so a short screen does not cut the account off", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    // Six 76px targets are taller than a phone held sideways; happy-dom has
    // no layout, so the class is what can be checked here.
    expect(bars()[1].className).toContain("overflow-y-auto");
  });

  it("closes when one of its links leads to the page already open", async () => {
    pathname = "/settings";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("link", {
        name: "Configuración",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
  });

  it("keeps the sheet closed until the account circle is pressed", () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    expect(screen.queryByRole("dialog")).toBeAbsent();
    expect(accountCircle()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the account panel: who you are, Configuración, the kitchen and the way out", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    const sheet = screen.getByRole("dialog", { name: "Tu cuenta" });

    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(within(sheet).getByText("Noa García")).toBeInTheDocument();
    expect(within(sheet).getByText("noa@example.com")).toBeInTheDocument();
    expect(links(sheet)).toEqual([
      ["Configuración", "/settings"],
      ["Pantalla de cocina", "/kitchen"],
    ]);
    // The kitchen's link is the phone's: the rail has a button of its own.
    expect(
      within(sheet).getByRole("link", { name: "Pantalla de cocina" }).className,
    ).toContain("md:hidden");
    expect(
      within(sheet).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  it("opens the same panel from the foot of the rail", async () => {
    pathname = "/kitchen";
    renderNav(<CompactNav account={ACCOUNT} />);

    await userEvent.click(
      within(bars()[1]).getByRole("button", { name: "Tu cuenta" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Tu cuenta" }),
    ).toBeInTheDocument();
  });

  it("closes when the route changes", async () => {
    pathname = "/dashboard";
    const { rerender } = renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pathname = "/settings";
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CompactNav account={ACCOUNT} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
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

    const trigger = accountCircle();
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

  it("wraps backwards from the first control to the last", async () => {
    pathname = "/dashboard";
    renderNav(<CompactNav account={ACCOUNT} />);

    await openSheet();
    const sheet = screen.getByRole("dialog");

    await userEvent.tab({ shift: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});
