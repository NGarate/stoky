import { POST } from "@/app/api/auth/[...all]/route";
import { DEVICE_ID_COOKIE } from "@/lib/device";
import { DEVELOPMENT_URL, canonicalUrl } from "@/lib/auth/public-url";

/**
 * Signs in through the real auth route, the way a browser does.
 *
 * This is the application's only credential-verification path: the route
 * module (`src/app/api/auth/[...all]/route.ts`), its limits and Better Auth
 * behind it, with Postgres and Valkey. Nothing here reaches into a library's
 * internals, so what passes here is what a person's sign-in does.
 *
 * Each call takes its own address, because the route counts a rate-limit
 * attempt before it looks at anything (ISSUES.md CRITICAL-4) — sharing one
 * address across tests would make the sixth test in a file fail for reasons
 * that have nothing to do with what it asserts.
 */

let addressCounter = 0;

/** A distinct address per call, so one test cannot spend another's budget. */
export function freshTestAddress(): string {
  addressCounter += 1;
  return `198.51.100.${addressCounter % 250}-${process.pid}-${addressCounter}`;
}

/**
 * Where the instance thinks it lives — the first `STOKY_URLS` entry — which is
 * what a browser's `Origin` says.
 */
export function testOrigin(): string {
  return canonicalUrl(process.env) ?? DEVELOPMENT_URL;
}

export interface SignInOutcome {
  status: number;
  /** The `code` of a refusal's JSON body, when it has one. */
  code: string | undefined;
  /** The `Retry-After` header, as sent. */
  retryAfter: string | null;
  /** Every `Set-Cookie` line of the answer. */
  setCookie: string[];
  /**
   * The cookies the answer set, as the `Cookie` header a browser would send
   * next: `name=value` pairs, the expired ones left out. Empty when none.
   */
  cookieHeader: string;
  /** The account signed in as, on a success. */
  userId: string | undefined;
  /** The user Better Auth answered a success with. */
  user: Record<string, unknown> | undefined;
  /** The answer's JSON body, or null. */
  body: Record<string, unknown> | null;
}

export interface SignInOptions {
  address?: string;
  /** Sent as the `stoky_device` cookie, as a browser that has been here does. */
  deviceId?: string;
  /**
   * The rest of the browser's `Cookie` header — the cookies an earlier sign-in
   * left (`SignInOutcome.cookieHeader`), for a browser signing in again.
   */
  cookie?: string;
  /** `Origin`; defaults to the instance's own whenever a cookie is sent. */
  origin?: string;
  /** Sent as `Sec-Fetch-Site`, as a browser on https does. */
  fetchSite?: string;
  /** Sent in place of the JSON credentials, for a body that is not one. */
  rawBody?: string;
}

/** The cookies a `Set-Cookie` list leaves a browser holding, as a `Cookie` header. */
export function cookieHeaderFrom(setCookie: string[]): string {
  return setCookie
    .filter((line) => !/;\s*max-age=0\b/i.test(line) && !/expires=thu, 01 jan 1970/i.test(line))
    .map((line) => line.split(";")[0].trim())
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

export async function signInWith(
  credentials: { email: string; password: string },
  options: SignInOptions = {},
): Promise<SignInOutcome> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": options.address ?? freshTestAddress(),
  });
  const cookies = [
    options.deviceId ? `${DEVICE_ID_COOKIE}=${options.deviceId}` : "",
    options.cookie ?? "",
  ].filter(Boolean);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  const origin = options.origin ?? (cookies.length ? testOrigin() : undefined);
  if (origin) headers.set("origin", origin);
  if (options.fetchSite) headers.set("sec-fetch-site", options.fetchSite);

  const response = await POST(
    new Request(`${testOrigin()}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(credentials),
    }),
  );

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  const setCookie = response.headers.getSetCookie();
  const user =
    body?.user && typeof body.user === "object" ? (body.user as Record<string, unknown>) : undefined;

  return {
    status: response.status,
    code: typeof body?.code === "string" ? body.code : undefined,
    retryAfter: response.headers.get("retry-after"),
    setCookie,
    cookieHeader: cookieHeaderFrom(setCookie),
    userId: typeof user?.id === "string" ? user.id : undefined,
    user,
    body,
  };
}
