import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readSession } from "@/lib/auth";
import { MAX_SESSIONS_PER_ACCOUNT } from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { signInWith } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * Ten sessions per account (PROGRESS D140, ASVS 5.0.0 7.1.2), through the
 * real route, Better Auth and the rows.
 *
 * Each "browser" is a cookie jar, as in `session.sign-in-tidy.test.ts`, and
 * whether a session still works is read back with `readSession`, so a row the
 * cap ended is a cookie that stopped working.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `cap-${process.pid}-${Date.now().toString(36)}`;
let ana: { id: string; email: string };

beforeAll(async () => {
  const email = generateTestEmail(MARKER);
  const user = await createTestUser({ email, name: `Cap ${MARKER}`, password: PASSWORD });
  ana = { id: user.id, email };
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

async function clearSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { userId: ana.id } });
}

/** Signs Ana in, sending `jar` as the browser's cookies, and returns the new jar. */
async function signIn(jar?: string): Promise<string> {
  const answer = await signInWith({ email: ana.email, password: PASSWORD }, { cookie: jar });
  expect(answer.status).toBe(200);
  return answer.cookieHeader;
}

/** Signs in from `n` separate browsers, one after another, oldest first. */
async function signInFrom(n: number): Promise<string[]> {
  const jars: string[] = [];
  for (let i = 0; i < n; i += 1) jars.push(await signIn());
  return jars;
}

const works = async (jar: string) =>
  (await readSession(new Headers({ cookie: jar }), { refresh: false })) !== null;
const rows = () =>
  prisma.session.findMany({ where: { userId: ana.id }, orderBy: { createdAt: "asc" } });

/** The `auth.session.ended` lines written while `run` ran, parsed: every value a string. */
async function endedDuring(run: () => Promise<unknown>) {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let lines: string[];
  try {
    await run();
  } finally {
    lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
  }
  return {
    raw: lines,
    ended: lines.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return parsed.event === "auth.session.ended" ? [parsed] : [];
      } catch {
        return [];
      }
    }),
  };
}

describe("the eleventh sign-in", () => {
  it("ends the least recently used session, not the oldest", async () => {
    expect(MAX_SESSIONS_PER_ACCOUNT).toBe(10);
    await clearSessions();
    const jars = await signInFrom(10);
    const created = await rows();
    expect(created).toHaveLength(10);

    // The first browser is the one in use: the keep-alive slid its row, so it
    // is the most recently used although it is the oldest. The second is now
    // the least recently used.
    await prisma.session.update({ where: { id: created[0].id }, data: { updatedAt: new Date() } });

    const { raw, ended } = await endedDuring(() => signIn());

    const left = await rows();
    expect(left).toHaveLength(10);
    expect(left.map((row) => row.id)).toContain(created[0].id);
    expect(left.map((row) => row.id)).not.toContain(created[1].id);
    expect(await works(jars[1])).toBe(false);
    expect(await works(jars[0])).toBe(true);

    expect(ended).toEqual([
      expect.objectContaining({ reason: "evicted", userId: ana.id, targetUserId: ana.id, count: "1" }),
    ]);
    // No token reaches the log, whichever row it names.
    for (const row of [...created, ...left]) {
      expect(raw.join("\n")).not.toContain(row.token);
    }
  });

  it("is a re-sign-in that ends only the session its browser presented", async () => {
    await clearSessions();
    const jars = await signInFrom(10);
    const before = await rows();

    const { ended } = await endedDuring(() => signIn(jars[4]));

    const left = await rows();
    expect(left).toHaveLength(10);
    // Only the presented row went; every other browser keeps its session.
    expect(before.filter((row) => !left.some((kept) => kept.id === row.id))).toEqual([
      expect.objectContaining({ id: before[4].id }),
    ]);
    expect(await works(jars[0])).toBe(true);
    expect(ended.map((line) => line.reason)).toEqual(["replaced"]);
  });
});

describe("sign-ins at the same moment", () => {
  it("leave exactly ten sessions", async () => {
    await clearSessions();
    await signInFrom(9);

    await Promise.all([signIn(), signIn(), signIn()]);

    expect(await rows()).toHaveLength(10);
  });
});
