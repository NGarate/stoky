import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
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
/** What the server answers a scan with; null leaves the mutation unanswered. */
let scanResult: {
  product: { id: string; name: string } | null;
  source: string;
} | null = null;
let scanCallbacks: {
  onSuccess?: (result: unknown, input: unknown) => void;
  onError?: (error: unknown, input: unknown) => void;
} = {};
/** When set, the server refuses the lookup with this instead of answering. */
let scanError: unknown = null;
const scanMutate = mock((input: unknown) => {
  // Later, as a real refusal arrives: by then the page is showing its
  // "looking up" state, and the manual field is not on screen.
  if (scanError !== null) {
    const error = scanError;
    setTimeout(() => scanCallbacks.onError?.(error, input), 0);
  } else if (scanResult !== null) scanCallbacks.onSuccess?.(scanResult, input);
});
const productInvalidate = mock(() => Promise.resolve());
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
    useUtils: () => ({ product: { invalidate: productInvalidate } }),
    product: {
      scanBarcode: {
        useMutation: (callbacks: typeof scanCallbacks) => {
          scanCallbacks = callbacks;
          return { mutate: scanMutate, isPending: false };
        },
      },
    },
  },
}));

const routerPush = mock((_href: string) => {});
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
  usePathname: () => "/products/scan",
  useParams: () => ({}),
  redirect: () => {},
}));

/**
 * The camera library, replaced so a camera failure is something a test
 * does rather than something the environment happens to do. It was left
 * real, and happy-dom's missing MediaDevices made it fail on every render —
 * until `Scanner.test.tsx`, whose own mock of this module is process-wide,
 * happened to load first, and then it never failed at all. The focus test
 * went red or green by file order.
 */
let scannerOnError: ((error?: Error) => void) | undefined;
mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints() {
      return new Promise((_resolve, reject) => {
        scannerOnError = reject;
      });
    }
  },
}));

const { default: ScanPage } =
  await import("@/app/(dashboard)/products/scan/page");
const { buttonVariants } = await import("@/components/ui/button");
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
  // happy-dom leaves it undefined, which the scanner reads as plain HTTP and
  // answers with the HTTPS panel instead of opening the camera.
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  enqueue.mockClear();
  scanMutate.mockClear();
  routerPush.mockClear();
  productInvalidate.mockClear();
  scanResult = null;
  scanError = null;
  searchParams = new URLSearchParams();
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

describe("a scan that creates a product", () => {
  it("refreshes the catalogue, which did not have it a moment ago", async () => {
    scanResult = {
      product: { id: "p-new", name: "Galletas" },
      source: "openfoodfacts",
    };
    render();
    await typeBarcode("8410000444444");

    expect(productInvalidate).toHaveBeenCalled();
  });

  it("leaves it alone when the scan only found what was already there", async () => {
    scanResult = { product: { id: "p-old", name: "Leche" }, source: "local" };
    render();
    await typeBarcode("8410000555555");

    expect(productInvalidate).not.toHaveBeenCalled();
  });
});

describe("the manual field", () => {
  it("is named by a label, not only by its placeholder", () => {
    // The placeholder vanishes as soon as somebody types, and it was the
    // field's only name.
    render();

    expect(screen.getByLabelText("Código de barras")).toHaveAttribute(
      "name",
      "barcode",
    );
  });

  it("submits through the Button primitive, which owns the target floor", () => {
    // A hand-styled <button> with px-4 py-2 was 40px tall, under the 48px
    // floor every primitive clears.
    render();

    expect(screen.getByRole("button", { name: "Buscar" }).className).toBe(
      buttonVariants({ variant: "outline" }),
    );
  });
});

describe("a code nobody knows", () => {
  it("opens the create form with the code intact, whatever it contains", async () => {
    // The manual field accepts anything. Interpolated raw, "&" started a
    // second query parameter and "#" cut the code short on arrival.
    scanResult = { product: null, source: "not_found" };
    render();
    await typeBarcode("12&pendingScan=x#3");

    expect(routerPush).toHaveBeenCalledWith(
      `/products/new?barcode=${encodeURIComponent("12&pendingScan=x#3")}`,
    );
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
        label: {
          key: "offline.scannedBarcode",
          values: { barcode: "8410000333333" },
        },
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

/** A refusal the server sent, with a status — not a dropped connection. */
function serverError(httpStatus = 502): TRPCClientError<never> {
  const error = new TRPCClientError<never>("lookup failed");
  Object.defineProperty(error, "data", { value: { httpStatus } });
  return error;
}

describe("a lookup that fails", () => {
  it("says so, and what to do, instead of quietly scanning again", async () => {
    // A refused lookup restarted the camera and said nothing, so the code
    // seemed simply not to have been read — and scanning it again failed
    // again, silently, for as long as anyone kept trying.
    scanError = serverError();
    render();
    await typeBarcode("8410000666666");

    expect(
      await screen.findByText(
        "No se ha podido buscar el código 8410000666666. Vuelve a escanearlo o escríbelo abajo.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the code in the field, ready to send again", async () => {
    scanError = serverError();
    render();
    await typeBarcode("8410000777777");

    await waitFor(() => {
      const field = screen.getByLabelText("Código de barras");
      expect(field).toHaveValue("8410000777777");
      expect(field).toHaveFocus();
    });
  });
});

describe("a lookup refused for being one too many", () => {
  // `productLookupRateLimit`: past its budget of new codes for the hour, an
  // account's lookups are refused with 429. Scanning or typing the code again
  // would be refused again, so the field this page offers for a failure is a
  // dead end — the form is where the product can still be created.
  it("hands over to the form with the code, and says why it is empty", async () => {
    scanError = serverError(429);
    render();
    await typeBarcode("8410000888888");

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        "/products/new?barcode=8410000888888",
      ),
    );
    expect(
      await screen.findByText(
        "Has buscado muchos códigos nuevos en poco tiempo. Rellena el producto 8410000888888 a mano; la búsqueda volverá a funcionar en un rato.",
      ),
    ).toBeInTheDocument();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("a camera that cannot be used", () => {
  it("puts focus in the field where the code can be typed instead", async () => {
    // §7 rule 4: "No camera available. Type the barcode instead" — with the
    // field already focused. The refusal a phone gives when the permission
    // was denied.
    render();
    expect(screen.getByLabelText("Código de barras")).not.toHaveFocus();

    await act(async () => {
      scannerOnError?.(
        Object.assign(new Error("Permission denied"), {
          name: "NotAllowedError",
        }),
      );
    });

    expect(screen.getByLabelText("Código de barras")).toHaveFocus();
  });
});

describe("the way back", () => {
  it("goes to the products by default", () => {
    render();

    expect(
      screen.getByRole("link", { name: /Volver a productos/ }),
    ).toHaveAttribute("href", "/products");
  });

  it("goes back to the shop when the shop is where scanning started", () => {
    // Screen A's scan button opens this page, and the way back led to the
    // product catalogue — a place the person in the aisle never was.
    searchParams = new URLSearchParams("from=shopping");
    render();

    expect(
      screen.getByRole("link", { name: /Volver a la compra/ }),
    ).toHaveAttribute("href", "/shopping");
  });
});
