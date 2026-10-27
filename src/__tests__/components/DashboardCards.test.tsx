import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";
import { Decimal } from "@prisma/client-runtime-utils";
import { asStored } from "../utils/amount";

/**
 * The Panel's opening: quick actions first, then the sections themselves.
 *
 * Three owner reviews have each cut a layer of the same redundancy. The
 * second (2026-08-19) removed the alert rows — cards restating the lists
 * rendered directly below them — and left one summary sentence in their
 * place. The third removed the sentence: "3 productos por reponer" sitting
 * above a section headed "Necesita reposición" that lists three products is
 * the same count twice, and the section was always the door. The scan quick
 * action went in the second pass: on a phone Escanear is permanently in the
 * bottom bar, and this screen is the desktop overview, where there is no
 * camera.
 *
 * What survives from Phase 8 item 2 is the invariant, not its wording: this
 * screen asks the server the same `needsRestock` question the inventory's
 * restock filter asks, so the rows here and the rows there cannot disagree.
 */

let overviewCalls: Array<Record<string, unknown>>;

const row = (over: Record<string, unknown> = {}) =>
  asStored(
    {
      id: "p1",
      name: "Café molido",
      totalStock: 0,
      minStock: 2,
      defaultUnit: "paquete",
      isLowStock: false,
      ...over,
    },
    "totalStock",
    "minStock",
  );

const expiringItem = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  quantity: new Decimal(1),
  unit: "L",
  daysUntilExpiry: 3,
  isExpiringSoon: false,
  location: null,
  product: { id: "p2", name: "Leche fresca" },
  ...over,
});

const expiredItem = (over: Record<string, unknown> = {}) => ({
  id: "b2",
  quantity: new Decimal(1),
  unit: "tarrina",
  daysExpired: 2,
  location: null,
  product: { id: "p3", name: "Yogur natural" },
  ...over,
});

interface Stub<T> {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => void;
}

let overviewStub: Stub<{
  products: ReturnType<typeof row>[];
  nextCursor?: string;
}>;
let expiringStub: Stub<unknown[]>;
let expiredStub: Stub<unknown[]>;

/** A refusal shaped the way tRPC delivers one to the browser. */
function trpcError(code: string, httpStatus: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("User not in a household");
  Object.defineProperty(error, "data", { value: { code, httpStatus } });
  return error;
}

function answered<T>(data: T): Stub<T> {
  return {
    data,
    isPending: false,
    error: null,
    fetchStatus: "idle",
    refetch: () => {},
  };
}

mock.module("@/lib/trpc/client", () => ({
  api: {
    // RouteState's household form, reached only on the no-household branch.
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    household: {
      create: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    inventory: {
      getStockOverview: {
        useQuery: (input: Record<string, unknown>) => {
          overviewCalls.push(input);
          return overviewStub;
        },
      },
      getExpiringItems: {
        useQuery: () => expiringStub,
      },
      getExpiredItems: {
        useQuery: () => expiredStub,
      },
    },
  },
}));

const { default: DashboardPage } =
  await import("@/app/(dashboard)/dashboard/page");

beforeEach(() => {
  overviewStub = answered({ products: [row()] });
  expiringStub = answered<unknown[]>([]);
  expiredStub = answered<unknown[]>([]);
  overviewCalls = [];
});

afterEach(cleanup);

describe("the Panel's opening order", () => {
  it("puts the quick actions above everything else", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const addStock = screen.getByRole("link", { name: "Añadir stock" });
    const restock = screen.getByRole("heading", {
      name: "Se está acabando",
    });

    // The person opening this screen came to *do* something; what needs
    // attention reads second.
    expect(
      addStock.compareDocumentPosition(restock) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not offer scanning: the phone's bar has it, the desktop no camera", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.queryByRole("link", { name: "Escanear un código" }),
    ).toBeAbsent();
    // The other three actions have no other home on this tier and stay.
    expect(
      screen.getByRole("link", { name: "Añadir stock" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Apuntar consumo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Subir un ticket" }),
    ).toBeInTheDocument();
  });
});

describe("what the Panel does not say twice", () => {
  it("does not present the catalogue size as needing attention", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Nothing about "27 productos" requires attention; it is not news.
    expect(screen.queryByText(/Productos en el catálogo/)).toBeAbsent();
  });

  it("does not count above the sections that already show the count", () => {
    expiredStub.data = [expiredItem()];
    expiringStub.data = [expiringItem(), expiringItem({ id: "b3" })];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // The state that used to produce "1 lote caducado · 2 lotes caducan
    // pronto · 1 producto por reponer". The sections below list exactly those
    // rows, so the sentence was the same information a second time.
    expect(screen.queryByText(/por reponer/)).toBeAbsent();
    expect(screen.queryByText(/lotes? caducad/)).toBeAbsent();
    expect(screen.queryByText(/lotes? caduca/)).toBeAbsent();

    // What replaced it is what was always underneath: the sections, which
    // are the doors, still carry every row.
    expect(
      screen.getByRole("heading", { name: "Se está acabando" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Café molido" }),
    ).toBeInTheDocument();
  });

  it("still says all is well in words when nothing needs attention", () => {
    overviewStub.data = { products: [] };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Never a "0 things wrong" line — the empty sections say it themselves.
    expect(screen.getByText(/No falta nada/)).toBeInTheDocument();
  });

  it("asks the server the same restock question the inventory filter asks", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      overviewCalls.some(
        (input) => input.needsRestock === true && input.limit === 100,
      ),
    ).toBe(true);
  });
});

/**
 * Gated on the data it is built from, not on every query's progress.
 *
 * It waited for all three queries to stop being pending — and
 * `getExpiredItems` was not persisted, so offline it was pending for ever and
 * the Panel said "loading" over a restock list it already had. Any error
 * replaced the whole page, so one background refetch failing took a loaded
 * panel away. And no-household was found by looking for the word in the
 * message text.
 */
describe("when not every question has an answer", () => {
  it("shows the restock list while the expired query waits for a signal", () => {
    expiredStub = {
      data: undefined,
      isPending: true,
      error: null,
      fetchStatus: "paused",
      refetch: () => {},
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: "Café molido" }),
    ).toBeInTheDocument();
  });

  it("keeps a loaded panel when a background refetch fails", () => {
    overviewStub = {
      ...answered({ products: [row()] }),
      error: trpcError("INTERNAL_SERVER_ERROR", 500),
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: "Café molido" }),
    ).toBeInTheDocument();
  });

  it("does not call a failed expiry question good news", () => {
    expiringStub = {
      data: undefined,
      isPending: false,
      error: trpcError("INTERNAL_SERVER_ERROR", 500),
      fetchStatus: "idle",
      refetch: () => {},
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.queryByText("No hay nada caducado ni a punto de caducar."),
    ).toBeAbsent();
    expect(
      screen.getByText("No se han podido cargar los datos"),
    ).toBeInTheDocument();
  });

  it("offers a household by the server's code, not by the message's words", () => {
    overviewStub = {
      data: undefined,
      isPending: false,
      error: trpcError("PRECONDITION_FAILED", 412),
      fetchStatus: "idle",
      refetch: () => {},
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(screen.getByText("Todavía no tienes un hogar")).toBeInTheDocument();
  });
});

describe("the restock list's state", () => {
  it("wears StockStatus's word, the one the inventory wears", () => {
    // It derived its own: a warn badge reading "Quedan 1 paquete (mínimo 2)"
    // here and "Stock bajo" on /inventory for the same product (UI-11).
    overviewStub.data = {
      products: [
        row({ id: "p-low", name: "Arroz", totalStock: 1, isLowStock: true }),
      ],
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(screen.getByText("Queda poco")).toBeInTheDocument();
    // How much is left is still said, as a detail rather than as the state.
    expect(
      screen.getByText(/Quedan 1 paquete \(mínimo 2\)/),
    ).toBeInTheDocument();
  });
});

describe("the Panel's lists", () => {
  it("offers the overflow as a door to the filtered inventory", () => {
    overviewStub.data = {
      products: Array.from({ length: 7 }, (_, i) => row({ id: `p${i}` })),
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Five rows show; the way to the other two must exist, because the alert
    // row that used to be this door is gone.
    const more = screen.getByRole("link", {
      name: "Ver los 2 productos restantes en el inventario",
    });
    expect(more.getAttribute("href")).toBe("/inventory?filter=restock");
  });

  it("draws its lists as lists, not as cards", () => {
    expiredStub.data = [expiredItem()];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Noel's rule (2026-08-19): a card around every list is visual overhead,
    // not structure. Rows separate with dividers (`divide-border` is the
    // dividers' colour, not a box); the border box itself is gone.
    for (const list of screen.getAllByRole("list")) {
      expect(list.className).not.toMatch(
        /bg-card|rounded|(?:^| )border(?: |$)/,
      );
    }
  });
});

it("passes axe at AAA", async () => {
  const { container } = renderWithIntl(<DashboardPage />, { locale: "es" });
  await screen.findByRole("heading", { level: 1 });
  expect(await axeViolations(container)).toBe("");
});
