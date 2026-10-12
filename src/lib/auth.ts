import NextAuth, { CredentialsSignin } from "next-auth";
import { connection } from "next/server";
import type { NextAuthConfig, Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { HouseholdRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { logSecurityEvent } from "@/lib/security-log";
import { assertUsableSecret } from "@/lib/auth/secret";
import { verifyPassword } from "@/lib/auth/password-hash";
import {
  deviceFingerprint,
  deviceIdFromRequest,
  isKnownDevice,
  rememberDevice,
} from "@/lib/auth/known-devices";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  clientAddress,
  consumeRateLimit,
  loginAccountRateLimit,
  loginDeviceRateLimit,
  loginRateLimit,
  rateLimitIdentifier,
  refundRateLimit,
  resetRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";

/**
 * Sign-in refused because the address has run out of attempts.
 *
 * A `CredentialsSignin` subclass rather than a bare throw because its `code`
 * is the one thing Auth.js passes back to the browser — everything else is
 * deliberately flattened to "CredentialsSignin" so a login form cannot leak
 * whether it was the address or the password that was wrong. The client turns
 * this code into a message that says to wait, which matters: a correct
 * password rejected with "invalid credentials" reads as a broken account.
 */
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Sign-in refused because the *account* has run out of attempts — the shared
 * counter, or this browser's own budget on it — rather than the address.
 *
 * Its own code because the person needs a different sentence. "Too many
 * attempts from this connection" sends them to another network, which cannot
 * help when the counter is keyed on the account; and when someone else is
 * spending it (the lockout SECURITY.md accepts), being told so is how the
 * operator comes to hear about it. A subclass of `RateLimitedSignin`, so code
 * that asks "was this rate-limited?" still gets yes. Saying "account" leaks
 * nothing: the counter runs only after the address check has passed, and for
 * registered and unregistered addresses alike.
 */
export class AccountRateLimitedSignin extends RateLimitedSignin {
  code = "account_rate_limited";
}

/** Sign-in refused because the rate limiter could not reach Valkey. */
export class AuthUnavailableSignin extends CredentialsSignin {
  code = "auth_unavailable";
}

/**
 * Checked here because this is the module every server path goes through, and
 * because it must happen before a session is ever signed. See
 * `@/lib/auth/secret` for what it refuses and why it is fatal.
 */
assertUsableSecret();

/**
 * The longest a session lives, in seconds, however active it is: thirty days
 * after the password was typed.
 *
 * The fifteen-minute `maxAge` below is an *idle* timeout, and every read of the
 * session re-issues the token with a fresh one, so on its own a session in use
 * never ended — a kitchen tablet, or a cookie copied off one, renewed for ever
 * (security review 2026-10-12). Thirty days is OWASP ASVS 4.0.3 V3.3.2's
 * Level 1 ceiling, and the longest that still suits the device it is set for:
 * a tablet that lives in a kitchen asks for its password once a month rather
 * than once a shift. A constant, not a setting, because nothing about an
 * installation makes a different number the right one.
 */
export const MAX_SESSION_AGE_S = 30 * 24 * 60 * 60;

export const authConfig: NextAuthConfig = {
  /**
   * Trust the Host header, because a reverse proxy is the only thing in front
   * of this application.
   *
   * Auth.js v5 defaults this to false off Vercel, and then refuses any request
   * whose Host it cannot vouch for — `UntrustedHost`, a 500 from
   * `/api/auth/session`, and nobody can sign in. **Setting `NEXTAUTH_URL`
   * correctly does not help**, which is what makes this worth a comment:
   * verified against a production build with `NEXTAUTH_URL` matching the
   * server's own address exactly, and it still refused.
   *
   * So a deployed instance could not authenticate anybody at all, while
   * development and the browser suite — which run through `next dev`, where the
   * check does not apply — passed throughout.
   *
   * The trade is real and acceptable here: trusting the header means a forged
   * `Host` could steer a callback URL, and the release bundle (`deploy/`) puts
   * Traefik in front with a `Host(...)` rule, so nothing reaches this process
   * without matching the configured domain first. A deployment that exposes the
   * container directly does not have that protection.
   */
  trustHost: true,

  /**
   * The signing key is the one `assertUsableSecret()` above checked, named
   * here rather than left for Auth.js to find.
   *
   * Left to itself, next-auth 5's `setEnvDefaults` resolves it as
   * `config.secret ??= process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET`:
   * **`AUTH_SECRET` wins whenever it is set** — the name the Auth.js v5 docs
   * and `npx auth secret` use — while the guard and `/api/health` read only
   * `NEXTAUTH_SECRET`. So a valid `NEXTAUTH_SECRET` beside `AUTH_SECRET=changeme`
   * started, reported healthy, and signed every session with `changeme`.
   * Setting the key explicitly means neither `setEnvDefaults` nor
   * `@auth/core`'s own fallback (`AUTH_SECRET`, `AUTH_SECRET_1..3`, read only
   * when `secret` is empty) is ever consulted.
   *
   * `AUTH_SECRET` is ignored rather than refused: once it signs nothing, a
   * fatal check for it would only be one more way not to start. Auth.js's
   * `AUTH_SECRET_1..3` rotation list was never reachable here and still is
   * not — `@auth/core` reads it only when the secret is empty, and with
   * `NEXTAUTH_SECRET` set (production requires it) it never was — so rotating
   * means changing `NEXTAUTH_SECRET`, which signs everyone out. Where
   * `NEXTAUTH_SECRET` is unset (development, the suites) this is `undefined`
   * and the fallback above applies exactly as before.
   */
  secret: process.env.NEXTAUTH_SECRET,

  /**
   * **There is deliberately no `adapter`.**
   *
   * There was one — `PrismaAdapter(prisma)` — and it did nothing.
   * `@auth/core`'s credentials branch mints and encodes a JWT unconditionally
   * and never calls an adapter, so no session was ever persisted through it.
   *
   * Removing it was not tidying. `@auth/core/lib/init.js` reads
   * `strategy: config.adapter ? "database" : "jwt"`: **an adapter's presence
   * picks the default strategy**, and this schema has no `Session`, `Account`
   * or `VerificationToken` model. So `session.strategy: "jwt"` below was the
   * only thing overriding a default the configuration could not survive, while
   * reading like a restatement of one. Deleting that line — plausible
   * tidy-up — left sign-in answering 302 and setting a cookie while every
   * session read failed with `prisma.session.findUnique is undefined` and
   * `/api/auth/session` returned `null`. Measured, 2026-08-27, ISSUES.md
   * AUTH-1.
   *
   * With no adapter, `"jwt"` is the default rather than an override, and the
   * trap is gone rather than commented.
   *
   * **Adding an adapter back is a schema change, not a config change.** It
   * would need those three models, and it buys nothing while sign-in is
   * credentials-only, because credentials can never use a database session. An
   * OAuth provider is the case that would want one, and it can bring them.
   */
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const limit = loginRateLimit();
        // Counted against the /64 for an IPv6 client, logged with the
        // address in full: the bucket is what stops a client rotating through
        // its own prefix, and the address is what an operator needs to read.
        const identifier = rateLimitIdentifier(request.headers);
        const address = clientAddress(request.headers);

        // Counted before the credentials are looked at, not after. A limit
        // that only counts attempts it has already spent ~250ms of Argon2id
        // on is also a way to make the server do that work on demand.
        let addressWindow: number;
        try {
          const { allowed, retryAfterSeconds, window } = await consumeRateLimit(
            limit,
            identifier,
          );
          addressWindow = window;
          if (!allowed) {
            logSecurityEvent("auth.signin.throttled", {
              address,
              code: `retry-after=${retryAfterSeconds}`,
            });
            throw new RateLimitedSignin();
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Fails closed. See `src/lib/rate-limit.ts` for why, and for what
            // it costs when Valkey is down.
            // Both: the structured line so the event is greppable alongside
            // the refusals, and the prose so an operator reading the container
            // output is told what to check rather than left with a code.
            logSecurityEvent("auth.unavailable", { address });
            console.error(
              "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new AuthUnavailableSignin();
          }
          throw error;
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          logSecurityEvent("auth.signin.failed", {
            address,
            code: "malformed",
          });
          return null;
        }

        /**
         * The second limit, and the one NIST SP 800-63B §5.2.2 actually asks
         * for: consecutive failed attempts *on a single account*.
         *
         * The per-IP limit above does not do that. An attacker with a hundred
         * addresses gets five attempts from each — five hundred against one
         * password. With both in force, a hundred addresses buy ten.
         *
         * Counted on the submitted address whether or not an account exists,
         * so a difference in behaviour cannot be used to learn which addresses
         * are registered. Counted before Argon2id, for the same reason as the
         * limit above.
         *
         * **Except from a browser this account has signed in from before.**
         * A full account counter refuses the right password too, so anyone
         * who knows the address could keep spending it and keep the member
         * out (security review, 2026-10-12). A known device is counted on a
         * budget of its own instead — the OWASP device-cookie pattern — and
         * a stranger's guesses never touch it. Whether the device is known is
         * asked for registered and unregistered addresses alike, so this adds
         * no way to tell them apart; and a device id nobody has recorded is
         * counted on the shared budget exactly as before, so minting cookies
         * buys nothing. See `@/lib/auth/known-devices`.
         */
        const account = accountIdentifier(parsed.data.email);
        const deviceId = deviceIdFromRequest(request);
        let charged: {
          kind: "device" | "account";
          limit: RateLimit;
          identifier: string;
        };

        try {
          charged =
            deviceId && (await isKnownDevice(account, deviceId))
              ? {
                  kind: "device",
                  limit: loginDeviceRateLimit(),
                  identifier: `${account}:${deviceFingerprint(deviceId)}`,
                }
              : {
                  kind: "account",
                  limit: loginAccountRateLimit(),
                  identifier: account,
                };

          const { allowed, retryAfterSeconds } = await consumeRateLimit(
            charged.limit,
            charged.identifier,
          );
          if (!allowed) {
            logSecurityEvent("auth.signin.throttled", {
              address,
              email: parsed.data.email,
              code: `${charged.kind} retry-after=${retryAfterSeconds}`,
            });
            throw new AccountRateLimitedSignin();
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Both: the structured line so the event is greppable alongside
            // the refusals, and the prose so an operator reading the container
            // output is told what to check rather than left with a code.
            logSecurityEvent("auth.unavailable", { address });
            console.error(
              "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new AuthUnavailableSignin();
          }
          throw error;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        // Argon2id runs whether or not the account exists. Skipping it for a
        // missing account answered "no such address" in a few milliseconds
        // and "wrong password" in a quarter of a second, so a stopwatch told
        // anyone which addresses are registered — the very thing the flattened
        // message and the identical log lines below refuse to say. With no
        // account, `verifyPassword` checks against a dummy hash made with the
        // same parameters as every stored one.
        const isValid = await verifyPassword(
          user?.passwordHash,
          parsed.data.password,
        );

        // One event, the same fields, for both failures. The distinction
        // between "no such account" and "wrong password" is exactly what the
        // flattened error message refuses to tell the browser, and writing it
        // into the log would put it back — the log is readable by anyone who
        // can read the container's output.
        if (!user || !isValid) {
          logSecurityEvent("auth.signin.failed", {
            address,
            email: parsed.data.email,
          });
          return null;
        }

        // For the reason D30 gives: the specification counts attempts rather
        // than failures, and a household signing in from three devices is
        // three attempts before anybody has mistyped anything.
        //
        // **The two counters are not treated alike.** The account's counter —
        // or this device's, whichever the attempt was charged to — is
        // cleared: only its own password gets here. Only that one: a known
        // device signing in leaves the shared counter as it found it, so the
        // owner signing in on their phone does not hand whoever is filling
        // it a fresh budget. The address's counter is
        // refunded by this one attempt and no more, because clearing it let
        // anybody with an account of their own wipe the failures beside it —
        // four guesses at other people's passwords, one good sign-in to their
        // own, repeat, and the per-address limit never filled. Refunded to
        // the window it was counted in, so a success that lands after that
        // window ended cannot take an attempt off the next one.
        await refundRateLimit(limit, identifier, addressWindow);
        await resetRateLimit(charged.limit, charged.identifier);

        // Only after the password has been accepted, which is what makes a
        // recorded device worth a budget of its own.
        if (deviceId) await rememberDevice(account, deviceId);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          householdId: user.householdId ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",

    /**
     * Fifteen minutes of **inactivity**, not fifteen minutes of session.
     *
     * `maxAge` was a hard ceiling: a session died fifteen minutes after
     * sign-in whatever the person was doing, so a slow shop or a long receipt
     * review ended with a login form and a lost form. WCAG 2.1 **2.2.6
     * Timeouts** (AAA) asks that users be warned of an inactivity duration
     * that could cause data loss; nothing warned, and there was nothing to
     * warn about because activity did not help.
     *
     * It slides on every read. With the JWT strategy Auth.js re-encodes the
     * token, with a fresh `iat` and expiry, on *every* read of the session —
     * `@auth/core` 0.41.3 `lib/actions/session.js` — so any navigation or any
     * call to `/api/auth/session` pushes the expiry out. `updateAge` is read
     * only on the database-session path there; it is kept for the day the
     * strategy changes, and does not throttle anything today.
     *
     * The idle window stays short on purpose. Phase 5 puts this application on
     * a kitchen tablet that lives in a kitchen, and Phase 7 §6 asks what a
     * stolen device can reach — a session that expires quickly once it is put
     * down is the answer, and sliding it on real activity is what makes that
     * bearable rather than hostile. What it does not bound is a session in
     * use; `MAX_SESSION_AGE_S` above does, checked in the `jwt` callback.
     */
    maxAge: 15 * 60,
    updateAge: 5 * 60,
  },
  callbacks: {
    /**
     * Where session revocation happens, and the only place it can.
     *
     * Returning `null` here makes Auth.js clear the session cookies — see
     * `@auth/core/lib/actions/session.js`, which pushes `sessionStore.clean()`
     * on exactly that. There is no server-side session record to delete, so a
     * line in time is the whole mechanism: a token issued before
     * `User.sessionsValidFrom` is refused.
     *
     * **It has to be here rather than beside the role check in
     * `householdProcedure`.** `/api/auth/session` re-issues the token through
     * Auth.js's own route, nowhere near tRPC, so a revocation enforced only at
     * the procedure tier would leave a revoked session sliding forward for
     * ever, re-issued on every read.
     *
     * The ordering works because this runs *before* the re-issue.
     * `jwt.encode` calls `.setIssuedAt()`, so `iat` moves forward on every
     * read of an active session — but it moves forward only after this
     * callback has let the token through, so a revocation set at any moment
     * catches the very next read.
     *
     * **The absolute lifetime is checked here too, and for the same reason.**
     * `iat` cannot carry it, since it is the time of the last re-issue, not of
     * the sign-in. So sign-in stamps `authTime`, a claim of ours that
     * `jwt.encode` copies forward untouched, and a token whose `authTime` is
     * more than `MAX_SESSION_AGE_S` old is refused. A token with no `authTime`
     * was issued before the claim existed and its age is unknown; it is refused
     * rather than stamped now, because stamping would hand a token stolen
     * before the upgrade a fresh thirty days. Everybody signs in once after
     * upgrading, and the offline queue keeps what it holds and asks for that
     * sign-in (`src/lib/offline/classify.ts`, the `auth` outcome).
     *
     * **Skipped on sign-in**, where `user` is present and `iat` does not exist
     * yet: the token is built here and stamped afterwards. Signing in again is
     * how somebody comes back from a revocation or from the absolute lifetime,
     * so refusing that would make either a lockout.
     *
     * The cost is one query per session read — once per page render, since the
     * root layout reads the session for the locale. That is the same order as
     * the membership query `householdProcedure` already makes per call, and it
     * is what buys the ability to end a session at all.
     */
    jwt: async ({ token, user }) => {
      if (user) {
        token.householdId = user.householdId;
        token.role = user.role;
        token.authTime = Math.floor(Date.now() / 1000);
        return token;
      }

      // Before the query: a token past its lifetime needs no database to be
      // refused, and refusing it first keeps an old token from costing one.
      const authTime = typeof token.authTime === "number" ? token.authTime : null;
      if (authTime === null || Date.now() / 1000 - authTime > MAX_SESSION_AGE_S) {
        logSecurityEvent("auth.session.revoked", {
          userId: token.sub as string,
          reason: "absolute-lifetime",
        });
        return null;
      }

      const issuedAt = typeof token.iat === "number" ? token.iat * 1000 : null;
      if (issuedAt === null) return token;

      const account = await prisma.user.findUnique({
        where: { id: token.sub as string },
        select: { sessionsValidFrom: true },
      });

      // A token whose account is gone is not this callback's business —
      // `householdProcedure` answers that, and refusing here would turn every
      // deleted account into a confusing sign-out loop rather than a refusal.
      if (!account?.sessionsValidFrom) return token;

      if (issuedAt < account.sessionsValidFrom.getTime()) {
        logSecurityEvent("auth.session.revoked", {
          userId: token.sub as string,
          reason: "sessions-valid-from",
        });
        return null;
      }

      return token;
    },
    session: async ({ session, token }) => {
      if (token) {
        session.user.id = token.sub as string;
        session.user.householdId = token.householdId as string | undefined;
        // A token minted before roles existed carries none. Falling back to
        // the least-privileged role rather than to MEMBER means an old
        // session cannot outrank a new one. Such a token also predates the
        // `authTime` claim, so the `jwt` callback refuses it before it gets
        // here; the fallback stays as the floor if that ever stops being so.
        session.user.role = (token.role as HouseholdRole | undefined) ?? "KITCHEN";
      }
      return session;
    },
  },
};

const { handlers, auth: readSession, signIn, signOut } = NextAuth(authConfig);

export { handlers, signIn, signOut };

/**
 * The session — and the reason this wraps NextAuth's own `auth` rather than
 * re-exporting it.
 *
 * **Reading the session is request data, so a caller of this can never
 * prerender.** Cache Components requires that to be *declared*, and until it
 * is, Next starts a prerender, reaches `crypto.getRandomValues()` inside
 * NextAuth, and aborts by throwing. Node consumed that rejection silently;
 * Bun — the runtime since `b81102d` — reports it, once per request per route,
 * 1612 across a suite run (`ISSUES.md` RUNTIME-1). Nothing was ever wrong with
 * the responses. The cost was the log: this project has no error tracking, so
 * the log is what it has, and spurious rejections at that volume bury a real
 * one.
 *
 * `await connection()` is Next's own answer, and it belongs **here** rather
 * than at the nine call sites. Fixing them one at a time was tried first and
 * is how the diagnosis went wrong twice: the error names only the first site
 * that trips it, so each fix reveals the next and reads as no progress at all.
 * It also leaves the next `await auth()` somebody writes free to reintroduce
 * the defect in silence.
 *
 * It costs no prerendering. Measured either side of the change: the same eight
 * routes are Partial Prerender, because the root layout is already
 * request-bound by the CSP nonce and nothing above these callers was
 * prerendering to begin with.
 *
 * The wrapper is deliberately zero-argument, and its return type is written
 * out rather than inferred. NextAuth's `auth` is four overloads — a route
 * wrapper, a `(req, res)` handler, a middleware — and `ReturnType` picks the
 * middleware, which typechecks here and turns `session.user` into an error at
 * all nine call sites. Nothing has ever used those shapes; a narrower export
 * is one fewer to keep dynamic-safe.
 */
export async function auth(): Promise<Session | null> {
  await connection();
  return readSession();
}
