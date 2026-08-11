import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  disableServiceWorker,
  forgetCachedShell,
  reconcileUser,
  registerServiceWorker,
  shouldRegisterServiceWorker,
} from "@/lib/sw/register";

/**
 * When the worker is registered, when it is torn down, and what happens on a
 * browser that cannot do either.
 *
 * The last is not hypothetical. `next.config.ts` explicitly invites plain-HTTP
 * LAN and Tailscale origins through `allowedDevOrigins`, because reaching a
 * self-hosted box from a phone is how this is tested on real hardware — and
 * neither `navigator.serviceWorker` nor `window.caches` exists there. An
 * unguarded call is a TypeError on every page load.
 *
 * The rendered tier rather than the static one, and not for a DOM: the module
 * asks `"caches" in window`, and the static tier has no `window` at all — so
 * every one of these would pass by short-circuit and prove nothing.
 */

const original = {
  serviceWorker: (globalThis.navigator as { serviceWorker?: unknown })
    ?.serviceWorker,
  caches: (globalThis as { caches?: unknown }).caches,
};

function withCapableBrowser(overrides: {
  register?: () => Promise<unknown>;
  getRegistrations?: () => Promise<{ unregister: () => Promise<boolean> }[]>;
  keys?: () => Promise<string[]>;
  del?: (name: string) => Promise<boolean>;
  controller?: { postMessage: (message: string) => void } | null;
}) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: {
      register: overrides.register ?? (async () => ({})),
      getRegistrations: overrides.getRegistrations ?? (async () => []),
      controller: overrides.controller ?? null,
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "caches", {
    value: {
      keys: overrides.keys ?? (async () => []),
      delete: overrides.del ?? (async () => true),
    },
    configurable: true,
    writable: true,
  });
}

function withIncapableBrowser() {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "caches", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: original.serviceWorker,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "caches", {
    value: original.caches,
    configurable: true,
    writable: true,
  });
});

describe("shouldRegisterServiceWorker", () => {
  it("registers in production", () => {
    expect(
      shouldRegisterServiceWorker({ nodeEnv: "production", forced: undefined }),
    ).toBe(true);
  });

  it("does not register in development", () => {
    expect(
      shouldRegisterServiceWorker({ nodeEnv: "development", forced: undefined }),
    ).toBe(false);
  });

  it("can be forced on at runtime", () => {
    // A runtime flag rather than an environment variable, so the branch is not
    // dead-code-eliminated from a development build and can be turned on from
    // a console to exercise the worker.
    expect(
      shouldRegisterServiceWorker({ nodeEnv: "development", forced: true }),
    ).toBe(true);
  });
});

describe("a browser that cannot run a worker", () => {
  it("does not throw when registering", async () => {
    withIncapableBrowser();

    // The plain-HTTP LAN origin. Unguarded, this is a TypeError on every page
    // load — and every page load is where offline support was supposed to be.
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });

  it("does not throw when tearing down", async () => {
    withIncapableBrowser();

    await expect(disableServiceWorker()).resolves.toBeUndefined();
  });

  it("does not throw when asked to forget", () => {
    withIncapableBrowser();

    expect(() => forgetCachedShell()).not.toThrow();
  });
});

describe("registering", () => {
  it("registers /sw.js at the root scope", async () => {
    const register = mock(async (_url: string, _options: unknown) => ({}));
    withCapableBrowser({ register: register as never });

    await registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("survives a registration that fails", async () => {
    withCapableBrowser({
      register: async () => {
        throw new Error("blocked");
      },
    });

    // Offline support is an enhancement. A failure must not take the app down.
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });
});

describe("tearing down", () => {
  it("unregisters every worker it finds", async () => {
    const unregister = mock(async () => true);
    withCapableBrowser({
      getRegistrations: async () => [{ unregister }, { unregister }],
    });

    await disableServiceWorker();

    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("deletes only this application's caches", async () => {
    const deleted: string[] = [];
    withCapableBrowser({
      keys: async () => ["stoky-shell-v1", "stoky-static-v1", "someone-else"],
      del: async (name) => {
        deleted.push(name);
        return true;
      },
    });

    await disableServiceWorker();

    // In development the origin is shared with whatever else runs on
    // localhost, and another application's cache is not our business.
    expect(deleted.sort()).toEqual(["stoky-shell-v1", "stoky-static-v1"]);
  });
});

describe("reconcileUser", () => {
  it("forgets when the account changed", () => {
    expect(reconcileUser("user-a", "user-b")).toBe(true);
  });

  it("forgets when the session ended", () => {
    // `/login` with a null id. There is no sign-out control in this
    // application, so this is the only end-of-session signal that exists.
    expect(reconcileUser("user-a", null)).toBe(true);
  });

  it("keeps the shell for the same account", () => {
    expect(reconcileUser("user-a", "user-a")).toBe(false);
  });

  it("does nothing on a first visit with nobody signed in", () => {
    expect(reconcileUser(null, null)).toBe(false);
  });
});

describe("forgetCachedShell", () => {
  it("tells the controlling worker to drop everything", () => {
    const postMessage = mock((_message: string) => {});
    withCapableBrowser({ controller: { postMessage } });

    forgetCachedShell();

    expect(postMessage).toHaveBeenCalledWith("STOKY_FORGET");
  });

  it("is quiet when no worker is controlling the page", () => {
    withCapableBrowser({ controller: null });

    expect(() => forgetCachedShell()).not.toThrow();
  });
});
