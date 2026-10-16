import "../setup/matchers";
import { describe, it, expect, afterAll, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import es from "../../../messages/es.json";
import type { PasskeySummary } from "@/lib/auth/client";
import { MAX_PASSKEY_NAME_LENGTH } from "@/lib/validations/auth";

/**
 * **Llaves de acceso** on `/settings/security` (PROGRESS D151): the list, and
 * adding, renaming and removing — and, where adding cannot work, the sentence
 * that says why instead of a button that fails.
 *
 * The auth API is replaced at the browser module (`@/lib/auth/client`), with
 * the real module spread in so its error class is the one the dialog checks
 * (D50). That the route forwards these calls and the policy plugin demands
 * the step-up is `integration/passkeys.test.ts`.
 */

const t = es.security;
const PASSWORD = "cocina despensa nevera";
const ORIGIN = "https://stoky.example";

interface Me {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "KITCHEN";
  twoFactorEnabled: boolean;
  passkeyOrigin: string | null;
}

const PHONE: PasskeySummary = {
  id: "pk-phone",
  name: "Safari en iOS",
  createdAt: "2026-10-15T08:00:00.000Z",
  synced: true,
};
const KEY: PasskeySummary = {
  id: "pk-key",
  name: null,
  createdAt: "2026-10-15T09:00:00.000Z",
  synced: false,
};

let me: Me;
let passkeys: PasskeySummary[];
let steps: unknown[][] = [];
let addRefusal: unknown = null;
let listed = 0;

const realAuthClient = await import("@/lib/auth/client");
const { AccountChangeRefusedError } = realAuthClient;

mock.module("@/lib/auth/client", () => ({
  ...realAuthClient,
  listPasskeys: async (): Promise<PasskeySummary[]> => {
    listed++;
    return [...passkeys];
  },
  addPasskey: async (name: string | null): Promise<void> => {
    steps.push(["add", name]);
    if (addRefusal !== null) throw addRefusal;
  },
  removePasskey: async (id: string): Promise<void> => {
    steps.push(["remove", id]);
    passkeys = passkeys.filter((passkey) => passkey.id !== id);
  },
  renamePasskey: async (id: string, name: string): Promise<void> => {
    steps.push(["rename", id, name]);
  },
}));

// The snackbar reads the write queue; the same stand-in `DeviceList.test.tsx`
// uses, with a real context because `mock.module` replaces the module for the
// whole process.
mock.module("@/lib/offline/queue-context", () => ({
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
    useUtils: () => ({}),
    auth: {
      me: {
        useQuery: () => ({ data: me, error: null, fetchStatus: "idle", refetch: async () => {} }),
      },
      confirmPassword: {
        useMutation: () => ({
          mutateAsync: async (input: { currentPassword: string }) => {
            steps.push(["confirmPassword", input.currentPassword]);
            return { expiresAt: "2026-10-15T10:05:00.000Z" };
          },
        }),
      },
    },
  },
}));

const { PasskeyManager } = await import("@/components/security/PasskeyManager");
const { SnackbarProvider } = await import("@/components/ui/snackbar");

// What `browserAt` changes, as it was: `mock.module` aside, every component
// file shares one window, and a later one (the login page's passkey offer)
// must not find this file's address or a WebAuthn it never set up.
const STARTING_URL = window.location.href;
const STARTING_PROPERTIES = (["isSecureContext", "PublicKeyCredential"] as const).map(
  (key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
);

afterAll(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(STARTING_URL);
  for (const [key, descriptor] of STARTING_PROPERTIES) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else delete (window as unknown as Record<string, unknown>)[key];
  }
});

/** The page's address, its secure-context flag, and whether WebAuthn exists. */
function browserAt(url: string, { secure = true, webauthn = true } = {}): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  Object.defineProperty(window, "PublicKeyCredential", {
    value: webauthn ? function PublicKeyCredential() {} : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  me = { id: "u-alba", role: "MEMBER", twoFactorEnabled: false, passkeyOrigin: ORIGIN };
  passkeys = [PHONE, KEY];
  steps = [];
  addRefusal = null;
  listed = 0;
  browserAt(`${ORIGIN}/settings/security`);
});

afterEach(cleanup);

function renderSection() {
  return renderWithIntl(
    <QueryClientProvider client={new QueryClient()}>
      <SnackbarProvider>
        <PasskeyManager />
      </SnackbarProvider>
    </QueryClientProvider>,
  );
}

/** Types the password into the open dialog and presses its action. */
async function confirm(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(es.reauth.password), password);
  await user.click(within(dialog).getAllByRole("button").at(-1) as HTMLElement);
  return dialog;
}

describe("the list", () => {
  it("names each passkey, says when it was added and whether it is synced", async () => {
    renderSection();

    const phone = (await screen.findByText(PHONE.name as string)).closest("li") as HTMLElement;
    expect(within(phone).getByText(t.passkeysSynced)).toBeInTheDocument();
    expect(within(phone).getByText(t.passkeysCreated)).toBeInTheDocument();

    // A passkey made without a name still has a title to act on.
    const key = screen.getByText(t.passkeysUnnamed).closest("li") as HTMLElement;
    expect(within(key).getByText(t.passkeysDeviceOnly)).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    passkeys = [];
    renderSection();

    expect(await screen.findByText(t.passkeysNone)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.passkeysAdd })).toBeInTheDocument();
  });

  it.each(["KITCHEN", "MEMBER", "ADMIN", "OWNER"] as const)(
    "is shown to a %s account, the kitchen's shared one included",
    async (role) => {
      me = { ...me, role };
      renderSection();

      expect(await screen.findByText(PHONE.name as string)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t.passkeysAdd })).toBeInTheDocument();
    },
  );
});

describe("where adding one cannot work", () => {
  it("explains an insecure context, and offers no button", async () => {
    browserAt(`${ORIGIN}/settings/security`, { secure: false });
    renderSection();

    expect(await screen.findByText(t.passkeysInsecure)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.passkeysAdd })).toBeNull();
  });

  it("explains a browser without WebAuthn, and offers no button", async () => {
    browserAt(`${ORIGIN}/settings/security`, { webauthn: false });
    renderSection();

    expect(await screen.findByText(t.passkeysUnsupported)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.passkeysAdd })).toBeNull();
  });

  it("names the canonical address at any other, and offers no button", async () => {
    // A second STOKY_URLS entry: signed in, and a secure context, but a
    // credential made here would name a host the server does not accept.
    browserAt("https://stoky.lan:8443/settings/security");
    renderSection();

    expect(
      await screen.findByText(t.passkeysOnlyAt.replace("{host}", "stoky.example")),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.passkeysAdd })).toBeNull();
    // The list and its removal still work there: a lost phone's passkey can
    // be removed from whatever address the person is at.
    expect(screen.getByText(PHONE.name as string)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.passkeysRemoveNamed.replace("{name}", PHONE.name as string) }),
    ).toBeInTheDocument();
  });

  it("explains an install that cannot have them, and asks for no list", async () => {
    me = { ...me, passkeyOrigin: null };
    renderSection();

    expect(screen.getByText(t.passkeysUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.passkeysAdd })).toBeNull();
    expect(listed).toBe(0);
  });
});

describe("adding one", () => {
  it("asks for the password, then confirms it, then asks the browser", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: t.passkeysAdd }));
    const dialog = await screen.findByRole("dialog");
    // The advice for a device other people use, before the password is typed.
    expect(within(dialog).getByText(t.passkeysSharedDevice)).toBeInTheDocument();
    expect(steps).toEqual([]);

    await confirm(user);

    await waitFor(() => expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0));
    expect(steps.map(([step]) => step)).toEqual(["confirmPassword", "add"]);
    expect(steps[0]).toEqual(["confirmPassword", PASSWORD]);
    // Named after where it was made, so it can be told apart before a rename.
    expect(typeof steps[1][1]).toBe("string");
  });

  it("keeps the dialog open and says why when the browser's prompt is cancelled", async () => {
    addRefusal = new AccountChangeRefusedError("cancelled");
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: t.passkeysAdd }));
    const dialog = await confirm(user);

    expect(await within(dialog).findByText(t.passkeysCancelled)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("removing one", () => {
  it("asks for the password before anything is removed", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", {
        name: t.passkeysRemoveNamed.replace("{name}", PHONE.name as string),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(es.reauth.password)).toBeInTheDocument();
    expect(steps).toEqual([]);

    await confirm(user);

    await waitFor(() => expect(steps).toEqual([["confirmPassword", PASSWORD], ["remove", PHONE.id]]));
    await waitFor(() => expect(screen.queryByText(PHONE.name as string)).toBeNull());
  });
});

describe("focus after removing one", () => {
  it("goes to the section's opening sentence, not to <body>, once the row has gone", async () => {
    // The opener was the removed row's "Quitar": it takes no focus from
    // outside the page (WCAG 2.4.3).
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", {
        name: t.passkeysRemoveNamed.replace("{name}", PHONE.name as string),
      }),
    );
    await confirm(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByText(t.passkeysExplain)).toHaveFocus());
  });
});

describe("renaming one", () => {
  it("takes the new name, trimmed, without the password", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", {
        name: t.passkeysRenameNamed.replace("{name}", t.passkeysUnnamed),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(es.reauth.password)).toBeNull();
    await user.type(within(dialog).getByLabelText(t.passkeysNameLabel), "  Llave del llavero  ");
    await user.click(within(dialog).getByRole("button", { name: t.passkeysRenameSave }));

    await waitFor(() => expect(steps).toEqual([["rename", KEY.id, "Llave del llavero"]]));
  });

  it("bounds the field at the length the server accepts", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", {
        name: t.passkeysRenameNamed.replace("{name}", t.passkeysUnnamed),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    // The route refuses a longer name with a 400 the dialog could only call
    // unknown; the field must stop the typing first.
    expect(within(dialog).getByLabelText(t.passkeysNameLabel)).toHaveAttribute(
      "maxLength",
      String(MAX_PASSKEY_NAME_LENGTH),
    );
  });

  it("refuses an empty name", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", {
        name: t.passkeysRenameNamed.replace("{name}", t.passkeysUnnamed),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t.passkeysRenameSave }));

    expect(await within(dialog).findByText(t.passkeysNameMissing)).toBeInTheDocument();
    expect(steps).toEqual([]);
  });
});
