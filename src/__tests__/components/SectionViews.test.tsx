import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

let pathname = "/inventory";

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

const { SectionViews } = await import("@/components/dashboard/SectionViews");

afterEach(() => {
  cleanup();
  pathname = "/inventory";
});

describe("SectionViews", () => {
  it("names Inventario's two views, in order, as links to their own screens", () => {
    renderWithIntl(<SectionViews section="inventory" />);

    const views = screen.getByRole("navigation", {
      name: "Vistas de Inventario",
    });
    expect(
      within(views)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Existencias", "/inventory"],
      ["Productos", "/products"],
    ]);
  });

  it("names Compra's two views", () => {
    pathname = "/prices";
    renderWithIntl(<SectionViews section="shopping" />);

    const views = screen.getByRole("navigation", { name: "Vistas de Compra" });
    expect(
      within(views)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Listas", "/shopping"],
      ["Precios", "/prices"],
    ]);
  });

  it("marks the view on screen, and only that one, as the current page", () => {
    pathname = "/products";
    renderWithIntl(<SectionViews section="inventory" />);

    expect(
      screen
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("aria-current")]),
    ).toEqual([
      ["Existencias", null],
      ["Productos", "page"],
    ]);
  });

  it("says it in English too", () => {
    renderWithIntl(<SectionViews section="inventory" />, { locale: "en" });

    const views = screen.getByRole("navigation", { name: "Inventory views" });
    expect(within(views).getAllByRole("link").map((l) => l.textContent)).toEqual(
      ["Stock", "Products"],
    );
  });
});
