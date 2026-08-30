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

mock.module("@/lib/trpc/client", () => ({
  api: {
    inventory: {
      getExpiringItems: {
        useQuery: () => ({ data: expiringData, isLoading: false }),
      },
      getExpiredItems: {
        useQuery: () => ({ data: expiredData, isLoading: false }),
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
  daysExpired,
});

const expiringItem = (id: string, daysUntilExpiry: number) => ({
  id,
  product: product(id),
  location: null,
  daysUntilExpiry,
  isExpiringSoon: daysUntilExpiry <= 3,
});

afterEach(cleanup);

describe("ExpiringItems", () => {
  it("renders in the catalogue's language, not hardcoded Spanish", async () => {
    expiredData = [expiredItem("1", 3)];
    expiringData = [expiringItem("2", 0)];

    renderWithIntl(<ExpiringItems />, { locale: "en" });

    // Singular ICU branch — also proves the plural rule actually evaluates
    // rather than the guard's substring check being satisfied by dead markup.
    expect(await screen.findByText("Expired product (1)")).toBeInTheDocument();
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
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

  it("truncates and says how many more, in the catalogue's language", async () => {
    expiredData = [expiredItem("1", 3), expiredItem("2", 5)];
    expiringData = [];

    renderWithIntl(<ExpiringItems maxItems={1} />, { locale: "en" });

    expect(await screen.findByText("And 1 more…")).toBeInTheDocument();
  });
});
