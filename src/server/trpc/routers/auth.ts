import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { enforceRateLimit } from "../throttle";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  changePasswordSchema,
  endSessionsSchema,
  registerSchema,
} from "@/lib/validations/auth";
import { snackbarDurationSchema } from "@/lib/validations/preferences";
import {
  PASSWORD_CONTAINS_IDENTITY_MESSAGE,
  WRONG_CURRENT_PASSWORD_MESSAGE,
  passwordProblems,
} from "@/lib/validations/password";
import {
  clientAddress,
  passwordChangeRateLimit,
  rateLimitIdentifier,
  registerRateLimit,
} from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import {
  createCredentialUser,
  readPasswordHash,
  setPasswordAndEndSessions,
} from "@/lib/auth/credentials";
import { endSessions } from "@/lib/auth/end-sessions";
import { deviceLabel } from "@/lib/auth/device-label";
import { confirmCurrentPassword } from "@/lib/auth/reauth";
import {
  capFor,
  deadlineKind,
  nextExpiry,
  shouldSlide,
  type DeadlineKind,
} from "@/lib/auth/session-policy";
import { logSecurityEvent } from "@/lib/security-log";
import {
  REGISTRATION_CLOSED_MESSAGE,
  REGISTRATION_LOCK_KEY,
  registrationAllows,
  registrationMode,
} from "@/lib/auth/registration";

/**
 * The refusal when `STOKY_REGISTRATION` says no.
 *
 * FORBIDDEN rather than anything that names a reason: the security-event
 * middleware logs every FORBIDDEN as `access.denied` with the path, which is
 * the line an operator greps for, and the caller learns only that the door is
 * shut — not how many accounts exist behind it.
 */
function registrationClosed(): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message: REGISTRATION_CLOSED_MESSAGE });
}

/**
 * Accounts, as far as tRPC is concerned.
 *
 * **Signing in is not here.** It is the auth API (`/api/auth/sign-in/email`,
 * `src/server/http/auth-handler.ts`), and it used to be here too — an
 * `auth.login` procedure on the public router, unmetered and unused by the
 * interface, which was a second way to verify a password with none of the
 * protections the real one has. It was removed;
 * `src/__tests__/utils/authorize.ts` drives the real path instead.
 *
 * So what is left is the parts Better Auth is not asked to do: creating an
 * account, reading the current one and its session's expiry, changing its
 * password, listing and ending its sessions, and a `logout` that exists for
 * shape.
 */
export const authRouter = createTRPCRouter({
  /**
   * Creates an account, and optionally the household to go with it.
   *
   * `publicProcedure`, necessarily — there is nobody to authenticate yet — which
   * makes it one of the two endpoints reachable from the internet by anyone.
   * That is why it is rate limited before any work is done and why the
   * password has a maximum length: Argon2id here is 64 MB per call, so an
   * unbounded body would make this a memory amplifier (ISSUES.md CRITICAL-4,
   * DEBT-1).
   *
   * "Before any work", not "before it reads anything": tRPC has read and
   * JSON-parsed the body, and Zod has validated it, before the resolver can
   * count the attempt. What bounds that read is the route, which refuses a
   * body over 15 MiB with 413 before tRPC sees it
   * (`src/server/http/body-limit.ts`) — the proxy's cap alone did not, for a
   * request labelled a prefetch (`docs/SECURITY_REVIEW.md` §8).
   *
   * The household is optional. An account can exist without one, and
   * `householdRouter` is what such an account uses to get out of that state
   * (HOUSE-1).
   *
   * **Whether anyone may call it at all is the operator's**, through
   * `STOKY_REGISTRATION` (`src/lib/auth/registration.ts`): `first-user` by
   * default in production, so the person who installs the instance claims it
   * and everybody after is added through `household.addMember`. The order of
   * the checks below is the point of them:
   *
   * 1. `closed` refuses before anything — no limiter call, no query, no hash.
   * 2. The per-address limiter, before any query.
   * 3. `first-user` counts accounts and refuses once one exists. Before the
   *    existence check, so a refusal says nothing about whether an address
   *    is registered.
   * 4. The existence check, then the hash.
   * 5. One transaction creates the household and the account together, under
   *    an advisory lock, re-counting in `first-user` mode — see there.
   */
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ ctx, input }) => {
      const { email, name, password, householdName } = input;

      // Read per call rather than at import, so a test can set it and so
      // nothing here can disagree with what the startup guard checked.
      const mode = registrationMode();

      // Not inside the `if (ctx.headers)` below: a closed instance is closed
      // to a caller with no request behind it too.
      if (mode === "closed") throw registrationClosed();

      // ISSUES.md CRITICAL-4. Counted before anything is created, and before
      // the ~250ms of Argon2id below, so the endpoint cannot be used to make
      // the server do that work on demand.
      //
      // A context with no headers is the integration suite calling the router
      // directly; there is no request to attribute an attempt to, and there is
      // also no way to reach this procedure from outside without one.
      if (ctx.headers) {
        // Through the shared helper rather than inline, so the refusal carries
        // its `ThrottledError` and the HTTP layer can answer with
        // `Retry-After`. It also fails closed here without this procedure
        // having to remember to — see `src/server/trpc/throttle.ts`.
        await enforceRateLimit(
          registerRateLimit(),
          rateLimitIdentifier(ctx.headers),
          "Too many registrations from this address. Try again in a little while.",
        );
      }

      // After the limiter, so a closed-after-first-user instance cannot be
      // made to count its accounts on demand. A fast answer for the common
      // refusal; the decision that counts is the one inside the transaction.
      if (mode === "first-user" && !registrationAllows(mode, await ctx.db.user.count())) {
        throw registrationClosed();
      }

      // A courtesy, not the guard: it answers a duplicate before spending
      // Argon2id on it, with the message the screens match. Two registrations
      // of one address at once both pass it, and the unique index on `email`
      // refuses the second — as P2002, which `domainErrors` answers CONFLICT.
      const existingUser = await ctx.db.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Email already registered",
        });
      }

      // Hash password with Argon2id. Outside the transaction: a quarter of a
      // second holding the lock below would queue every other registration
      // behind it.
      const passwordHash = await hashPassword(password);

      const user = await ctx.db.$transaction(async (tx) => {
        // `first-user` is "while there are no accounts", and a count followed
        // by a create is a race: two people registering a fresh instance at
        // once both count zero and both get in. A transaction-scoped advisory
        // lock on a constant key makes the count and the create one step —
        // the second registration waits here until the first has committed,
        // then counts one. Released at commit or rollback; nothing to undo.
        //
        // Taken in every mode, not only `first-user`: registration is metered
        // to a handful an hour, so serialising it costs nothing, and one code
        // path is one thing to test. `$executeRaw` because the function
        // returns `void`, which `$queryRaw` cannot deserialise. The key is a
        // bound `bigint`, so Postgres resolves the one-argument overload.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`;

        if (mode === "first-user" && !registrationAllows(mode, await tx.user.count())) {
          throw registrationClosed();
        }

        // The household first and the account second, both on `tx`, so the
        // two commit or roll back together with this transaction. They used to
        // be two writes with no transaction: an account create that failed —
        // the duplicate above, raced — left a household nobody belonged to and
        // nothing could reach. The account takes the household's id as a
        // scalar rather than as a nested write because `createCredentialUser`
        // is the one way an account with a password is made, and the unchecked
        // input it takes is the form every caller can use.
        const household = householdName
          ? await tx.household.create({ data: { name: householdName } })
          : null;

        return createCredentialUser(
          tx,
          {
            email,
            name,
            role: household ? "OWNER" : "MEMBER",
            householdId: household?.id,
          },
          passwordHash,
        );
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }),

  /**
   * The signed-in account, read from the database rather than from the session.
   *
   * **Nothing calls it today**, which is worth knowing before relying on it.
   * The screens read what they need from the session, and the freshness
   * argument this would otherwise make — that a role change takes effect on the
   * next request rather than when the token is re-issued — is already handled
   * where it matters, in `householdProcedure`, which re-reads membership on
   * every request.
   *
   * Kept because it is the obvious shape of an endpoint a client will
   * eventually want, and because it costs one query. Throws UNAUTHORIZED rather
   * than returning null when the row is gone: a session for a deleted account
   * is not a missing resource, it is a session that should end.
   */
  me: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        include: {
          household: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not found",
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        snackbarDuration: user.snackbarDuration,
        role: user.role,
        household: user.household,
      };
    }),

  /**
   * This session's expiry, moved forward when activity is worth it — the
   * keep-alive's one call (`readSessionExpiry`, `src/lib/auth/client.ts`).
   *
   * **The only thing that slides a browser session.** Its row ends fifteen
   * minutes after it was last slid, and a day after the sign-in however often
   * (`src/lib/auth/session-policy.ts`). Reading the session does not move it —
   * not a page render, not a tRPC call — because a dashboard left open polls,
   * and polling is not somebody at the screen. The keep-alive asks only when a
   * pointer or a key moves.
   *
   * `publicProcedure`, because "no session" is an answer (`null`) rather than
   * a refusal: the keep-alive reads it as signed out, and an UNAUTHORIZED would
   * be logged as a refused request every time a tab outlived its session.
   *
   * The write is conditioned on the row still being live, so a session that
   * ended between the read and the write is not brought back.
   *
   * `kind` says which deadline `expires` is: `"idle"` while activity can
   * still move it, `"cap"` once it is the day's limit and nothing can. The
   * keep-alive reads it to stop offering "Seguir conectado" when pressing it
   * would change nothing (WCAG 2.2.6).
   *
   * **A remembered session is only read here** (D141). Its expiry is slid by
   * Better Auth's daily refresh, which this very request's session read has
   * already run when it was due (`readSession`); fifteen minutes from now
   * would cut ninety days short, and near the year's limit `nextExpiry` would
   * write a time already past.
   */
  session: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.session) return null;

    const now = new Date();
    const row = await ctx.db.session.findUnique({
      where: { id: ctx.session.sessionId },
      select: { expiresAt: true, authenticatedAt: true, persistent: true },
    });
    if (!row || row.expiresAt <= now) return null;
    const answer = (expiresAt: Date): { expires: string; kind: DeadlineKind } => ({
      expires: expiresAt.toISOString(),
      kind: deadlineKind({
        expiresAt,
        authenticatedAt: row.authenticatedAt,
        capS: capFor(row.persistent),
      }),
    });
    if (row.persistent || !shouldSlide(row.expiresAt, now)) return answer(row.expiresAt);

    const expires = nextExpiry({ authenticatedAt: row.authenticatedAt, now });
    const { count } = await ctx.db.session.updateMany({
      where: { id: ctx.session.sessionId, expiresAt: { gt: now } },
      data: { expiresAt: expires },
    });
    return count === 0 ? null : answer(expires);
  }),

  /**
   * How long a confirmation stays on screen, recorded against the account.
   *
   * It was in `localStorage`, which made a WCAG 2.2.1 adjustment a property of
   * the browser: somebody who needs longer to read a message had to say so
   * again on the phone, and again on the kitchen tablet, and lost it whenever
   * storage was cleared. The criterion is about the person.
   *
   * `protectedProcedure` and not `householdProcedure`: this is an account
   * setting, and an account with no household still sees snackbars — the form
   * that creates the household raises them.
   *
   * The device keeps a copy, written by the control rather than here. That is
   * a cache for the first paint before this value has been read, not a second
   * source of truth; the account is what `PreferencesSync` hands the store on
   * every load.
   */
  setSnackbarDuration: protectedProcedure
    .input(snackbarDurationSchema)
    .mutation(async ({ ctx, input }) => {
      // `updateMany`, so a session whose account has since been deleted
      // records nothing rather than throwing P2025. Failing to store a
      // preference must not become an error the reader has to act on.
      await ctx.db.user.updateMany({
        where: { id: ctx.session.user.id },
        data: { snackbarDuration: input.snackbarDuration },
      });

      return input;
    }),

  /**
   * End every session this account has, including the one asking.
   *
   * Deletes the rows (`endSessions`), so every device holding one of them is
   * signed out on its next request: the session is read from its row every
   * time.
   *
   * **Including the one asking**, which is what "everywhere" has to mean: a
   * person who thinks a session is loose cannot be asked to guess which one.
   * The screen says so before the button is pressed.
   *
   * `protectedProcedure`, not `householdProcedure`: an account with no
   * household still has sessions, and needing a household to end them would
   * put the control out of reach of exactly the account that has least else.
   *
   * `z.void()`, because it takes nothing and should accept nothing — see
   * `logout` below.
   */
  revokeMySessions: protectedProcedure.input(z.void()).mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const count = await endSessions(ctx.db, { userId });

    logSecurityEvent("auth.session.ended", {
      userId,
      targetUserId: userId,
      reason: "self",
      count,
      address: ctx.headers ? clientAddress(ctx.headers) : undefined,
    });

    return { success: true };
  }),

  /**
   * This account's live sessions, one per signed-in browser or app — what a
   * person needs to see before ending one (ASVS 5.0.0 7.5.2, PROGRESS D143).
   *
   * **Never a token, never the device id.** The select names its columns, so
   * a column added later is not listed until somebody decides it should be:
   * `token` is the credential the cookie signs, and `deviceId` is the
   * `stoky_device` cookie's value, read here only to join `ScreenChoice`.
   * What a session is shown as is the browser and system its User-Agent names
   * (`deviceLabel`) and, where the device has chosen one, the screen it opens
   * on — which is what tells the kitchen tablet from a phone.
   *
   * Expired rows are left out: they are sessions that have ended and are only
   * waiting to be deleted (D139). `signedInAt` is `authenticatedAt`, not
   * `createdAt`, which Better Auth resets when it re-creates a session.
   * `lastUsedAt` is `updatedAt`, as coarse as the writes that move it (D140).
   *
   * `protectedProcedure`, for the reason `revokeMySessions` gives. A query,
   * so it takes no input.
   */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const rows = await ctx.db.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        authenticatedAt: true,
        updatedAt: true,
        expiresAt: true,
        userAgent: true,
        persistent: true,
        deviceId: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });

    const deviceIds = [...new Set(rows.flatMap((row) => (row.deviceId ? [row.deviceId] : [])))];
    const choices =
      deviceIds.length === 0
        ? []
        : await ctx.db.screenChoice.findMany({
            where: { userId, deviceId: { in: deviceIds } },
            select: { deviceId: true, screen: true },
          });
    const screenOf = new Map(choices.map((choice) => [choice.deviceId, choice.screen]));

    return rows.map((row) => ({
      id: row.id,
      device: deviceLabel(row.userAgent),
      screen: (row.deviceId && screenOf.get(row.deviceId)) || null,
      signedInAt: row.authenticatedAt,
      lastUsedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      remembered: row.persistent,
      current: row.id === ctx.session.sessionId,
    }));
  }),

  /**
   * End one of this account's sessions, every one but this, or every one —
   * after the current password (ASVS 5.0.0 7.5.2, PROGRESS D143).
   *
   * **The password first** (`confirmCurrentPassword`): a session somebody
   * else is holding — a phone picked up, a tablet left signed in — must not
   * be able to sign the owner out of theirs, or end the one it is being
   * evicted from. It is counted per session and per account before Argon2id
   * runs, and a wrong one is BAD_REQUEST, logged, and ends nothing.
   *
   * **Scoped to the account in every branch.** `"one"` deletes the row with
   * that id *and* this account's id, so another account's id ends nothing and
   * is answered NOT_FOUND, the same as an id nobody has: the caller learns
   * nothing about other people's sessions. `"others"` keeps the session
   * asking, by its id; a context without one is refused before the password
   * is asked, because Prisma reads `{ id: { not: undefined } }` as no
   * condition and `"others"` would become `"all"`.
   *
   * Logged as `auth.session.ended` with `reason: "self"`, and answers how
   * many ended and whether this session was one of them, so the screen knows
   * whether to sign out.
   *
   * No token rotation for the session that confirmed: SECURITY.md
   * *Authentication* records that deviation from ASVS 7.2.4.
   */
  endSessions: protectedProcedure
    .input(endSessionsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const current = ctx.session.sessionId;

      await confirmCurrentPassword(ctx, input.currentPassword, "end-sessions");

      const where =
        input.scope === "one"
          ? { userId, id: input.sessionId }
          : input.scope === "others"
            ? { userId, id: { not: current } }
            : { userId };
      const ended = await endSessions(ctx.db, where);

      if (input.scope === "one" && ended === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      logSecurityEvent("auth.session.ended", {
        userId,
        targetUserId: userId,
        reason: "self",
        count: ended,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });

      return {
        ended,
        includedCurrent:
          input.scope === "all" || (input.scope === "one" && input.sessionId === current),
      };
    }),

  /**
   * A signed-in person replaces their own password, and every session the
   * account has ends — this one included.
   *
   * Until this existed nothing changed a password once it was set (security
   * review, 2026-10-12): a password an admin chose in `household.addMember`
   * stayed known to that admin for good, and a leaked one could not be
   * rotated — `revokeMySessions` ended the sessions and whoever held the
   * password signed straight back in.
   *
   * `protectedProcedure`, not `householdProcedure`, for the reason
   * `revokeMySessions` gives: an account with no household still has a
   * password. The order of the steps is the point of them:
   *
   * 1. **The limit, first.** The next step answers "is this the password?",
   *    and a stolen session asking it in a loop is the attack; counted before
   *    Argon2id runs, like sign-in.
   * 2. **The current password**, through the same `verifyPassword` sign-in
   *    uses. Wrong is BAD_REQUEST, never UNAUTHORIZED: the offline queue and
   *    the screens read UNAUTHORIZED as a session that has ended, and this
   *    person is still signed in. It is logged here because the refusal
   *    middleware records only UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS.
   * 3. **The identity rule**, against the account's own address and name,
   *    which the input does not carry — so the schema cannot apply it
   *    (`withIdentityRule`). After the check above, so it answers nobody who
   *    has not proved they know the password.
   * 4. **One transaction** sets the hash and deletes every session row
   *    (`setPasswordAndEndSessions`). Two could leave a new password beside
   *    sessions that were meant to end; one cannot. The caller's own session
   *    goes with the rest, and the screen signs out and asks for the new
   *    password.
   *
   * **Ending this session too is deliberate**, for now: the person who
   * suspects their password leaked is the one who most needs every device
   * asked again. The form says so before it is submitted.
   */
  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const address = ctx.headers ? clientAddress(ctx.headers) : undefined;

      await enforceRateLimit(
        passwordChangeRateLimit(),
        userId,
        "Too many password changes. Try again in a little while.",
      );

      const account = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });

      // A session whose account is gone has nothing to change; UNAUTHORIZED is
      // the truth here, as it is in `householdProcedure`.
      if (!account) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This account no longer exists",
        });
      }

      const storedHash = await readPasswordHash(ctx.db, userId);
      if (!(await verifyPassword(storedHash, input.currentPassword))) {
        logSecurityEvent("auth.password.change.refused", { userId, address });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: WRONG_CURRENT_PASSWORD_MESSAGE,
        });
      }

      const problems = passwordProblems(input.newPassword, {
        email: account.email,
        name: account.name,
      });
      if (problems.includes("containsIdentity")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: PASSWORD_CONTAINS_IDENTITY_MESSAGE,
        });
      }

      const passwordHash = await hashPassword(input.newPassword);

      // Zero only if the account was deleted since it was read above — the
      // same truth as the check there.
      if ((await setPasswordAndEndSessions(ctx.db, { userId }, passwordHash)) === 0) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This account no longer exists",
        });
      }

      logSecurityEvent("auth.password.changed", { userId, address });

      return { success: true };
    }),

  /**
   * Does nothing, on purpose, and is not how anybody signs out.
   *
   * Ending a session is `signOutAction` in `src/lib/auth/actions.ts` — a
   * server action, so it can clear the cookie as it deletes the row —
   * called by `SignOutButton`, which first purges the offline queue and tells
   * the service worker to forget the cached shell. Those two are the reason
   * signing out is a component's job rather than an endpoint's.
   *
   * This is kept so that a caller who goes looking for `auth.logout` finds this
   * paragraph instead of concluding that signing out is unimplemented, which is
   * what its previous silence invited.
   *
   * **Signing out ends this device's session and nothing else**: its row is
   * deleted, so a copy of the cookie taken before is refused too. The other
   * devices' sessions end when they sit idle for fifteen minutes, a day after
   * their sign-in (`src/lib/auth/session-policy.ts`), or when somebody ends
   * the account's sessions — `revokeMySessions` or `endSessions` above, or an
   * admin from the members panel.
   *
   * **`z.void()` on the three mutations that take nothing** — this,
   * `revokeMySessions` and `shopping.generateFromLowStock`. With no parser
   * tRPC hands the resolver whatever body arrived, a multipart form included,
   * so the one check every other procedure has on what reaches it was absent
   * from the three a cross-site form could most easily trigger. `z.void()`
   * refuses anything but `undefined`, which is what the client sends;
   * `z.object({})` would not, because a `FormData` is an object and passes.
   * `src/__tests__/unit/procedure-inputs.test.ts` holds every mutation to it.
   */
  logout: protectedProcedure
    .input(z.void())
    .mutation(async () => {
      return { success: true };
    }),
});
