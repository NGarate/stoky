import "../setup/matchers";
import { TRPCClientError } from "@trpc/client";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactElement } from "react";
import { renderWithIntl as renderWithIntlOnly, type TestLocale } from "../utils/render";
import { useComposer } from "@/components/offline/Composer";
import { persistKey } from "@/lib/offline/persist";
import type { FailedOp, QueuedOp } from "@/lib/offline/queue";

/**
 * The three controls that end a session, in one file because they share a hook.
 *
 * `SignOutButton` ends this device's visit, and `DeviceList` ends this
 * device's session, every other or every one, after the password. Both run
 * the same purge sequence — `useEndSession` — and that is also why their
 * tests live together. `ChangePasswordForm` used to be the third: it ended
 * every session, this one's included. Since D144 it keeps this device signed
 * in and purges nothing, and its tests stay here to prove exactly that
 * against the same spies. The people page's "Ver sus sesiones" (D145) is
 * here for the same reason: it needs the tRPC mock, and there is one. The
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
/** Changes the server refused, waiting for a person. `purgeAll` takes these too. */
let failedOps: FailedOp[] = [];
/** What `auth.endSessions` answers, per test: null accepts. */
let endRefusal: unknown = null;
/** What each `auth.endSessions` call was sent. */
let endInputs: unknown[] = [];
/** What `auth.changePassword` answers, per test: null accepts. */
let changeRefusal: unknown = null;
/** What each password change was sent. */
let changeInputs: unknown[] = [];

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
    state: { pending, failed: failedOps, status: "idle", full: false },
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
/** The account's sessions, as `auth.listSessions` answers them: this one and a phone. */
const DEVICES = [
  {
    id: "s-here",
    device: { browser: "Firefox", os: "Linux" },
    screen: null,
    signedInAt: new Date("2026-10-15T08:00:00.000Z"),
    lastUsedAt: new Date("2026-10-15T09:00:00.000Z"),
    expiresAt: new Date("2026-10-15T09:15:00.000Z"),
    remembered: false,
    current: true,
  },
  {
    id: "s-phone",
    device: { browser: "Chrome", os: "Android" },
    screen: null,
    signedInAt: new Date("2026-10-14T08:00:00.000Z"),
    lastUsedAt: new Date("2026-10-14T21:00:00.000Z"),
    expiresAt: new Date("2026-10-15T08:00:00.000Z"),
    remembered: false,
    current: false,
  },
];
/** What the list was asked to read again. */
let invalidated = 0;

/**
 * The household on `/settings/people`: the admin signed in, Ana, Bea, who has
 * no two-step verification, and Olga, an owner who has it.
 */
const MEMBERS = [
  { id: "u-olga", name: "Olga", email: "olga@example.com", role: "OWNER", twoFactorEnabled: true },
  { id: "u-alba", name: "Alba", email: "alba@example.com", role: "ADMIN", twoFactorEnabled: true },
  { id: "u-ana", name: "Ana", email: "ana@example.com", role: "KITCHEN", twoFactorEnabled: true },
  { id: "u-bea", name: "Bea", email: "bea@example.com", role: "MEMBER", twoFactorEnabled: false },
];
/** Ana's sessions, as `household.memberSessions` answers them. */
const ANA_SESSIONS = [
  {
    id: "m-tablet",
    device: { browser: "Firefox", os: "Android" },
    screen: "KITCHEN",
    signedInAt: new Date("2026-10-10T08:00:00.000Z"),
    lastUsedAt: new Date("2026-10-15T08:30:00.000Z"),
    expiresAt: new Date("2027-01-13T08:30:00.000Z"),
    remembered: true,
  },
  {
    id: "m-phone",
    device: { browser: "Chrome", os: "Android" },
    screen: null,
    signedInAt: new Date("2026-10-15T07:00:00.000Z"),
    lastUsedAt: new Date("2026-10-15T07:10:00.000Z"),
    expiresAt: new Date("2026-10-15T07:25:00.000Z"),
    remembered: false,
  },
];
/** Whose sessions the people page asked for, last; null when it asked for none. */
let memberSessionsFor: unknown = null;
/** What each `household.endMemberSessions` call was sent. */
let memberEndInputs: unknown[] = [];
/** What `household.endMemberSessions` answers, per test: null accepts. */
let memberEndRefusal: unknown = null;
/** The caller's role, as `auth.me` answers it on the people page. */
let meRole = "ADMIN";
/** What each `household.endHouseholdSessions` call was sent. */
let householdEndInputs: unknown[] = [];
/** What `household.endHouseholdSessions` answers, per test: null accepts. */
let householdEndRefusal: unknown = null;
/** What each `household.removeMemberTwoFactor` call was sent. */
let twoFactorRemovals: unknown[] = [];
/** What `household.removeMemberTwoFactor` answers, per test: null accepts. */
let twoFactorRemovalRefusal: unknown = null;
/** How many times the people page asked for the member list again. */
let membersInvalidated = 0;
/** The member list as the next read answers it. */
let members = MEMBERS;
/** Whose two-step verification the next read of the list says is off. */
let twoFactorOffOnRead: string[] = [];
/** The people page's other mutations, which these tests never press. */
const untouched = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      auth: { listSessions: { invalidate: async () => void invalidated++ } },
      household: {
        members: {
          invalidate: async () => {
            membersInvalidated++;
            members = members.map((member) =>
              twoFactorOffOnRead.includes(member.id) ? { ...member, twoFactorEnabled: false } : member,
            );
          },
        },
      },
    }),
    household: {
      members: {
        useQuery: () => ({ data: members, error: null, fetchStatus: "idle", isPending: false, refetch: async () => {} }),
      },
      memberSessions: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          memberSessionsFor = options?.enabled ? input : null;
          return {
            data: options?.enabled ? ANA_SESSIONS : undefined,
            error: null,
            refetch: async () => {},
          };
        },
      },
      endMemberSessions: {
        useMutation: () => ({
          mutateAsync: async (input: { sessionId?: string }) => {
            memberEndInputs.push(input);
            if (memberEndRefusal !== null) throw memberEndRefusal;
            return { ended: input.sessionId ? 1 : 2 };
          },
        }),
      },
      endHouseholdSessions: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            steps.push("endHouseholdSessions");
            householdEndInputs.push(input);
            if (householdEndRefusal !== null) throw householdEndRefusal;
            return { ended: 4 };
          },
        }),
      },
      removeMemberTwoFactor: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            twoFactorRemovals.push(input);
            if (twoFactorRemovalRefusal !== null) throw twoFactorRemovalRefusal;
            return { ended: 2 };
          },
        }),
      },
      addMember: { useMutation: untouched },
      updateRole: { useMutation: untouched },
      resetMemberPassword: { useMutation: untouched },
      removeMember: { useMutation: untouched },
    },
    auth: {
      me: { useQuery: () => ({ data: { id: "u-alba", role: meRole } }) },
      listSessions: {
        useQuery: () => ({ data: DEVICES, error: null, fetchStatus: "idle", refetch: async () => {} }),
      },
      endSessions: {
        useMutation: () => ({
          mutateAsync: async (input: { scope: string; sessionId?: string }) => {
            steps.push("endSessions");
            endInputs.push(input);
            if (endRefusal !== null) throw endRefusal;
            return {
              ended: input.scope === "one" ? 1 : 2,
              includedCurrent:
                input.scope === "all" || (input.scope === "one" && input.sessionId === "s-here"),
            };
          },
        }),
      },
      changePassword: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            steps.push("changePassword");
            changeInputs.push(input);
            if (changeRefusal !== null) throw changeRefusal;
            return { success: true };
          },
        }),
      },
    },
  },
}));

const { SignOutButton } = await import("@/components/session/SignOutButton");
const { DeviceList } = await import("@/components/session/DeviceList");
const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { ChangePasswordForm } = await import("@/components/session/ChangePasswordForm");
const { default: PeoplePage } = await import("@/app/(dashboard)/settings/people/page");
const {
  PASSWORD_CONTAINS_IDENTITY_MESSAGE,
  WRONG_CURRENT_PASSWORD_MESSAGE,
} = await import("@/lib/validations/password");

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
  failedOps = [];
  steps = [];
  queryClient = new QueryClient();
  queryClient.setQueryData(
    [["inventory", "getStockOverview"], { type: "query" }],
    { items: [{ name: "the leaving account's milk" }] },
  );
  queriesAtSignOut = null;
  endRefusal = null;
  endInputs = [];
  invalidated = 0;
  changeRefusal = null;
  changeInputs = [];
  signOutFails = false;
  unsentAfterFlush = 0;
  memberSessionsFor = null;
  memberEndInputs = [];
  memberEndRefusal = null;
  meRole = "ADMIN";
  householdEndInputs = [];
  householdEndRefusal = null;
  twoFactorRemovals = [];
  twoFactorRemovalRefusal = null;
  membersInvalidated = 0;
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

  it("draws discarding them as the destructive action it is", async () => {
    // It deletes somebody's unsent changes, and was drawn in the same filled
    // primary as "Enviar y cerrar sesión", which keeps them.
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      screen.getByRole("button", { name: "Cerrar sesión y descartarlos" }).className,
    ).toContain("bg-destructive");
  });

  it("draws the same on the control that ends every session", async () => {
    renderDevices();
    const confirm = await openEnd("Cerrar todas");

    expect(
      within(confirm).getByRole("button", { name: "Cerrar y descartarlos" }).className,
    ).toContain("bg-destructive");
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

describe("with changes the server refused", () => {
  /**
   * `purgeAll` empties `failed` as well as `pending`, and the panel counted
   * only `pending` — so somebody with three changes to reconcile was told
   * "No hay nada sin enviar" and then had them deleted.
   */
  beforeEach(() => {
    failedOps = ["a", "b", "c"].map((id) => ({
      ...op(id),
      reason: "needs-reconciliation" as const,
    }));
  });

  it("does not say there is nothing to lose", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    const panel = screen.getByRole("group");
    expect(panel).not.toHaveTextContent(/no hay nada sin enviar/i);
    expect(panel).toHaveTextContent(/hay 3 cambios que el servidor no aceptó/i);
  });

  it("names leaving for what it does to them, and offers to look first", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      screen.getByRole("button", { name: "Cerrar sesión y descartarlos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver los cambios sin guardar" }),
    ).toHaveAttribute("href", "/settings/unsaved");
  });

  it("does not offer to send them, which cannot help", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      screen.queryByRole("button", { name: "Enviar y cerrar sesión" }),
    ).toBeAbsent();
  });

  it("says the same on the control that ends every session", async () => {
    renderDevices();

    const confirm = await openEnd("Cerrar todas");

    expect(confirm).toHaveTextContent(/hay 3 cambios que el servidor no aceptó/i);
    // Sending first cannot help them, so leaving is drawn as what it does.
    expect(
      within(confirm).getByRole("button", { name: "Cerrar todas" }).className,
    ).toContain("bg-destructive");
    expect(
      within(confirm).getByRole("link", { name: "Ver los cambios sin guardar" }),
    ).toHaveAttribute("href", "/settings/unsaved");
  });

  it("carries the English copy too", async () => {
    renderWithIntl(<SignOutButton />, { locale: "en" });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(screen.getByRole("group")).toHaveTextContent(
      /3 changes the server refused will be deleted/i,
    );
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
 * Ending sessions from the devices list, `/settings/security` (D143).
 *
 * The server half is `integration/session.revocation.test.ts`, which proves a
 * cookie stops being read once its row is deleted. What only the client can
 * get wrong is *order* and *reach*:
 *
 * - when this device is among the sessions ended, the server write must
 *   happen before anything local is discarded, because the purge is
 *   irreversible and the redirect that follows shows the sign-in screen —
 *   which reads as success even when nothing was ended;
 * - when it is not, nothing local may be discarded at all: ending the phone
 *   left on a train must not sign this tablet out or empty its queue;
 * - a refusal must leave everything standing, so the person is still signed
 *   in, still holding their unsent changes, and told why.
 */

function renderDevices(options?: { locale?: TestLocale }) {
  return renderWithIntl(
    <SnackbarProvider>
      <DeviceList />
    </SnackbarProvider>,
    options,
  );
}

/** Open the dialog from one of the list's controls. */
async function openEnd(name: string | RegExp): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("dialog");
}

/** Type the password into the open dialog and press one of its buttons. */
async function confirmWith(
  dialog: HTMLElement,
  button: string,
  password = "cocina despensa nevera",
): Promise<void> {
  await userEvent.type(within(dialog).getByLabelText("Tu contraseña"), password);
  await userEvent.click(within(dialog).getByRole("button", { name: button }));
}

describe("ending sessions: asking first", () => {
  it("ends nothing when the dialog is merely opened", async () => {
    renderDevices();

    await openEnd("Cerrar todas");

    expect(steps).toEqual([]);
  });

  it("says the current device is included, before the fact", async () => {
    // The redirect would otherwise be the first time anyone learned it, and a
    // control that ends the session you are looking at without warning reads
    // as a crash rather than as the thing you asked for.
    renderDevices();

    expect(await openEnd("Cerrar todas")).toHaveTextContent("también en este");
  });

  it("puts everything back when the answer is no", async () => {
    renderDevices();

    const dialog = await openEnd("Cerrar todas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(steps).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeAbsent();
  });
});

describe("ending sessions: the order the work happens in", () => {
  it("ends every session on the server before discarding anything local", async () => {
    renderDevices();

    await confirmWith(await openEnd("Cerrar todas"), "Cerrar todas");

    expect(steps).toEqual(["endSessions", "purgeQueue", "purgeShell", "signOut"]);
    expect(endInputs).toEqual([{ currentPassword: "cocina despensa nevera", scope: "all" }]);
  });

  it("leaves the same way when the session ended is this one", async () => {
    renderDevices();

    await confirmWith(
      await openEnd(/^Cerrar esta sesión: Firefox en Linux$/),
      "Cerrar esta sesión",
    );

    expect(steps).toEqual(["endSessions", "purgeQueue", "purgeShell", "signOut"]);
    expect(endInputs).toEqual([
      { currentPassword: "cocina despensa nevera", scope: "one", sessionId: "s-here" },
    ]);
  });

  it("purges nothing when ending the others, and reads the list again", async () => {
    // This device stays signed in, so its queue, its saved reads and its
    // cached shell are still its own.
    renderDevices();

    await confirmWith(await openEnd("Cerrar las demás"), "Cerrar las demás");

    expect(steps).toEqual(["endSessions"]);
    expect(endInputs).toEqual([{ currentPassword: "cocina despensa nevera", scope: "others" }]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
    expect(invalidated).toBe(1);
    expect(screen.queryByRole("dialog")).toBeAbsent();
  });

  it("purges nothing when ending another device's one", async () => {
    renderDevices();

    await confirmWith(
      await openEnd(/^Cerrar esta sesión: Chrome en Android$/),
      "Cerrar esta sesión",
    );

    expect(steps).toEqual(["endSessions"]);
    expect(endInputs).toEqual([
      { currentPassword: "cocina despensa nevera", scope: "one", sessionId: "s-phone" },
    ]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("sends unsent writes before ending, when asked to", async () => {
    pending = [op("a"), op("b")];
    renderDevices();

    await confirmWith(await openEnd("Cerrar todas"), "Enviar y cerrar");

    expect(steps.slice(0, 2)).toEqual(["flush", "endSessions"]);
  });

  it("counts the unsent writes and offers to discard them instead", async () => {
    pending = [op("a"), op("b")];
    renderDevices();

    const dialog = await openEnd("Cerrar todas");

    expect(dialog).toHaveTextContent("Quedan 2 cambios sin enviar");
    expect(
      within(dialog).getByRole("button", { name: "Cerrar y descartarlos" }),
    ).toBeInTheDocument();
  });

  it("does not mention unsent writes when ending only the others", async () => {
    // They stay on this device, which stays signed in.
    pending = [op("a"), op("b")];
    renderDevices();

    const dialog = await openEnd("Cerrar las demás");

    expect(dialog).not.toHaveTextContent("sin enviar");
    expect(within(dialog).getByRole("button", { name: "Cerrar las demás" })).toBeInTheDocument();
  });
});

describe("ending sessions: when the server refuses", () => {
  beforeEach(() => {
    endRefusal = trpcRefusal("BAD_REQUEST", WRONG_CURRENT_PASSWORD_MESSAGE);
  });

  it("discards nothing and does not sign out", async () => {
    renderDevices();

    await confirmWith(await openEnd("Cerrar todas"), "Cerrar todas");

    expect(steps).toEqual(["endSessions"]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("says which refusal it was, where a screen reader is told", async () => {
    renderDevices();

    await confirmWith(await openEnd("Cerrar todas"), "Cerrar todas");

    expect(screen.getByRole("alert")).toHaveTextContent("La contraseña no es correcta");
    expect(screen.getByLabelText("Tu contraseña")).toHaveAttribute("aria-invalid", "true");
  });

  it("says a spent budget as one, not as a wrong password", async () => {
    endRefusal = trpcRefusal("TOO_MANY_REQUESTS", "Too many attempts");
    renderDevices();

    await confirmWith(await openEnd("Cerrar las demás"), "Cerrar las demás");

    expect(screen.getByRole("alert")).toHaveTextContent("Demasiados intentos");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaves the dialog usable, so it can be tried again", async () => {
    renderDevices();

    const dialog = await openEnd("Cerrar todas");
    await confirmWith(dialog, "Cerrar todas");

    expect(within(dialog).getByRole("button", { name: "Cerrar todas" })).not.toBeDisabled();
  });
});

describe("ending sessions: both catalogues", () => {
  it("carries the English copy too", async () => {
    // I18N-8's shape: a Spanish string hardcoded into the markup looks correct
    // in the Spanish render and is invisible until somebody switches.
    renderDevices({ locale: "en" });

    const dialog = await openEnd("Sign out all");

    expect(dialog).toHaveAccessibleName("Sign out every session?");
    expect(dialog).toHaveTextContent("this one too");
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

  it("refuses the same way from the devices list, and ends nothing", async () => {
    renderDevices();
    await confirmWith(await openEnd("Cerrar todas"), "Enviar y cerrar");

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

  it("tells the devices list that the sessions *were* ended", async () => {
    // The opposite fact from a server refusal, and the one that matters most on
    // this control: saying "you are still signed in everywhere" here would tell
    // somebody their lost phone still has access when it does not.
    renderDevices();
    await confirmWith(await openEnd("Cerrar todas"), "Cerrar todas");

    expect(screen.getByRole("alert")).toHaveTextContent("Se han cerrado las sesiones");
  });

  it("says only this session was ended, when that is the one asked for", async () => {
    // "The sessions were ended" here would tell somebody their other devices
    // were signed out too, when every one of them is still live.
    renderDevices();
    await confirmWith(
      await openEnd(/^Cerrar esta sesión: Firefox en Linux$/),
      "Cerrar esta sesión",
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Se ha cerrado la sesión en el servidor");
    expect(alert).not.toHaveTextContent("las sesiones");
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
  it("moves to the dialog that is now asking, on the devices list", async () => {
    renderDevices();
    const dialog = await openEnd("Cerrar todas");

    expect(document.activeElement).toBe(dialog);
  });

  it("moves to the panel on the sign-out control too", async () => {
    renderWithIntl(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "¿Cerrar sesión?" }),
    );
  });
});

/**
 * Changing the password, which ends every *other* session and keeps this one
 * (PROGRESS D144).
 *
 * The server half is `integration/auth.flow.test.ts` ("Changing your own
 * password"), and the cookie arriving is `e2e/password-change.spec.ts`. What
 * only the form can get wrong is what it does here: nothing is purged and
 * nobody is signed out — the queue and the saved reads are the same person's,
 * who is still here — and *which* refusal it was is said: a wrong current
 * password told as "try again" sends somebody round the form retyping the
 * wrong thing.
 */

/** A refusal shaped the way tRPC delivers one to the browser. */
function trpcRefusal(code: string, message: string): TRPCClientError<never> {
  const error = new TRPCClientError<never>(message);
  Object.defineProperty(error, "data", { value: { code } });
  return error;
}

const CURRENT = "cocina despensa nevera";
const NEXT = "tarro de garbanzos azul";

/** Fill the three fields and submit. */
async function changePassword(
  fields: { current?: string; next?: string; again?: string } = {},
): Promise<void> {
  const { current = CURRENT, next = NEXT, again = next } = fields;
  if (current) await userEvent.type(screen.getByLabelText("Contraseña actual"), current);
  if (next) await userEvent.type(screen.getByLabelText("Contraseña nueva"), next);
  if (again) {
    await userEvent.type(screen.getByLabelText("Repite la contraseña nueva"), again);
  }
  await userEvent.click(screen.getByRole("button", { name: "Cambiar la contraseña" }));
}

describe("changing the password", () => {
  it("says before the fact that this device stays signed in", () => {
    renderWithIntl(<ChangePasswordForm />);

    // Attached to the button, so it is heard with the button's name rather
    // than discovered afterwards.
    expect(
      screen.getByRole("button", { name: "Cambiar la contraseña" }),
    ).toHaveAccessibleDescription(
      "Se cerrarán las sesiones de tus otros dispositivos; este sigue abierto.",
    );
  });

  it("attaches help to every field", () => {
    // WCAG 3.3.5 (AAA), which `e2e/a11y-aaa.spec.ts` checks per route; the
    // first version of this form left two fields without any and it went red.
    renderWithIntl(<ChangePasswordForm />);

    for (const label of [
      "Contraseña actual",
      "Contraseña nueva",
      "Repite la contraseña nueva",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(/\S/);
    }
  });

  it("reports everything the browser can see at once, and sends nothing", async () => {
    renderWithIntl(<ChangePasswordForm />);

    await changePassword({ current: "", next: "corta", again: "otra" });

    const summary = screen.getByTestId("form-error-summary");
    expect(summary).toHaveTextContent("No se ha cambiado la contraseña");
    expect(summary).toHaveTextContent("Escribe tu contraseña actual.");
    expect(summary).toHaveTextContent("al menos 12 caracteres");
    expect(summary).toHaveTextContent("no coinciden");
    // Focused, so the reasons are read where the submit failed.
    expect(document.activeElement).toBe(summary);
    expect(steps).toEqual([]);
  });

  it("changes it on the server and discards nothing here", async () => {
    // The old form signed out after a change: the queue, the saved reads and
    // the cached shell went, and the person was sent to /login. The session
    // is kept now, so any of those would be throwing away the same person's
    // shopping for nothing.
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(changeInputs).toEqual([{ currentPassword: CURRENT, newPassword: NEXT }]);
    expect(steps).toEqual(["changePassword"]);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("says it is done, in place, and empties the fields", async () => {
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    const status = await screen.findByText("Contraseña cambiada");
    expect(status.closest('[role="status"]')).toHaveTextContent(
      "Se han cerrado las sesiones de tus otros dispositivos",
    );
    expect(screen.queryByTestId("form-error-summary")).toBeAbsent();
    for (const label of [
      "Contraseña actual",
      "Contraseña nueva",
      "Repite la contraseña nueva",
    ]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("has the devices list read again, since the other sessions are gone", async () => {
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(invalidated).toBe(1);
  });

  it("does not send waiting changes first, because nothing is lost", async () => {
    // The old form flushed the queue before changing, and refused to change
    // when it could not: the sign-out after it would have deleted them. With
    // the session kept, they go when they would have gone anyway.
    pending = [op("a"), op("b")];
    renderWithIntl(<ChangePasswordForm />);

    expect(screen.queryByText(/se enviarán antes de cambiarla/i)).toBeAbsent();
    await changePassword();

    expect(steps).toEqual(["changePassword"]);
    expect(flush).not.toHaveBeenCalled();
  });

  it("names a wrong current password, and leaves the fields as typed", async () => {
    changeRefusal = trpcRefusal("BAD_REQUEST", WRONG_CURRENT_PASSWORD_MESSAGE);
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(screen.getByTestId("form-error-summary")).toHaveTextContent(
      "La contraseña actual no es correcta.",
    );
    expect(screen.getByLabelText("Contraseña actual")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Contraseña nueva")).toHaveValue(NEXT);
    expect(screen.queryByText("Contraseña cambiada")).toBeAbsent();
    expect(invalidated).toBe(0);
    expect(screen.getByRole("button", { name: "Cambiar la contraseña" })).not.toBeDisabled();
  });

  it("names a new password built from the person's name or address", async () => {
    changeRefusal = trpcRefusal("BAD_REQUEST", PASSWORD_CONTAINS_IDENTITY_MESSAGE);
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(screen.getByTestId("form-error-summary")).toHaveTextContent(
      "contiene tu nombre o tu correo",
    );
  });

  it("names a new password the policy refuses", async () => {
    // What the input schema answers: BAD_REQUEST with the Zod issues as the
    // message, neither of the two named refusals above.
    changeRefusal = trpcRefusal("BAD_REQUEST", '[{"path":["newPassword"]}]');
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(screen.getByTestId("form-error-summary")).toHaveTextContent(
      "demasiado fácil de adivinar",
    );
  });

  it("says to wait when the limit is spent", async () => {
    changeRefusal = trpcRefusal("TOO_MANY_REQUESTS", "Too many attempts at the password.");
    renderWithIntl(<ChangePasswordForm />);

    await changePassword();

    expect(screen.getByTestId("form-error-summary")).toHaveTextContent(
      "Espera unos minutos",
    );
  });

  it("carries the English copy too", async () => {
    renderWithIntl(<ChangePasswordForm />, { locale: "en" });

    expect(
      screen.getByRole("button", { name: "Change the password" }),
    ).toHaveAccessibleDescription(/this one stays signed in/);
    expect(screen.getByLabelText("Repeat the new password")).toBeInTheDocument();
  });
});

/**
 * An admin ending a member's sessions, on `/settings/people` (ASVS 5.0.0
 * 7.4.5, D145).
 *
 * The real page, with the server mocked: here because the tRPC mock is
 * process-wide (D50), and this file already holds it. The server half — the
 * guards, the scoping, the log line — is `integration/session.revocation
 * .test.ts`'s; `components/PeopleRoles.test.tsx` holds the dialog on its own.
 * What only the page can get wrong is whose row offers it and what it sends.
 */
describe("a member's sessions, from the people page", () => {
  function renderPeople() {
    return renderWithIntl(
      <SnackbarProvider>
        <PeoplePage />
      </SnackbarProvider>,
      { locale: "es" },
    );
  }

  const rowOf = (name: string) =>
    screen.getAllByRole("listitem").find((item) => within(item).queryByText(name, { exact: true }));

  it("is offered on another member's row, beside removing them, and not on the admin's own", () => {
    renderPeople();

    const ana = rowOf("Ana");
    const alba = rowOf("Alba");
    if (!ana || !alba) throw new Error("the members are not listed");
    // "They left" and "their phone was stolen" are different acts, both offered.
    expect(within(ana).getByRole("button", { name: "Ver sus sesiones" })).toBeInTheDocument();
    expect(within(ana).getByRole("button", { name: "Quitar del hogar" })).toBeInTheDocument();
    // Your own are in Seguridad y acceso, behind your password.
    expect(within(alba).queryByRole("button", { name: "Ver sus sesiones" })).toBeNull();
    // Nothing is read until somebody asks.
    expect(memberSessionsFor).toBeNull();
  });

  it("opens a dialog named for the member, listing their sessions by device", async () => {
    renderPeople();

    const ana = rowOf("Ana");
    if (!ana) throw new Error("Ana is not listed");
    await userEvent.click(within(ana).getByRole("button", { name: "Ver sus sesiones" }));

    const dialog = screen.getByRole("dialog", { name: "Sesiones de Ana" });
    expect(memberSessionsFor).toEqual({ userId: "u-ana" });
    expect(within(dialog).getByText("Pantalla de cocina")).toBeInTheDocument();
    expect(within(dialog).getByText("Chrome en Android")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });

  it("ends the one chosen, by its id, says so, and stays open", async () => {
    renderPeople();
    const ana = rowOf("Ana");
    if (!ana) throw new Error("Ana is not listed");
    await userEvent.click(within(ana).getByRole("button", { name: "Ver sus sesiones" }));
    const dialog = screen.getByRole("dialog", { name: "Sesiones de Ana" });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cerrar esta: Pantalla de cocina" }),
    );

    expect(memberEndInputs).toEqual([{ userId: "u-ana", sessionId: "m-tablet" }]);
    expect(
      await screen.findByText("Se ha cerrado la sesión de Ana en Pantalla de cocina."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sesiones de Ana" })).toBeInTheDocument();
  });

  it("ends every one with no session named, and closes", async () => {
    renderPeople();
    const ana = rowOf("Ana");
    if (!ana) throw new Error("Ana is not listed");
    await userEvent.click(within(ana).getByRole("button", { name: "Ver sus sesiones" }));
    const dialog = screen.getByRole("dialog", { name: "Sesiones de Ana" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar todas sus sesiones" }));

    expect(memberEndInputs).toEqual([{ userId: "u-ana" }]);
    expect(await screen.findByText("Se han cerrado las sesiones de Ana.")).toBeInTheDocument();
    // `hidden: true`, measured: with the dialog left open, the plain query
    // still answered null here under happy-dom, so it could not see the
    // dialog fail to close.
    expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0);
  });

  it("says an owner's are an owner's to end, in the dialog, and ends nothing", async () => {
    const refused = new TRPCClientError<never>("Only an owner may change who owns this household");
    Object.defineProperty(refused, "data", { value: { code: "FORBIDDEN" } });
    memberEndRefusal = refused;
    renderPeople();
    const ana = rowOf("Ana");
    if (!ana) throw new Error("Ana is not listed");
    await userEvent.click(within(ana).getByRole("button", { name: "Ver sus sesiones" }));
    const dialog = screen.getByRole("dialog", { name: "Sesiones de Ana" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar todas sus sesiones" }));

    expect(
      await within(dialog).findByText("Solo una persona propietaria puede cerrar las sesiones de otra."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sesiones de Ana" })).toBeInTheDocument();
  });

  it("says before a removal that it signs the member out on every device", async () => {
    // ASVS 5.0.0 7.4.2, D146: removing somebody now ends their sessions too,
    // and the question is the last place the admin can learn that.
    renderPeople();
    const ana = rowOf("Ana");
    if (!ana) throw new Error("Ana is not listed");

    await userEvent.click(within(ana).getByRole("button", { name: "Quitar del hogar" }));

    expect(
      screen.getByRole("group", { name: "¿Quitar a Ana del hogar?" }),
    ).toHaveTextContent("se cierran sus sesiones en todos sus dispositivos");
  });
});

/**
 * **Cerrar todas las sesiones del hogar**, an owner's alone (D147).
 *
 * The server half — owners only, the password, the household's reach — is
 * `integration/session.revocation.test.ts`'s. What only the page can get
 * wrong is who is offered it, and that it is the sign-out sequence: it ends
 * this device's session too, so the server answers before anything local is
 * discarded, and a refusal discards nothing.
 */
describe("every session in the household, from the people page", () => {
  function renderPeople() {
    return renderWithIntl(
      <SnackbarProvider>
        <PeoplePage />
      </SnackbarProvider>,
      { locale: "es" },
    );
  }

  const TITLE = "Cerrar todas las sesiones del hogar";

  async function openHouseholdEnd(): Promise<HTMLElement> {
    const section = screen.getByRole("region", { name: TITLE });
    await userEvent.click(within(section).getByRole("button", { name: "Cerrar todas las sesiones" }));
    return screen.getByRole("dialog", { name: "¿Cerrar todas las sesiones del hogar?" });
  }

  it("is offered to an owner", () => {
    meRole = "OWNER";
    renderPeople();

    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
  });

  it("is not offered to an admin, who could not use it", () => {
    meRole = "ADMIN";
    renderPeople();

    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar todas las sesiones" })).toBeNull();
  });

  it("says before the fact that the owner is signed out too, and ends nothing on opening", async () => {
    meRole = "OWNER";
    renderPeople();

    expect(await openHouseholdEnd()).toHaveTextContent("también la tuya en este");
    expect(steps).toEqual([]);
  });

  it("ends them on the server with the password, then leaves this device", async () => {
    meRole = "OWNER";
    renderPeople();

    await confirmWith(await openHouseholdEnd(), "Cerrar todas las sesiones");

    expect(householdEndInputs).toEqual([{ currentPassword: "cocina despensa nevera" }]);
    expect(steps).toEqual(["endHouseholdSessions", "purgeQueue", "purgeShell", "signOut"]);
  });

  it("discards nothing on a wrong password, and says so in the dialog", async () => {
    meRole = "OWNER";
    householdEndRefusal = trpcRefusal("BAD_REQUEST", WRONG_CURRENT_PASSWORD_MESSAGE);
    renderPeople();

    const dialog = await openHouseholdEnd();
    await confirmWith(dialog, "Cerrar todas las sesiones");

    expect(steps).toEqual(["endHouseholdSessions"]);
    expect(signOutAction).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("La contraseña no es correcta");
  });

  it("says an owner's act is an owner's, when the role changed under the page", async () => {
    meRole = "OWNER";
    householdEndRefusal = trpcRefusal("FORBIDDEN", "Only an owner may end every session in the household");
    renderPeople();

    const dialog = await openHouseholdEnd();
    await confirmWith(dialog, "Cerrar todas las sesiones");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Solo una persona propietaria puede cerrar todas las sesiones del hogar.",
    );
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("offers to send unsent changes first", async () => {
    meRole = "OWNER";
    pending = [op("a")];
    renderPeople();

    const dialog = await openHouseholdEnd();
    await confirmWith(dialog, "Enviar y cerrar");

    expect(steps.slice(0, 2)).toEqual(["flush", "endHouseholdSessions"]);
  });
});

/**
 * **Quitar la verificación en dos pasos**, an admin's way back for a member
 * who has lost their authenticator (D150).
 *
 * The server half — the admin's password, the household, owners on owners,
 * the sessions ended — is `integration/household.two-factor-removal.test.ts`'s.
 * What only the page can get wrong is who is offered it, that it asks for the
 * password and says what it costs first, and how a refusal is worded.
 */
describe("a member's two-step verification, from the people page", () => {
  function renderPeople() {
    return renderWithIntl(
      <SnackbarProvider>
        <PeoplePage />
      </SnackbarProvider>,
      { locale: "es" },
    );
  }

  const BUTTON = "Quitar la verificación en dos pasos";

  function rowOf(name: string): HTMLElement {
    const row = screen
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText(name, { exact: true }));
    if (!row) throw new Error(`${name} is not listed`);
    return row;
  }

  async function openRemoval(name: string): Promise<HTMLElement> {
    await userEvent.click(within(rowOf(name)).getByRole("button", { name: BUTTON }));
    return screen.getByRole("dialog", { name: `¿Quitar la verificación en dos pasos de ${name}?` });
  }

  it("says on every row whether it is on, in words", () => {
    renderPeople();

    expect(rowOf("Ana")).toHaveTextContent("Verificación en dos pasosActivada");
    expect(rowOf("Bea")).toHaveTextContent("Verificación en dos pasosDesactivada");
  });

  it("is offered to an admin only on another member's row that has it, and never on an owner's", () => {
    meRole = "ADMIN";
    renderPeople();

    expect(within(rowOf("Ana")).getByRole("button", { name: BUTTON })).toBeInTheDocument();
    // Nothing to remove.
    expect(within(rowOf("Bea")).queryByRole("button", { name: BUTTON })).toBeNull();
    // Your own is turned off from Seguridad y acceso.
    expect(within(rowOf("Alba")).queryByRole("button", { name: BUTTON })).toBeNull();
    // An owner's is another owner's to remove.
    expect(within(rowOf("Olga")).queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("is offered to an owner on another owner's row", () => {
    meRole = "OWNER";
    renderPeople();

    expect(within(rowOf("Olga")).getByRole("button", { name: BUTTON })).toBeInTheDocument();
    expect(within(rowOf("Alba")).queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("says what it costs, asks for the password, and sends nothing on opening", async () => {
    renderPeople();

    const dialog = await openRemoval("Ana");

    expect(dialog).toHaveTextContent("Se cerrarán todas sus sesiones y tendrá que configurarla de nuevo");
    expect(within(dialog).getByLabelText("Tu contraseña")).toBeInTheDocument();
    expect(twoFactorRemovals).toEqual([]);
  });

  it("removes it with the admin's password, says so, reads the list again and closes", async () => {
    renderPeople();

    await confirmWith(await openRemoval("Ana"), "Quitar la verificación");

    expect(twoFactorRemovals).toEqual([{ userId: "u-ana", currentPassword: "cocina despensa nevera" }]);
    expect(
      await screen.findByText(
        "Se ha quitado la verificación en dos pasos de Ana y se han cerrado sus sesiones. Pídele que la configure de nuevo en cuanto entre.",
      ),
    ).toBeInTheDocument();
    expect(membersInvalidated).toBe(1);
    expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0);
  });

  it("leaves focus on the list of people, not on <body>, once the row no longer offers it", async () => {
    // The re-read takes the button that opened the dialog off Ana's row
    // before the dialog closes (WCAG 2.4.3).
    twoFactorOffOnRead = ["u-ana"];
    try {
      renderPeople();

      await confirmWith(await openRemoval("Ana"), "Quitar la verificación");

      await waitFor(() => expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0));
      expect(within(rowOf("Ana")).queryByRole("button", { name: BUTTON })).toBeNull();
      await waitFor(() => expect(document.activeElement?.tagName).toBe("UL"));
    } finally {
      twoFactorOffOnRead = [];
      members = MEMBERS;
    }
  });

  it("says a wrong password in the dialog, and stays open", async () => {
    twoFactorRemovalRefusal = trpcRefusal("BAD_REQUEST", WRONG_CURRENT_PASSWORD_MESSAGE);
    renderPeople();

    const dialog = await openRemoval("Ana");
    await confirmWith(dialog, "Quitar la verificación");

    expect(within(dialog).getByRole("alert")).toHaveTextContent("La contraseña no es correcta");
    expect(membersInvalidated).toBe(0);
  });

  it("says an owner's is another owner's, when the role changed under the page", async () => {
    twoFactorRemovalRefusal = trpcRefusal("FORBIDDEN", "Only an owner may change who owns this household");
    renderPeople();

    const dialog = await openRemoval("Ana");
    await confirmWith(dialog, "Quitar la verificación");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Solo otra persona propietaria puede quitar la verificación en dos pasos de una persona propietaria.",
    );
  });

  it("says the member changed, and reads the list again", async () => {
    twoFactorRemovalRefusal = trpcRefusal("CONFLICT", "This member has no two-step verification to remove");
    renderPeople();

    const dialog = await openRemoval("Ana");
    await confirmWith(dialog, "Quitar la verificación");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Esta persona ya no tiene la verificación en dos pasos activada",
    );
    expect(membersInvalidated).toBe(1);
  });
});
