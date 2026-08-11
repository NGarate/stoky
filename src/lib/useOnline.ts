"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the browser thinks it has a connection.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: this is external
 * state that changes without React's involvement, and the hook exists for
 * exactly that. It also gives a server snapshot, which matters here — every
 * component that reads this is server-rendered inside the dashboard layout,
 * where `navigator` does not exist and a bare read throws.
 *
 * The server snapshot is `true`. A server has a connection by definition, and
 * assuming offline there would render a "no signal" state into HTML that is
 * then cached and served to somebody who does have one.
 *
 * Not the truth about reachability — `navigator.onLine` reports a captive
 * portal as online. It is right about the case this is used for: whether to
 * stay quiet about a session that cannot be refreshed anyway.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
