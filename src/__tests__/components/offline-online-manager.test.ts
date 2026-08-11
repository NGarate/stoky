import { describe, it, expect, afterEach } from "bun:test";
import { onlineManager } from "@tanstack/react-query";
import { seedOnlineManager } from "@/lib/offline/onlineManager";

/**
 * The one line `@tanstack/query-core` leaves out.
 *
 * Its `OnlineManager` starts at `#online = true` and its default setup adds an
 * `online` and an `offline` listener and nothing else — read in the shipped
 * build, not assumed. So a tab that was open when the connection dropped is
 * correct, and the case this whole phase exists for is not: opening the app in
 * aeroplane mode. There has been no `offline` event to hear, so `isOnline()`
 * answers `true`, every query fires a request that cannot succeed, and no
 * screen ever reaches the `paused` state the interface is built to show.
 *
 * The rendered tier, because it needs a `window` with real event listeners and
 * a `navigator.onLine` to take away.
 */

/** happy-dom defines `onLine` as a configurable prototype getter. */
function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setNavigatorOnline(true);
  seedOnlineManager();
});

describe("seedOnlineManager", () => {
  it("starts offline when the device is offline", () => {
    setNavigatorOnline(false);

    seedOnlineManager();

    // Without the seed this is `true`, and every screen in aeroplane mode goes
    // to `error` rather than `paused`. Delete the seeded line and it goes red.
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("starts online when the device is online", () => {
    setNavigatorOnline(true);

    seedOnlineManager();

    expect(onlineManager.isOnline()).toBe(true);
  });

  it("still hears the browser change its mind", () => {
    setNavigatorOnline(true);
    seedOnlineManager();

    window.dispatchEvent(new Event("offline"));
    expect(onlineManager.isOnline()).toBe(false);

    window.dispatchEvent(new Event("online"));
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("survives every observer going away and coming back", () => {
    setNavigatorOnline(false);
    seedOnlineManager();

    // `onSubscribe` re-runs the *stored* setup. Seeding through
    // `setEventListener` is what makes the stored setup ours rather than
    // query-core's, so the seed is not quietly replaced the first time the
    // last observer unsubscribes.
    const unsubscribe = onlineManager.subscribe(() => {});
    unsubscribe();
    onlineManager.subscribe(() => {})();

    expect(onlineManager.isOnline()).toBe(false);
  });

  it("notifies subscribers when the seed changes the answer", () => {
    setNavigatorOnline(true);
    seedOnlineManager();

    const heard: boolean[] = [];
    onlineManager.subscribe((online) => heard.push(online));

    setNavigatorOnline(false);
    seedOnlineManager();

    expect(heard).toContain(false);
  });
});
