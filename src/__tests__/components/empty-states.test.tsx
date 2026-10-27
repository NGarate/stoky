import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";

/**
 * What an empty list says, and what it offers.
 *
 * `REDESIGN_PLAN.md` §7 rule 5: never an empty, silent screen — empty is an
 * invitation with a button. Three screens broke it outright: `/products` and
 * `/inventory` with no products drew a table header and nothing under it,
 * and `/prices` said "Registra tu primer precio" on a screen with no way to
 * register one. The rest said what was missing and stopped.
 *
 * Each case asserts the sentence *and* where the way forward goes, because a
 * button that leads nowhere useful is the same dead end with a border.
 */

let listData: unknown;
let searchParams = new URLSearchParams();

const noop = (): void => {};
const idleMutation = { mutate: noop, isPending: false };
const answered = (data: unknown) => ({
  data,
  isPending: false,
  error: null,
  fetchStatus: "idle" as const,
  refetch: noop,
});

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: noop, replace: noop, refresh: noop }),
  useSearchParams: () => searchParams,
  usePathname: () => "/",
  useParams: () => ({}),
  redirect: noop,
}));

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: noop,
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: noop,
    discard: noop,
    flush: async () => 0,
    purgeAll: noop,
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      invalidate: () => Promise.resolve(),
      shopping: {
        list: { invalidate: () => Promise.resolve() },
        getAutoList: { invalidate: () => Promise.resolve() },
      },
    }),
    household: { create: { useMutation: () => idleMutation } },
    product: { list: { useQuery: () => answered(listData) } },
    inventory: {
      getStockOverview: { useQuery: () => answered(listData) },
      getExpiringItems: { useQuery: () => answered([]) },
      getExpiredItems: { useQuery: () => answered([]) },
    },
    price: { getProductPrices: { useQuery: () => answered(listData) } },
    shopping: {
      list: { useQuery: () => answered(listData) },
      getAutoList: { useQuery: () => ({ data: undefined, isLoading: false }) },
      create: { useMutation: () => idleMutation },
      generateFromLowStock: { useMutation: () => idleMutation },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { default: ProductsPage } =
  await import("@/app/(dashboard)/products/page");
const { InventoryView } = await import("@/app/(dashboard)/inventory/page");
const { default: PricesPage } = await import("@/app/(dashboard)/prices/page");
const { default: ShoppingListsPage } =
  await import("@/app/(dashboard)/shopping/lists/page");

function mount(ui: React.ReactElement): void {
  renderWithIntl(<SnackbarProvider>{ui}</SnackbarProvider>);
}

/** The empty state's own box, so a link elsewhere on the page cannot satisfy it. */
function emptyState(): HTMLElement {
  const box = document.querySelector<HTMLElement>("[data-slot=empty-state]");
  if (!box) throw new Error("no empty state on the page");
  return box;
}

function hrefs(container: HTMLElement): Array<string | null> {
  return within(container)
    .queryAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

beforeEach(() => {
  searchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("a household with no products yet", () => {
  it("/products invites the first one, by hand or by barcode", () => {
    listData = { products: [], nextCursor: undefined };

    mount(<ProductsPage />);

    const box = emptyState();
    expect(
      within(box).getByText("Todavía no hay productos"),
    ).toBeInTheDocument();
    expect(
      within(box).getByText("Crea el primero o escanea su código de barras."),
    ).toBeInTheDocument();
    expect(hrefs(box)).toEqual(["/products/new", "/products/scan"]);
  });

  it("/inventory says the same, rather than a count of zero over nothing", () => {
    listData = { products: [], total: 0, page: 1, pageCount: 0 };

    mount(<InventoryView />);

    const box = emptyState();
    expect(
      within(box).getByText("Todavía no hay productos"),
    ).toBeInTheDocument();
    expect(hrefs(box)).toEqual(["/products/new", "/products/scan"]);
  });

  it("/inventory keeps the search's own sentence when a search found nothing", () => {
    searchParams = new URLSearchParams("q=caviar");
    listData = { products: [], total: 0, page: 1, pageCount: 0 };

    mount(<InventoryView />);

    expect(
      screen.getByText(/Ningún producto coincide con «caviar»/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay productos")).toBeAbsent();
  });
});

describe("/prices with nothing recorded", () => {
  it("explains where prices come from and links to both ways in", () => {
    listData = [];

    mount(<PricesPage />);

    const box = emptyState();
    expect(within(box).getByText("Todavía no hay precios")).toBeInTheDocument();
    expect(within(box).getByText(/al añadir stock/)).toBeInTheDocument();
    expect(hrefs(box)).toEqual(["/inventory/add", "/receipts/upload"]);
    // The screen has no way to register a price, so it must not ask for one.
    expect(screen.queryByText(/Registra tu primer precio/)).toBeAbsent();
  });

  it("says a search found nothing, which is not the same as having no prices", () => {
    listData = [];

    mount(<PricesPage />);
    fireEvent.change(screen.getByLabelText("Buscar"), {
      target: { value: "caviar" },
    });

    expect(
      screen.getByText(/Ningún producto con precio coincide con «caviar»/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay precios")).toBeAbsent();
  });
});

describe("/shopping/lists with no lists", () => {
  it("says so plainly and offers to create one", () => {
    listData = [];

    mount(<ShoppingListsPage />);

    const box = emptyState();
    expect(
      within(box).getByText("Todavía no tienes listas"),
    ).toBeInTheDocument();
    expect(
      within(box).getByRole("button", { name: "Crear lista" }),
    ).toBeInTheDocument();
  });
});

it("passes axe at AAA on /prices", async () => {
  listData = [];
  const { container } = renderWithIntl(
    <SnackbarProvider>
      <PricesPage />
    </SnackbarProvider>,
  );
  await screen.findByText("Todavía no hay precios");
  expect(await axeViolations(container)).toBe("");
});
