import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

let pathname = "/dashboard";

// Complete, per D50 — a partial mock of a shared module deletes exports for
// every file that runs after it.
mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  // The locale switcher applies its choice with a router refresh.
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

// `next/link` needs an App Router context that does not exist in a unit test;
// the nav's own behaviour is the href and the active-route styling.
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

const { DashboardNav } = await import("@/components/dashboard/DashboardNav");

afterEach(cleanup);

function activeLink(): HTMLElement | undefined {
  return screen
    .getAllByRole("link")
    .find((link) => link.className.includes("bg-primary"));
}

describe("DashboardNav", () => {
  it("renders every section using the Spanish catalogue", () => {
    pathname = "/dashboard";
    renderNav(<DashboardNav account={ACCOUNT} />);

    const expected = [
      ["Panel", "/dashboard"],
      ["Inventario", "/inventory"],
      ["Productos", "/products"],
      ["Tickets", "/receipts"],
      ["Lista de la compra", "/shopping"],
      ["Precios", "/prices"],
      ["Configuración", "/settings"],
    ];

    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("links the wordmark back to the dashboard", () => {
    pathname = "/inventory";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(screen.getByRole("link", { name: "Stoky" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("highlights the section matching the current route", () => {
    pathname = "/inventory";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(activeLink()?.textContent).toBe("Inventario");
  });

  it("keeps the section highlighted on nested routes", () => {
    pathname = "/receipts/abc123/review";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(activeLink()?.textContent).toBe("Tickets");
  });

  it("highlights exactly one section at a time", () => {
    pathname = "/prices/product-1";
    renderNav(<DashboardNav account={ACCOUNT} />);

    const highlighted = screen
      .getAllByRole("link")
      .filter((link) => link.className.includes("bg-primary"));
    expect(highlighted).toHaveLength(1);
  });

  it("does not confuse a prefix match for a section match", () => {
    // "/products" must not light up while on "/prices".
    pathname = "/prices";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(activeLink()?.textContent).toBe("Precios");
  });

  it("highlights nothing on an unrelated route", () => {
    pathname = "/some/other/page";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(activeLink()).toBeUndefined();
  });

  it("names the landmark", () => {
    pathname = "/dashboard";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(
      screen.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeInTheDocument();
  });

  it("marks the current section with aria-current, not colour alone", () => {
    pathname = "/inventory";
    renderNav(<DashboardNav account={ACCOUNT} />);

    const link = screen.getByRole("link", { name: "Inventario" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("font-semibold");
  });

  it("is the desktop tier only, and hands over rather than disappearing", () => {
    pathname = "/dashboard";
    const { container } = renderNav(<DashboardNav account={ACCOUNT} />);

    // Below `lg` this bar is hidden — but `CompactNav` renders a bottom bar or
    // a rail at those widths, so nothing is dropped (ISSUES.md NAV-1).
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("hidden");
    expect(nav?.className).toContain("lg:block");
  });

  it("gives every link a 48px target", () => {
    pathname = "/dashboard";
    renderNav(<DashboardNav account={ACCOUNT} />);

    for (const label of ["Panel", "Inventario", "Configuración"]) {
      expect(screen.getByRole("link", { name: label }).className).toContain(
        "min-h-[48px]",
      );
    }
  });

  /**
   * The bar carried theme, language and snackbar duration on every signed-in
   * route, so three settings controls sat across the top of the household
   * overview — the screen whose job is what to buy and what is running out.
   * They are on `/settings` now, which this bar links to.
   */
  it("carries no settings controls, only destinations", () => {
    pathname = "/dashboard";
    renderNav(<DashboardNav account={ACCOUNT} />);

    expect(screen.queryByLabelText("Idioma")).toBeAbsent();
    expect(screen.queryByRole("group", { name: "Tema" })).toBeAbsent();
    expect(
      screen.queryByRole("group", { name: "Duración de los avisos" }),
    ).toBeAbsent();
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("ends with the account circle, named in words, which opens the account", async () => {
    pathname = "/dashboard";
    renderNav(<DashboardNav account={ACCOUNT} />);

    const circle = screen.getByRole("button", {
      name: "Tu cuenta: Noa García",
    });
    // The initials are decoration; the name is the button's.
    expect(circle).toHaveTextContent("NG");
    expect(circle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(circle);

    const dialog = screen.getByRole("dialog", { name: "Tu cuenta" });
    expect(within(dialog).getByText("noa@example.com")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });
});
