import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * `/products/new` reached from a queued scan nobody could name (T7).
 *
 * The sync banner's "Ponle nombre" link carries the barcode and the queued
 * scan's id. Once the product exists, by whichever route, the queued scan has
 * its answer and must leave the queue — or the banner keeps asking for a name
 * the product already has.
 */

const discard = mock((_id: string) => {});
let lookupResult: {
  product: { id: string; name: string } | null;
  source: string;
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () =>
    new URLSearchParams("barcode=8410000999999&pendingScan=op-scan"),
  usePathname: () => "/products/new",
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard,
    flush: async () => 0,
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      product: {
        invalidate: async () => {},
        list: { invalidate: async () => {} },
        getByBarcode: { invalidate: async () => {} },
      },
    }),
    product: {
      getByBarcode: { useQuery: () => ({ data: null }) },
      scanBarcode: {
        useMutation: (callbacks: {
          onSuccess?: (result: unknown) => Promise<void>;
        }) => ({
          mutate: () => void callbacks.onSuccess?.(lookupResult),
          isPending: false,
        }),
      },
      create: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
  },
}));

const { default: NewProductPage } =
  await import("@/app/(dashboard)/products/new/page");

beforeEach(() => {
  discard.mockClear();
});

afterEach(cleanup);

describe("a queued scan named by looking it up", () => {
  it("leaves the queue when Open Food Facts makes the product", async () => {
    lookupResult = {
      product: { id: "p-new", name: "Galletas" },
      source: "openfoodfacts",
    };
    renderWithIntl(<NewProductPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Buscar en Open Food Facts" }),
    );

    expect(discard).toHaveBeenCalledWith("op-scan");
  });

  it("leaves the queue when the household already had it", async () => {
    lookupResult = {
      product: { id: "p-old", name: "Galletas" },
      source: "local",
    };
    renderWithIntl(<NewProductPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Buscar en Open Food Facts" }),
    );

    expect(discard).toHaveBeenCalledWith("op-scan");
  });

  it("stays queued when the lookup found nothing", async () => {
    // Still unnamed, so the question in the banner is still the right one.
    lookupResult = { product: null, source: "not_found" };
    renderWithIntl(<NewProductPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Buscar en Open Food Facts" }),
    );

    expect(discard).not.toHaveBeenCalled();
  });
});
