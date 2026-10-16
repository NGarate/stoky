import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { enforceRateLimit } from "../throttle";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  changePasswordSchema,
  confirmPasswordSchema,
  endSessionsSchema,
  registerSchema,
} from "@/lib/validations/auth";
import { snackbarDurationSchema } from "@/lib/validations/preferences";
import {
  PASSWORD_CONTAINS_IDENTITY_MESSAGE,
  passwordProblems,
} from "@/lib/validations/password";
import {
  clientAddress,
  rateLimitIdentifier,
  registerRateLimit,
} from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password-hash";
import { createCredentialUser } from "@/lib/auth/credentials";
import { endSessions, endTwoFactorChallenges } from "@/lib/auth/end-sessions";
import { liveSessionsOf } from "@/lib/auth/session-list";
import { changeOwnPassword } from "@/lib/auth/password-change";
import { MISSING_SESSION_ID_MESSAGE, confirmCurrentPassword } from "@/lib/auth/reauth";
import { grantStepUp } from "@/lib/auth/step-up";
import { passkeyRpOrigin } from "@/lib/auth/passkeys";
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
   * The screens that word themselves by role, the write queue, and the
   * security screen's two-step verification read it; access control does not
   * — `householdProcedure` re-reads membership on every request. Throws UNAUTHORIZED rather
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
        // For `/settings/security`, which says whether it is on. Read from
        // the row like the rest, so turning it on in another tab shows here
        // on the next read.
        twoFactorEnabled: user.twoFactorEnabled,
        // The one origin a passkey works at (D151), or null when this install
        // cannot have them (`src/lib/auth/passkeys.ts`). The security screen
        // compares it with the page's own, so somebody at a second listed
        // address is told where to go rather than shown a button that fails.
        // Configuration, not a secret: it is the first `STOKY_URLS` entry.
        passkeyOrigin: passkeyRpOrigin(),
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
   * This account's live sessions, one per signed-in browser or app — what a
   * person needs to see before ending one (ASVS 5.0.0 7.5.2, PROGRESS D143).
   *
   * The reading is `liveSessionsOf` (`src/lib/auth/session-list.ts`), shared
   * with the admin's view of a member's sessions so the two cannot drift:
   * never a token, never the device id, expired rows left out. What this adds
   * is `current`, which only a person's own list has.
   *
   * `protectedProcedure`, not `householdProcedure`: an account with no
   * household still has sessions, and needing a household to see or end them
   * would put the control out of reach of exactly the account that has least
   * else. A query, so it takes no input.
   *
   * `/settings/security` shows it as **Tus dispositivos** (`DeviceList`).
   */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await liveSessionsOf(ctx.db, ctx.session.user.id);
    return sessions.map((session) => ({
      ...session,
      current: session.id === ctx.session.sessionId,
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
   * A signed-in person replaces their own password: every other session the
   * account has ends, and this one carries on under a new token (ASVS 5.0.0
   * 7.4.3, PROGRESS D144).
   *
   * Until this existed nothing changed a password once it was set (security
   * review, 2026-10-12): a password an admin chose in `household.addMember`
   * stayed known to that admin for good, and a leaked one could not be
   * rotated — ending the sessions left whoever held the password free to
   * sign straight back in.
   *
   * `protectedProcedure`, not `householdProcedure`, for the reason
   * `listSessions` gives: an account with no household still has a
   * password. The order of the steps is the point of them:
   *
   * 1. **The current password, through `confirmCurrentPassword`** — the same
   *    two budgets, counted before Argon2id, and the same `BAD_REQUEST` and
   *    `auth.reauth.refused` line as every other re-entry, with `via:
   *    "password-change"`. A stolen session asking "is this the password?"
   *    in a loop is the attack, and it spends that session's budget, not the
   *    owner's.
   * 2. **The identity rule**, against the account's own address and name,
   *    which the input does not carry — so the schema cannot apply it
   *    (`withIdentityRule`). After the check above, so it answers nobody who
   *    has not proved they know the password.
   * 3. **Better Auth writes it** (`changeOwnPassword`,
   *    `src/lib/auth/password-change.ts`): the hash, every session deleted,
   *    and a new one for this device whose cookie goes out with this answer.
   *    The browser sends this one procedure through a link that does not
   *    stream (`src/lib/trpc/links.ts`), because a streamed answer's headers
   *    leave before the resolver has set the cookie. A request with no
   *    cookie — a native client — is not given a new session, and its own
   *    ends here with the rest (D142).
   *
   * Logged as `auth.password.changed` and as `auth.session.ended` with
   * `reason: "password-change"` and how many sessions went, this device's
   * old token not counted when it was rotated.
   */
  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const headers = ctx.headers;
      // Better Auth finds the session in the request's headers; a context
      // without them cannot reach it. Refused before anything is spent.
      if (!headers) {
        throw new TRPCError({ code: "BAD_REQUEST", message: MISSING_SESSION_ID_MESSAGE });
      }
      const address = clientAddress(headers);

      await confirmCurrentPassword(ctx, input.currentPassword, "password-change");

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

      // Counted before, because Better Auth deletes them without saying how
      // many: every row but the one asking, which a rotation replaces.
      const others = await ctx.db.session.count({
        where: { userId, id: { not: ctx.session.sessionId } },
      });

      const { rotated } = await changeOwnPassword(headers, input);
      const ended = rotated ? others : await endSessions(ctx.db, { userId });
      // Better Auth ended the others with its own delete, which leaves a
      // two-step sign-in in progress alone: whoever started one has the old
      // password, and it must not outlive it (D148). `endSessions` already did
      // this for the native branch.
      if (rotated) await endTwoFactorChallenges(ctx.db, [userId]);

      logSecurityEvent("auth.password.changed", { userId, address });
      logSecurityEvent("auth.session.ended", {
        userId,
        targetUserId: userId,
        reason: "password-change",
        count: ended,
        address,
      });

      return { success: true };
    }),

  /**
   * The current password, re-entered to allow one change to how this account
   * signs in that the auth API makes: adding a passkey, or removing one
   * (ASVS 5.0.0 7.5.1, PROGRESS D151).
   *
   * Better Auth's passkey endpoints take a session and a WebAuthn ceremony,
   * never a password, so the password is asked here — through
   * `confirmCurrentPassword`, the same two budgets and the same refusal as
   * every other re-entry, with `via: "step-up"` — and what it proves is left
   * for the auth API as a step-up (`src/lib/auth/step-up.ts`): bound to this
   * session, spent by the one change, lapsing in five minutes. The policy
   * plugin refuses the change without one (`STEP_UP_REQUIRED`).
   *
   * `protectedProcedure`, like `changePassword`: every account may have
   * passkeys, the kitchen's shared one included (the owner's decision of
   * 2026-10-15). Answers when the step-up lapses. No token rotation, as for
   * every re-entry (D143).
   */
  confirmPassword: protectedProcedure
    .input(confirmPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      await confirmCurrentPassword(ctx, input.currentPassword, "step-up");
      const expiresAt = await grantStepUp(ctx.db, {
        sessionId: ctx.session.sessionId,
        userId: ctx.session.user.id,
      });
      return { expiresAt: expiresAt.toISOString() };
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
   * the account's sessions — `endSessions` above, or an admin from the
   * members panel.
   *
   * **`z.void()` on the mutations that take nothing** — this and
   * `shopping.generateFromLowStock`, and `revokeMySessions` until
   * `endSessions` replaced it. With no parser tRPC hands the resolver
   * whatever body arrived, a multipart form included, so the one check every
   * other procedure has on what reaches it was absent from the three a
   * cross-site form could most easily trigger. `z.void()`
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
