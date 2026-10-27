import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * What /receipts/upload says once the receipt has been read.
 *
 * The result — "Se han leído 3 líneas" or "No se ha podido leer el ticket" —
 * appeared in a plain `<div>` after a wait of seconds with nothing to look
 * at. Somebody not looking at that part of the screen, or using a screen
 * reader, was never told the wait was over or how it ended (WCAG 4.1.3).
 */

let statusData: unknown;
const noop = (): void => {};
const uploads: Array<Record<string, unknown>> = [];
const invalidated: string[] = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: noop, replace: noop, refresh: noop }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/receipts/upload",
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
      store: {
        list: { invalidate: async () => void invalidated.push("store.list") },
      },
    }),
    store: {
      list: {
        useQuery: () => ({
          data: [
            { id: "s-merc", name: "Mercadona" },
            { id: "s-dia", name: "Día" },
          ],
          isLoading: false,
        }),
      },
    },
    receipt: {
      upload: {
        useMutation: () => ({
          mutateAsync: async (input: Record<string, unknown>) => {
            uploads.push(input);
            return { id: "r1" };
          },
          isPending: false,
        }),
      },
      getStatus: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? statusData : undefined,
        }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { default: UploadPage } =
  await import("@/app/(dashboard)/receipts/upload/page");

function mount(): HTMLElement {
  return renderWithIntl(
    <SnackbarProvider>
      <UploadPage />
    </SnackbarProvider>,
  ).container;
}

async function upload(container: HTMLElement): Promise<void> {
  const input = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(
    input,
    new File(["receipt"], "ticket.jpg", { type: "image/jpeg" }),
  );
}

/** The polite region the page owns (the snackbar's is a different one). */
function pageStatus(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="upload-result"]');
}

beforeEach(() => {
  statusData = undefined;
  uploads.length = 0;
  invalidated.length = 0;
});

afterEach(cleanup);

describe("the result of reading a receipt", () => {
  it("has a polite live region from the first render, before there is a result", () => {
    // A region created at the moment it gains text is the one some readers
    // never announce, so it must already be there, empty.
    const container = mount();

    const region = pageStatus(container);
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it("announces a successful read", async () => {
    statusData = { status: "NEEDS_REVIEW", progress: { processed: 3 } };
    const container = mount();

    await upload(container);

    await waitFor(() => {
      expect(pageStatus(container)?.textContent).toMatch(/3/);
    });
  });

  it("announces a failed read", async () => {
    statusData = { status: "FAILED", progress: null };
    const container = mount();

    await upload(container);

    await waitFor(() => {
      expect(pageStatus(container)?.textContent).toMatch(
        /No se ha podido leer el ticket/,
      );
    });
    expect(
      screen.getByRole("button", { name: "Subir otra foto" }),
    ).toBeInTheDocument();
  });
});

describe("the receipt's store", () => {
  it("offers the household's stores and files the receipt under the one picked", async () => {
    const container = mount();

    await userEvent.click(
      screen.getByRole("combobox", { name: "Tienda del ticket" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Mercadona" }));
    await upload(container);

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ storeId: "s-merc" });
    expect(uploads[0]).not.toHaveProperty("storeName");
  });

  it("matches a typed name to the store already there, as the list does", async () => {
    const container = mount();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Tienda del ticket" }),
      "dia",
    );
    // No new store announced: "dia" is the "Día" in the list.
    expect(screen.queryByText(/Se añadirá la tienda/)).toBeAbsent();
    await upload(container);

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ storeId: "s-dia" });
  });

  it("names a new store, says so before uploading, and refreshes the list", async () => {
    const container = mount();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Tienda del ticket" }),
      "Frutería Paqui ",
    );
    expect(
      screen.getByText(
        "Se añadirá la tienda «Frutería Paqui» al subir el ticket.",
      ),
    ).toBeInTheDocument();
    await upload(container);

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ storeName: "Frutería Paqui" });
    expect(uploads[0]).not.toHaveProperty("storeId");
    await waitFor(() => expect(invalidated).toContain("store.list"));
  });

  it("sends no store when the field is left empty", async () => {
    const container = mount();

    await upload(container);

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).not.toHaveProperty("storeId");
    expect(uploads[0]).not.toHaveProperty("storeName");
  });
});
