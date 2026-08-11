import { onlineManager } from "@tanstack/react-query";

/**
 * Tell TanStack Query whether there is a signal *before* it guesses.
 *
 * `@tanstack/query-core@5.101.4`'s `OnlineManager` initialises `#online = true`
 * and its default setup adds an `online` and an `offline` listener and nothing
 * else — verified in the shipped build, not assumed. It never reads
 * `navigator.onLine`.
 *
 * That is fine for a tab that was open when the connection dropped, and wrong
 * for the case this whole phase is about: opening the app in aeroplane mode.
 * There has been no `offline` event to hear, so `isOnline()` answers `true`,
 * every query fires a request that cannot succeed, and the retry predicate
 * spends two more on each before every screen lands in `error` — never in
 * `paused`, which is the state the interface is built to show.
 *
 * `setEventListener` stores the setup it is given and calls it immediately, and
 * `onSubscribe` re-runs *that* stored setup rather than the built-in one. So
 * seeding here survives the unsubscribe/resubscribe cycle instead of being
 * overwritten the first time every observer goes away.
 *
 * `navigator.onLine` is not the truth — it reports a captive portal as online —
 * but it is right about the case that matters here, and being wrong the other
 * way costs one refused request that the queue already knows how to classify.
 */
export function seedOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    if (typeof window === "undefined" || !window.addEventListener) return;

    // The line query-core omits.
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline, false);
    window.addEventListener("offline", goOffline, false);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  });
}
