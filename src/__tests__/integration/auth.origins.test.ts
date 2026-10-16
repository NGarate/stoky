import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * Which origins may sign in, through the real auth route, with the list in
 * `STOKY_URLS` (PROGRESS D138).
 *
 * The case the list exists for: a plain-HTTP LAN install reached both by name
 * and by address. With one URL, a browser that already held a cookie answered
 * 403 at whichever address the URL did not name. Every listed origin is now
 * trusted, and in production nothing else is — `DEV_ALLOWED_ORIGIN`, which
 * development adds, included.
 *
 * Each configuration runs in a process of its own, because the instance is
 * built once per process from the environment it starts with. The child
 * signs in through `signInWith`, the helper every other suite uses, against
 * this suite's database and cache.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `origins-${process.pid}-${Date.now().toString(36)}`;
const FIRST = "http://stoky.lan:3000";
const SECOND = "http://192.168.1.10:3000";
/**
 * The child's own signing key, at least the 32 characters production demands
 * (`src/lib/auth/secret.ts`). Inheriting the outer one made the production
 * case pass or fail on whichever secret the runner exported: the local script
 * sets 39 characters, CI sets 25, and the child refused to start in CI.
 */
const CHILD_SECRET = "origins-suite-child-secret-not-a-real-one";
let email: string;

beforeAll(async () => {
  email = generateTestEmail(MARKER);
  await createTestUser({ email, name: `Origins ${MARKER}`, password: PASSWORD });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

interface Answer {
  status: number;
  code: string | undefined;
}

/**
 * Signs in once per origin, each from a browser that already holds a device
 * cookie — the one a forging page could make post here — in a fresh process
 * built with `env`.
 */
function signInFrom(origins: string[], env: Record<string, string>): Answer[] {
  const base: Record<string, string | undefined> = { ...process.env };
  delete base.NEXT_PHASE;
  const script = `const { signInWith } = await import("@/__tests__/utils/authorize");
    const origins = JSON.parse(process.env.ORIGINS_UNDER_TEST);
    const answers = [];
    for (const origin of origins) {
      const answer = await signInWith(
        { email: process.env.EMAIL_UNDER_TEST, password: process.env.PASSWORD_UNDER_TEST },
        { deviceId: crypto.randomUUID(), origin },
      );
      answers.push({ status: answer.status, code: answer.code });
    }
    console.log(JSON.stringify(answers));
    process.exit(0);`;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    cwd: join(import.meta.dir, "../../.."),
    env: {
      ...base,
      // Empty rather than absent: Bun loads `.env` for a key that is absent.
      NEXTAUTH_URL: "",
      NEXTAUTH_SECRET: "",
      STOKY_SECRET: CHILD_SECRET,
      DEV_ALLOWED_ORIGIN: "",
      ...env,
      ORIGINS_UNDER_TEST: JSON.stringify(origins),
      EMAIL_UNDER_TEST: email,
      PASSWORD_UNDER_TEST: PASSWORD,
    },
  });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return JSON.parse(child.stdout.toString().trim().split("\n").at(-1)!) as Answer[];
}

describe("a sign-in with two addresses listed", () => {
  it("is accepted at either one, and refused from anywhere else, in production", () => {
    const [first, second, unlisted, developmentHost] = signInFrom(
      [FIRST, SECOND, "https://evil.example", "http://192.168.1.20:3000"],
      {
        NODE_ENV: "production",
        STOKY_URLS: `${FIRST}, ${SECOND}`,
        // Read only outside production: listing a host here must not let it in.
        DEV_ALLOWED_ORIGIN: "192.168.1.20",
        PORT: "3000",
      },
    );

    expect(first).toEqual({ status: 200, code: undefined });
    // Not 403: the second address is as much this instance as the first.
    expect(second).toEqual({ status: 200, code: undefined });
    expect(unlisted).toEqual({ status: 403, code: "INVALID_ORIGIN" });
    expect(developmentHost).toEqual({ status: 403, code: "INVALID_ORIGIN" });
  });

  it("trusts a DEV_ALLOWED_ORIGIN host outside production, which is what it is for", () => {
    // The contrast to the last case above: the same host, the same request,
    // and only NODE_ENV differs.
    const [developmentHost] = signInFrom(["http://192.168.1.20:3000"], {
      NODE_ENV: "development",
      STOKY_URLS: `${FIRST}, ${SECOND}`,
      DEV_ALLOWED_ORIGIN: "192.168.1.20",
      PORT: "3000",
    });

    expect(developmentHost).toEqual({ status: 200, code: undefined });
  });
});
