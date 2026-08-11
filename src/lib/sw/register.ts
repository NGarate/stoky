/**
 * Registering the service worker, and — just as importantly — unregistering it.
 *
 * `public/sw.js` is served in development too, so a developer who once ran a
 * production build has a worker caching chunks that no longer exist. That is a
 * genuinely confusing afternoon, so the dev path actively tears down rather
 * than merely declining to register.
 */

const CACHE_PREFIX = "stoky-";

declare global {
  interface Window {
    /** Set by hand to exercise the worker in development. */
    __STOKY_SW_FORCE__?: boolean;
  }
}

/**
 * Whether to register.
 *
 * `forced` is read from a runtime flag rather than an environment variable, so
 * the branch is **not** dead-code-eliminated in a development build and can be
 * turned on from a console.
 */
export function shouldRegisterServiceWorker({
  nodeEnv,
  forced,
}: {
  nodeEnv: string | undefined;
  forced: boolean | undefined;
}): boolean {
  if (forced === true) return true;
  return nodeEnv === "production";
}

/**
 * Whether this browser can do any of this at all.
 *
 * Both are absent on an insecure origin — and `next.config.ts` explicitly
 * invites plain-HTTP LAN and Tailscale origins through `allowedDevOrigins`,
 * because reaching a self-hosted box from a phone is how this gets tested on
 * real hardware. An unguarded call there is a TypeError on *every page load*.
 */
function capable(): boolean {
  // The value, not the key. `"serviceWorker" in navigator` is true when the
  // property exists and holds `undefined` — which is what a shim, a polyfill,
  // or a test double produces — and the next dereference then throws. Asking
  // whether the thing is actually there costs nothing and is true in more
  // cases.
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.serviceWorker) &&
    typeof window !== "undefined" &&
    Boolean(window.caches)
  );
}

export async function registerServiceWorker(): Promise<void> {
  if (!capable()) {
    // One line naming why, rather than silence that reads as a bug.
    console.info(
      "[stoky] Service workers need a secure context; offline support is off.",
    );
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // Offline support is an enhancement. A failure here must not take the
    // application with it.
  }
}

/** Remove any worker and every cache this application owns. */
export async function disableServiceWorker(): Promise<void> {
  if (!capable()) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );

    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX))
        // Only ours. Another application on the same origin is not our
        // business, and in development that origin is shared with whatever
        // else runs on localhost.
        .map((name) => caches.delete(name)),
    );
  } catch {
    // Nothing depends on this having worked.
  }
}

/**
 * Tell the worker to forget the previous account's shell.
 *
 * Called with the signed-in user's id inside the dashboard, and with `null` on
 * `/login`. The second is not belt and braces: **there is no sign-out control
 * in this application** — `signOut` is exported from `src/lib/auth.ts` and
 * called nowhere — so a redirect to `/login` is the only end-of-session signal
 * that exists.
 */
export function reconcileUser(
  previous: string | null,
  current: string | null,
): boolean {
  return previous !== current;
}

export function forgetCachedShell(): void {
  if (!capable()) return;
  navigator.serviceWorker.controller?.postMessage("STOKY_FORGET");
}
