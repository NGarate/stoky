import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

let pathname = "/dashboard";

mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  // The locale switcher applies its choice with a router refresh.
  useRouter: () => ({ refresh: () => {} }),
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
  setLocaleCookie: async () => {},
}));

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
    renderWithIntl(<DashboardNav />);

    const expected = [
      ["Panel", "/dashboard"],
      ["Inventario", "/inventory"],
      ["Productos", "/products"],
      ["Recibos", "/receipts"],
      ["Lista de compras", "/shopping"],
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
    renderWithIntl(<DashboardNav />);

    expect(screen.getByRole("link", { name: "Stoky" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("highlights the section matching the current route", () => {
    pathname = "/inventory";
    renderWithIntl(<DashboardNav />);

    expect(activeLink()?.textContent).toBe("Inventario");
  });

  it("keeps the section highlighted on nested routes", () => {
    pathname = "/receipts/abc123/review";
    renderWithIntl(<DashboardNav />);

    expect(activeLink()?.textContent).toBe("Recibos");
  });

  it("highlights exactly one section at a time", () => {
    pathname = "/prices/product-1";
    renderWithIntl(<DashboardNav />);

    const highlighted = screen
      .getAllByRole("link")
      .filter((link) => link.className.includes("bg-primary"));
    expect(highlighted).toHaveLength(1);
  });

  it("does not confuse a prefix match for a section match", () => {
    // "/products" must not light up while on "/prices".
    pathname = "/prices";
    renderWithIntl(<DashboardNav />);

    expect(activeLink()?.textContent).toBe("Precios");
  });

  it("highlights nothing on an unrelated route", () => {
    pathname = "/some/other/page";
    renderWithIntl(<DashboardNav />);

    expect(activeLink()).toBeUndefined();
  });

  it("names the landmark", () => {
    pathname = "/dashboard";
    renderWithIntl(<DashboardNav />);

    expect(
      screen.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeInTheDocument();
  });

  it("marks the current section with aria-current, not colour alone", () => {
    pathname = "/inventory";
    renderWithIntl(<DashboardNav />);

    const link = screen.getByRole("link", { name: "Inventario" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("font-semibold");
  });

  it("is the desktop tier only, and hands over rather than disappearing", () => {
    pathname = "/dashboard";
    const { container } = renderWithIntl(<DashboardNav />);

    // Below `lg` this bar is hidden — but `CompactNav` renders a bottom bar or
    // a rail at those widths, so nothing is dropped (ISSUES.md NAV-1).
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("hidden");
    expect(nav?.className).toContain("lg:block");
  });

  it("gives every link a 44px target", () => {
    pathname = "/dashboard";
    renderWithIntl(<DashboardNav />);

    for (const label of ["Panel", "Inventario", "Configuración"]) {
      expect(
        screen.getByRole("link", { name: label }).className,
      ).toContain("min-h-[44px]");
    }
  });

  it("includes the preferences cluster", () => {
    pathname = "/dashboard";
    renderWithIntl(<DashboardNav />);

    expect(screen.getByLabelText("Idioma")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
  });
});
