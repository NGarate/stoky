import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { clientAddress } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";

/**
 * This application's rules inside Better Auth, where the route cannot reach
 * (PROGRESS D135: hooks only where Better Auth's internals are unavoidable).
 *
 * **One TOTP code, one use** (PROGRESS D148, ASVS 5.0.0 6.5.1). Better Auth's
 * `/two-factor/verify-totp` accepts any code inside its window, as often as it
 * is sent: the spike signed in twice with one code. Nothing it stores says a
 * code was used, so the check has to happen before it looks, against a
 * column of ours (`TwoFactor.lastTotpCounter`), and the claim has to be the
 * same statement as the check, or two requests with one code both pass:
 *
 * 1. Find whose code it is the way Better Auth will: the session the request
 *    carries — a bearer token's too, which Better Auth shows the endpoint
 *    but not this hook (`requestSession`) — else the signed `two_factor`
 *    cookie's challenge.
 * 2. Decrypt the secret. A secret that no longer decrypts — `STOKY_SECRET`
 *    rotated — is refused here as `TWO_FACTOR_UNREADABLE`, before Better Auth
 *    counts anything: no number of attempts would make it right, and a
 *    lockout would be a second wrong answer.
 * 3. Work out which time step the code is for, of the three Better Auth
 *    accepts (now, one before, one after; the ±1 step is the ASVS 6.5.5
 *    deviation the owner accepted), comparing all three in constant time.
 * 4. **A match is claimed** with one conditional `UPDATE`: the step must be
 *    above the last one accepted. Zero rows is a replay (or a code older than
 *    one already used), refused as `INVALID_CODE`.
 * 5. **No match is made a certain failure**: the code is replaced with one no
 *    step can produce, so Better Auth refuses it *and counts it* — against the
 *    challenge's five attempts and the account lockout. Not passed through:
 *    Better Auth reads its own clock, and a request that crosses a step
 *    between this check and its own would let through a code for a step this
 *    guard never claimed.
 *
 * Coupled to Better Auth 1.7.7's internals: the `two_factor` cookie and the
 * challenge row it names, `secretConfig`, and how a before-hook's returned
 * body is merged. The version is pinned exactly, and
 * `integration/two-factor.test.ts` fails if any of them moves.
 */

/** Better Auth's defaults, which the instance does not change. */
export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now that Better Auth accepts. */
export const TOTP_WINDOW = 1;

/** What a code that matched no step becomes: nothing six digits long. */
export const NO_MATCH_CODE = "stoky-no-match";

/**
 * The guard's clock. Better Auth reads `Date.now()` on its own; a test moves
 * this one alone to make the two disagree, the case step 5 exists for.
 */
export const totpClock = { now: (): number => Date.now() };

/** RFC 4226 HOTP: HMAC-SHA-1 keyed with the secret as Better Auth stores it (its UTF-8 bytes). */
export function hotp(secret: string, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const truncated = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return truncated.toString().padStart(digits, "0");
}

/** The time step `at` (milliseconds) falls in. */
export function totpStep(at: number): number {
  return Math.floor(at / (TOTP_PERIOD_S * 1000));
}

/**
 * The step `code` is the code for, of the window around `at`, or null.
 *
 * Every candidate is computed and compared whatever the earlier ones gave, so
 * how long this takes does not say which step matched, or whether one did.
 */
export function matchingStep(secret: string, code: string, at: number): number | null {
  const now = totpStep(at);
  const given = Buffer.from(code.padEnd(TOTP_DIGITS, "\0").slice(0, 64));
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step += 1) {
    const expected = Buffer.from(hotp(secret, step).padEnd(given.length, "\0"));
    const equal = timingSafeEqual(given, expected) && code.length === TOTP_DIGITS;
    if (equal && matched === null) matched = step;
  }
  return matched;
}

/** The row Better Auth's two-factor table holds, as its adapter returns it. */
interface TwoFactorRow {
  id: string;
  secret: string;
  verified?: boolean | null;
}

/** The parts of Better Auth's context the guard reads; typed loosely on purpose. */
interface GuardContext {
  body?: Record<string, unknown>;
  headers?: Headers;
  getSignedCookie: (name: string, secret: string) => Promise<string | null>;
  context: {
    secret: string;
    secretConfig: Parameters<typeof symmetricDecrypt>[0]["key"];
    createAuthCookie: (name: string) => { name: string };
    adapter: {
      findOne: <T>(query: {
        model: string;
        where: { field: string; value: string }[];
      }) => Promise<T | null>;
    };
    internalAdapter: {
      findVerificationValue: (
        identifier: string,
      ) => Promise<{ value: string; expiresAt: Date } | null>;
    };
  };
}

/** A plugin's before-hooks, as Better Auth's options hold them. */
interface PluginHooks {
  id?: string;
  hooks?: {
    before?: {
      matcher: (context: never) => boolean;
      handler: (context: never) => Promise<unknown>;
    }[];
  };
}

/**
 * The session the endpoint will be served as, which is not always the one
 * `getSessionFromCtx` finds from inside a hook.
 *
 * **A bearer token is a session only to the endpoint.** The bearer plugin
 * turns `Authorization: Bearer` into the session cookie by returning new
 * headers from its before-hook, and Better Auth applies a hook's returned
 * context to the endpoint alone: every other before-hook is handed the
 * request as it came (`runBeforeHooks`, Better Auth 1.7.7). Read from there,
 * a native client's request has no session, so a check that found none and
 * stood aside let a bearer token turn an authenticator on without its first
 * code being claimed.
 *
 * So the bearer plugin's own hook is run here first, and the session read
 * from the headers it would give the endpoint: the same token check, the same
 * signature, the same answer. Better Auth keeps the session it finds on the
 * request's context, and the endpoint then reads that one.
 */
async function requestSession(raw: unknown): Promise<{
  session?: { id?: string } | null;
  user?: { id?: string } | null;
} | null> {
  const ctx = raw as {
    headers?: Headers;
    context: { options: { plugins?: PluginHooks[] } };
  };
  let headers = ctx.headers;
  if (headers?.has("authorization")) {
    const bearer = ctx.context.options.plugins?.find((plugin) => plugin.id === "bearer");
    for (const hook of bearer?.hooks?.before ?? []) {
      if (!hook.matcher(ctx as never)) continue;
      const result = (await hook.handler({ ...ctx, returnHeaders: true } as never)) as {
        response?: { context?: { headers?: unknown } };
      } | null;
      const converted = result?.response?.context?.headers;
      if (converted instanceof Headers) headers = converted;
    }
  }
  return getSessionFromCtx({ ...ctx, headers } as never, { disableRefresh: true });
}

/**
 * Whose code this request is offering, found the way Better Auth's
 * `verifyTwoFactor` finds it: the session first — a bearer token's included
 * (`requestSession`) — else the challenge the signed `two_factor` cookie
 * names. Null when neither holds; Better Auth then refuses the request
 * itself.
 */
async function codeOwner(ctx: GuardContext): Promise<{ userId: string; signIn: boolean } | null> {
  const session = await requestSession(ctx);
  if (session?.user?.id) return { userId: session.user.id, signIn: false };

  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const challenge = await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now()) return null;
  return { userId: challenge.value, signIn: true };
}

export interface PolicyPluginOptions {
  /** Where `lastTotpCounter` is claimed: the application's client. */
  db: Pick<PrismaClient, "$executeRaw">;
}

export function stokyPolicy({ db }: PolicyPluginOptions) {
  return {
    id: "stoky-policy",
    hooks: {
      before: [
        {
          matcher: (context: { path?: string }) => context.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as GuardContext;
            const code = ctx.body?.code;
            // Not a string: Better Auth's own schema refuses it.
            if (typeof code !== "string") return;

            const owner = await codeOwner(ctx);
            if (!owner) return;
            const row = await ctx.context.adapter.findOne<TwoFactorRow>({
              model: "twoFactor",
              where: [{ field: "userId", value: owner.userId }],
            });
            // Nothing to guard: Better Auth answers TOTP_NOT_ENABLED.
            if (!row || (owner.signIn && row.verified === false)) return;

            const address = ctx.headers ? clientAddress(ctx.headers) : undefined;
            let secret: string;
            try {
              secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
            } catch {
              logSecurityEvent("auth.twofactor.unreadable", { userId: owner.userId, address });
              throw new APIError("UNAUTHORIZED", {
                code: "TWO_FACTOR_UNREADABLE",
                message: "The authenticator secret cannot be read with this server's secret",
              });
            }

            const step = matchingStep(secret, code, totpClock.now());
            if (step === null) {
              return { context: { body: { ...ctx.body, code: NO_MATCH_CODE } } };
            }

            // The check and the claim in one statement; a tagged template, so
            // every value is a bound parameter.
            const claimed = await db.$executeRaw`
              UPDATE "TwoFactor" SET "lastTotpCounter" = ${step}
              WHERE id = ${row.id}
                AND ("lastTotpCounter" IS NULL OR "lastTotpCounter" < ${step})`;
            if (claimed === 0) {
              logSecurityEvent("auth.twofactor.replayed", { userId: owner.userId, address });
              throw new APIError("UNAUTHORIZED", { code: "INVALID_CODE", message: "Invalid code" });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
