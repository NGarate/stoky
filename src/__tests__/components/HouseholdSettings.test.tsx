import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * The settings hub's "Hogar" section: the household's name, for whoever may
 * change it. `household.update` is `adminProcedure`, so a member is offered
 * nothing at all rather than a field the server refuses.
 */
const updateCalls: unknown[] = [];
const invalidated: string[] = [];
let refreshes = 0;

/** The names the server holds besides the household's own. */
let names: { tabName: string | null; appName: string | null } = {
  tabName: null,
  appName: null,
};

/** Who the section thinks is looking. */
let role = "OWNER";

/** When set, the rename reports this instead of succeeding. */
let failure: { data?: { code?: string } } | null = null;

// A saved tab name reaches the title through a server render of the layout.
mock.module("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ refresh: () => void refreshes++, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

// The real snackbar needs a write queue to read; none of it matters here.
mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      household: {
        current: {
          invalidate: async () => void invalidated.push("household.current"),
        },
      },
    }),
    household: {
      current: {
        useQuery: () => ({
          data: { household: { id: "h1", name: "Casa", ...names }, role },
        }),
      },
      update: {
        useMutation: (opts: {
          onSuccess?: (data: unknown) => Promise<void>;
          onError?: (error: unknown) => void;
        }) => ({
          mutate: (input: { name: string }) => {
            updateCalls.push(input);
            if (failure) opts.onError?.(failure);
            else void opts.onSuccess?.({ id: "h1", name: input.name });
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { HouseholdSettings } =
  await import("@/components/settings/HouseholdSettings");

const renderSection = () =>
  renderWithIntl(
    <SnackbarProvider>
      <HouseholdSettings />
    </SnackbarProvider>,
    { locale: "es" },
  );

beforeEach(() => {
  updateCalls.length = 0;
  invalidated.length = 0;
  refreshes = 0;
  names = { tabName: null, appName: null };
  role = "OWNER";
  failure = null;
});

afterEach(cleanup);

describe("the household section of the settings hub", () => {
  it.each(["OWNER", "ADMIN"])(
    "shows %s the household's name in a labelled field",
    (who) => {
      role = who;
      renderSection();

      expect(
        screen.getByRole("heading", { name: "Hogar" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre del hogar")).toHaveValue("Casa");
    },
  );

  it.each(["MEMBER", "KITCHEN"])("shows %s nothing at all", (who) => {
    role = who;
    renderSection();

    expect(screen.queryByRole("heading", { name: "Hogar" })).toBeAbsent();
    expect(screen.queryByLabelText("Nombre del hogar")).toBeAbsent();
  });

  it("saves the new name, refetches it and says so", async () => {
    renderSection();

    const field = screen.getByLabelText("Nombre del hogar");
    await userEvent.clear(field);
    await userEvent.type(field, "Casa de la playa");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateCalls).toEqual([
      { name: "Casa de la playa", tabName: "", appName: "" },
    ]);
    expect(invalidated).toContain("household.current");
    expect(refreshes).toBe(1);
    expect(
      await screen.findAllByText(/El hogar se llama ahora «Casa de la playa»/),
    ).not.toHaveLength(0);
  });

  it("offers the tab's and the app's names, each saying it is public", async () => {
    names = { tabName: "Casa", appName: null };
    renderSection();

    const tab = screen.getByLabelText("Nombre en la pestaña del navegador");
    const app = screen.getByLabelText("Nombre de la app instalada");
    expect(tab).toHaveValue("Casa");
    expect(app).toHaveValue("");
    expect(tab).toHaveAccessibleDescription(/Vacío, la pestaña dice «Stoky»/);
    expect(tab).toHaveAccessibleDescription(/Es público/);
    expect(app).toHaveAccessibleDescription(/se llama como el hogar/);
    expect(app).toHaveAccessibleDescription(/Es público/);
    expect(app).toHaveAccessibleDescription(/al volver a instalarla/);

    await userEvent.clear(tab);
    await userEvent.type(app, "Despensa");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateCalls).toEqual([
      { name: "Casa", tabName: "", appName: "Despensa" },
    ]);
  });

  it("says when the rename did not save", async () => {
    failure = { data: { code: "FORBIDDEN" } };
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findAllByText(/No se ha podido cambiar el nombre del hogar/),
    ).not.toHaveLength(0);
  });
});
