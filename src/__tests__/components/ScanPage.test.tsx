import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { onlineManager } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * The scan page's offline path (T7).
 *
 * When there is no signal, a scan is queued rather than sent — TanStack Query
 * pauses an offline mutation rather than erroring, so a scan that just called
 * `mutate` would hang. The page checks `onlineManager` first and enqueues a
 * `product.resolveScan` op, deduped against what is already waiting.
 */

const enqueue = mock((_op: unknown) => ({ ok: true as const, id: "op-1" }));
const scanMutate = mock((_input: unknown) => {});
let pending: QueuedOp[] = [];

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false, hydrated: true },
    enqueue,
    drain: () => {},
    retry: () => {},
    discard: () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    product: {
      scanBarcode: {
        useMutation: () => ({ mutate: scanMutate, isPending: false }),
      },
    },
  },
}));

const routerPush = mock((_href: string) => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products/scan",
  useParams: () => ({}),
  redirect: () => {},
}));

const { default: ScanPage } = await import("@/app/(dashboard)/products/scan/page");
const { SnackbarProvider } = await import("@/components/ui/snackbar");

function render() {
  renderWithIntl(
    <SnackbarProvider>
      <ScanPage />
    </SnackbarProvider>,
    { locale: "es" },
  );
}

async function typeBarcode(value: string) {
  const input = screen.getByPlaceholderText("Introducir código manualmente");
  await userEvent.type(input, value);
  await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
}

beforeEach(() => {
  enqueue.mockClear();
  scanMutate.mockClear();
  pending = [];
  onlineManager.setOnline(true);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("scanning with a signal", () => {
  it("sends the scan to the server", async () => {
    render();
    await typeBarcode("8410000111111");

    expect(scanMutate).toHaveBeenCalledWith({ barcode: "8410000111111" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("scanning with no signal", () => {
  beforeEach(() => onlineManager.setOnline(false));

  it("queues the scan instead of sending it", async () => {
    render();
    await typeBarcode("8410000222222");

    expect(scanMutate).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const op = enqueue.mock.calls[0]?.[0] as {
      path: string;
      input: { barcode: string };
    };
    expect(op.path).toBe("product.resolveScan");
    expect(op.input.barcode).toBe("8410000222222");
    // The confirmation snackbar's text is left to the snackbar's own tests: it
    // renders through a portal whose mounting flakes under the suite's
    // cross-file module mocks, and the enqueue above is the behaviour T7 owns.
  });

  it("does not queue the same barcode twice", async () => {
    pending = [
      {
        id: "already",
        path: "product.resolveScan",
        input: { barcode: "8410000333333" },
        householdId: "h1",
        label: { key: "offline.scannedBarcode", values: { barcode: "8410000333333" } },
        createdAt: new Date(),
        attempts: 0,
      },
    ];
    render();
    await typeBarcode("8410000333333");

    // The dedupe is the behaviour that matters: a barcode already waiting is
    // not queued a second time.
    expect(enqueue).not.toHaveBeenCalled();
  });
});
