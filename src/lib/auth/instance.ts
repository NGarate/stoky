import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";
import { assertAuthEnvironment } from "@/lib/auth/environment";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { classifyPublicUrl, publicUrl } from "@/lib/auth/public-url";
import { nextExpiry } from "@/lib/auth/session-policy";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/validations/password";

/**
 * The Better Auth instance, built once, on first use (PROGRESS D135).
 *
 * **Built lazily, never at import.** `betterAuth()` starts its initialisation
 * and its schema check the moment it is called, and `next build` evaluates
 * every route module with no secret and no database. Nothing imports this
 * module for a side effect: the auth route, the session read in
 * `src/lib/auth.ts` and the sign-out action call `getAuth()` when a request
 * needs it. No `server-only` either — the package was removed on purpose
 * (`dependency-scope.test.ts`); `src/__tests__/unit/auth-dynamic.test.ts`
 * keeps everything outside the auth seam from importing this.
 *
 * What it is configured to be, and why each choice:
 *
 * - **Sessions are rows, read on every request.** The cookie cache is off, so
 *   deleting a row ends that session everywhere at once; that is the whole of
 *   revocation (`src/lib/auth/end-sessions.ts`).
 * - **Every session is a browser session** for now: sign-in sends
 *   `rememberMe: false` (`src/server/http/auth-handler.ts`), so the cookie has
 *   no `Max-Age`, and the create hook below gives the row fifteen idle minutes
 *   under a day's ceiling (`src/lib/auth/session-policy.ts`).
 * - **Better Auth's own limiter is off.** Ours runs in the route, per address,
 *   per account and per known device (`src/lib/auth/sign-in-policy.ts`).
 * - **No telemetry, no IP addresses.** Nothing leaves the instance, and
 *   `Session.ipAddress` stays null.
 * - **Our Argon2id**, so the hashes written before the swap verify unchanged.
 */

let generatedSecret: string | undefined;

/**
 * The key that signs session cookies: `NEXTAUTH_SECRET`.
 *
 * Outside production, with none set, a random 32-byte key for the life of this
 * process, said once in the log: a restart then signs everybody out, which is
 * the right cost for a development server. In production an unset key never
 * gets here — `assertUsableSecret` stops the server first — and is refused
 * again rather than invented.
 *
 * Never empty, because Better Auth reads an empty `secret` as "use
 * `BETTER_AUTH_SECRET` or `AUTH_SECRET`" and an empty entry in `secrets` as an
 * error.
 */
export function resolveSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error("[auth] unavailable: NEXTAUTH_SECRET is not set.");
  }
  if (!generatedSecret) {
    generatedSecret = randomBytes(32).toString("base64");
    console.warn(
      "[auth] warning: NEXTAUTH_SECRET is not set; sessions are signed with a key that lasts until this process stops.",
    );
  }
  return generatedSecret;
}

/**
 * The origins a signed-in browser may POST to the auth API from: the public
 * URL's, and outside production each `DEV_ALLOWED_ORIGIN` host at the dev
 * server's port over http and behind `tailscale serve` over https — the two
 * ways `docs/LOCAL_BOOTSTRAP.md` reaches a development server from a phone.
 */
export function trustedOrigins(
  baseURL: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const origins = [new URL(baseURL).origin];
  if (env.NODE_ENV === "production") return origins;

  const port = env.PORT || "3000";
  for (const host of (env.DEV_ALLOWED_ORIGIN ?? "").split(",")) {
    const name = host.trim();
    if (!name) continue;
    origins.push(`http://${name}:${port}`, `https://${name}`);
  }
  return origins;
}

/**
 * One line per message, and never the arguments: Better Auth passes request
 * details and error objects there, and a stack per refused request is what
 * made an unauthenticated client's log volume a finding (security review,
 * 2026-10-12). Bounded, because some messages quote a caller's `Origin`.
 *
 * At level `error`, which is what keeps a refused sign-in silent: Better Auth
 * writes a `warn` for every wrong password and unknown address ("Invalid
 * password", "User not found"), which the security log already records with
 * more in it. `integration/security-log.test.ts` fails at level `warn`.
 */
function logLine(level: string, message: string): void {
  const text = String(message).replace(/\s+/g, " ").slice(0, 300);
  console.error(`[auth] ${level} ${text}`);
}

/**
 * What an error that reaches Better Auth's router writes — one thrown outside
 * an endpoint's own answer, such as a database that does not respond. Its
 * default writes the error object as an argument, which `logLine` drops, so
 * the line would carry the error's name and nothing else; this writes the name
 * and the message. A refusal is the caller's input being turned away and
 * writes nothing.
 */
function logEndpointError(error: unknown): void {
  if (isAPIError(error) && error.status !== "INTERNAL_SERVER_ERROR") return;
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  logLine("error", `${name}: ${message}`);
}

function build(env: Record<string, string | undefined>) {
  const baseURL = publicUrl(env) as string;
  const secret = resolveSecret(env);

  return betterAuth({
    appName: "Stoky",
    baseURL,
    basePath: "/api/auth",
    // Both, from the same value: `secrets` is what Better Auth signs and
    // encrypts with when it is set, and naming it means `BETTER_AUTH_SECRETS`
    // is never read; `secret` keeps `BETTER_AUTH_SECRET` and `AUTH_SECRET` out
    // of the legacy fallback.
    secret,
    secrets: [{ version: 1, value: secret }],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by `auth.register` and `household.addMember`,
      // which apply the registration mode and the password policy.
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    user: {
      additionalFields: {
        householdId: { type: "string", required: false, input: false },
        role: { type: "string", required: false, input: false },
      },
    },
    session: {
      // Better Auth's figures for a remembered session, which nothing creates
      // yet: every row is given its own expiry by the hook below.
      expiresIn: 90 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: 0,
      // Off, so a deleted row is refused on the very next read.
      cookieCache: { enabled: false },
      additionalFields: {
        authenticatedAt: { type: "date", required: false, input: false },
      },
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: "error", log: logLine },
    onAPIError: { onError: logEndpointError },
    trustedOrigins: trustedOrigins(baseURL, env),
    advanced: {
      // Better Auth skips its origin check when NODE_ENV is "test"; stated,
      // so the suites run the check production runs.
      disableOriginCheck: false,
      useSecureCookies: classifyPublicUrl({ NEXTAUTH_URL: baseURL }).kind === "https",
      cookiePrefix: "stoky",
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: {
          /**
           * The row's lifetime, set here because Better Auth gives a browser
           * session a flat day.
           *
           * `authenticatedAt` is when the password was typed. On a sign-in it
           * is now. When Better Auth re-creates the session of a request that
           * already has one — a password change, two-step verification being
           * turned on — it is carried over, so the day's ceiling still counts
           * from the sign-in and not from the re-creation.
           */
          before: async (session, ctx) => {
            const now = new Date();
            const prior = ctx?.context?.session?.session as
              | { authenticatedAt?: Date | string | null }
              | undefined;
            const authenticatedAt = prior?.authenticatedAt
              ? new Date(prior.authenticatedAt)
              : now;
            return {
              data: {
                ...session,
                authenticatedAt,
                expiresAt: nextExpiry({ authenticatedAt, now }),
                ipAddress: null,
              },
            };
          },
        },
        update: {
          /**
           * Better Auth never moves an expiry. Its daily refresh would push a
           * row ninety days out; only `auth.session`, on real activity, slides
           * one, and it writes the row itself. Removed in place, because a
           * hook's returned data is merged over the patch and cannot take a
           * field out of it.
           */
          before: async (patch) => {
            delete (patch as { expiresAt?: unknown }).expiresAt;
          },
        },
      },
    },
    // Last, as Better Auth asks: it copies every Set-Cookie into Next's
    // cookie store when an endpoint is called from a Server Action.
    plugins: [nextCookies()],
  });
}

export type StokyAuth = ReturnType<typeof build>;

let instance: StokyAuth | undefined;

/**
 * The instance, built on first call after `assertAuthEnvironment` passes
 * (`src/lib/auth/environment.ts`). Start-up has already refused the same
 * environment under a Next server; this is the second line, for anything that
 * builds it elsewhere.
 */
export function getAuth(): StokyAuth {
  if (!instance) {
    assertAuthEnvironment();
    instance = build(process.env);
  }
  return instance;
}
