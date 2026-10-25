import "../setup/matchers";
import { TRPCClientError } from "@trpc/client";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithIntl } from "../utils/render";

/**
 * **Tus dispositivos** on `/settings/security` — what the list says about each
 * session, and that nothing on it ends a session without the password
 * (ASVS 5.0.0 7.5.2, PROGRESS D143).
 *
 * The order of the work when this device is among the sessions ended — the
 * server first, then the purge, then the redirect — is
 * `EndSession.test.tsx`'s, beside the other two controls that share
 * `useEndSession` and the mocks that watch it (D50). This file never submits
 * an ending that includes this device, so it needs none of those spies.
 */

interface Row {
  id: string;
  device: { browser: string | null; os: string | null };
  screen: "KITCHEN" | "SHOPPING" | "DASHBOARD" | null;
  signedInAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  remembered: boolean;
  current: boolean;
}

function row(overrides: Partial<Row> & Pick<Row, "id">): Row {
  return {
    device: { browser: "Firefox", os: "Linux" },
    screen: null,
    signedInAt: new Date("2026-10-15T08:00:00.000Z"),
    lastUsedAt: new Date("2026-10-15T09:00:00.000Z"),
    expiresAt: new Date("2026-10-15T09:15:00.000Z"),
    remembered: false,
    current: false,
    ...overrides,
  };
}

const HERE = row({ id: "s-here", current: true });
const TABLET = row({
  id: "s-tablet",
  device: { browser: "Chrome", os: "Android" },
  screen: "KITCHEN",
  remembered: true,
  expiresAt: new Date("2027-01-13T09:00:00.000Z"),
});
const STRANGER = row({ id: "s-stranger", device: { browser: null, os: null } });

let rows: Row[] = [];
let calls: unknown[] = [];
let refusal: unknown = null;
let invalidated = 0;
/** The rows the next read of the list no longer has, as the server would answer it. */
let endedOnRead: string[] = [];

function trpcRefusal(code: string, message: string): TRPCClientError<never> {
  const error = new TRPCClientError<never>(message);
  Object.defineProperty(error, "data", { value: { code } });
  return error;
}

mock.module("@/lib/offline/queue-context", () => ({
  // A real context as well as the hook: `mock.module` replaces the module for
  // the whole process, and `WriteQueueProvider` renders the context.
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true as const, id: "x" }),
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush: async () => 0,
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      auth: {
        listSessions: {
          invalidate: async () => {
            invalidated++;
            rows = rows.filter(
              (candidate) => !endedOnRead.includes(candidate.id),
            );
          },
        },
      },
    }),
    auth: {
      listSessions: {
        useQuery: () => ({
          data: rows,
          error: null,
          fetchStatus: "idle",
          refetch: async () => {},
        }),
      },
      endSessions: {
        useMutation: () => ({
          mutateAsync: async (input: { scope: string }) => {
            calls.push(input);
            if (refusal !== null) throw refusal;
            return {
              ended: input.scope === "one" ? 1 : 2,
              includedCurrent: false,
            };
          },
        }),
      },
    },
  },
}));

const { DeviceList } = await import("@/components/session/DeviceList");
const { reauthRefusalOf } = await import("@/components/session/ReauthDialog");
const { EndSessionError } =
  await import("@/components/session/use-end-session");
const { SnackbarProvider } = await import("@/components/ui/snackbar");

function renderList() {
  // `useEndSession` clears the query client when this device leaves, so the
  // list needs one even though nothing here leaves.
  return renderWithIntl(
    <QueryClientProvider client={new QueryClient()}>
      <SnackbarProvider>
        <DeviceList />
      </SnackbarProvider>
    </QueryClientProvider>,
  );
}

/** The list item whose title is `name`. */
function rowNamed(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find(
      (candidate) =>
        within(candidate).queryByText(name, { selector: "span" }) !== null,
    );
  if (!item) throw new Error(`no row titled ${name}`);
  return item;
}

beforeEach(() => {
  rows = [HERE, TABLET, STRANGER];
  calls = [];
  refusal = null;
  invalidated = 0;
  endedOnRead = [];
});

afterEach(cleanup);

describe("what each session is shown as", () => {
  it("marks this device's session, and only that one", () => {
    renderList();

    expect(
      within(rowNamed("Firefox en Linux")).getByText("Este dispositivo"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Este dispositivo")).toHaveLength(1);
  });

  it("names a device by the screen it chose, and still says what it runs", () => {
    // The kitchen tablet reads as the kitchen screen: that is what tells it
    // from a phone of the same make.
    renderList();

    const tablet = rowNamed("Pantalla de cocina");
    expect(within(tablet).getByText("Chrome en Android")).toBeInTheDocument();
    expect(within(tablet).getByText("Recordada")).toBeInTheDocument();
  });

  it("says a browser session ends when left alone, and words an unknown device", () => {
    renderList();

    expect(
      within(rowNamed("Dispositivo desconocido")).getByText(
        "Se cierra tras 15 min sin uso",
      ),
    ).toBeInTheDocument();
  });

  it("says how many sessions the account may hold, and which goes", () => {
    // The cap (D140) ends a session at somebody else's sign-in; the list is
    // where its disappearance has to be explained.
    renderList();

    expect(screen.getByText(/hasta 10 sesiones abiertas/)).toBeInTheDocument();
    expect(
      screen.getByText(/la que lleva más tiempo sin usarse/),
    ).toBeInTheDocument();
  });

  it("offers to end the others only when there are others", () => {
    rows = [HERE];
    renderList();

    expect(
      screen.queryByRole("button", { name: "Cerrar las demás" }),
    ).toBeAbsent();
    expect(
      screen.getByRole("button", { name: "Cerrar todas" }),
    ).toBeInTheDocument();
  });
});

describe("every action asks for the password", () => {
  it.each([
    ["this device's row", /^Cerrar esta sesión: Firefox en Linux$/],
    ["another device's row", /^Cerrar esta sesión: Pantalla de cocina$/],
    ["the others", /^Cerrar las demás$/],
    ["every one", /^Cerrar todas$/],
  ])("%s opens a password field and ends nothing yet", async (_label, name) => {
    renderList();

    await userEvent.click(screen.getByRole("button", { name }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Tu contraseña")).toHaveAttribute(
      "type",
      "password",
    );
    expect(calls).toEqual([]);
  });

  it("refuses an empty password without asking the server", async () => {
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: "Cerrar las demás" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cerrar las demás" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Escribe tu contraseña.",
    );
    expect(calls).toEqual([]);
  });
});

describe("ending another device's session", () => {
  async function endTablet(): Promise<HTMLElement> {
    renderList();
    await userEvent.click(
      screen.getByRole("button", {
        name: /^Cerrar esta sesión: Pantalla de cocina$/,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      "¿Cerrar la sesión de Pantalla de cocina?",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Tu contraseña"),
      "cocina despensa nevera",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cerrar esta sesión" }),
    );
    return dialog;
  }

  it("sends that session's id with the password, and says it is done", async () => {
    await endTablet();

    expect(calls).toEqual([
      {
        currentPassword: "cocina despensa nevera",
        scope: "one",
        sessionId: "s-tablet",
      },
    ]);
    expect(invalidated).toBe(1);
    expect(screen.queryByRole("dialog")).toBeAbsent();
    expect(
      await screen.findByText("Se ha cerrado la sesión de Pantalla de cocina."),
    ).toBeInTheDocument();
  });

  it("leaves focus on the list, not on <body>, once the row it was opened from has gone", async () => {
    // The opener was this row's button, removed by the list read again
    // before the dialog closed (WCAG 2.4.3).
    endedOnRead = ["s-tablet"];

    await endTablet();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeAbsent());
    expect(
      screen.queryByText("Pantalla de cocina", { selector: "span" }),
    ).toBeAbsent();
    await waitFor(() => expect(document.activeElement?.tagName).toBe("UL"));
  });

  it("says a session that had already ended as that, and reads the list again", async () => {
    refusal = trpcRefusal("NOT_FOUND", "Session not found");

    await endTablet();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Esa sesión ya estaba cerrada.",
    );
    expect(invalidated).toBe(1);
  });
});

describe("reading a refusal", () => {
  it("reads a refusal the purge sequence wrapped through its cause", () => {
    // `useEndSession` throws EndSessionError("server") with the server's
    // refusal as its cause; read at the wrapper, a spent budget would be told
    // as "try again".
    const wrapped = new EndSessionError("server", {
      cause: trpcRefusal("TOO_MANY_REQUESTS", "Too many attempts"),
    });

    expect(reauthRefusalOf(wrapped)).toBe("tooMany");
    expect(
      reauthRefusalOf(
        trpcRefusal("BAD_REQUEST", "The current password is not correct"),
      ),
    ).toBe("wrong");
    // Any other BAD_REQUEST is not the password's fault.
    expect(
      reauthRefusalOf(trpcRefusal("BAD_REQUEST", "Choose the session to end")),
    ).toBe("failed");
  });
});
