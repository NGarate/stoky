import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
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
let overviewStub: {
  data: { products: unknown[] } | undefined;
  isPending: boolean;
  error: null;
  fetchStatus: "idle";
  refetch: () => void;
};

mock.module("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
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
  overviewStub = {
    data: { products: [] },
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

    expect(overviewCalls).toEqual([{ limit: 100, needsRestock: true }]);
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

    expect(overviewCalls).toEqual([{ limit: 50 }]);
    expect(screen.queryByText("Solo lo que necesita reposición")).toBeNull();
  });
});
