import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * The control that did not exist until now.
 *
 * `signOut` was exported and called nowhere, so `queue.purgeAll` and the
 * cached shell's purge were security controls nothing could fire. What matters
 * here is the order and the asking: a queue with unsent changes is somebody's
 * shopping, and signing out silently would delete it.
 */

const signOutAction = mock(async () => {});
const postMessage = mock((_message: string) => {});
const purgeAll = mock(() => {});
const flush = mock(async () => {});

let pending: QueuedOp[] = [];

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

const { SignOutButton } = await import("@/components/session/SignOutButton");

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
    ).toBeNull();
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
    expect(screen.queryByRole("group")).toBeNull();
  });
});

describe("on a shared device", () => {
  it("says why signing out matters, before it is pressed", () => {
    renderWithIntl(<SignOutButton />);

    // The kitchen tablet is the case this exists for.
    expect(screen.getByText(/si este dispositivo lo usa más gente/i)).toBeInTheDocument();
  });
});
