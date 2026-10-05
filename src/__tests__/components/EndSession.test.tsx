import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactElement } from "react";
import { renderWithIntl as renderWithIntlOnly, type TestLocale } from "../utils/render";
import { useComposer } from "@/components/offline/Composer";
import { persistKey } from "@/lib/offline/persist";
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

/** Whether the sign-out POST fails — the shared-tablet case, a dropped Wi-Fi. */
let signOutFails = false;

/**
 * The root provider's query client, holding what the leaving account last saw.
 *
 * It lives above the dashboard and survives the redirect, so whatever is in it
 * when `signOutAction` runs is what the next person to sign in on this tab is
 * shown first.
 */
let queryClient = new QueryClient();
/** How many queries the client still held when the sign-out POST went out. */
let queriesAtSignOut: number | null = null;

function renderWithIntl(ui: ReactElement, options?: { locale?: TestLocale }) {
  return renderWithIntlOnly(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    options,
  );
}
/** What `flush()` reports as still unsent. A drain can send nothing and resolve. */
let unsentAfterFlush = 0;

const signOutAction = mock(async () => {
  steps.push("signOut");
  queriesAtSignOut = queryClient.getQueryCache().getAll().length;
  if (signOutFails) throw new Error("the sign-out POST failed");
});
const postMessage = mock((_message: string) => {
  steps.push("purgeShell");
});
const purgeAll = mock(() => {
  steps.push("purgeQueue");
});
const flush = mock(async () => {
  steps.push("flush");
  return unsentAfterFlush;
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
mock.module("@/lib/offline/queue-context", () => ({
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
  queryClient = new QueryClient();
  queryClient.setQueryData(
    [["inventory", "getStockOverview"], { type: "query" }],
    { items: [{ name: "the leaving account's milk" }] },
  );
  queriesAtSignOut = null;
  serverRefuses = false;
  signOutFails = false;
  unsentAfterFlush = 0;
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

  it("empties the queries held in memory before signing out", async () => {
    // The query client outlives the redirect. Whatever it still holds is the
    // first thing the next account on this tab is shown, and what that
    // account's persister then saves under its own key.
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Cerrar sesión" })[0] as HTMLElement,
    );

    expect(queriesAtSignOut).toBe(0);
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

/**
 * The two failures that used to be silent, found by reviewing this work rather
 * than by a suite.
 *
 * Both are about the same mistaken belief: that a promise resolving means the
 * thing it stood for happened.
 *
 * - **`flush()` resolving does not mean the queue was sent.** `drain()` returns
 *   without sending when another drain is in flight, when the session has
 *   expired, and — the everyday one — when the head is still inside its undo
 *   window. Leaving on that alone purged exactly the changes somebody had just
 *   pressed a button to send.
 * - **`signOutAction` is a POST and can reject**, after the purge has already
 *   run. Nothing can undo that, so the least the screen can do is stop claiming
 *   it worked. It used to be called as `void leave()`, which discarded the
 *   rejection entirely.
 */
describe("when sending first does not empty the queue", () => {
  beforeEach(() => {
    pending = [op("a"), op("b")];
    unsentAfterFlush = 2;
  });

  it("discards nothing and does not sign out, from the sign-out control", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Enviar y cerrar sesión" }),
    );

    expect(steps).toEqual(["flush"]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("says the changes are still here, rather than nothing", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Enviar y cerrar sesión" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("tus cambios siguen aquí");
  });

  it("leaves the controls usable, so sending can be tried again", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    const send = screen.getByRole("button", { name: "Enviar y cerrar sesión" });
    await userEvent.click(send);

    expect(send).not.toBeDisabled();
  });

  it("refuses the same way from the revoke control, and revokes nothing", async () => {
    renderWithIntl(<RevokeSessionsButton />);
    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Enviar y cerrarlas todas" }),
    );

    expect(steps).toEqual(["flush"]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se ha cerrado ninguna sesión",
    );
  });
});

describe("when signing out fails after the purge", () => {
  beforeEach(() => {
    signOutFails = true;
  });

  it("does not claim it worked, and says the data is already gone", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Cerrar sesión" })[0] as HTMLElement,
    );

    // The purge did happen — that is the point of saying so rather than
    // offering a retry that cannot put it back.
    expect(purgeAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "la sesión no se ha cerrado",
    );
  });

  it("re-enables the controls rather than sitting on a dead spinner", async () => {
    // `working` used to be cleared only when the server write refused, so any
    // failure after that point left every button — cancel included — disabled
    // with no way out but a reload.
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    const commit = screen.getAllByRole("button", {
      name: "Cerrar sesión",
    })[0] as HTMLElement;
    await userEvent.click(commit);

    expect(screen.getByRole("button", { name: "Seguir aquí" })).not.toBeDisabled();
  });

  it("tells the revoke control that the sessions *were* ended", async () => {
    // The opposite fact from a server refusal, and the one that matters most on
    // this control: saying "you are still signed in everywhere" here would tell
    // somebody their lost phone still has access when it does not.
    renderWithIntl(<RevokeSessionsButton />);
    const confirm = await openRevokeConfirm();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, cerrarlas todas" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Se han cerrado tus sesiones");
  });
});

describe("the persisted reads, which nothing was watching", () => {
  /**
   * The third of the hook's three purges, and the one no assertion could see.
   *
   * The ordering test enumerates `revoke`, `purgeQueue`, `purgeShell` and
   * `signOut` — because those are the mocked seams — while
   * `forgetPersistedReads` is deliberately *not* mocked, for the D50 reason the
   * top of this file gives. The consequence was that deleting that line from
   * `useEndSession` left every gate green, and what it deletes is one account's
   * cached reads staying on a shared device after they sign out.
   *
   * Asserted through its real effect rather than a spy, which is also the
   * stronger claim: the key is gone from `localStorage`, not merely that a
   * function of that name was entered.
   */
  /**
   * Whose key, asked at run time rather than assumed.
   *
   * `TEST_COMPOSER.userId` is the answer only when this file runs alone.
   * `AddStockLayers.test.tsx` mocks `@/components/offline/Composer` for the
   * whole process (D50), so in a full run the hook sees that file's `"u1"` and
   * clears a different key — this test passed in isolation and failed in the
   * suite until it stopped guessing. Measured, not reasoned about.
   */
  function effectiveUserId(): string {
    let seen = "";
    function Probe(): null {
      seen = useComposer().userId;
      return null;
    }
    renderWithIntl(<Probe />);
    cleanup();
    return seen;
  }

  it("takes this account's cached reads off the device", async () => {
    const key = persistKey(effectiveUserId());
    window.localStorage.setItem(key, JSON.stringify({ anything: true }));
    expect(window.localStorage.getItem(key)).not.toBeNull();

    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Cerrar sesión" })[0] as HTMLElement,
    );

    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("leaves them alone when the sequence refuses", async () => {
    // The other half: a refusal must discard nothing, and this purge is part of
    // "nothing".
    pending = [op("a")];
    unsentAfterFlush = 1;
    const key = persistKey(effectiveUserId());
    window.localStorage.setItem(key, JSON.stringify({ anything: true }));

    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Enviar y cerrar sesión" }),
    );

    expect(window.localStorage.getItem(key)).not.toBeNull();
    window.localStorage.removeItem(key);
  });
});

describe("where focus goes when the question appears", () => {
  /**
   * Opening the confirmation unmounts the button that was focused. Without
   * moving focus deliberately it lands on `<body>`: a keyboard user loses their
   * place mid-page, and a screen reader is told nothing — the panel that just
   * asked whether to end every session is one nobody announced.
   */
  it("moves to the panel that is now asking, on the revoke control", async () => {
    renderWithIntl(<RevokeSessionsButton />);
    const confirm = await openRevokeConfirm();

    expect(document.activeElement).toBe(confirm);
  });

  it("moves to the panel on the sign-out control too", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "¿Cerrar sesión?" }),
    );
  });
});
