import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { getAuth } from "@/lib/auth/instance";
import { DEVICE_ID_COOKIE } from "@/lib/device";
import { prisma } from "@/lib/prisma";
import { signInWith, testOrigin } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * What the auth API answers, against the endpoints Better Auth actually
 * mounts (PROGRESS D135).
 *
 * The unit suite proves the allowlist refuses the paths it was written
 * against. This one reads the list of endpoints off the running instance, so
 * an endpoint a future Better Auth adds — or one nobody thought of — is
 * tried too, by every method, with a signed-in browser's cookie and its own
 * origin: everything it would need to act. Nothing may answer but the five,
 * and no session, account or user row may change.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `surface-${process.pid}-${Date.now().toString(36)}`;
let email: string;
let userId: string;
let cookie: string;

beforeAll(async () => {
  email = generateTestEmail(MARKER);
  userId = (await createTestUser({ email, name: `Surface ${MARKER}`, password: PASSWORD })).id;
  const signedIn = await signInWith({ email, password: PASSWORD });
  expect(signedIn.status).toBe(200);
  cookie = signedIn.cookieHeader;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

/**
 * The five, written out rather than read from the handler: an endpoint added
 * to its allowlist is exactly what this test must notice, and reading the
 * list would make it agree.
 */
const ANSWERED = new Set([
  "POST /sign-in/email",
  "POST /sign-out",
  "GET /get-session",
  "GET /ok",
  "GET /error",
]);

/** Everything about the account an endpoint could change. */
async function snapshot() {
  return {
    user: await prisma.user.findUnique({ where: { id: userId } }),
    accounts: await prisma.account.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    sessions: await prisma.session.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    verifications: await prisma.verification.count(),
  };
}

/** Every endpoint the instance mounts, as "METHOD /path", parameters filled in. */
function mountedEndpoints(): string[] {
  const api = getAuth().api as unknown as Record<
    string,
    { path?: string; options?: { method?: string | string[] } }
  >;
  const endpoints: string[] = [];
  for (const endpoint of Object.values(api)) {
    if (!endpoint.path) continue;
    const path = endpoint.path.replace(/:[^/]+/g, "x");
    // Every method, not only the declared ones: the allowlist is by method too.
    for (const method of ["GET", "POST"]) endpoints.push(`${method} ${path}`);
  }
  return endpoints;
}

function request(endpoint: string): Request {
  const [method, path] = endpoint.split(" ");
  const headers = new Headers({ cookie, origin: testOrigin(), "x-forwarded-for": "203.0.113.50" });
  if (method === "POST") headers.set("content-type", "application/json");
  return new Request(`${testOrigin()}/api/auth${path}`, {
    method,
    headers,
    body:
      method === "POST"
        ? JSON.stringify({ email, password: PASSWORD, newPassword: `${PASSWORD} nueva`, currentPassword: PASSWORD, name: "x", revokeOtherSessions: true })
        : undefined,
  });
}

describe("the endpoints Better Auth mounts", () => {
  it("are read off the instance, so the check below is not vacuous", () => {
    const endpoints = mountedEndpoints();
    expect(endpoints.length).toBeGreaterThan(40);
    expect(endpoints).toContain("POST /change-password");
    expect(endpoints).toContain("POST /revoke-sessions");
    expect(endpoints).toContain("POST /sign-up/email");
  });

  it("answer 404 unless allowed, and change nothing", async () => {
    const before = await snapshot();
    const answered: string[] = [];

    for (const endpoint of mountedEndpoints()) {
      if (ANSWERED.has(endpoint)) continue;
      const handle = endpoint.startsWith("GET") ? GET : POST;
      const response = await handle(request(endpoint));
      if (response.status !== 404) answered.push(`${endpoint} → ${response.status}`);
    }

    expect(answered).toEqual([]);
    expect(await snapshot()).toEqual(before);
    // And the browser is still signed in, which a forwarded sign-out or
    // revocation would have ended.
    const session = await GET(
      new Request(`${testOrigin()}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(((await session.json()) as { user?: { id: string } }).user?.id).toBe(userId);
  });
});

/**
 * Better Auth's own origin check, which it turns off when NODE_ENV is "test" —
 * the suites' environment — unless told otherwise. `disableOriginCheck: false`
 * is what keeps these suites running the check production runs.
 */
describe("a sign-in from a browser that already holds a cookie", () => {
  const device = () => crypto.randomUUID();

  it("is refused from an origin the instance does not trust", async () => {
    const answer = await signInWith(
      { email, password: PASSWORD },
      { deviceId: device(), origin: "https://evil.example" },
    );

    expect(answer.status).toBe(403);
    expect(answer.code).toBe("INVALID_ORIGIN");
    expect(answer.setCookie.some((line) => line.startsWith("stoky.session_token="))).toBe(false);
  });

  it("is refused with no origin at all", async () => {
    const response = await POST(
      new Request(`${testOrigin()}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${DEVICE_ID_COOKIE}=${device()}`,
          "x-forwarded-for": "203.0.113.51",
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("MISSING_OR_NULL_ORIGIN");
  });

  it("is accepted from the instance's own origin", async () => {
    const answer = await signInWith({ email, password: PASSWORD }, { deviceId: device() });

    expect(answer.status).toBe(200);
  });
});
