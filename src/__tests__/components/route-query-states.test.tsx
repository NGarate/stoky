import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { Suspense, createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * Four routes that gated on `isLoading` alone.
 *
 * `isLoading` is `isPending && isFetching`, so it is false for a query that is
 * paused offline and for one that has failed. All four fell through to the
 * branch for a successful answer with nothing in it: the receipts list said
 * "No hay tickets", the receipt review said "Ticket no encontrado" — about a
 * receipt that exists, with no signal or after a 500 — and both price screens
 * said nothing had ever been recorded.
 *
 * The assertion is the pair, as in `route-query-failure.test.tsx`: the honest
 * state is present AND the lie is absent.
 */

interface QueryStub {
  data: unknown;
  isPending: boolean;
  isLoading: boolean;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => void;
}

let queryStub: QueryStub;

const noop = (): void => {};
const idleMutation = { mutate: noop, mutateAsync: async () => {}, isPending: false };

mock.module("next/navigation", () => ({
  useParams: () => ({ id: "r1" }),
  useRouter: () => ({ push: noop, replace: noop, refresh: noop }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/receipts/r1/review",
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
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    household: { create: { useMutation: () => idleMutation } },
    receipt: {
      list: { useQuery: () => queryStub },
      getReceiptWithItems: { useQuery: () => queryStub },
      confirmAll: { useMutation: () => idleMutation },
      confirmItem: { useMutation: () => idleMutation },
      applyReceipt: { useMutation: () => idleMutation },
    },
    price: {
      getProductPrices: { useQuery: () => queryStub },
      getHistory: { useQuery: () => queryStub },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { default: ReceiptsPage } = await import("@/app/(dashboard)/receipts/page");
const { default: ReviewPage } = await import(
  "@/app/(dashboard)/receipts/[id]/review/page"
);
const { default: PricesPage } = await import("@/app/(dashboard)/prices/page");
const { default: PriceHistoryPage } = await import(
  "@/app/(dashboard)/prices/[productId]/page"
);

function trpcError(code: string, httpStatus: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", { value: { code, httpStatus } });
  return error;
}

/**
 * Already settled, in the shape React's `use` reads synchronously. A bare
 * resolved promise suspends on first sight, and this suite is about which
 * branch the page takes, not about Suspense.
 */
const params = Object.assign(Promise.resolve({ productId: "p1" }), {
  status: "fulfilled",
  value: { productId: "p1" },
});

const ROUTES = [
  { name: "/receipts", render: () => <ReceiptsPage />, lie: /No hay tickets/ },
  {
    name: "/receipts/[id]/review",
    render: () => <ReviewPage />,
    lie: /Ticket no encontrado/,
  },
  { name: "/prices", render: () => <PricesPage />, lie: /No hay precios registrados/ },
  {
    name: "/prices/[productId]",
    render: () => <PriceHistoryPage params={params} />,
    lie: /No hay precios registrados/,
  },
] as const;

function mount(ui: React.ReactElement): void {
  renderWithIntl(
    <SnackbarProvider>
      <Suspense fallback={null}>{ui}</Suspense>
    </SnackbarProvider>,
  );
}

beforeEach(() => {
  queryStub = {
    data: undefined,
    isPending: true,
    isLoading: false,
    error: null,
    fetchStatus: "idle",
    refetch: noop,
  };
});

afterEach(cleanup);

describe("a route whose query cannot answer", () => {
  for (const { name, render, lie } of ROUTES) {
    it(`${name} says it has nothing saved when there is no connection`, async () => {
      queryStub = { ...queryStub, isPending: true, fetchStatus: "paused" };

      mount(render());

      expect(await screen.findByText("Aquí todavía no hay nada guardado")).toBeInTheDocument();
      expect(screen.queryByText(lie)).toBeAbsent();
    });

    it(`${name} offers a retry when the server failed`, async () => {
      queryStub = {
        ...queryStub,
        isPending: false,
        error: trpcError("INTERNAL_SERVER_ERROR", 500),
      };

      mount(render());

      expect(await screen.findByText("No se han podido cargar los datos")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(screen.queryByText(lie)).toBeAbsent();
    });
  }
});

describe("a receipt that really is not there", () => {
  it("is still called not found when the server says so", () => {
    // The other half: the fix must not turn a real 404 into "try again".
    queryStub = {
      ...queryStub,
      isPending: false,
      error: trpcError("NOT_FOUND", 404),
    };

    mount(<ReviewPage />);

    expect(screen.getByText("Ticket no encontrado")).toBeInTheDocument();
  });
});
