import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * The two controls that end a session, in one file because they share a hook.
 *
 * `SignOutButton` ends this device's visit. `RevokeSessionsButton` ends every
 * session the account has, this one included. Both run the same purge sequence
 * — `useEndSession` — and that is also why their tests live together: the
 * mocks below replace modules for the *whole process* (D50), so two files
 * mocking `@/lib/auth/actions` and the queue with different spies would each
 * be asserting against the other's. Measured: they did, and eighteen tests in
 * three unrelated files went red.
 *
 * `signOut` was exported and called nowhere before `SignOutButton`, so
 * `queue.purgeAll` and the cached shell's purge were security controls nothing
 * could fire. What matters for both is the order and the asking: a queue with
 * unsent changes is somebody's shopping, and leaving silently would delete it.
 */

/** What happened, in the order it happened — the subject of the revoke suite. */
let steps: string[] = [];

const signOutAction = mock(async () => {
  steps.push("signOut");
});
const postMessage = mock((_message: string) => {
  steps.push("purgeShell");
});
const purgeAll = mock(() => {
  steps.push("purgeQueue");
});
const flush = mock(async () => {
  steps.push("flush");
});

let pending: QueuedOp[] = [];
/** Whether the server accepts the revocation, per test. */
let serverRefuses = false;

mock.module("@/lib/auth/actions", () => ({ signOutAction }));
/**
 * `@/lib/sw/register` is deliberately **not** mocked.
 *
 * `mock.module` replaces a module for every suite in the process, and
 * `service-worker-register.test.ts` tests that one for real — a mock here
 * would replace what it is testing. The browser is stubbed instead, which is
 * both safer and a stronger assertion: it checks the message the worker
 * actually receives rather than that a function was called.
 */
function stubServiceWorker(): typeof postMessage {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { controller: { postMessage } },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "caches", {
    value: { keys: async () => [], delete: async () => true },
    configurable: true,
    writable: true,
  });
  return postMessage;
}
mock.module("@/components/offline/queue-context", () => ({
  // A real context as well as the hook. `mock.module` replaces the module for
  // the whole process, and `WriteQueueProvider` renders
  // `WriteQueueContext.Provider` — so a mock that omits it turns the provider
  // into a syntax error in whichever suite renders the real one.
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true as const, id: "x" }),
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush,
    purgeAll,
  }),
}));

/**
 * `@/lib/offline/persist` is deliberately not mocked either, for the same
 * reason as `@/lib/sw/register`: `offline-persist.test.tsx` tests it for real.
 * `forgetPersistedReads` runs against the stubbed browser and is harmless.
 */
mock.module("@/lib/trpc/client", () => ({
  api: {
    auth: {
      revokeMySessions: {
        useMutation: () => ({
          mutateAsync: async () => {
            steps.push("revoke");
            if (serverRefuses) throw new Error("refused");
            return { revokedAt: new Date("2026-08-28T00:00:00.000Z") };
          },
        }),
      },
    },
  },
}));

const { SignOutButton } = await import("@/components/session/SignOutButton");
const { RevokeSessionsButton } = await import(
  "@/components/session/RevokeSessionsButton"
);

function op(id: string): QueuedOp {
  return {
    id,
    path: "shopping.updateItem",
    input: { id: "item-1", isChecked: true },
    householdId: "h1",
    label: { key: "offline.tickedOff" },
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    attempts: 0,
  };
}

beforeEach(() => {
  signOutAction.mockClear();
  postMessage.mockClear();
  stubServiceWorker();
  purgeAll.mockClear();
  flush.mockClear();
  pending = [];
  steps = [];
  serverRefuses = false;
});

afterEach(cleanup);

describe("with nothing waiting", () => {
  it("says so rather than warning about nothing", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(screen.getByRole("group")).toHaveTextContent(/no hay nada sin enviar/i);
    // Nothing to send, so no such option is offered.
    expect(
      screen.queryByRole("button", { name: "Enviar y cerrar sesión" }),
    ).toBeAbsent();
  });

  it("takes the queue and the cached shell off the device before leaving", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Cerrar sesión" })[0] as HTMLElement,
    );

    // Both belong to the account that is leaving, and after the redirect this
    // component no longer exists to do it.
    expect(purgeAll).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("STOKY_FORGET");
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });
});

describe("with unsent changes", () => {
  beforeEach(() => {
    pending = [op("a"), op("b")];
  });

  it("says how many, and does not leave without being told to", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(screen.getByRole("group")).toHaveTextContent(
      /quedan 2 cambios sin enviar/i,
    );
    expect(signOutAction).not.toHaveBeenCalled();
    expect(purgeAll).not.toHaveBeenCalled();
  });

  it("offers to send them first", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Enviar y cerrar sesión" }),
    );

    expect(flush).toHaveBeenCalledTimes(1);
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  it("discards them only when that is the button pressed", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Cerrar sesión y descartarlos" }),
    );

    expect(flush).not.toHaveBeenCalled();
    expect(purgeAll).toHaveBeenCalledTimes(1);
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  it("lets the person stay, and changes nothing when they do", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));

    expect(signOutAction).not.toHaveBeenCalled();
    expect(purgeAll).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeAbsent();
  });
});

describe("on a shared device", () => {
  it("says why signing out matters, before it is pressed", () => {
    renderWithIntl(<SignOutButton />);

    // The kitchen tablet is the case this exists for.
    expect(screen.getByText(/si este dispositivo lo usa más gente/i)).toBeInTheDocument();
  });
});

/**
 * Ending every session, from the account's own settings.
 *
 * The server half is `integration/session.revocation.test.ts`, which proves a
 * token issued before the line stops working. What only the client can get
 * wrong is *order*, in both directions:
 *
 * - the server write must happen before anything local is discarded, because
 *   the purge is irreversible and the redirect that follows shows the sign-in
 *   screen — which reads as success even when nothing was revoked;
 * - a refusal must leave everything standing, so the person is still signed in,
 *   still holding their unsent changes, and told why.
 */

/** Open the confirmation, which every test below needs first. */
async function openRevokeConfirm(): Promise<HTMLElement> {
  await userEvent.click(
    screen.getByRole("button", { name: "Cerrar la sesión en todos los dispositivos" }),
  );
  return screen.getByRole("group", {
    name: "¿Cerrar la sesión en todos los dispositivos?",
  });
}

describe("ending every session: asking first", () => {
  it("revokes nothing when the control is merely opened", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    await openRevokeConfirm();

    expect(steps).toEqual([]);
  });

  it("says the current device is included, before the fact", async () => {
    // The redirect would otherwise be the first time anyone learned it, and a
    // control that ends the session you are looking at without warning reads
    // as a crash rather than as the thing you asked for.
    renderWithIntl(<RevokeSessionsButton />);

    expect(await openRevokeConfirm()).toHaveTextContent("Se cerrará también aquí");
  });

  it("puts the control back when the answer is no", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    await userEvent.click(within(confirm).getByRole("button", { name: "Seguir aquí" }));

    expect(steps).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Cerrar la sesión en todos los dispositivos" }),
    ).toBeInTheDocument();
  });
});

describe("ending every session: the order the work happens in", () => {
  it("revokes on the server before discarding anything local", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, cerrarlas todas" }),
    );

    expect(steps).toEqual(["revoke", "purgeQueue", "purgeShell", "signOut"]);
  });

  it("sends unsent writes before revoking, when asked to", async () => {
    pending = [op("a"), op("b")];
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Enviar y cerrarlas todas" }),
    );

    expect(steps.slice(0, 2)).toEqual(["flush", "revoke"]);
  });

  it("counts the unsent writes and offers to discard them instead", async () => {
    pending = [op("a"), op("b")];
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();

    expect(confirm).toHaveTextContent("Quedan 2 cambios sin enviar");
    expect(
      within(confirm).getByRole("button", { name: "Cerrarlas todas y descartarlos" }),
    ).toBeInTheDocument();
  });
});

describe("ending every session: when the server refuses", () => {
  beforeEach(() => {
    serverRefuses = true;
  });

  it("discards nothing and does not sign out", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, cerrarlas todas" }),
    );

    expect(steps).toEqual(["revoke"]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("says so, where a screen reader is told", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, cerrarlas todas" }),
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se han podido cerrar");
    expect(alert).toHaveTextContent("Sigues dentro");
  });

  it("leaves the control usable, so it can be tried again", async () => {
    renderWithIntl(<RevokeSessionsButton />);

    const confirm = await openRevokeConfirm();
    const commit = within(confirm).getByRole("button", { name: "Sí, cerrarlas todas" });
    await userEvent.click(commit);

    expect(commit).not.toBeDisabled();
  });
});

describe("ending every session: both catalogues", () => {
  it("carries the English copy too", async () => {
    // I18N-8's shape: a Spanish string hardcoded into the markup looks correct
    // in the Spanish render and is invisible until somebody switches.
    renderWithIntl(<RevokeSessionsButton />, { locale: "en" });

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out on every device" }),
    );

    expect(
      screen.getByRole("group", { name: "Sign out on every device?" }),
    ).toHaveTextContent("This device included");
  });
});
