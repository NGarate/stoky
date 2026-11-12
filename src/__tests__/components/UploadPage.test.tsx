import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext, useSyncExternalStore } from "react";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";

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

/**
 * The address, as far as the page reads it: its query, and where it was sent.
 * The page keeps the receipt it is following in `?receipt=`, so `replace` to
 * /receipts/upload changes what `useSearchParams` answers; anywhere else is
 * a navigation away, recorded and otherwise ignored.
 */
let query = new URLSearchParams();
const replaced: string[] = [];
const watchers = new Set<() => void>();
function replace(url: string): void {
  replaced.push(url);
  const [path, search = ""] = url.split("?");
  if (path !== "/receipts/upload") return;
  query = new URLSearchParams(search);
  for (const watcher of watchers) watcher();
}

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: noop, replace, refresh: noop }),
  useSearchParams: () =>
    useSyncExternalStore(
      (watcher) => {
        watchers.add(watcher);
        return () => watchers.delete(watcher);
      },
      () => query,
    ),
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
    auth: {
      me: { useQuery: () => ({ data: { role: "MEMBER" } }) },
    },
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
      getImage: {
        useQuery: () => ({ data: "data:image/jpeg;base64,c3RvcmVk" }),
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
  await userEvent.click(
    await screen.findByRole("button", { name: "Enviar ticket" }),
  );
}

/** The polite region the page owns (the snackbar's is a different one). */
function pageStatus(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="upload-result"]');
}

beforeEach(() => {
  statusData = undefined;
  query = new URLSearchParams();
  replaced.length = 0;
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

describe("following the receipt it sent", () => {
  it("keeps it in the address, so a reload still shows how the read went", async () => {
    statusData = { status: "FAILED", progress: null };
    // As after a reload: no upload in this page's life, the receipt in the URL.
    query = new URLSearchParams("receipt=r1");
    const container = mount();

    await waitFor(() => {
      expect(pageStatus(container)?.textContent).toMatch(
        /No se ha podido leer el ticket/,
      );
    });
  });

  it("shows the photo being read as the server stored it, unfolded", async () => {
    statusData = { status: "PROCESSING", progress: { processed: 0, total: 0 } };
    const container = mount();

    await upload(container);

    const photo = await screen.findByAltText("Foto del ticket");
    expect(photo.getAttribute("src")).toBe("data:image/jpeg;base64,c3RvcmVk");
    expect(photo.closest("details")?.open).toBe(true);
  });

  it("goes on to the review once the receipt has been read", async () => {
    statusData = { status: "NEEDS_REVIEW", progress: { processed: 3 } };
    const container = mount();

    await upload(container);

    await waitFor(() => {
      expect(replaced).toContain("/receipts/r1/review");
    });
  });

  it("stays to say so when the read failed", async () => {
    statusData = { status: "FAILED", progress: null };
    const container = mount();

    await upload(container);

    await waitFor(() => {
      expect(pageStatus(container)?.textContent).toMatch(/No se ha podido/);
    });
    expect(replaced.some((url) => url.includes("/review"))).toBe(false);
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

it("passes axe at AAA", async () => {
  const container = mount();
  await screen.findByRole("heading", { level: 1 });
  expect(await axeViolations(container)).toBe("");
});
