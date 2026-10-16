import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import es from "../../../messages/es.json";
import type { SecondStepResult, TotpEnrolment } from "@/lib/auth/client";

/**
 * Two-step verification in `/settings/security` (PROGRESS D148, D149): turning
 * it on with a QR code, a key and a link, the backup codes shown once, and
 * turning it off or replacing the codes with the password.
 *
 * The auth API is replaced at the browser module (`@/lib/auth/client`), with
 * the real module spread in so its error class is the one the dialog checks
 * for (D50). That the route charges, forwards and logs these calls is
 * `unit/auth-handler.test.ts`; that Better Auth turns it on is
 * `integration/two-factor.test.ts`.
 */

const t = es.twoFactorSettings;
const PASSWORD = "cocina despensa nevera";
const KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const URI = `otpauth://totp/Stoky:cocina%40example.com?secret=${KEY}&issuer=Stoky&digits=6&period=30`;
const CODES = [
  "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
  "GGGG-HHHH-JJJJ-KKKK-MMMM-NNNN",
  "PPPP-QQQQ-RRRR-SSSS-TTTT-VVVV",
];
const NEW_CODES = ["WWWW-XXXX-YYYY-ZZZZ-0000-1111", "2222-3333-4444-5555-6666-7777"];

interface Me {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "KITCHEN";
  twoFactorEnabled: boolean;
}

let me: Me;
let calls: unknown[][] = [];
let refusal: unknown = null;
let verifyAnswer: SecondStepResult = { ok: true };
let invalidated = 0;
let devicesReread = 0;

const realAuthClient = await import("@/lib/auth/client");
const { AccountChangeRefusedError } = realAuthClient;

mock.module("@/lib/auth/client", () => ({
  ...realAuthClient,
  startTotpEnrolment: async (password: string): Promise<TotpEnrolment> => {
    calls.push(["enable", password]);
    if (refusal !== null) throw refusal;
    return { totpUri: URI, backupCodes: [...CODES] };
  },
  verifyTotp: async (code: string): Promise<SecondStepResult> => {
    calls.push(["verify", code]);
    if (verifyAnswer.ok) me = { ...me, twoFactorEnabled: true };
    return verifyAnswer;
  },
  replaceBackupCodes: async (password: string): Promise<string[]> => {
    calls.push(["regenerate", password]);
    if (refusal !== null) throw refusal;
    return [...NEW_CODES];
  },
  turnOffTwoFactor: async (password: string): Promise<void> => {
    calls.push(["disable", password]);
    if (refusal !== null) throw refusal;
    me = { ...me, twoFactorEnabled: false };
  },
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      auth: {
        me: { invalidate: async () => void invalidated++ },
        listSessions: { invalidate: async () => void devicesReread++ },
      },
    }),
    auth: {
      me: {
        useQuery: () => ({ data: me, error: null, fetchStatus: "idle", refetch: async () => {} }),
      },
    },
  },
}));

const { TwoFactorSettings } = await import("@/components/security/TwoFactorSettings");

beforeEach(() => {
  me = { id: "u-cocina", role: "MEMBER", twoFactorEnabled: false };
  calls = [];
  refusal = null;
  verifyAnswer = { ok: true };
  invalidated = 0;
  devicesReread = 0;
});

afterEach(cleanup);

/** Opens the password dialog with `button` and confirms it. */
async function confirm(user: ReturnType<typeof userEvent.setup>, button: string, password = PASSWORD) {
  await user.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(es.reauth.password), password);
  await user.click(within(dialog).getAllByRole("button").at(-1) as HTMLElement);
}

/** Through the password and the first code, to the backup codes. */
async function enrol(user: ReturnType<typeof userEvent.setup>) {
  await confirm(user, t.turnOn);
  await screen.findByRole("heading", { name: t.scanTitle });
  await user.type(screen.getByLabelText(t.codeLabel), "123456");
  await user.click(screen.getByRole("button", { name: t.verify }));
  await screen.findByRole("heading", { name: t.codesTitle });
}

const codesOnScreen = () => CODES.filter((code) => screen.queryByText(code) !== null);

describe("who may set it up", () => {
  it.each(["KITCHEN", "MEMBER", "ADMIN", "OWNER"] as const)(
    "offers it to a %s account, the kitchen's shared one included",
    (role) => {
      me = { ...me, role };
      renderWithIntl(<TwoFactorSettings />);

      expect(screen.getByRole("button", { name: t.turnOn })).toBeInTheDocument();
      expect(screen.getByText(t.statusOff)).toBeInTheDocument();
    },
  );

  it("says it is on, in words, and offers the codes and the way off", () => {
    me = { ...me, role: "KITCHEN", twoFactorEnabled: true };
    renderWithIntl(<TwoFactorSettings />);

    expect(screen.getByText(t.statusOn)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.regenerate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.turnOff })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.turnOn })).toBeNull();
  });
});

describe("turning it on", () => {
  it("asks for the password before anything, and shows the authenticator three ways", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);

    expect(calls).toEqual([["enable", PASSWORD]]);
    expect(await screen.findByRole("heading", { name: t.scanTitle })).toHaveFocus();
    // The QR code has a name: a grid of squares says nothing to a screen reader.
    const qr = screen.getByRole("img", { name: t.qrLabel });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
    // The key, in fours, for somebody who cannot scan.
    expect(screen.getByText(KEY.replace(/(.{4})(?=.)/g, "$1 "))).toBeInTheDocument();
    // And the address itself, for an app on this device.
    expect(screen.getByRole("link", { name: t.openInApp })).toHaveAttribute("href", URI);
  });

  it("shows no backup code until the first code has turned it on", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);
    await screen.findByRole("heading", { name: t.scanTitle });
    expect(codesOnScreen()).toEqual([]);

    await user.type(screen.getByLabelText(t.codeLabel), "123456");
    await user.click(screen.getByRole("button", { name: t.verify }));

    expect(await screen.findByRole("heading", { name: t.codesTitle })).toHaveFocus();
    expect(calls).toEqual([["enable", PASSWORD], ["verify", "123456"]]);
    expect(codesOnScreen()).toEqual(CODES);
    expect(screen.getByText(t.codesIntro)).toBeInTheDocument();
    expect(invalidated).toBeGreaterThan(0);
    // Better Auth replaced this browser's session: the devices list is read
    // again, or it would show the old row as this device.
    expect(devicesReread).toBeGreaterThan(0);
  });

  it("stays on the code when it is refused, and says why", async () => {
    verifyAnswer = { ok: false, code: "invalid_code" };
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);
    await screen.findByRole("heading", { name: t.scanTitle });
    await user.type(screen.getByLabelText(t.codeLabel), "000000");
    await user.click(screen.getByRole("button", { name: t.verify }));

    expect(await screen.findByText(es.auth.twoFactorInvalidCode)).toBeInTheDocument();
    expect(screen.getByLabelText(t.codeLabel)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("heading", { name: t.codesTitle })).toBeNull();
    expect(codesOnScreen()).toEqual([]);
  });

  it("does not send anything but six digits", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);
    await screen.findByRole("heading", { name: t.scanTitle });
    await user.type(screen.getByLabelText(t.codeLabel), "12a45");
    await user.click(screen.getByRole("button", { name: t.verify }));

    expect(await screen.findByText(t.codeMissing)).toBeInTheDocument();
    expect(calls).toEqual([["enable", PASSWORD]]);
  });

  it("leaves it off, the secret dropped, when the person cancels", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);
    await screen.findByRole("heading", { name: t.scanTitle });
    await user.click(screen.getByRole("button", { name: es.common.cancel }));

    expect(screen.queryByRole("img", { name: t.qrLabel })).toBeNull();
    expect(screen.queryByText(KEY.slice(0, 4), { exact: false })).toBeNull();
    expect(screen.getByRole("button", { name: t.turnOn })).toBeInTheDocument();
  });

  it("gives focus back to the way in, not to <body>, when the person cancels", async () => {
    // The focused "Cancelar" goes with the step it was in.
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn);
    await screen.findByRole("heading", { name: t.scanTitle });
    await user.click(screen.getByRole("button", { name: es.common.cancel }));

    await waitFor(() => expect(screen.getByRole("button", { name: t.turnOn })).toHaveFocus());
  });

  it("words a wrong password beside the field, and goes nowhere", async () => {
    refusal = new AccountChangeRefusedError("wrong_password");
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOn, "no es esta");

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(es.reauth.wrong)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(es.reauth.password)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("heading", { name: t.scanTitle })).toBeNull();
  });

  it("words a spent budget, and a screen that was out of date", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    refusal = new AccountChangeRefusedError("too_many_attempts", 60);
    await confirm(user, t.turnOn);
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(es.reauth.tooMany)).toBeInTheDocument();

    refusal = new AccountChangeRefusedError("already_enabled");
    await user.click(within(dialog).getAllByRole("button").at(-1) as HTMLElement);
    expect(await within(dialog).findByText(t.alreadyEnabled)).toBeInTheDocument();
    // And the state is read again, so the screen stops offering it.
    await waitFor(() => expect(invalidated).toBeGreaterThan(0));
  });
});

describe("the backup codes", () => {
  it("are gone once the person says they have saved them", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await enrol(user);
    expect(codesOnScreen()).toEqual(CODES);
    await user.click(screen.getByRole("button", { name: t.codesDone }));

    expect(codesOnScreen()).toEqual([]);
    expect(screen.getByText(t.changedEnabled)).toBeInTheDocument();
    expect(screen.getByText(t.statusOn)).toBeInTheDocument();
  });

  it("are gone when the screen is left and opened again", async () => {
    const user = userEvent.setup();
    const first = renderWithIntl(<TwoFactorSettings />);
    await enrol(user);
    expect(codesOnScreen()).toEqual(CODES);

    first.unmount();
    renderWithIntl(<TwoFactorSettings />);

    expect(codesOnScreen()).toEqual([]);
    expect(screen.queryByRole("heading", { name: t.codesTitle })).toBeNull();
    expect(screen.getByRole("button", { name: t.regenerate })).toBeInTheDocument();
  });

  it("say they cannot be seen again, and copy as text", async () => {
    // After `setup`, which puts a clipboard of its own on `navigator`.
    const user = userEvent.setup();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    renderWithIntl(<TwoFactorSettings />);

    await enrol(user);
    await user.click(screen.getByRole("button", { name: t.copy }));

    expect(await screen.findByText(t.copied)).toBeInTheDocument();
    expect(written).toHaveLength(1);
    for (const code of CODES) expect(written[0]).toContain(code);
    expect(screen.getByRole("list", { name: t.codesListLabel })).toBeInTheDocument();
  });

  it("are replaced with the password, and the new set shown once", async () => {
    me = { ...me, twoFactorEnabled: true };
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.regenerate);

    expect(await screen.findByRole("heading", { name: t.codesTitle })).toBeInTheDocument();
    expect(calls).toEqual([["regenerate", PASSWORD]]);
    for (const code of NEW_CODES) expect(screen.getByText(code)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t.codesDone }));
    for (const code of NEW_CODES) expect(screen.queryByText(code)).toBeNull();
    expect(screen.getByText(t.changedRegenerated)).toBeInTheDocument();
  });
});

describe("turning it off", () => {
  it("takes the password, and points to the devices list afterwards", async () => {
    me = { ...me, twoFactorEnabled: true };
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await confirm(user, t.turnOff);

    expect(await screen.findByText(t.changedDisabled)).toBeInTheDocument();
    expect(calls).toEqual([["disable", PASSWORD]]);
    expect(screen.getByText(t.statusOff)).toBeInTheDocument();
    // Turning it off replaces this browser's session too.
    expect(devicesReread).toBeGreaterThan(0);
    // ASVS 5.0.0 7.4.3: after a change to a factor, the way to end the other sessions.
    expect(screen.getByRole("link", { name: t.reviewDevicesLink })).toHaveAttribute("href", "#devices");
  });

  it("asks before it does anything", async () => {
    me = { ...me, twoFactorEnabled: true };
    const user = userEvent.setup();
    renderWithIntl(<TwoFactorSettings />);

    await user.click(screen.getByRole("button", { name: t.turnOff }));

    expect(await screen.findByRole("dialog", { name: t.turnOffTitle })).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe("in English", () => {
  it("says the same things in its own words", async () => {
    const en = (await import("../../../messages/en.json")).default.twoFactorSettings;
    renderWithIntl(<TwoFactorSettings />, { locale: "en" });

    expect(screen.getByRole("button", { name: en.turnOn })).toBeInTheDocument();
    expect(en.turnOn).not.toBe(t.turnOn);
  });
});
