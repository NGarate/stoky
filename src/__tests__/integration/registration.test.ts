import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { createPrismaClient, prisma } from "@/lib/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { createCredentialUser } from "@/lib/auth/credentials";
import {
  REGISTRATION_CLOSED_MESSAGE,
  REGISTRATION_ENV,
  REGISTRATION_LOCK_KEY,
} from "@/lib/auth/registration";

/**
 * `STOKY_REGISTRATION` against a real PostgreSQL: who `auth.register` lets in,
 * in what order it decides, and that two people claiming a fresh instance at
 * once cannot both win.
 *
 * **On a database of its own.** `first-user` is a statement about every
 * account on the instance — "there are none yet" — and the suite's shared
 * database has accounts from every other file in it. Emptying that one would
 * delete other suites' rows; counting around them would test arithmetic, not
 * the guard. So this file creates `<test database>_registration`, migrates it
 * the way the runner migrates the suite's own, hands its client to the router
 * through the context's `db` (the seam Phase 4 put there for transactions), and
 * drops it afterwards. Nothing here writes to the shared database.
 */

const ROOT = join(import.meta.dir, "../../..");
const RUN = `reg-${process.pid}-${Date.now().toString(36)}`;
const PASSWORD = "cocina despensa nevera";

function isolatedDatabaseUrl(): { url: string; name: string } {
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error(
      "DATABASE_URL is not set; run through `bun run test:integration`.",
    );
  const url = new URL(base);
  const name = `${url.pathname.slice(1)}_registration`;
  // An identifier cannot be a bind parameter, so it is checked instead: this
  // name is interpolated into CREATE and DROP DATABASE below.
  if (!/^[a-z0-9_]+$/.test(name))
    throw new Error(`Refusing database name ${JSON.stringify(name)}`);
  url.pathname = `/${name}`;
  return { url: url.toString(), name };
}

const isolated = isolatedDatabaseUrl();
let db: PrismaClient;

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${isolated.name}" WITH (FORCE)`,
  );
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${isolated.name}"`);

  const migrate = Bun.spawnSync(
    ["bunx", "--bun", "prisma", "migrate", "deploy"],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: isolated.url },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (migrate.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`,
    );
  }

  db = createPrismaClient(isolated.url);
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await prisma.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${isolated.name}" WITH (FORCE)`,
  );
});

const env = process.env as Record<string, string | undefined>;
const savedEnv = {
  mode: env[REGISTRATION_ENV],
  attempts: env.RATE_LIMIT_REGISTER_ATTEMPTS,
};

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

beforeEach(async () => {
  // This database only. Every test starts from a fresh instance's state.
  await db.user.deleteMany();
  await db.household.deleteMany();
});

afterEach(() => {
  restore(REGISTRATION_ENV, savedEnv.mode);
  restore("RATE_LIMIT_REGISTER_ATTEMPTS", savedEnv.attempts);
});

async function callerOn(database: PrismaClient, address?: string) {
  const ctx = await createTRPCContext({
    session: null,
    db: database,
    headers: address ? new Headers({ "x-forwarded-for": address }) : undefined,
  });
  return appRouter.createCaller(ctx);
}

const account = (suffix: string, householdName?: string) => ({
  email: `${RUN}.${suffix}@example.com`,
  name: "Registro",
  password: PASSWORD,
  ...(householdName ? { householdName } : {}),
});

async function refusal(call: Promise<unknown>): Promise<TRPCError> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    return error as TRPCError;
  }
  throw new Error("expected the call to be refused, and it succeeded");
}

/**
 * A client that fails on any use. Handed to a closed instance's router to show
 * the refusal touches no database at all — not a count, not a lookup.
 */
const untouchable = new Proxy({} as PrismaClient, {
  get(_target, property) {
    throw new Error(`the database was used: ${String(property)}`);
  },
});

describe("closed", () => {
  it("refuses everybody, the first account included, and creates nothing", async () => {
    env[REGISTRATION_ENV] = "closed";
    const caller = await callerOn(db);

    const refused = await refusal(
      caller.auth.register(account("first", `Casa ${RUN}`)),
    );

    expect(refused.code).toBe("FORBIDDEN");
    expect(refused.message).toBe(REGISTRATION_CLOSED_MESSAGE);
    expect(await db.user.count()).toBe(0);
    expect(await db.household.count()).toBe(0);
  });

  it("refuses before the limiter and before any query", async () => {
    // One registration an hour from this address. If the limiter ran first,
    // the second refusal would be TOO_MANY_REQUESTS — a closed instance
    // spending a stranger's budget, and Valkey, on a door that is shut.
    env[REGISTRATION_ENV] = "closed";
    env.RATE_LIMIT_REGISTER_ATTEMPTS = "1";
    const caller = await callerOn(untouchable, `${RUN}-closed`);

    for (const attempt of ["a", "b", "c"]) {
      const refused = await refusal(caller.auth.register(account(attempt)));
      expect(refused.code).toBe("FORBIDDEN");
    }
  });
});

describe("first-user", () => {
  it("lets exactly the first account in, as the owner of its household", async () => {
    env[REGISTRATION_ENV] = "first-user";
    const caller = await callerOn(db);

    const first = await caller.auth.register(account("owner", `Casa ${RUN}`));
    expect(first.success).toBe(true);
    const owner = await db.user.findUnique({
      where: { email: first.user.email },
    });
    expect(owner?.role).toBe("OWNER");
    expect(owner?.householdId).not.toBeNull();

    const refused = await refusal(
      caller.auth.register(account("second", `Otra ${RUN}`)),
    );
    expect(refused.code).toBe("FORBIDDEN");
    expect(refused.message).toBe(REGISTRATION_CLOSED_MESSAGE);
    expect(await db.user.count()).toBe(1);
    expect(await db.household.count()).toBe(1);
  });

  it("refuses an address that exists the same way, so it cannot be used to ask", async () => {
    env[REGISTRATION_ENV] = "first-user";
    const caller = await callerOn(db);
    await caller.auth.register(account("owner"));

    // The same address again: CONFLICT would say "this one is registered".
    const refused = await refusal(caller.auth.register(account("owner")));
    expect(refused.code).toBe("FORBIDDEN");
  });

  it("counts accounts only after the limiter has counted the caller", async () => {
    env[REGISTRATION_ENV] = "first-user";
    env.RATE_LIMIT_REGISTER_ATTEMPTS = "1";
    await (await callerOn(db)).auth.register(account("owner"));
    const caller = await callerOn(db, `${RUN}-first-user`);

    expect((await refusal(caller.auth.register(account("a")))).code).toBe(
      "FORBIDDEN",
    );
    expect((await refusal(caller.auth.register(account("b")))).code).toBe(
      "TOO_MANY_REQUESTS",
    );
  });

  it("lets only one of two simultaneous claims of a fresh instance through", async () => {
    // Both read zero accounts before either has hashed its password — the
    // quarter-second of Argon2id is the window — so only the re-count inside
    // the locked transaction can tell them apart.
    env[REGISTRATION_ENV] = "first-user";
    const caller = await callerOn(db);

    const results = await Promise.allSettled([
      caller.auth.register(account("left", `Izquierda ${RUN}`)),
      caller.auth.register(account("right", `Derecha ${RUN}`)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      TRPCError,
    );
    expect(((rejected as PromiseRejectedResult).reason as TRPCError).code).toBe(
      "FORBIDDEN",
    );
    expect(await db.user.count()).toBe(1);
    // The loser's household was never written, rather than written and left.
    expect(await db.household.count()).toBe(1);
  });
  it("waits for a claim in progress, then counts it", async () => {
    // The race above is real but its window is a few milliseconds, so it does
    // not prove the lock: measured, removing only the lock left it green. This
    // holds the lock open on purpose. A registration that takes it waits here,
    // sees the account this transaction commits, and is refused; one that does
    // not take it counts zero, creates a second account, and fails below.
    env[REGISTRATION_ENV] = "first-user";
    const caller = await callerOn(db);
    let settled = false;

    // Returned wrapped: an async callback that returned the promise itself
    // would wait for it before committing — on the lock it is holding.
    const { outcome } = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`;

        const attempt = caller.auth.register(
          account("waiting", `Espera ${RUN}`),
        );
        const outcome = attempt.then(
          () => "registered",
          (error: unknown) => error,
        );
        void outcome.finally(() => {
          settled = true;
        });

        // Until the registration is queued on the lock — or has finished
        // without ever asking for it.
        const deadline = Date.now() + 10_000;
        for (;;) {
          const [{ waiting }] = await db.$queryRaw<[{ waiting: number }]>`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
          if (waiting > 0 || settled) break;
          if (Date.now() > deadline)
            throw new Error("the registration neither waited nor finished");
          await Bun.sleep(20);
        }

        await tx.user.create({
          data: { email: `${RUN}.holder@example.com`, name: "Holder" },
        });
        return { outcome };
      },
      { timeout: 20_000 },
    );

    const registering = await outcome;
    expect(registering).toBeInstanceOf(TRPCError);
    expect((registering as TRPCError).code).toBe("FORBIDDEN");
    expect(await db.user.count()).toBe(1);
  }, 30_000);
});

describe("open", () => {
  it("lets several accounts register, each with its own household", async () => {
    env[REGISTRATION_ENV] = "open";
    const caller = await callerOn(db);

    for (const suffix of ["uno", "dos", "tres"]) {
      const result = await caller.auth.register(
        account(suffix, `Casa ${suffix} ${RUN}`),
      );
      expect(result.success).toBe(true);
    }

    expect(await db.user.count()).toBe(3);
    expect(await db.household.count()).toBe(3);
    // Each with the credential row its password lives in, keyed on its own id.
    const users = await db.user.findMany({ select: { id: true } });
    for (const { id } of users) {
      expect(
        await db.account.count({
          where: { userId: id, accountId: id, providerId: "credential" },
        }),
      ).toBe(1);
    }
  });

  it("leaves no household behind when two registrations race for one address", async () => {
    // Both pass the courtesy existence check; the unique index refuses the
    // second. The household used to be a separate write before the account's,
    // so the loser left one that nobody belonged to.
    env[REGISTRATION_ENV] = "open";
    const caller = await callerOn(db);

    const results = await Promise.allSettled([
      caller.auth.register(account("same", `Primera ${RUN}`)),
      caller.auth.register(account("same", `Segunda ${RUN}`)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === "rejected");
    expect(((rejected as PromiseRejectedResult).reason as TRPCError).code).toBe(
      "CONFLICT",
    );
    expect(await db.user.count()).toBe(1);
    expect(await db.household.count()).toBe(1);
    expect(await db.household.count({ where: { members: { none: {} } } })).toBe(
      0,
    );
  });

  it("a failure after the user insert leaves no orphan user or account", async () => {
    // The account is two rows now, the user and its credential Account, and
    // the second can fail after the first is written. The household and the
    // user must go with it: a user without a credential cannot sign in and
    // holds its address against registering again.
    env[REGISTRATION_ENV] = "open";
    const caller = await callerOn(db);

    await refuseCredentialRows(async () => {
      await expect(
        caller.auth.register(account("orphan", `Huérfana ${RUN}`)),
      ).rejects.toThrow();
    });

    expect(await db.user.count()).toBe(0);
    expect(await db.account.count()).toBe(0);
    expect(await db.household.count()).toBe(0);
  });
});

/**
 * `household.addMember` and the test factories hand `createCredentialUser` the
 * root client rather than a transaction, so the module opens its own. Checked
 * here because this file owns a database where Account inserts can be made to
 * fail without touching any other suite's.
 */
describe("an account made with the root client", () => {
  it("is not left without its credential row when that insert fails", async () => {
    await refuseCredentialRows(async () => {
      await expect(
        createCredentialUser(
          db,
          { email: `${RUN}.root@example.com`, name: "Raíz", role: "MEMBER" },
          "$argon2id$not-checked-here",
        ),
      ).rejects.toThrow();
    });

    expect(await db.user.count()).toBe(0);
    expect(await db.account.count()).toBe(0);
  });
});

/** Runs `body` while this database refuses every new Account row. */
async function refuseCredentialRows(body: () => Promise<void>): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE FUNCTION refuse_account_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Account inserts are refused by this test'; END $$`);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER refuse_account_insert BEFORE INSERT ON "Account"
    FOR EACH ROW EXECUTE FUNCTION refuse_account_insert()`);
  try {
    await body();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER refuse_account_insert ON "Account"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION refuse_account_insert()`);
  }
}
