import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { hashBackupCode } from "@/lib/auth/backup-codes";
import { STEP_UP_REQUIRED, hasStepUp } from "@/lib/auth/step-up";
import { REMEMBER_HEADER } from "@/lib/auth/session-policy";
import {
  RateLimitUnavailableError,
  clientAddress,
  consumeRateLimit,
  refundRateLimit,
  twoFactorCodeRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";
import type { SignInLimiter } from "@/lib/auth/sign-in-policy";
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
 * **A day's wrong codes are bounded per account** (PROGRESS D148). Better
 * Auth locks the second step for fifteen minutes after ten wrong codes and
 * forgets them when the lock ends, and a password holder opens a new
 * challenge for nothing, so its limits alone bound a guesser to about 960
 * codes a day, for ever. A sign-in's code is charged to
 * `twoFactorCodeRateLimit` (twenty a day) before it is compared, and a code
 * that is claimed gives its attempt back; past the budget every code is
 * refused `TOO_MANY_WRONG_CODES` until the window ends.
 *
 * **A backup code is compared as its hash** (PROGRESS D149, ASVS 5.0.0
 * 6.5.2). The codes are stored as `sha256:<hex>` (`src/lib/auth/backup-codes.ts`)
 * and Better Auth looks for the typed code in the stored list as it is, so
 * `/two-factor/verify-backup-code` is given the typed code's hash instead.
 * Always hashed, whatever was typed: a stored hash sent as the code is hashed
 * again and matches nothing, so reading the column is not a way in.
 *
 * **A passkey is added or removed only after the password** (PROGRESS D151,
 * ASVS 5.0.0 7.5.1). Better Auth asks for a session alone, so a tablet left
 * signed in could add its holder's passkey to somebody else's account. Asking
 * for the registration options needs a step-up this session holds
 * (`src/lib/auth/step-up.ts`); the registration and the removal spend it.
 * Refused as `STEP_UP_REQUIRED` (403) otherwise. Every role may, the
 * kitchen's shared account included (the owner's decision of 2026-10-15).
 *
 * **A session read never signs a browser out** (PROGRESS D144): Better
 * Auth's `get-session` expires the session cookie when the row it names is
 * gone, and a request sent with this device's old cookie just before a
 * rotation would then delete the new one. Those expiring lines are taken out
 * of every `get-session` answer.
 *
 * **A registration never signs anybody in**: `createSession` is forced off.
 * The person registering already has a session, and a second, made by a
 * passkey nobody has used yet, would be one the route never tidied.
 *
 * **A passkey sign-in keeps the remember-me choice** (D141). Better Auth
 * sets the session cookie with ninety days' `Max-Age` whatever was asked; the
 * row is already a browser session (the create hook read `x-stoky-remember`),
 * so for an unticked box the cookie is set again as a browser cookie, and the
 * first `Set-Cookie` for it is taken out, so the answer carries one.
 *
 * Coupled to Better Auth 1.7.7's internals: the `two_factor` cookie and the
 * challenge row it names, `secretConfig`, how a before-hook's returned body
 * is merged (`defu`: a value given replaces, `undefined` does not), how a
 * backup code is looked up (`includes` over the decoded list, then a write
 * conditional on the list read), and how an after-hook's cookies are added to
 * the endpoint's. The version is pinned exactly, and
 * `integration/two-factor.test.ts` and `integration/passkeys.test.ts` fail if
 * any of them moves.
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
export function hotp(
  secret: string,
  counter: number,
  digits: number = TOTP_DIGITS,
): string {
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
export function matchingStep(
  secret: string,
  code: string,
  at: number,
): number | null {
  const now = totpStep(at);
  const given = Buffer.from(code.padEnd(TOTP_DIGITS, "\0").slice(0, 64));
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step += 1) {
    const expected = Buffer.from(hotp(secret, step).padEnd(given.length, "\0"));
    const equal =
      timingSafeEqual(given, expected) && code.length === TOTP_DIGITS;
    if (equal && matched === null) matched = step;
  }
  return matched;
}

/** The row Better Auth's two-factor table holds, as its adapter returns it. */
interface TwoFactorRow {
  id: string;
  secret: string;
  verified?: boolean | null;
  lockedUntil?: Date | string | null;
}

/**
 * Better Auth's account lockout of the second step, which the instance does
 * not change: ten wrong codes in a row lock it for this long.
 */
export const TWO_FACTOR_LOCK_S = 15 * 60;

/**
 * How long the second step of `ctx`'s account stays locked, in whole
 * seconds: from the row's `lockedUntil`, or the whole lock when the row or
 * its owner cannot be read.
 */
async function lockedFor(ctx: GuardContext): Promise<number> {
  const owner = await codeOwner(ctx).catch(() => null);
  const row = owner
    ? await ctx.context.adapter
        .findOne<TwoFactorRow>({
          model: "twoFactor",
          where: [{ field: "userId", value: owner.userId }],
        })
        .catch(() => null)
    : null;
  const until = row?.lockedUntil
    ? new Date(row.lockedUntil).getTime()
    : Number.NaN;
  if (Number.isNaN(until)) return TWO_FACTOR_LOCK_S;
  return Math.max(1, Math.ceil((until - Date.now()) / 1000));
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
 * stood aside let a bearer token add a passkey without the step-up, and turn
 * an authenticator on without its first code being claimed.
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
    const bearer = ctx.context.options.plugins?.find(
      (plugin) => plugin.id === "bearer",
    );
    for (const hook of bearer?.hooks?.before ?? []) {
      if (!hook.matcher(ctx as never)) continue;
      const result = (await hook.handler({
        ...ctx,
        returnHeaders: true,
      } as never)) as {
        response?: { context?: { headers?: unknown } };
      } | null;
      const converted = result?.response?.context?.headers;
      if (converted instanceof Headers) headers = converted;
    }
  }
  return getSessionFromCtx({ ...ctx, headers } as never, {
    disableRefresh: true,
  });
}

/**
 * Whose code this request is offering, found the way Better Auth's
 * `verifyTwoFactor` finds it: the session first — a bearer token's included
 * (`requestSession`) — else the challenge the signed `two_factor` cookie
 * names. Null when neither holds; Better Auth then refuses the request
 * itself.
 */
async function codeOwner(
  ctx: GuardContext,
): Promise<{ userId: string; signIn: boolean } | null> {
  const session = await requestSession(ctx);
  if (session?.user?.id) return { userId: session.user.id, signIn: false };

  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const challenge =
    await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now())
    return null;
  return { userId: challenge.value, signIn: true };
}

export interface PolicyPluginOptions {
  /**
   * The application's client: where `lastTotpCounter` is claimed, and where a
   * step-up is found and spent.
   */
  db: Pick<PrismaClient, "$executeRaw" | "verification">;
  /**
   * Where the wrong codes of a sign-in's second step are counted per account
   * (`twoFactorCodeRateLimit`); Valkey unless a test passes its own.
   */
  limiter?: Pick<SignInLimiter, "consume" | "refund">;
}

const valkeyCodeLimiter: Pick<SignInLimiter, "consume" | "refund"> = {
  consume: consumeRateLimit,
  refund: refundRateLimit,
};

/**
 * One code of a sign-in's second step, charged to its account's daily
 * budget before it is looked at (`twoFactorCodeRateLimit`). Refused 429
 * `TOO_MANY_WRONG_CODES`, with `Retry-After`, once the budget is spent —
 * the right code included, or the budget would bound nothing — and 503
 * when the limiter cannot be reached, failing closed like every limit on a
 * credential.
 */
async function chargeCode(
  limiter: Pick<SignInLimiter, "consume" | "refund">,
  userId: string,
): Promise<RateLimitResult> {
  let charge: RateLimitResult;
  try {
    charge = await limiter.consume(twoFactorCodeRateLimit(), userId);
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) throw error;
    console.error(
      "[auth] refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
    );
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "AUTH_UNAVAILABLE",
      message: "Sign-in is temporarily unavailable",
    });
  }
  if (!charge.allowed) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      {
        code: "TOO_MANY_WRONG_CODES",
        message: "Too many wrong codes for this account",
      },
      {
        "retry-after": String(Math.max(1, Math.ceil(charge.retryAfterSeconds))),
      },
    );
  }
  return charge;
}

/** The passkey endpoints that need a step-up, and whether each spends it. */
const STEP_UP_PATHS: Record<string, { spend: boolean }> = {
  "/passkey/generate-register-options": { spend: false },
  "/passkey/verify-registration": { spend: true },
  "/passkey/delete-passkey": { spend: true },
};

/**
 * Refuses the request unless the session it carries — a bearer token's
 * included (`requestSession`) — holds a step-up, spent when `spend` says so.
 * No session is refused here too, 401, rather than left to Better Auth: a
 * check that stands aside whenever it finds no session is one that a
 * session it cannot see walks past.
 */
async function requireStepUp(
  raw: unknown,
  db: PolicyPluginOptions["db"],
  spend: boolean,
): Promise<void> {
  const session = await requestSession(raw);
  if (!session?.session?.id || !session.user?.id) {
    throw new APIError("UNAUTHORIZED", {
      code: "UNAUTHORIZED",
      message: "Sign in first",
    });
  }
  const held = await hasStepUp(db, {
    sessionId: session.session.id,
    userId: session.user.id,
    spend,
  });
  if (!held) {
    throw new APIError("FORBIDDEN", {
      code: STEP_UP_REQUIRED,
      message: "Confirm your password before changing your passkeys",
    });
  }
}

/** The parts of an after-hook's context the passkey cookie re-set reads. */
interface CookieContext {
  headers?: Headers;
  context: {
    newSession: Parameters<typeof setSessionCookie>[1] | null;
    authCookies: { sessionToken: { name: string } };
    responseHeaders?: Headers;
  };
}

/**
 * Takes every `Set-Cookie` for `name` out of `headers`, keeping the rest in
 * order: Better Auth's own `removeSetCookieEntries`, which it does not export.
 */
function removeSetCookie(headers: Headers | undefined, name: string): void {
  if (!headers) return;
  const existing = headers.getSetCookie();
  const kept = existing.filter(
    (line) => !line.startsWith(`${name}=`) && !line.startsWith(`${name}.`),
  );
  if (kept.length === existing.length) return;
  headers.delete("set-cookie");
  for (const line of kept) headers.append("set-cookie", line);
}

/**
 * Takes out of `headers` the `Set-Cookie` lines that expire one of `names` —
 * an empty value or `Max-Age=0` — and keeps every other line, in order.
 */
function removeExpiringSetCookies(
  headers: Headers | undefined,
  names: readonly string[],
): void {
  if (!headers) return;
  const existing = headers.getSetCookie();
  const kept = existing.filter((line) => {
    const [pair, ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    const name = (separator === -1 ? pair : pair.slice(0, separator)).trim();
    if (!names.includes(name)) return true;
    const value = separator === -1 ? "" : pair.slice(separator + 1).trim();
    const expires =
      value === "" ||
      attributes.some((attribute) =>
        /^\s*max-age\s*=\s*0\s*$/i.test(attribute),
      );
    return !expires;
  });
  if (kept.length === existing.length) return;
  headers.delete("set-cookie");
  for (const line of kept) headers.append("set-cookie", line);
}

/** The parts of a session read's context the cookie guard reads. */
interface ReadContext {
  context: {
    authCookies: {
      sessionToken: { name: string };
      dontRememberToken: { name: string };
    };
    responseHeaders?: Headers;
  };
}

export function stokyPolicy({
  db,
  limiter = valkeyCodeLimiter,
}: PolicyPluginOptions) {
  return {
    id: "stoky-policy",
    hooks: {
      after: [
        {
          // **A session read never signs a browser out** (D144). When the
          // row a cookie names is gone, Better Auth's get-session answers
          // null and expires the session and dont_remember cookies, and
          // `nextCookies` copies that into the answer of whatever route read
          // it — the tRPC route on every request. A request sent with this
          // device's old cookie just before a password change, a change to
          // two-step verification or a sign-in replaced it is read after the
          // row went, and if its answer arrives after the one that set the
          // new cookie, it expires the new one: the device signed out by its
          // own change. So a read keeps the cookie jar as it was, and says no
          // session; only a sign-in, a rotation and a sign-out write it. A
          // dead cookie left behind costs nothing — every read refuses it —
          // and the next sign-in replaces it (a ticked one clears
          // dont_remember itself, `src/server/http/auth-handler.ts`).
          matcher: (context: { path?: string }) =>
            context.path === "/get-session",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as ReadContext;
            removeExpiringSetCookies(ctx.context.responseHeaders, [
              ctx.context.authCookies.sessionToken.name,
              ctx.context.authCookies.dontRememberToken.name,
            ]);
          }),
        },
        {
          matcher: (context: { path?: string }) =>
            context.path === "/passkey/verify-authentication",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as CookieContext;
            const session = ctx.context.newSession;
            if (!session || ctx.headers?.get(REMEMBER_HEADER) !== "0") return;
            removeSetCookie(
              ctx.context.responseHeaders,
              ctx.context.authCookies.sessionToken.name,
            );
            await setSessionCookie(raw as never, session, true);
          }),
        },
        {
          // A locked second step says until when. Better Auth refuses it 429
          // ACCOUNT_TEMPORARILY_LOCKED with no Retry-After, and every other
          // refusal of a spent budget here carries one (RFC 9110 §10.2.3).
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/verify-totp" ||
            context.path === "/two-factor/verify-backup-code",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as GuardContext & {
              context: { returned?: unknown };
              setHeader: (name: string, value: string) => void;
            };
            const returned = ctx.context.returned;
            if (!(returned instanceof APIError)) return;
            const code = (returned.body as { code?: unknown } | undefined)
              ?.code;
            if (code !== "ACCOUNT_TEMPORARILY_LOCKED") return;
            ctx.setHeader("retry-after", String(await lockedFor(ctx)));
          }),
        },
      ],
      before: [
        ...Object.entries(STEP_UP_PATHS).map(([path, { spend }]) => ({
          matcher: (context: { path?: string }) => context.path === path,
          handler: createAuthMiddleware(async (raw) => {
            await requireStepUp(raw, db, spend);
            if (path === "/passkey/verify-registration") {
              const body = (raw as { body?: Record<string, unknown> }).body;
              // False rather than removed: a returned body is merged, and a
              // key left out keeps the caller's value.
              return { context: { body: { ...body, createSession: false } } };
            }
          }),
        })),
        {
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/verify-backup-code",
          handler: createAuthMiddleware(async (raw) => {
            const ctx = raw as unknown as GuardContext;
            const code = ctx.body?.code;
            // Not a string: Better Auth's own schema refuses it.
            if (typeof code !== "string") return;
            return {
              context: { body: { ...ctx.body, code: hashBackupCode(code) } },
            };
          }),
        },
        {
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/verify-totp",
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

            const address = ctx.headers
              ? clientAddress(ctx.headers)
              : undefined;
            let secret: string;
            try {
              secret = await symmetricDecrypt({
                key: ctx.context.secretConfig,
                data: row.secret,
              });
            } catch {
              logSecurityEvent("auth.twofactor.unreadable", {
                userId: owner.userId,
                address,
              });
              throw new APIError("UNAUTHORIZED", {
                code: "TWO_FACTOR_UNREADABLE",
                message:
                  "The authenticator secret cannot be read with this server's secret",
              });
            }

            // A sign-in's code is charged to the account's daily budget
            // before it is looked at, and given back only if it is claimed:
            // wrong and replayed codes stay counted. Not while Better Auth's
            // own lock holds, which refuses those itself, uncounted.
            const locked =
              row.lockedUntil != null &&
              new Date(row.lockedUntil).getTime() > Date.now();
            const charge =
              owner.signIn && !locked
                ? await chargeCode(limiter, owner.userId)
                : null;

            const step = matchingStep(secret, code, totpClock.now());
            if (step === null) {
              return {
                context: { body: { ...ctx.body, code: NO_MATCH_CODE } },
              };
            }

            // The check and the claim in one statement; a tagged template, so
            // every value is a bound parameter.
            const claimed = await db.$executeRaw`
              UPDATE "TwoFactor" SET "lastTotpCounter" = ${step}
              WHERE id = ${row.id}
                AND ("lastTotpCounter" IS NULL OR "lastTotpCounter" < ${step})`;
            if (claimed === 0) {
              logSecurityEvent("auth.twofactor.replayed", {
                userId: owner.userId,
                address,
              });
              throw new APIError("UNAUTHORIZED", {
                code: "INVALID_CODE",
                message: "Invalid code",
              });
            }
            if (charge)
              await limiter.refund(
                twoFactorCodeRateLimit(),
                owner.userId,
                charge.window,
              );
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
