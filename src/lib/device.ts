/**
 * The identifier for *this browser*, so a screen choice can be remembered for
 * it (`REDESIGN_PLAN.md` §5.1, Journey 8).
 *
 * **A cookie rather than `localStorage`, and that is the whole design.** The
 * choice is stored per `(userId, deviceId)`, and the screen it decides is the
 * one a person lands on — so the decision has to be made before anything is
 * drawn, or they watch the wrong screen for a moment and get moved. Only the
 * server can do that, and the server cannot read `localStorage`. A cookie
 * arrives with the request, which turns the whole feature into a server
 * component and a redirect, with no client island and nothing to flash.
 *
 * **`httpOnly`, because nothing on the client needs it.** That is not caution
 * for its own sake: a value no script can read is a value no injected script
 * can exfiltrate, and it keeps this from becoming a fingerprint that a page can
 * hand to somebody else. It is a random v4 UUID, scoped to this origin, and it
 * says nothing about the device except "the same browser as last time".
 *
 * Losing it is harmless and deliberately so: a cleared cookie jar is simply a
 * device nobody has been asked about yet, and the person is asked again.
 */
export const DEVICE_ID_COOKIE = "stoky_device";

/** A year. The choice is meant to outlast the session that made it. */
export const DEVICE_ID_MAX_AGE_S = 365 * 24 * 60 * 60;

/**
 * Whether a cookie value is one we minted.
 *
 * Checked rather than trusted: the value is attacker-controlled — anyone can
 * send any cookie — and it ends up as half of a database key. Refusing anything
 * that is not a v4 UUID means a hostile value cannot become a row, and a
 * corrupted one is treated as a device we have not seen, which asks the person
 * again instead of failing.
 */
export function isDeviceId(value: string | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}

/**
 * Mint one.
 *
 * `crypto.randomUUID` is available in the middleware runtime, which is the only
 * place this is called — the nonce beside it uses the same API. Note that this
 * is *not* `src/lib/offline/ids.ts`, which avoids `randomUUID` because it runs
 * in the browser where the API is secure-context-only and this project is
 * reachable over plain http on a LAN. Here it runs on the server, where no such
 * restriction applies.
 */
export function mintDeviceId(): string {
  return crypto.randomUUID();
}
