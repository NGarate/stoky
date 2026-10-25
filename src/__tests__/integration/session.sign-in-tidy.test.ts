import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signInWith } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * What a sign-in leaves behind it (PROGRESS D139, ASVS 5.0.0 7.2.4), through
 * the real route, Better Auth and the rows.
 *
 * Each "browser" is a cookie jar: the `Cookie` header one sign-in's answer
 * leaves, sent with the next. Whether a session still works is read back with
 * `readSession`, the read every page and tRPC call makes, so a row that is
 * gone is a cookie that stopped working, not a row count alone.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `tidy-${process.pid}-${Date.now().toString(36)}`;
let ana: { id: string; email: string };
let bea: { id: string; email: string };

beforeAll(async () => {
  for (const name of ["ana", "bea"] as const) {
    const email = generateTestEmail(`${MARKER}-${name}`);
    const user = await createTestUser({
      email,
      name: `Tidy ${MARKER} ${name}`,
      password: PASSWORD,
    });
    if (name === "ana") ana = { id: user.id, email };
    else bea = { id: user.id, email };
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

async function clearSessions(): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId: { in: [ana.id, bea.id] } },
  });
}

/** Signs `who` in, sending `jar` as the browser's cookies, and returns the new jar. */
async function signIn(who: { email: string }, jar?: string): Promise<string> {
  const answer = await signInWith(
    { email: who.email, password: PASSWORD },
    { cookie: jar },
  );
  expect(answer.status).toBe(200);
  return answer.cookieHeader;
}

const works = async (jar: string) =>
  (await readSession(new Headers({ cookie: jar }), { refresh: false })) !==
  null;
const rows = (userId: string) => prisma.session.findMany({ where: { userId } });

/** The security events written while `run` ran, parsed: every value a string, as the log writes it. */
async function eventsDuring(run: () => Promise<unknown>) {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let lines: string[];
  try {
    await run();
  } finally {
    lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
  }
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

describe("signing in again in the same browser", () => {
  it("ends the session the browser presented, leaving one row that works", async () => {
    await clearSessions();
    const first = await signIn(ana);
    const [old] = await rows(ana.id);
    expect(await works(first)).toBe(true); // the control

    // An hour into the old session, so a new one that inherited its clock
    // would show it.
    await prisma.session.update({
      where: { id: old.id },
      data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) },
    });

    const events = await eventsDuring(async () => {
      const second = await signIn(ana, first);
      expect(await works(second)).toBe(true);
    });

    const left = await rows(ana.id);
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(old.id);
    expect(await works(first)).toBe(false);
    // The new session counts its day from this sign-in, not the replaced one's.
    expect(Date.now() - left[0].authenticatedAt.getTime()).toBeLessThan(60_000);

    const ended = events.filter(
      (event) => event.event === "auth.session.ended",
    );
    expect(ended).toEqual([
      expect.objectContaining({
        reason: "replaced",
        userId: ana.id,
        targetUserId: ana.id,
        count: "1",
      }),
    ]);
  });

  it("ends another person's session on a shared device, and says whose", async () => {
    await clearSessions();
    const anas = await signIn(ana);

    const events = await eventsDuring(() => signIn(bea, anas));

    expect(await rows(ana.id)).toHaveLength(0);
    expect(await works(anas)).toBe(false);
    expect(await rows(bea.id)).toHaveLength(1);
    expect(
      events.filter((event) => event.event === "auth.session.ended"),
    ).toEqual([
      expect.objectContaining({
        reason: "replaced",
        userId: bea.id,
        targetUserId: ana.id,
        count: "1",
      }),
    ]);
  });

  it("ends nothing when the password is wrong", async () => {
    await clearSessions();
    const anas = await signIn(ana);

    const refused = await signInWith(
      { email: bea.email, password: "not the password" },
      { cookie: anas },
    );

    expect(refused.status).toBe(401);
    expect(await works(anas)).toBe(true);
  });
});

describe("signing in from another browser", () => {
  it("leaves the first browser's session alone", async () => {
    await clearSessions();
    const laptop = await signIn(ana);

    const events = await eventsDuring(() => signIn(ana));

    expect(await rows(ana.id)).toHaveLength(2);
    expect(await works(laptop)).toBe(true);
    // Nothing was replaced, so nothing is said.
    expect(
      events.filter((event) => event.event === "auth.session.ended"),
    ).toEqual([]);
  });

  it("leaves another account's sessions alone", async () => {
    await clearSessions();
    const beas = await signIn(bea);

    await signIn(ana);

    expect(await works(beas)).toBe(true);
  });
});

describe("expired rows", () => {
  it("are deleted at the account's next sign-in, from any browser", async () => {
    await clearSessions();
    await signIn(ana);
    const live = await signIn(ana);
    const [stale] = (await rows(ana.id)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    // A browser that was closed: its cookie is never sent again, so Better
    // Auth never reads the row to delete it.
    await prisma.session.update({
      where: { id: stale.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await signIn(ana);

    const left = await rows(ana.id);
    expect(left.map((row) => row.id)).not.toContain(stale.id);
    expect(left).toHaveLength(2);
    expect(await works(live)).toBe(true);
  });

  it("are left alone when they are another account's", async () => {
    await clearSessions();
    await signIn(bea);
    const [beas] = await rows(bea.id);
    await prisma.session.update({
      where: { id: beas.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await signIn(ana);

    expect(await rows(bea.id)).toHaveLength(1);
  });
});
