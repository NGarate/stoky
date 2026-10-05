import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

/**
 * The page grammar, pinned where it is decided.
 *
 * Five arrangements of "back, title, intro, actions" grew across the screens
 * (DESIGN_AUDIT A6). What is asserted here is the *order* a reader meets them
 * in — DOM order, which is reading order and tab order — and that there is
 * exactly one title size, because the second size is how two settings pages
 * came to disagree.
 */

/** True when `a` comes before `b` in document order. */
function precedes(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("PageHeader", () => {
  it("reads back link, title, intro, then actions", () => {
    render(
      <PageHeader
        actions={<Button type="button">Crear lista</Button>}
        back={{ href: "/settings", label: "Volver a configuración" }}
        intro="Las tiendas donde compras."
        title="Tiendas"
      />,
    );

    const back = screen.getByRole("link", { name: "Volver a configuración" });
    const title = screen.getByRole("heading", { level: 1, name: "Tiendas" });
    const intro = screen.getByText("Las tiendas donde compras.");
    const action = screen.getByRole("button", { name: "Crear lista" });

    expect(precedes(back, title)).toBe(true);
    expect(precedes(title, intro)).toBe(true);
    expect(precedes(intro, action)).toBe(true);
    expect(back.getAttribute("href")).toBe("/settings");
  });

  it("renders exactly one h1 and nothing it was not given", () => {
    const { container } = render(<PageHeader title="Inventario" />);

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.querySelector("[data-slot=page-actions]")).toBeNull();
  });

  it("has one title size, and the kitchen's larger one only when asked", () => {
    render(<PageHeader title="Inventario" />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.className).toContain("text-2xl");
    expect(title.className).toContain("md:text-4xl");

    cleanup();

    render(<PageHeader density="touch" title="Cocina" />);
    const kitchen = screen.getByRole("heading", { level: 1 });
    expect(kitchen.className).toContain("text-4xl");
    expect(kitchen.className).not.toContain("text-2xl");
  });

  it("gives the actions a row of their own on a phone and a place opposite the title from md", () => {
    const { container } = render(
      <PageHeader
        actions={<Button type="button">Crear lista</Button>}
        title="Listas"
      />,
    );

    const row = container.querySelector("[data-slot=page-actions]");
    // The container stacks below md and sits beside the title from md.
    const header = row?.parentElement;
    expect(header?.className).toContain("flex-col");
    expect(header?.className).toContain("md:flex-row");
    // The buttons share the phone's row rather than squeezing beside the
    // title — the overflow /shopping/lists had at 390px.
    expect(row?.className).toContain("[&>*]:flex-1");
  });
});

describe("PageShell", () => {
  it("takes its width from the kind of page, and no gutter of its own", () => {
    const widths = {
      form: "max-w-2xl",
      detail: "max-w-3xl",
      screen: "max-w-5xl",
      index: "max-w-6xl",
    } as const;

    for (const [kind, width] of Object.entries(widths)) {
      const { container } = render(
        <PageShell width={kind as keyof typeof widths}>x</PageShell>,
      );
      const shell = container.firstElementChild as HTMLElement;
      expect(shell.className).toContain(width);
      expect(shell.className).toContain("mx-auto");
      expect(shell.className).not.toMatch(/\bp-\d/);
      cleanup();
    }
  });
});
