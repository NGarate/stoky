import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * `/inventory?filter=restock` — the Panel's restock card lands here.
 *
 * The filter must be loud: a banner naming it, a way back to the whole list,
 * and — when nothing needs restocking — a sentence rather than a bare empty
 * table. And it must ask the server the same `needsRestock` question the card
 * asked, because the card's number and this list's rows are one promise.
 */

let searchParams: URLSearchParams;
let overviewCalls: Array<Record<string, unknown>>;
const replaces: string[] = [];
let overviewStub: {
  data:
    | { products: unknown[]; total: number; page: number; pageCount: number }
    | undefined;
  isPending: boolean;
  error: null;
  fetchStatus: "idle";
  refetch: () => void;
};

mock.module("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({
    push: () => {},
    replace: (href: string) => replaces.push(href),
    refresh: () => {},
  }),
  usePathname: () => "/inventory",
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    inventory: {
      getStockOverview: {
        useQuery: (input: Record<string, unknown>) => {
          overviewCalls.push(input);
          return overviewStub;
        },
      },
      getExpiringItems: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getExpiredItems: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));

const { InventoryView } = await import("@/app/(dashboard)/inventory/page");

beforeEach(() => {
  searchParams = new URLSearchParams();
  overviewCalls = [];
  replaces.length = 0;
  overviewStub = {
    data: { products: [], total: 0, page: 1, pageCount: 1 },
    isPending: false,
    error: null,
    fetchStatus: "idle",
    refetch: () => {},
  };
});

afterEach(cleanup);

describe("the restock filter", () => {
  it("asks the server for the restock set, and says the filter is on", () => {
    searchParams = new URLSearchParams("filter=restock");

    renderWithIntl(<InventoryView />, { locale: "es" });

    // The whole shape, so a filter silently dropped from the query is a
    // failure rather than a quieter list.
    expect(overviewCalls).toEqual([
      {
        limit: 20,
        page: 1,
        sort: "name",
        direction: "asc",
        needsRestock: true,
      },
    ]);
    expect(
      screen.getByText("Solo lo que necesita reposición"),
    ).toBeTruthy();

    const clear = screen.getByRole("link", { name: "Ver todo el inventario" });
    expect(clear.getAttribute("href")).toBe("/inventory");
  });

  it("says so when nothing needs restocking, instead of a bare empty list", () => {
    searchParams = new URLSearchParams("filter=restock");

    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(
      screen.getByText("Nada necesita reposición ahora mismo."),
    ).toBeTruthy();
  });

  it("leaves the unfiltered inventory exactly as it was", () => {
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(overviewCalls).toEqual([
      { limit: 20, page: 1, sort: "name", direction: "asc" },
    ]);
    expect(screen.queryByText("Solo lo que necesita reposición")).toBeNull();
  });
});

describe("finding something in a long inventory", () => {
  const row = (id: string, name: string) => ({
    id,
    name,
    category: "Despensa",
    totalStock: 1,
    defaultUnit: "unidad",
    minStock: 2,
    isLowStock: true,
  });

  it("asks the server for the search, rather than filtering what it has", () => {
    searchParams = new URLSearchParams("q=cafe");
    renderWithIntl(<InventoryView />, { locale: "es" });

    // The whole point of the aggregate: a search over the household, not over
    // the twenty rows this page happens to hold.
    expect(overviewCalls[0]).toMatchObject({ search: "cafe" });
  });

  it("says how many products the description matches", () => {
    overviewStub.data = { products: [row("p1", "Café")], total: 7, page: 1, pageCount: 1 };
    renderWithIntl(<InventoryView />, { locale: "es" });

    // Seven, not one: the count answers "how much is there", which is the
    // question a filter creates and the old list could not answer at all.
    expect(screen.getByText("7 productos")).toBeInTheDocument();
  });

  it("says so when a search matches nothing, and names what was searched", () => {
    searchParams = new URLSearchParams("q=zzz");
    overviewStub.data = { products: [], total: 0, page: 1, pageCount: 1 };
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(screen.getByText(/Ningún producto coincide con «zzz»/)).toBeInTheDocument();
  });

  it("puts the search in the address, so a filtered list can be sent to someone", async () => {
    renderWithIntl(<InventoryView />, { locale: "es" });

    const field = screen.getByLabelText("Buscar en el inventario");
    fireEvent.change(field, { target: { value: "  leche  " } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    expect(replaces).toEqual(["/inventory?q=leche"]);
  });

  it("sends you back to page one when the description changes", async () => {
    searchParams = new URLSearchParams("q=cafe&page=4");
    renderWithIntl(<InventoryView />, { locale: "es" });

    fireEvent.change(screen.getByLabelText("Ordenar"), {
      target: { value: "stock-low" },
    });

    // Page four of a search that has just changed is page four of nothing.
    expect(replaces[0]).toBe("/inventory?q=cafe&sort=stock-low");
  });

  it("translates the chosen order into the two the server takes", () => {
    searchParams = new URLSearchParams("sort=stock-high");
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(overviewCalls[0]).toMatchObject({ sort: "stock", direction: "desc" });
  });

  it("ignores an order it does not know rather than asking for it", () => {
    searchParams = new URLSearchParams("sort=; DROP TABLE Product");
    renderWithIntl(<InventoryView />, { locale: "es" });

    // The whitelist is between a URL anybody can type and an ORDER BY.
    expect(overviewCalls[0]).toMatchObject({ sort: "name", direction: "asc" });
  });
});

describe("paging a long inventory", () => {
  it("offers no pager when everything fits on one page", () => {
    overviewStub.data = { products: [], total: 3, page: 1, pageCount: 1 };
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("says where you are, and keeps the description while you page", () => {
    searchParams = new URLSearchParams("q=leche&page=2");
    overviewStub.data = { products: [], total: 50, page: 2, pageCount: 3 };
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Siguiente" }).getAttribute("href"),
    ).toBe("/inventory?q=leche&page=3");
    expect(
      screen.getByRole("link", { name: "Anterior" }).getAttribute("href"),
    ).toBe("/inventory?q=leche");
  });

  it("asks the server for the page in the address", () => {
    searchParams = new URLSearchParams("page=3");
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(overviewCalls[0]).toMatchObject({ page: 3 });
  });

  it("treats a nonsense page as the first one", () => {
    searchParams = new URLSearchParams("page=abc");
    renderWithIntl(<InventoryView />, { locale: "es" });

    expect(overviewCalls[0]).toMatchObject({ page: 1 });
  });
});
