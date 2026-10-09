import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * ExpiringItems (I18N-5 blind spot) — every string it renders came from a
 * hand-rolled Spanish literal, in either language, because the catalogue
 * tests can only see strings that reach a catalogue.
 */

let expiringData: unknown[] = [];
let expiredData: unknown[] = [];

/** What the expiring query is doing, when a test needs it to have no answer. */
let expiringState: {
  data?: undefined;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
} | null = null;

mock.module("@/lib/trpc/client", () => ({
  api: {
    inventory: {
      getExpiringItems: {
        useQuery: () =>
          expiringState === null
            ? { data: expiringData, isLoading: false, error: null, fetchStatus: "idle", refetch: () => {} }
            : { ...expiringState, data: undefined, isLoading: false, refetch: () => {} },
      },
      getExpiredItems: {
        useQuery: () => ({ data: expiredData, isLoading: false, error: null, fetchStatus: "idle", refetch: () => {} }),
      },
    },
  },
}));

const { ExpiringItems } = await import("@/components/inventory/ExpiringItems");

const product = (id: string) => ({ id: `p-${id}`, name: `Product ${id}` });

const expiredItem = (id: string, daysExpired: number) => ({
  id,
  product: product(id),
  location: null,
  quantity: 1,
  unit: "ud",
  daysExpired,
});

const expiringItem = (id: string, daysUntilExpiry: number) => ({
  id,
  product: product(id),
  location: null,
  quantity: 1,
  unit: "ud",
  daysUntilExpiry,
  isExpiringSoon: daysUntilExpiry <= 3,
});

afterEach(() => {
  cleanup();
  expiringState = null;
});

/**
 * No answer is not an empty answer.
 *
 * Gated on `isLoading`, which is false for a paused or failed query, both fell
 * through to "allClear" — a failure reading as the good news that nothing is
 * about to spoil.
 */
describe("ExpiringItems without an answer", () => {
  it("does not say all is clear when there is no connection", async () => {
    expiringState = { error: null, fetchStatus: "paused" };

    renderWithIntl(<ExpiringItems />, { locale: "es" });

    expect(await screen.findByText("Aquí todavía no hay nada guardado")).toBeInTheDocument();
    expect(
      screen.queryByText("No hay productos caducados ni próximos a caducar"),
    ).toBeAbsent();
  });

  it("does not say all is clear when the server failed", async () => {
    expiringState = { error: new Error("500"), fetchStatus: "idle" };

    renderWithIntl(<ExpiringItems />, { locale: "es" });

    expect(await screen.findByText("No se han podido cargar los datos")).toBeInTheDocument();
    expect(
      screen.queryByText("No hay productos caducados ni próximos a caducar"),
    ).toBeAbsent();
  });
});

describe("ExpiringItems", () => {
  it("renders in the catalogue's language, not hardcoded Spanish", async () => {
    expiredData = [expiredItem("1", 3)];
    expiringData = [expiringItem("2", 0)];

    renderWithIntl(<ExpiringItems />, { locale: "en" });

    // Singular ICU branch — also proves the plural rule actually evaluates
    // rather than the guard's substring check being satisfied by dead markup.
    expect(await screen.findByText("Expired product (1)")).toBeInTheDocument();
    expect(screen.getByText("Expired 3 days ago")).toBeInTheDocument();
    expect(screen.getByText("Expires today")).toBeInTheDocument();
    expect(screen.queryByText(/Hace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Caduca/)).not.toBeInTheDocument();
    expect(screen.queryByText(/próximos/)).not.toBeInTheDocument();
  });

  it("switches ICU branch once there is more than one", async () => {
    expiredData = [expiredItem("1", 3), expiredItem("2", 5)];
    expiringData = [];

    renderWithIntl(<ExpiringItems />, { locale: "en" });

    expect(await screen.findByText("Expired products (2)")).toBeInTheDocument();
  });

  it("does the same in Spanish, singular and plural", async () => {
    expiredData = [expiredItem("1", 3)];
    expiringData = [];
    renderWithIntl(<ExpiringItems />, { locale: "es" });
    expect(await screen.findByText("Producto caducado (1)")).toBeInTheDocument();

    cleanup();

    expiredData = [expiredItem("1", 3), expiredItem("2", 5)];
    renderWithIntl(<ExpiringItems />, { locale: "es" });
    expect(await screen.findByText("Productos caducados (2)")).toBeInTheDocument();
  });

  it("says so when nothing is expired or expiring, in English", async () => {
    expiredData = [];
    expiringData = [];

    renderWithIntl(<ExpiringItems />, { locale: "en" });

    expect(
      await screen.findByText("Nothing has expired or is about to"),
    ).toBeInTheDocument();
  });

  it("renders each item on the shared row grammar: a linked title and meta", async () => {
    expiredData = [expiredItem("1", 3)];
    expiringData = [];

    renderWithIntl(<ExpiringItems />, { locale: "en" });

    // The title links to the product (ItemRow's title slot), not the whole row.
    const link = await screen.findByRole("link", { name: "Product 1" });
    expect(link).toHaveAttribute("href", "/products/p-1");
    // The meta definition list carries quantity and the no-location fallback.
    expect(screen.getByText("Quantity")).toBeInTheDocument();
    expect(screen.getByText("No location")).toBeInTheDocument();
  });

  it("truncates and says how many more, in the catalogue's language", async () => {
    expiredData = [expiredItem("1", 3), expiredItem("2", 5)];
    expiringData = [];

    renderWithIntl(<ExpiringItems maxItems={1} />, { locale: "en" });

    expect(await screen.findByText("And 1 more…")).toBeInTheDocument();
  });
});
