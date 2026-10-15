import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins/bearer";
import { twoFactor } from "better-auth/plugins/two-factor";
import { prisma } from "@/lib/prisma";
import { assertAuthEnvironment } from "@/lib/auth/environment";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { deviceIdFromHeaders } from "@/lib/auth/known-devices";
import { canonicalUrl, trustedAuthOrigins } from "@/lib/auth/public-url";
import { configuredSecret } from "@/lib/auth/secret";
import { stokyPolicy } from "@/lib/auth/policy-plugin";
import { generateBackupCodes, storeBackupCodes } from "@/lib/auth/backup-codes";
import {
  REMEMBERED_IDLE_S,
  REMEMBERED_REFRESH_S,
  REMEMBER_HEADER,
  clampRemembered,
  initialExpiry,
  persistentAtCreate,
} from "@/lib/auth/session-policy";
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
 * - **A browser session unless the person asks to be remembered** (D141).
 *   The route passes the login form's box as `rememberMe` and says which it
 *   was in a header of its own (`src/server/http/auth-handler.ts`); the create
 *   hook below records it on the row and gives the row its lifetime — fifteen
 *   idle minutes under a day, or ninety idle days under a year
 *   (`src/lib/auth/session-policy.ts`). A browser session's cookie has no
 *   `Max-Age`; a remembered one's has ninety days.
 * - **Better Auth's own limiter is off.** Ours runs in the route, per address,
 *   per account and per known device (`src/lib/auth/sign-in-policy.ts`).
 * - **No telemetry, no IP addresses.** Nothing leaves the instance, and
 *   `Session.ipAddress` stays null.
 * - **Our Argon2id**, so the hashes written before the swap verify unchanged.
 * - **A native client signs in with a bearer token** (D142): the session
 *   cookie's signed value, sent back as `Authorization: Bearer`. Signed
 *   tokens only (`requireSignature`), so the unsigned token the database holds
 *   is never a credential on its own. The route hands it out only to a
 *   request that carried no cookie (`src/server/http/auth-handler.ts`).
 */

let generatedSecret: string | undefined;

/**
 * The key that signs session cookies: `STOKY_SECRET`, or the deprecated
 * `NEXTAUTH_SECRET` when only that is set (`configuredSecret`, D137) — the
 * same value the start-up guard checked, read through the same rule.
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
  const { value, name } = configuredSecret(env);
  const configured = value?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error(`[auth] unavailable: ${name} is not set.`);
  }
  if (!generatedSecret) {
    generatedSecret = randomBytes(32).toString("base64");
    console.warn(
      `[auth] warning: ${name} is not set; sessions are signed with a key that lasts until this process stops.`,
    );
  }
  return generatedSecret;
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
  // The first `STOKY_URLS` entry (D138). Never null here: production without
  // one, or a first entry with no origin, is refused before `build` runs.
  const baseURL = canonicalUrl(env) as string;
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
      // A remembered session's: the cookie's `Max-Age`, and what Better
      // Auth's daily refresh proposes, which the update hook holds to a year
      // from the sign-in. A browser session's row is given its own expiry by
      // the create hook and is never refreshed.
      expiresIn: REMEMBERED_IDLE_S,
      updateAge: REMEMBERED_REFRESH_S,
      freshAge: 0,
      // Off, so a deleted row is refused on the very next read.
      cookieCache: { enabled: false },
      additionalFields: {
        authenticatedAt: { type: "date", required: false, input: false },
        // No default here: the create hook always sets it, and a default
        // would be applied before the hook could tell a re-create from a
        // sign-in.
        persistent: { type: "boolean", required: false, input: false },
        // The `stoky_device` cookie, for the list of a person's sessions
        // (D143). `returned: false` keeps it out of every answer Better Auth
        // gives, `get-session` included: it is a cookie value.
        deviceId: { type: "string", required: false, input: false, returned: false },
      },
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: "error", log: logLine },
    onAPIError: { onError: logEndpointError },
    // Every `STOKY_URLS` entry's origin, and outside production the
    // `DEV_ALLOWED_ORIGIN` hosts (`src/lib/auth/public-url.ts`).
    trustedOrigins: trustedAuthOrigins(env),
    advanced: {
      // Better Auth skips its origin check when NODE_ENV is "test"; stated,
      // so the suites run the check production runs.
      disableOriginCheck: false,
      // The first entry alone decides, which is why an https first entry
      // beside plain HTTP to another machine is refused (`public-url.ts`).
      useSecureCookies: new URL(baseURL).protocol === "https:",
      cookiePrefix: "stoky",
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: {
          /**
           * The row's kind and lifetime, set here because Better Auth gives a
           * browser session a flat day and a remembered one ninety days with
           * no ceiling.
           *
           * **A sign-in** — no session on the request — starts the clock:
           * `authenticatedAt` is now, and whether the row is remembered is
           * what the route said in `x-stoky-remember`, or, on a sign-in step
           * the route does not rebuild, what Better Auth was told
           * (`persistentAtCreate`).
           *
           * **A re-create** — Better Auth replacing the session of a request
           * that already has one: a password change, two-step verification
           * being turned on — carries both over, so the limit still counts
           * from the sign-in and a remembered device stays remembered.
           *
           * **The device, either way, is the `stoky_device` cookie the
           * request carried**, if a valid one (D143). For a re-create that is
           * the same device, asking from the same browser. It is not taken
           * from the prior session as the other two are, because Better Auth
           * hands this hook that session as it answers clients, without the
           * fields marked `returned: false` — `deviceId` among them.
           */
          before: async (session, ctx) => {
            const now = new Date();
            const prior = ctx?.context?.session?.session as
              | { authenticatedAt?: Date | string | null; persistent?: boolean | null }
              | undefined;
            const deviceId = (ctx?.headers && deviceIdFromHeaders(ctx.headers)) ?? null;

            let authenticatedAt: Date;
            let persistent: boolean;
            if (prior) {
              authenticatedAt = prior.authenticatedAt ? new Date(prior.authenticatedAt) : now;
              persistent = prior.persistent === true;
            } else {
              authenticatedAt = now;
              const dontRemember = ctx
                ? await ctx.getSignedCookie(
                    ctx.context.authCookies.dontRememberToken.name,
                    ctx.context.secret,
                  )
                : null;
              persistent = persistentAtCreate({
                remember: ctx?.headers?.get(REMEMBER_HEADER) ?? null,
                dontRememberCookie: Boolean(dontRemember),
                proposedExpiresAt: new Date(session.expiresAt),
                now,
              });
            }

            return {
              data: {
                ...session,
                authenticatedAt,
                persistent,
                deviceId,
                expiresAt: initialExpiry({ persistent, authenticatedAt, now }),
                ipAddress: null,
              },
            };
          },
        },
        update: {
          /**
           * What Better Auth may do to an expiry: its daily refresh proposes
           * ninety days from now.
           *
           * - **A browser session's is never moved here.** Only
           *   `auth.session`, on real activity, slides one, and it writes the
           *   row itself. Removed in place, because a hook's returned data is
           *   merged over the patch and cannot take a field out of it.
           * - **A remembered session's is held to a year from the sign-in**
           *   (`clampRemembered`), which Better Auth has no notion of.
           *
           * The session is the one the request presented, which is the one
           * Better Auth refreshes. When it cannot be read, the expiry is
           * dropped: a patch that cannot be bounded is not written.
           */
          before: async (patch, ctx) => {
            const update = patch as { expiresAt?: Date | string };
            if (update.expiresAt === undefined) return;
            const current = ctx?.context?.session?.session as
              | { authenticatedAt?: Date | string | null; persistent?: boolean | null }
              | undefined;
            if (current?.persistent === true && current.authenticatedAt) {
              update.expiresAt = clampRemembered({
                proposed: new Date(update.expiresAt),
                authenticatedAt: new Date(current.authenticatedAt),
              });
            } else {
              delete update.expiresAt;
            }
          },
        },
      },
    },
    plugins: [
      // `Authorization: Bearer <token>.<signature>` read as the session
      // cookie, on every endpoint and on `getSession` from tRPC; and the
      // cookie's value copied into `set-auth-token` whenever an answer sets
      // it. A token without its signature is refused rather than signed here
      // on the caller's behalf: the database holds tokens unsigned, so
      // without this a read of the `Session` table would be a credential.
      bearer({ requireSignature: true }),
      // Two-step verification with an authenticator app (D148). At the
      // password step of an account that has it, Better Auth deletes the
      // session it made and answers `twoFactorRedirect` with a signed
      // `two_factor` cookie naming a ten-minute challenge, which
      // `/two-factor/verify-totp` or `/two-factor/verify-backup-code` turns
      // into a session. Its own limits stay on: five wrong codes end a
      // challenge, ten across challenges lock the account for fifteen
      // minutes. The route also answers enable, disable and new backup
      // codes, each with the password, for `/settings/security`; never
      // `get-totp-uri` (`src/server/http/auth-handler.ts`).
      twoFactor({
        issuer: "Stoky",
        // Backup codes of 120 bits, stored as SHA-256 hashes rather than
        // Better Auth's 60-bit codes encrypted with `STOKY_SECRET` (D149,
        // `src/lib/auth/backup-codes.ts`): the database alone gives none
        // back, and a rotation of the secret leaves them working.
        backupCodeOptions: { customBackupCodesGenerate: generateBackupCodes, storeBackupCodes },
      }),
      // Ours: a TOTP code works once, and a typed backup code is compared as
      // its hash (`src/lib/auth/policy-plugin.ts`).
      stokyPolicy({ db: prisma }),
      // Last, as Better Auth asks: it copies every Set-Cookie into Next's
      // cookie store when an endpoint is called from a Server Action.
      nextCookies(),
    ],
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
