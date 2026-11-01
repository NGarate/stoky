import "../setup/matchers";
import { describe, it, expect, afterEach, mock, spyOn } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { renderWithIntl as render } from "../utils/render";

let searchParams = new URLSearchParams();

mock.module("next/navigation", () => ({
  useSearchParams: () => searchParams,
  usePathname: () => "/inventory/add",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  redirect: () => {},
}));

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
});

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
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("PageHeader", () => {
  it("reads back link, title, intro, then actions", () => {
    render(
      <PageHeader
        actions={<Button type="button">Crear lista</Button>}
        back="/settings"
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

  it("goes back to the screen that linked here, named for it", () => {
    // Adding stock is reached from the overview, the inventory, the prices
    // page and the product itself; a link fixed to the inventory sent three
    // of the four somewhere they had never been.
    searchParams = new URLSearchParams("from=/dashboard");
    render(<PageHeader back="/inventory" title="Añadir stock" />);

    expect(
      screen.getByRole("link", { name: "Volver al panel" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("keeps its own parent when the origin is not one it follows", () => {
    searchParams = new URLSearchParams("from=//evil.example/dashboard");
    render(<PageHeader back="/inventory" title="Añadir stock" />);

    expect(
      screen.getByRole("link", { name: "Volver al inventario" }),
    ).toHaveAttribute("href", "/inventory");
  });

  describe("going back", () => {
    /** The Navigation API, saying which entry came before this one. */
    function previousEntry(url: string | null): void {
      const entries = [
        ...(url ? [{ url }] : []),
        { url: "http://stoky.test/inventory/add" },
      ];
      Object.defineProperty(window, "navigation", {
        configurable: true,
        value: {
          currentEntry: { index: entries.length - 1 },
          entries: () => entries,
        },
      });
    }

    function clickBack(
      init?: MouseEventInit,
      from = "/dashboard",
    ): { followed: boolean; popped: boolean } {
      const back = spyOn(window.history, "back").mockImplementation(() => {});
      searchParams = new URLSearchParams({ from });
      render(<PageHeader back="/inventory" title="Añadir stock" />);
      const followed = fireEvent.click(
        screen.getByRole("link", { name: /^Volver/ }),
        init,
      );
      const popped = back.mock.calls.length === 1;
      back.mockRestore();
      return { followed, popped };
    }

    afterEach(() => {
      Reflect.deleteProperty(window, "navigation");
    });

    it("pops history when the entry before this one is where it leads", () => {
      // A pushed link brought the list back scrolled to the top, and the
      // system's back then returned to the screen just left.
      previousEntry("http://stoky.test/dashboard");
      expect(clickBack()).toEqual({ followed: false, popped: true });
    });

    it("knows the entry before however its query was written", () => {
      // The overview links with `?from=/dashboard`; the product passes its
      // own address on encoded. Both are the same page.
      previousEntry("http://stoky.test/products/p1?from=/dashboard");
      expect(clickBack(undefined, "/products/p1?from=%2Fdashboard")).toEqual({
        followed: false,
        popped: true,
      });
    });

    it("follows the link when the entry before is somewhere else", () => {
      // Opened from a shared link: popping would leave the app.
      previousEntry("http://stoky.test/kitchen");
      expect(clickBack()).toEqual({ followed: true, popped: false });
    });

    it("follows the link when this is the first entry", () => {
      previousEntry(null);
      expect(clickBack()).toEqual({ followed: true, popped: false });
    });

    it("follows the link where the Navigation API is missing", () => {
      expect(clickBack()).toEqual({ followed: true, popped: false });
    });

    it("leaves a modified click to the browser, for a new tab", () => {
      previousEntry("http://stoky.test/dashboard");
      expect(clickBack({ metaKey: true })).toEqual({
        followed: true,
        popped: false,
      });
    });
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
