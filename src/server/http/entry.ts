import http from "node:http";
import {
  parseTrustedProxies,
  resolveClient,
  TRUSTED_PROXIES_ENV,
} from "./trusted-proxies";

/**
 * The production entry: loaded before Next's standalone `server.js`
 * (`bun --preload ./entry.ts server.js`, the Dockerfile's `CMD`), so that
 * every request has its forwarded headers settled before Next reads them.
 *
 * **Why here and not in the application.** Next fills `X-Forwarded-For` with
 * the socket's address only when the client sent none
 * (`base-server.js`: `req.headers['x-forwarded-for'] ??= …remoteAddress`), and
 * gives route handlers and `src/proxy.ts` no other way to see the socket. So
 * by the time application code runs, a forged header and a proxy's are the
 * same string. The socket is visible in exactly one place: the HTTP server's
 * `request` event, ahead of Next's own listener.
 *
 * **Why a listener and not a custom server.** Next's standalone output and
 * its custom-server API "cannot be used together" (Next's custom-server
 * guide): `server.js` embeds the build's configuration and owns the port, the
 * keep-alive timeout and the shutdown on SIGTERM. Preloading leaves all of
 * that Next's, and adds one listener to the server it creates.
 *
 * shortcut: this reaches any `node:http` server the process starts, which is
 * how Next 16 serves; if a Next upgrade stops going through
 * `http.Server#listen`, nothing here runs and forged headers are believed
 * again. `scripts/smoke-proxy.sh --live` is the check that says so.
 */

let trusted: ReturnType<typeof parseTrustedProxies>;
try {
  trusted = parseTrustedProxies(process.env[TRUSTED_PROXIES_ENV]);
} catch (error) {
  console.error(`[proxy] refusing to start: ${(error as Error).message}`);
  process.exit(1);
}

console.log(
  process.env[TRUSTED_PROXIES_ENV]?.trim()
    ? `[proxy] forwarded headers are believed from ${TRUSTED_PROXIES_ENV}=${process.env[TRUSTED_PROXIES_ENV]}`
    : `[proxy] ${TRUSTED_PROXIES_ENV} is empty: forwarded headers are ignored, and behind a proxy every visitor counts as the proxy's address`,
);

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (
  this: http.Server,
  ...args: Parameters<typeof listen>
) {
  this.prependListener("request", (req) =>
    resolveClient(req.socket.remoteAddress, req.headers, trusted),
  );
  return listen.apply(this, args);
} as typeof listen;
