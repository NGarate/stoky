"use client";

import { useSyncExternalStore } from "react";

/**
 * What this browser, on this page, can do with WebAuthn (D151) — asked by
 * the two screens that offer a passkey: the settings section that adds one
 * and the login form that signs in with one.
 *
 * - `pending` on the server, and in the first client render that hydrates
 *   its HTML: there is no browser to ask, so neither screen renders a button
 *   or an excuse that the browser would then contradict.
 * - `insecure` — WebAuthn exists only in a secure context: https, or http to
 *   `localhost`.
 * - `unsupported` — a secure page in a browser without `PublicKeyCredential`.
 * - `ready`.
 */
export type WebAuthnSupport = "pending" | "insecure" | "unsupported" | "ready";

const noSubscription = () => () => {};

function webAuthnSupport(): WebAuthnSupport {
  if (!window.isSecureContext) return "insecure";
  if (typeof window.PublicKeyCredential !== "function") return "unsupported";
  return "ready";
}

/** Read once on the client and never on the server. */
export function useWebAuthnSupport(): WebAuthnSupport {
  return useSyncExternalStore(noSubscription, webAuthnSupport, () => "pending" as const);
}
