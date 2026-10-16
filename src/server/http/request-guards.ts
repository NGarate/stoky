import { clientAddress } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";

/**
 * The refusals both API routes make on headers alone, before a body is read
 * or anything else costs a thing: the tRPC endpoint
 * (`src/server/http/trpc-handler.ts`) and the auth API
 * (`src/server/http/auth-handler.ts`).
 */

/**
 * The `Sec-Fetch-Site` values a browser sends for a request this application
 * made itself (`same-origin`), or one the person started by typing or a
 * bookmark (`none`). `same-site` is the one that matters: SameSite=Lax sends
 * the session cookie with it, because a sibling subdomain is the same *site*.
 */
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * 403 for a request a browser says another site sent — the Fetch Metadata
 * check of the OWASP CSRF Cheat Sheet.
 *
 * **A request with no `Sec-Fetch-Site` passes.** Every current browser engine
 * sends it — Safari was the last, in 16.4 — but only to an HTTPS origin or
 * localhost: on a plain-HTTP LAN install no browser sends it, and this check
 * does nothing there. What else sends none is curl, Playwright's `request`
 * fixture, a native client and an older browser, none of which a forging page
 * can make another person's browser be. Those requests are left to the
 * defences they always had: the session cookie's SameSite=Lax and the
 * JSON-only rule below, which is what protects a plain-HTTP install.
 *
 * **Here, `Origin` is not compared with `STOKY_URLS`.** tRPC stays on this
 * header: a strict comparison would add nothing a browser does not already
 * say here, and would lock out an address somebody forgot to list. The auth
 * API does compare it — Better Auth refuses a cookie-bearing POST from an
 * origin not in `STOKY_URLS` (`src/lib/auth/public-url.ts`, D138) — because a
 * sign-in is the one request that sets a session.
 *
 * `basePath` is cut from the logged path, so the line names the procedure or
 * the auth endpoint rather than the route.
 */
export function refuseCrossSite(req: Request, basePath: string): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === null || OWN_FETCH_SITES.has(site.trim().toLowerCase())) return null;

  const pathname = new URL(req.url).pathname;
  const path = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length).replace(/^\//, "")
    : pathname;
  logSecurityEvent("access.denied", {
    reason: "cross-site",
    code: "FORBIDDEN",
    // Both caller-supplied: bounded, so a refusal cannot be a long line.
    fetchSite: site.slice(0, 32),
    path: path.slice(0, 200),
    address: clientAddress(req.headers),
  });
  return refusal(403, "Cross-site requests are refused");
}

/**
 * 415 for a body that is not `application/json`.
 *
 * tRPC itself also accepts `multipart/form-data` and
 * `application/octet-stream` on POST, and runs a mutation with whatever they
 * carry; Better Auth accepts `application/x-www-form-urlencoded` on sign-in.
 * Nothing in this application sends any of them — every call sends JSON, and a
 * receipt photograph travels base64'd inside it — while a plain HTML form can
 * send them with no CORS preflight. A mutation that takes no input therefore
 * ran on a form post from any page that could get the cookie sent: a sibling
 * subdomain, which SameSite=Lax does not stop. `application/json` is not a
 * type a form can send, so a page on another origin cannot send it without a
 * preflight this application never answers.
 */
export function refuseNonJson(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null;

  const type = req.headers.get("content-type");
  const mediaType = type?.split(";")[0].trim().toLowerCase();
  if (mediaType === "application/json") return null;

  return refusal(415, "Only application/json is accepted");
}

export function refusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
