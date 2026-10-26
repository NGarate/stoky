# Progress log

Working memory for the iterative execution of `docs/REDESIGN_PLAN.md`.

This file exists so that work can resume from a cold start. It records what is
done, what is in flight, and — most importantly — **decisions taken without
asking**, so a reader is never left wondering why something is the way it is.

Rules for this log:

- One line per completed unit, newest last, with its commit.
- Every autonomous decision gets an entry in *Decisions*, with the reasoning.
- Anything discovered that is not in the plan gets filed in `ISSUES.md` and
  linked here, rather than being fixed silently.
- Nothing is marked done on the strength of it having been written. It is done
  when a command says so.

---

## Status

| Phase | State |
|---|---|
| 0 — Clean slate | ✅ Complete |
| 1 — Close the dead routes | ✅ Complete |
| 2 — One design system | ✅ Complete |
| 2b — Foundations of use (audit) | ✅ Complete except the human screen-reader pass |
| — Test infrastructure (unplanned) | ✅ Complete |
| 3 — Roles, and CRITICAL-4 | ✅ Complete |
| 4 — Offline, and a shop that survives it | ✅ Complete against its done-when |
| 4b — Client state, the compiler, a React gate | ✅ Complete |
| 5 — Kitchen screen, and Screen A's layout | ✅ Complete against its done-when, except a week on a real tablet |
| 6 — Rating | ✅ Complete, except T7 (offline scan resolution), which stays in §10 |
| 7 — Security review | ✅ Complete — `docs/SECURITY_REVIEW.md`, which found and closed four isolation defects |
| — Browser-suite isolation and production parity (unplanned) | ✅ Complete |
| 8 — The owner's first pass | ✅ All six closed (`d7c178d`, `8114501`, `cf18b52`, `4bbb82d`, `941d1ed`, `70386ea`); the done-when — the owner's re-pass — is the owner's to run |

---

## Done

### Better Auth replaces next-auth (2026-10-15, `feat/better-auth-2026-10-15`)

| Change | Evidence |
|---|---|
| "feat(db): move password hashes into a credential Account row" (D134) | `migration.credential-account.test.ts` migrates a populated database and signs its accounts in with their old passwords; a migration that writes another `providerId` turns it red. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "refactor(auth): own the session type the app reads" | `AppSession` (`src/lib/auth/session.ts`) replaces next-auth's `Session` in the tRPC context, the HTTP handler and 18 integration tests. `auth-dynamic.test.ts` fails when any file outside `src/lib/auth*`, `src/types` and the two tests of next-auth's own configuration imports from `next-auth`; re-adding the import to `trpc.ts` turns it red. `bun run verify:ci` green on the commit. |
| "refactor(auth): take sign-in throttling out of the credentials provider" | The per-address, per-account and known-device budgets live in `src/lib/auth/sign-in-policy.ts`, which takes `Headers` and knows nothing of next-auth. `sign-in-policy.test.ts` drives it with a scripted limiter; hardcoding the refusal's `retryAfterSeconds` to 0 turns it red. `integration/rate-limit.test.ts` passes unchanged through `authorize`, and dropping the settle call there turns nine of its cases red. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "feat(auth): record each successful sign-in" | ASVS 5.0.0 16.3.1: `signInSucceeded(charge, userId, method)` writes `auth.signin.succeeded` with the user, the factor, the account tag and the client address, after the charge has settled. `integration/security-log.test.ts` signs in through `authorize` and finds exactly one such line; removing the log call turns it red. `bun run verify:ci` green on the commit. |
| "refactor(auth): never mint a device id for an auth API or bearer request" (D110 amended) | `src/proxy.ts` leaves `stoky_device` alone under `/api/auth/` and on `Authorization: Bearer` requests, so a native client is never handed a cookie it did not send; one that keeps cookies no longer earns a known-device budget from an auth-API sign-in. `proxy-device.test.ts` covers both, an id still forwarded to the auth API, and `/login`, `/api/authors` and a `Basic` header still minted; removing the skip turns two cases red. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "refactor(auth): put the browser's auth calls behind one module" | `src/lib/auth/client.ts` is the only browser caller of the auth library: `signInWithPassword` answers `{ok}` or `{ok: false, code}` in a vocabulary the forms translate, and `readSessionExpiry` reads the keep-alive's expiry. The login and registration forms and `SessionKeepAlive` call it; `auth-pages.test.tsx` mocks it completely, the real module spread in (D50). `auth-client.test.ts` checks the translation (dropping the code passthrough turns three cases red), and `auth-dynamic.test.ts` fails when any other file imports or mocks `next-auth/react`. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "feat(ui): add a Checkbox primitive" | `src/components/ui/checkbox.tsx` is `RadioOption`'s stretched input for a yes/no choice, ready for the remember-me box: named by its label, described by its hint, `name=on` in a plain form, its drawn tick following `:checked`. `target-size.test.tsx` measures the input itself and credits it with the label's 48px only when it really covers the label; an `sr-only` input, alone or beside the stretching classes, turns it red. `bun run verify:ci` green on the commit. |
| "feat(db): add the session and verification tables" | `20261015130000_auth_session_tables` creates Better Auth's `Session` (one row per signed-in browser or app, cascading from `User` like `Account`, with our `authenticatedAt` as the absolute limit's clock) and `Verification`, and adds `emailVerified` and `image` to `User`. Empty until the switch: next-auth neither reads nor writes them. `indexes.test.ts` asserts a unique index on `Session(token)` and indexes on `Session(userId)`, `Session(expiresAt)` and `Verification(identifier)`; a plain index on the token turns it red. `auth-tables.test.ts` deletes an account and finds its sessions gone and another's kept; `ON DELETE SET NULL` turns it red. `bun run verify:ci` green on the commit. |
| "feat(auth)!: replace next-auth with Better Auth" (D135; supersedes D125, amends D31) | Better Auth 1.7.7, sessions in the `Session` table, behind `src/server/http/auth-handler.ts` (five allowlisted endpoints, the body bound, Fetch Metadata, JSON only, our limits, the token kept out of bodies). `integration/auth.surface.test.ts` tries every endpoint the instance mounts with a signed-in cookie and finds only the five answer and no row changed; allowlisting `/change-password` turns it red. `integration/session.policy.test.ts` signs in for real: fifteen idle minutes, slid by `auth.session` and by nothing else, a day's cap, a deleted row refused at once; sliding inside `readSession`, dropping the clamp or enabling the cookie cache each turns it red. Ten wrong passwords write ten security lines and no Better Auth line. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "feat(db): drop the sessions-valid-from column" | `20261015131000_drop_sessions_valid_from` drops `User.sessionsValidFrom`, the revocation line next-auth needed and nothing has read since the switch: ending a session is deleting its row (D135). `migration.credential-account.test.ts` migrates a database where an account still has the line set and finds the column gone; leaving the migration out turns it red. `bun run verify:ci` green on the commit. |
| "feat(auth): refuse to start on settings Better Auth would misread" (D136) | `refuseToStartMisconfigured` exits on production without `NEXTAUTH_URL`, a `NEXTAUTH_URL` that is not a URL, `BETTER_AUTH_TRUSTED_ORIGINS` set and `BETTER_AUTH_TELEMETRY` on, each named on its own `[auth] refusing to start:` line; `BETTER_AUTH_SECRET(S)`, `AUTH_SECRET`, `BETTER_AUTH_URL` and `AUTH_URL` are each warned about as ignored. `unit/auth-environment.test.ts` runs the instrumentation hook as a production server for each: removing the start-up call, or any one check, turns it red; so does dropping the warning or letting the value into it. `bun run verify:ci` green on the commit. |
| "feat(auth): read the signing secret from STOKY_SECRET" (D137) | The signing key is `STOKY_SECRET`; `NEXTAUTH_SECRET` is still read when it is unset, with one `[config]` deprecation line at start-up (`src/lib/env-names.ts`). `install.sh` renames the line keeping its value, and the bundle's Compose file passes both names through. `unit/env-names.test.ts`, `unit/auth-secret.test.ts` (the key Better Auth signs with, in a fresh process), `unit/auth-environment.test.ts` (the hook, once), `integration/health.test.ts`, `unit/install-script.test.ts` and `unit/security-log.test.ts` pin the rule; preferring the legacy name, dropping the rename step or the start-up warning each turns them red. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "feat(auth): list every address the instance answers at in STOKY_URLS" (D138) | `STOKY_URLS` is a comma-separated list: the first entry is Better Auth's `baseURL` and alone decides `Secure`; every entry's origin is trusted for sign-in, and in production nothing else is. Production refuses no entry, an entry that is not a bare origin, and an https first entry beside LAN http; `NEXTAUTH_URL` is read as a list of one with a deprecation line. `unit/public-url.test.ts` (the list, the cookie in a fresh process), `unit/auth-environment.test.ts` (the hook) and `integration/auth.origins.test.ts` (a production instance with two entries signs in at both and refuses an unlisted origin and a `DEV_ALLOWED_ORIGIN` host) pin it; trusting only the first entry, dropping the mixed-scheme check or reading `DEV_ALLOWED_ORIGIN` in production each turns them red. `bun run verify:ci` and `bun run test:e2e` green on the commit. |
| "feat(auth): tidy a person's stale sessions at sign-in" (D139) | ASVS 5.0.0 7.2.4: after a sign-in succeeds the auth route ends the session the browser presented — whoever's it was — and the account's expired rows, never the one just issued (`src/lib/auth/sign-in-tidy.ts`), logging `auth.session.ended` `reason: "replaced"`. `integration/session.sign-in-tidy.test.ts` signs in twice with one cookie jar (one row left, the old cookie refused, the new row's clock fresh), across a shared tablet, from a second browser (both stay), with a wrong password (nothing ends) and after a row expires (gone); `unit/sign-in-tidy.test.ts` pins that no `{id: undefined}` reaches the `OR` (which Prisma 6.19 reads as matching nothing, so only the unit test sees it). Skipping the delete, deleting by account, dropping or widening the expired clause, or tidying before the password is checked each turns them red. `bun run verify:ci` green on the commit. |
| "feat(auth): cap each account at ten concurrent sessions" (D140) | ASVS 5.0.0 7.1.2: `MAX_SESSIONS_PER_ACCOUNT` is ten, and the sign-in that would make the eleventh ends the least recently used session — oldest `updatedAt`, never the one just issued — logging `auth.session.ended` `reason: "evicted"` (`capSessions`, `src/lib/auth/sign-in-tidy.ts`). It runs after the tidy, in the same transaction, which holds the account's `User` row `FOR UPDATE`. `integration/session.cap.test.ts`: an eleventh sign-in ends the least recently used row, not the oldest, and its cookie stops working; a re-sign-in at ten ends only the presented row and evicts nothing; three sign-ins at once on top of nine leave ten. Ordering by `createdAt`, capping before the tidy, dropping the cap, an off-by-one, or counting the new session each turn it red; the lock and the order are pinned in `unit/sign-in-tidy.test.ts`. `bun run verify:ci` green on the commit. |
| "feat(auth): keep a person signed in when they ask to" (D141) | The login form's "Mantener la sesión iniciada" box, unticked by default, makes a remembered session: `Session.persistent` (migration `20261015140000_persistent_sessions`), a ninety-day cookie, ninety idle days slid at most daily by a tRPC read, a year from `authenticatedAt` at most. The route passes `rememberMe` only for a literal `true`, sets `x-stoky-remember` after deleting the client's copy on every request, and on a ticked sign-in strips and expires `dont_remember`. `integration/session.policy.test.ts` signs in ticked, omitted and in a jar an unticked sign-in left, slides a day-old row, refuses one a year and a second on though used the day before, and checks the keep-alive never shortens one; `unit/auth-handler.test.ts` the coercion, the header and the cookie; `components/auth-pages.test.tsx` the box; `e2e/remember-me.spec.ts` what a real browser keeps. |
| "feat(auth): tell an idle timeout from the session limit in the warning" | WCAG 2.2.6: in the day's last fifteen minutes the expiry is the limit from the sign-in and "Seguir conectado" cannot move it. `deadlineKind` (`src/lib/auth/session-policy.ts`) says which deadline an expiry is, with a second's slack; `AppSession.expiresKind` and `auth.session`'s `kind` carry it, and `SessionKeepAlive` names the limit and drops the button for `"cap"`. `SessionKeepAlive.test.tsx` (ignoring the kind turns three red), `session-policy.test.ts` (the boundary at ±1 s) and `session.policy.test.ts` (both answers of `auth.session` and the render's read). SECURITY.md no longer says nothing warns before the day runs out. `bun run verify:ci` green; `bun run test:e2e` 194 passed on six of eight runs, the other two being the service-worker offline test (flaky since commit 15's measurement) and a Firefox navigation timeout. |
| "feat(auth): sign native clients in with bearer tokens" (D142) | Better Auth's `bearer({ requireSignature: true })` plugin: a client that keeps no cookies signs in at `/sign-in/email` with `rememberMe: true`, reads `<token>.<signature>` from `set-auth-token`, and sends it as `Authorization: Bearer` to tRPC and the auth API; the contract is in SECURITY.md *Authentication*. The route withholds `set-auth-token` and its expose entry from any request that carried a cookie, and the body never has the token. `integration/bearer.test.ts`: a cookie-less, Origin-less sign-in gets the signed token in the header alone; any cookie gets none; the token opens `get-session` and a tRPC query; unsigned and foreign-signed tokens are refused (with a control signed by the instance's own key); sign-out deletes the row; a remembered bearer row slides to the year and no further, a browser-kind one is never moved; a re-sign-in ends the presented bearer session. Removing the plugin, the strip, the body strip, the signature requirement, the update hook's drop, the year's clamp, the sign-out's header or the presented read each turns it red. `unit/trpc-handler.test.ts`: a bearer call with no Fetch Metadata passes, a cross-site one with the cookie is 403. |
| "feat(auth): let a person end their own sessions after re-entering the password" (D143) | ASVS 5.0.0 7.5.2: `auth.listSessions` lists the account's live sessions as browser, system and — through the new `Session.deviceId` joined to `ScreenChoice` — the screen the device opens on, with no token and no device id; `auth.endSessions` ends one, every other or every one after `confirmCurrentPassword` (`src/lib/auth/reauth.ts`), metered per session (5, refunded on success) and per account (20). Re-entry does not rotate the token, an ASVS 7.2.4 deviation the owner accepted. `integration/session.revocation.test.ts` (+15) signs every session in for real: each scope ends exactly its rows and leaves another account's; a wrong password ends nothing, is `BAD_REQUEST` and logged; the sixth wrong try is 429; a right answer is refunded; one session's spent budget leaves another able to end it; twenty wrong tries across four sessions stop a fifth; a right answer stays counted against the account; a screen another account chose on a shared device is not this one's; another account's id is `NOT_FOUND`; a context without a session id is refused; get-session never carries the device id. Each of nineteen deliberate breaks (the not-current filter, the verify, the per-session key, the account id in "one", the guard, the refund, a refund of the account budget too, the account budget, the account id in the screen join, the hook's device id, `returned: false`, the list's fields, expired rows, the screen join, `NOT_FOUND`, both log lines, `current`, `includedCurrent`) turns it red. `unit/end-sessions.test.ts` refuses `{ id: { not: undefined } }`; `tenant-scoped-ids`, `procedure-inputs`, `rate-limit`, `capabilities` (68) and `device-label` cover the rest. |
| "feat(auth): show your devices in security settings" | **Seguridad y acceso** (`/settings/security`, linked first from the settings hub) shows **Tus dispositivos**: one `ItemRow` per session, named by the screen the device chose or its browser and system, this device's marked, with last use, sign-in, end and whether it is remembered, and the ten-session cap (D140) said under the list. **Cerrar esta sesión**, **Cerrar las demás** and **Cerrar todas** each ask for the password in `ReauthDialog` before `auth.endSessions` runs; an ending that includes this device goes through `useEndSession` (server first, then the purge, then the redirect), one that does not purges nothing and reads the list again. `auth.revokeMySessions` and `RevokeSessionsButton` are deleted (67 procedures). `components/DeviceList.test.tsx` (13) and `EndSession.test.tsx` (48 → 54: the old button's cases moved onto the list, plus "others", another device's row, this device's row, and this row's post-purge failure worded as one session) go red under each of seventeen breaks — "others" or "all" routed the wrong way, send-first that discards, the badge, the cap hint, the screen name, the session id, the re-read, the gone and wrong-password wording, the empty-password check, the refusal not unwrapped from `EndSessionError`, "Cerrar las demás" with nobody else. `e2e/session-revocation.spec.ts` signs a second browser in separately and ends it alone, then both, then refuses a wrong password; it reads each browser's state from `get-session`, because a signed-out `goto("/dashboard")` lands on the prerendered shell before `/login` and the URL check passed against a build whose "one" ended all. `e2e/request-guards.spec.ts` sends `auth.endSessions` with the right password. |
| "refactor(auth): move the password form to security settings" | `ChangePasswordForm` moves from the settings hub to **Seguridad y acceso**, as a **Contraseña** section after **Tus dispositivos**: it ends sessions too, so it sits beside the list of what it would end, and the next commit changes what it ends. The hub row's description names the password. Behaviour is unchanged; `e2e/password-change.spec.ts` changes only its URL, and went red when the form was left off `/settings/security`. |
| "feat(auth): keep this device signed in when its password changes" (D144) | ASVS 5.0.0 7.4.3: `auth.changePassword` confirms the current password through `confirmCurrentPassword` (the D143 budgets; `passwordChangeRateLimit` and `RATE_LIMIT_PASSWORD_CHANGE_*` are retired, and a wrong password is `auth.reauth.refused` `via: "password-change"`), then the identity rule, then Better Auth's `changePassword` with `revokeOtherSessions` (`src/lib/auth/password-change.ts`): every other session ends and this one is re-created under a new token that keeps `authenticatedAt`, `persistent` and the device. The browser sends the call by `httpLink` through a `splitLink` (`src/lib/trpc/links.ts`), and the form says it is done in place instead of signing out and purging. A request with no cookie (native) ends every session, its own too. `integration/auth.flow.test.ts` signs in through the route and drives real sessions: other browsers and a bearer session end and log `reason: "password-change"` with the count; the old row is gone and the new one keeps sign-in time, kind and device for a browser and a remembered session, and opens with a token signed as the cookie is; a wrong password changes nothing and never reaches Better Auth (no Argon2id hash), and is answered before the identity rule; one session's spent budget leaves another able to change it. `unit/password-change.test.ts` maps Better Auth's refusals, `unit/trpc-links.test.ts` measures which request each call makes, `components/EndSession.test.tsx` holds the form to no purge and no sign-out, and `e2e/password-change.spec.ts` shows this browser still signed in after a reload, under a new cookie that is still a browser session's (no expiry: Better Auth picks the `Max-Age` from the `dont_remember` cookie the request carried, which the database row cannot show), while another device and a copy of the old cookie are refused. Breaks that went red: the hook not inheriting, the identity rule before the verify, no re-entry, `revokeOtherSessions` off, rotating without a cookie, no `endSessions` for native, no ended line, the two refusal mappings, the split off (unit, and the e2e: "the rotated cookie did not arrive") or everything unstreamed, `dont_remember` withheld from Better Auth (e2e only: the cookie came back expiring), and the form's sign-out, reset, status and re-read. |
| "feat(household): let an admin end a member's sessions" (D145) | ASVS 5.0.0 7.4.5: `household.revokeMemberSessions`, which ended all of a member's sessions and nothing less — and the admin's own with no password — is replaced by `household.memberSessions` (the member's live sessions, read by `liveSessionsOf` in `src/lib/auth/session-list.ts`, now shared with `auth.listSessions`) and `household.endMemberSessions` (one by id, or every one). Both refuse the caller's own id (`BAD_REQUEST`), another household's member (`NOT_FOUND`) and an admin acting on an owner (`FORBIDDEN`); the delete scopes the session id by the member's id and repeats the household and role checked; `auth.session.ended` `reason: "admin"` with the count; no password, as the owner confirmed. On **Personas del hogar**, "Ver sus sesiones" (absent from the admin's own row) opens `MemberSessionsDialog`: compact `ItemRow`s named as **Tus dispositivos** names them (`useSessionName`, extracted from `DeviceList`), **Cerrar esta** and **Cerrar todas sus sesiones**; the inline two-step confirmation and its strings are gone. 68 procedures. `integration/session.revocation.test.ts`: all and one ended with the log line and nothing but the count answered, the list with no token, device id or expired row, another account's session id `NOT_FOUND`, cross-household `NOT_FOUND`, owner `FORBIDDEN`, a `MEMBER` refused, the caller's own id `BAD_REQUEST`, an owner ending another owner's. `components/PeopleRoles.test.tsx` holds the dialog, `components/EndSession.test.tsx` the page (whose row offers it, what it sends, nothing read until asked), and `e2e/session-revocation.spec.ts` ends one of a member's two browsers, then both, with the admin still signed in. Breaks that went red: no owner guard (on the list, the end, both), no self refusal, an unscoped member lookup, the session id ignored or not scoped to the member, no `NOT_FOUND`, no log line, rows in the answer, expired rows or the token listed; on the client the button on the admin's own row, no session id sent (component and e2e), end-all not closing, the query always on, `FORBIDDEN` unmapped, refusals or the load error not shown, a row ending all, end-all enabled with nothing to end, the device meta dropped, and (e2e) the list kept across a close, which reopened the dialog on the sessions just ended. |
| "feat(household): end a member's sessions when they are removed" (D146) | ASVS 5.0.0 7.4.2: `household.removeMember` deletes every session the member has (`endSessions`) inside the transaction that clears their household, after the existing guards, and logs `auth.session.ended` `reason: "removed"` with the admin, the member and the count once it has committed. Before, removal took the household and left the sessions, so a device the household no longer controlled still reached the account: its password, its devices, a new household. The confirmation on **Personas del hogar** now says the member is signed out on every device (Spanish and English). `integration/household.members.test.ts` "removing a member": two real sign-ins' cookies refused and their rows gone, a bystander still signed in, the log line, the account able to sign in again with no household; a refused removal (admin on an owner) ends nothing and writes no line. `components/EndSession.test.tsx`: the confirmation says so. Breaks that went red: no `endSessions`, no log line, reason `admin`, actor and target swapped, a fixed count, ending before the guards outside the transaction, logging before the guards, ending the whole household's sessions; the old confirmation text. |
| "feat(household): let an owner end every session in the household" (D147) | ASVS 5.0.0 7.4.5: `household.endHouseholdSessions` ends every session of everybody in the household, the owners and the caller included, after the owner's current password. `adminProcedure`, then owners only inside the resolver (`FORBIDDEN` before the password is asked), then `confirmCurrentPassword` with `via: "household-end-all"`, then one `endSessions` filtered by the household through each session's account; one `auth.session.ended` `reason: "owner"` with the count and no `targetUserId`. On **Personas del hogar**, owners alone see a **Cerrar todas las sesiones del hogar** section (`EndHouseholdSessions`): `ReauthDialog`, then the sign-out sequence (`useEndSession` with the server call as its `before`), with the send-first offer for unsent changes. 69 procedures. `integration/session.revocation.test.ts` (+3): two owners, an admin and a kitchen account signed in for real are all signed out and their rows gone while another household's owner stays signed in, with the one log line; an admin, a member and a kitchen account are `FORBIDDEN` with no password asked (a wrong one writes no refusal) and end nothing; a wrong password is `BAD_REQUEST`, ends nothing and is logged. `components/EndSession.test.tsx` (+7): offered to an owner and not to an admin, says the owner leaves too, sends the password and ends on the server before purging and signing out, a wrong password or `FORBIDDEN` discards nothing and is said in the dialog, unsent changes are offered to be sent first. `e2e/session-revocation.spec.ts` (+1): an owner registered for the test adds a kitchen account, which signs in on its own browser; the owner ends every session with the password, lands on `/login`, and both browsers' `get-session` answers `null`. Breaks that went red: no household filter, only the owner's own, no owner check, the password before the role, no password, reason `admin`, `via` `end-sessions`, a target named, a fixed count; on the client the section offered to everyone or to nobody, no server call before leaving, no password sent, `FORBIDDEN` unmapped, unsent changes ignored, never sending first; in the e2e, ending only the owner's own sessions and a `before` that never calls the server (both: "the member's browser was still signed in"). |
| "feat(auth): add TOTP two-step verification with single-use codes" (D148) | ASVS 5.0.0 6.5.1: Better Auth's two-factor plugin, `TwoFactor` table and `User.twoFactorEnabled` (`20261015150000_two_factor`), with a code usable once. Only the sign-in's second step answers over HTTP — `POST /two-factor/verify-totp` and `/verify-backup-code`, seven endpoints in all; enrolment opens with the settings screen. A before-hook of ours (`src/lib/auth/policy-plugin.ts`) finds the step the code is for and claims it in one conditional `UPDATE` of `TwoFactor.lastTotpCounter`; a code matching no step is rewritten to one Better Auth must refuse and count; a secret that no longer decrypts is `TWO_FACTOR_UNREADABLE`, uncounted. The route settles the password's charge at `twoFactorRedirect`, ends the presented session there and logs `auth.signin.challenged`; the code step is charged per address, passes `code` alone, and is a sign-in only with the challenge cookie in and a session cookie out (refund, known device, tidy and cap, `auth.signin.succeeded` `method: "totp"`/`"backup-code"`). `endSessions` deletes the named accounts' challenges, the sign-in tidy excepted; a password change deletes them after Better Auth's own delete. Five new refusal codes worded in both languages. `integration/two-factor.test.ts` (17): the two steps; a code refused across two sign-ins in one step, for an earlier step, and for the enrolment; two sign-ins with one code while the row is held locked, exactly one in; a guard clock two steps behind Better Auth's lets nothing through unclaimed; five wrong codes end the challenge and are counted; an unticked and a ticked box survive the second step; `trustDevice` and `disableSession` ignored; a challenge dead after an admin reset and after a password change; the account counter cleared at the challenge; an unreadable secret refused, uncounted and logged; the presented session of another person ended at the password step; the eleventh session evicting the least used. `unit/totp-guard.test.ts`, `unit/auth-handler.test.ts` (+11), `unit/end-sessions.test.ts` (+5), `integration/auth.surface.test.ts`, `auth-tables.test.ts`, `data-export.test.ts`. Breaks that went red: the plugin unregistered, the claim unchecked, a read-then-write claim, no rewrite, refusing a no-match uncounted, the decrypt error escaping, no settle, no presented end, no tidy, the body passed through, challenges kept by `endSessions` or by the password change, the remember header defaulted either way, the cascade `RESTRICT`, the export selecting `twoFactor`, `get-totp-uri` allowlisted, and the unit breaks listed in the commit. |
| "feat(auth): store two-factor backup codes as hashes" (D149) | ASVS 5.0.0 6.5.2: two-step verification's backup codes are ten codes of 24 Crockford base32 characters (120 bits each, six groups of four, `crypto.getRandomValues`) stored as `sha256:<hex>` of the normalised code, in place of Better Auth's ten codes of about 60 bits encrypted with `STOKY_SECRET` (ISSUES AUTH-6). New `src/lib/auth/backup-codes.ts` (`generateBackupCodes`, `normaliseBackupCode`, `hashBackupCode`, and `storeBackupCodes`, whose `encrypt` hashes what is not yet a hash and whose `decrypt` is the identity), passed to `twoFactor({ backupCodeOptions })`; a before-hook in the policy plugin turns the typed code into its hash on `/two-factor/verify-backup-code`. Still no HTTP endpoint hands codes out: enrolment and regeneration open with the settings screen. `unit/backup-codes.test.ts` (12) and `integration/two-factor.test.ts` (+6): the column holds only hashes and none of the codes issued; a code typed in lower case with spaces signs in once and the rest still do; a stored hash typed as the code is refused; regeneration retires the old set; a wrong code is counted towards the lockout; a code signs in after the TOTP secret became unreadable, and two-step verification can then be turned off and on. Breaks that went red: Better Auth's `"encrypted"` storage, its generator, the hook unmatched, a stored hash passed through, `encrypt` rehashing hashes, no normalisation, `decrypt` losing the list, the hook refusing a code itself (uncounted), a biased `% 31`, 20 characters, a fixed random source, codes stored in the clear and an unchecked list. |
| "feat(auth): ask for the authenticator code when signing in" | The login form's second step, as its own state on `/login` rather than a page: `signInWithPassword` reads `twoFactorRedirect` as `{ ok: false, twoFactor: true }` (it was `ok`, which would have navigated with no session), and the new `verifyTotp` / `verifyBackupCode` in `src/lib/auth/client.ts` post `{ code }` and name each refusal (`SecondStepRefusalCode`). The form then asks for the authenticator code (`one-time-code`, numeric, six characters), with a button to a backup code and back and a **Volver** to the password; focus moves to the step's heading on entry. An expired challenge returns to the password with the reason and the address kept; an unreadable authenticator stays on the step and points at a backup code; a wrong backup code has its own sentence (`backupCodeInvalid`). Step 1 is unchanged, and the status region and the one submit button stay mounted across steps. `components/auth-pages.test.tsx` (+15, both languages), `unit/auth-client.test.ts` (+10), `unit/auth.error-messages.test.ts`. Breaks that went red: `twoFactor` ignored, an expired challenge kept on the step, the toggle stuck, no heading focus, no password focus on return, the fields unkeyed, an unreadable secret sent back to the password, the address dropped, **Volver** a submit, a backup code sent to the TOTP check, the autocomplete hint, a missing English sentence, the backup sentence shared, and the client's redirect, codes, path and body. |
| "feat(auth): set up two-step verification in settings" | **Seguridad y acceso** gains **Verificación en dos pasos**, for every role, the kitchen's shared account included (the owner's decision of 2026-10-15): an `ok` "Activada" or `neutral` "Desactivada" badge; turning it on (`ReauthDialog`, then a QR code drawn in the browser with `uqr` 0.1.3, the key in fours, an `otpauth:` link, and the first code through `verify-totp`, which turns it on and is used up); the ten backup codes shown once, after that code and never before, kept only in the step's state, with a copy and a `.txt` made in the browser; new codes and turning it off, each with the password; and after any change a link to *Tus dispositivos* (ASVS 5.0.0 7.4.3). The route opens `POST /two-factor/enable`, `/disable` and `/generate-backup-codes` (ten endpoints): a signed-in session or 401; the D143 budgets per session and per account before Better Auth, 429 `REAUTH_RATE_LIMITED` with `Retry-After`, 503 without Valkey; `password` alone forwarded; the session's attempt refunded on a right password, and the same two budgets, never sign-in's per-address one, for the first code a signed-in session sends to `verify-totp`, refunded when it is right; `auth.reauth.refused` `via: "two-factor"`, and the new `auth.twofactor.disabled` and `auth.twofactor.codes-regenerated`. `get-totp-uri` stays closed. `auth.me` carries `twoFactorEnabled`; `src/lib/auth/client.ts` gains `startTotpEnrolment`, `turnOffTwoFactor`, `replaceBackupCodes` and `AccountChangeRefusedError`, which `reauthRefusalOf` reads. Tokens `--qr-dark`/`--qr-light`, dark on light in every theme, held to 7:1. ASVS 6.3.3 (a second factor for every account) is recorded in SECURITY.md as a deviation. `components/TotpSetup.test.tsx` (19), `unit/auth-handler.test.ts` (+10), `unit/auth-client.test.ts` (+8), `integration/two-factor.test.ts` (+6): the kitchen account enrols through the route; a wrong password logged and nothing set up; the sixth try from one session refused even with the right password; off keeps the browser signed in; new codes retire the old; no session, 401. New `e2e/two-factor.spec.ts` (chromium): enrol from the key the page shows, sign in with a code, the same code refused in a fresh browser. Breaks that went red: a role refusal in the route, the log dropped, the body passed through, no budget, `get-totp-uri` allowlisted, no refund, no account budget, failing open, the codes kept after saving or across a remount or shown before the first code, the section hidden by role, the QR unnamed, the dialog not reading the refusal, no link to the devices, and `--qr-dark` at 4.48:1. |
| "feat(household): let an admin remove a member's two-step verification" (D150) | The way back from a lost authenticator with no backup code left, without the operator's SQL: `household.removeMemberTwoFactor` takes `{userId, currentPassword}` and refuses the caller's own id (`BAD_REQUEST`), then asks for the admin's own password (`confirmCurrentPassword`, `via: "member-two-factor"`) before looking the member up, then `memberOfHousehold` (`NOT_FOUND`) and `assertMayActOnOwner` (`FORBIDDEN`); one transaction clears `twoFactorEnabled` conditioned on the household, the role checked and that it is on (`CONFLICT` otherwise, nothing touched), deletes the `TwoFactor` row and ends every session and challenge the member has (`endSessions`); logged as the new `auth.twofactor.removed` and `auth.session.ended` `reason: "two-factor-removed"`. `household.members` carries `twoFactorEnabled`. **Personas del hogar**: each row says "Verificación en dos pasos: Activada/Desactivada", and rows that have it — never the caller's own, never an owner's to an admin — offer "Quitar la verificación en dos pasos" (`RemoveMemberTwoFactorDialog`, a `ReauthDialog` that says first that every session ends; `FORBIDDEN` and `CONFLICT` worded, the list read again). *Seguridad y acceso*'s explanation names the admin as the way back. 70 procedures. New `integration/household.two-factor-removal.test.ts` (6): members enrolled through `auth.api` and signed in for real lose the authenticator row, the cookie and a pending challenge, then sign in with the password alone; an owner removes another owner's; a wrong password is refused and logged, and is asked before a missing id is looked up; an admin on an owner is `FORBIDDEN`; another household's is `NOT_FOUND`, a member is refused, the caller's own is `BAD_REQUEST`; a member without it is `CONFLICT` and keeps their session; no line carries the code, the secret, a password or an email address. `components/EndSession.test.tsx` (+8) and `unit/procedure-inputs.test.ts` (+1). `e2e/two-factor.spec.ts` (+1, not run in this commit): an admin removes an enrolled member's and the member's browser is signed out and signs in with the password alone. Breaks that went red: `endSessions` skipped, no password, the member looked up first, no owner guard, `twoFactorEnabled` out of the write's guard, no self check, the row kept, reason `admin`, the event renamed, `via` `end-sessions`; on the page the button offered without it, on the own row or on an owner's to an admin, the meta always "Activada", `FORBIDDEN` unmapped, no refetch on `CONFLICT` or success, the dialog left open, no password sent. The household in the write's guard survives every test: it holds only against a member who leaves between the check and the write, the race `resetMemberPassword`'s identical guard answers. |
| "feat(auth): sign in with passkeys on the server" (D151) | `@better-auth/passkey` 1.7.7 (exact), registered only where WebAuthn can work — the first `STOKY_URLS` entry https or `http://localhost`, never an IP (`src/lib/auth/passkeys.ts`: `passkeysAvailable`, `passkeyRpHost`, `passkeyRpOrigin`, `passkeyOfferedAt`) — with that entry's host as `rpID` and its origin as the only `origin`. User verification `required` and checked in both `afterVerification` hooks (`USER_VERIFICATION_REQUIRED`). New `Passkey` table (migration `20261015160000_passkeys`, cascades from `User`). The step-up: `auth.confirmPassword` (`via: "step-up"`) writes `stoky-step-up:<session id>` for five minutes (`src/lib/auth/step-up.ts`); the policy plugin requires it for the registration options and spends it at the registration and the removal (`403 STEP_UP_REQUIRED`), forces `createSession` off, and for an unticked box re-sets the session cookie without `Max-Age`, removing Better Auth's first one. The route opens seven passkey endpoints (seventeen in all): the sign-in charged per address and settled like the password's (refund, known device, tidy and cap, `auth.signin.succeeded` `method: "passkey"`, `auth.passkey.signin-failed`), the remember-me handling shared through `rememberChoice`; the options on a budget of their own (`passkeyOptionsRateLimit`, 30 per 15 min, a deviation explained in D151); each change's own body keys, `auth.passkey.added`/`removed` logged; the registration options' query cut to `authenticatorAttachment`. `endSessions` deletes the ended sessions' step-ups. New refusal words: `passkeyFailed`, `passkeyNotFound`, `passkeyNotVerified`, `stepUpRequired`. 71 procedures. New `integration/passkeys.test.ts` (17) with a software ES256 authenticator (`utils/webauthn.ts`), `unit/passkeys.test.ts` (12), `unit/auth-handler.test.ts` (+12), plus `end-sessions`, `rate-limit`, `auth.error-messages`, `procedure-inputs`, `capabilities`, `auth-tables`, `data-export` and `auth.surface`. Breaks that went red: no step-up check, a registration or removal that does not spend it, a step-up not bound to its session, no UV check at either ceremony, no cookie re-set, no deduplication, `createSession` passed to Better Auth, a kitchen refusal, every trusted origin as `origin`, no tidy, `endSessions` keeping step-ups, every box remembered, no password at `confirmPassword`, either log line dropped, the options on sign-in's budget, an IP host or LAN http allowed, the offer by hostname only, and the `RESTRICT` foreign key. |
| "feat(auth): manage passkeys in settings" | **Seguridad y acceso** gains **Llaves de acceso** (`src/components/security/PasskeyManager.tsx`), for every role, the kitchen's shared account included: one `ItemRow` per passkey — its name (or "Llave de acceso sin nombre"), when it was added, and "Sincronizada" or "Solo en el dispositivo donde se creó" from the authenticator's backup flag — with "Renombrar" (`ghost`, a dialog with a name field, no password) and "Quitar" (`destructive-ghost`, `ReauthDialog`, then `auth.confirmPassword`, then the removal); "Añadir una llave de acceso" goes through the same dialog, which advises against a device other people use, then `auth.confirmPassword`, then the browser's prompt, and names the passkey after the browser and system that made it. Where adding cannot work the screen says why instead of a button: `auth.me` now carries `passkeyOrigin` (null on an install that cannot have them), and a page at another origin is told "Las llaves de acceso solo funcionan en <host>", then an insecure context, then a browser without WebAuthn (`useSyncExternalStore`, nothing on the server). The list and removal still work at every listed address. `src/lib/auth/client.ts` gains `listPasskeys` (only id, name, date and the sync flag kept), `addPasskey`, `renamePasskey`, `removePasskey` and `browserRefusalOf`, refusals as `AccountChangeRefusedError` with five new codes. `@simplewebauthn/browser` 13.3.0, exact, loaded on the click (a 6.3 KB chunk of its own). `next.config.ts` grants `publickey-credentials-create=(self)` and `publickey-credentials-get=(self)`; `create` was denied, which would have failed every registration. The list is read under a non-tRPC query key, so the offline persister never keeps it. `components/PasskeyManager.test.tsx` (15), `unit/auth-client.test.ts` (+7), `integration/routers.test.ts` (`passkeyOrigin`). Breaks that went red: the insecure-context check inverted, the host comparison dropped from the explanation or from the button, a removal without the password, the confirmation skipped, the section hidden from the kitchen, the shared-device advice dropped, the missing-API and unsupported cases ignored, the null origin ignored, an untrimmed rename, a cancelled prompt unworded, the whole row kept, `clientExtensionResults` sent, `STEP_UP_REQUIRED` unmapped, the browser asked after a refused options request, `NotAllowedError` read as unknown, the sync flag ignored, and `passkeyOrigin` null. |
| "feat(auth): offer passkey sign-in on the login page" | `/login` offers **"Iniciar sesión con una llave de acceso"**, an `outline` `type="button"` after the submit, so Enter in the password field still sends the password. The page (`src/app/(auth)/login/page.tsx`) is now `instant = false` and reads the request's `Host` only after `await connection()`, as `/register` does — the first runtime input it reads — and hands `passkeyOfferedAt(host)` to `LoginForm`. Offered only when that is true and the browser is a secure context with WebAuthn (`useWebAuthnSupport`, `src/components/session/webauthn-support.ts`, now shared with the settings section); at the canonical address in a browser that cannot, one muted sentence; at any other address nothing, since a LAN address can never have one. The button reads the same remember-me box. `src/lib/auth/client.ts` gains `signInWithPasskey({rememberMe})` — the options, `startAuthentication` (loaded on the click), then `verify-authentication` with `{response, rememberMe}` and no `clientExtensionResults` — returning a result like the password's: a dismissed prompt is `passkey_cancelled` with its own words (`passkeyCancelled`), the server's codes `passkey_not_found`/`passkey_not_verified`/`passkey_failed`. New strings `passkeySignIn`, `passkeySigningIn`, `passkeyUnavailableInsecure`, `passkeyCancelled`. **The browser suite**: the one `webServer` now lists `STOKY_URLS=http://localhost:<port>,http://127.0.0.1:<port>`, so `localhost` is the canonical address and the relying party while 127.0.0.1, where the rest of the suite runs, stays trusted; a new `passkeys` project (Chromium at `localhost`, `--host-resolver-rules=MAP localhost 127.0.0.1`, left out when `PLAYWRIGHT_BASE_URL` names another server) runs the new `e2e/passkeys.spec.ts`: a CDP virtual authenticator, a passkey added in settings after the password, sign out, then a sign-in with it and the box left alone, which must leave a session cookie that dies with the browser. `components/auth-pages.test.tsx` (+11), `unit/auth-client.test.ts` (+6), `unit/auth.error-messages.test.ts`. Breaks that went red: the secure-context check dropped, the WebAuthn check dropped, `connection()` removed, the host ignored, the button made a submit, the box ignored, a refusal that navigates anyway, every passkey sign-in remembered, `clientExtensionResults` sent, a dismissed prompt read as a failure, `passkey_cancelled` unworded, and the English sentence missing. |

### Stock recounts retain only supported details (2026-09-12)

| Change | Evidence |
|---|---|
| INV-3: batch provenance, unknown remainders, explicit stock details and exact dozen conversion | `bun run verify:ci`: 695 unit, 658 component, 549 integration; `bunx playwright test`: 154 passed. Regression tests verified to fail under mutation. D119 records the changed assumptions. |


### Sharp's last job, the proxy rename, and a defect that was ours to expose (2026-08-27)

The Bun migration's tail, from
`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md`. Steps 1
through 4 are done and the plan's own step 4 goal turned out to be wrong (D114).

**The guard first, because it was the only item closing a hole.** Nothing that
ships may import `sharp` — `next.config.ts` excludes it from the standalone
output, so an import works in development, passes every gate, and fails in
production with the exact error that made this application leave the library.
A build cannot notice. It matches the three import spellings rather than the
word, because two files discuss sharp in prose and a guard that goes red on an
explanation gets deleted.

**The experiment the plan named as blocking everything.** A hand-built PNG whose
IHDR claims 9000 × 9000 over sixteen deflated zero bytes — **68 bytes** — is
refused with `input exceeds maxPixels limit`, the same refusal a 200 KB
sharp-built fixture triggers. The control is what makes it evidence: the
*identical* 68 bytes declaring 60 × 40 are accepted, so "refused because the
payload is nothing" is not an available explanation.

**Then the conversion**, which needed two readers the plan had not anticipated.
`Bun.Image` applies EXIF orientation *while decoding*, so it reports the
displayed size — a source stored 120 × 60 with a rotate tag comes back 60 × 120,
identical to its own output. Converting that assertion the obvious way leaves a
test that passes because both sides agree, having stopped comparing anything.
Reading `SOF` for the stored frame and tag `0x0112` for the orientation gives a
*stronger* assertion than the one it replaced. Generalised: **a normalising
reader cannot be the instrument for a test about whether the normalisation
happened.**

**`middleware.ts` became `proxy.ts`** (D115), and the healthcheck moved to
`bun -e` — the last Node process in a running container — verified by letting
Docker run it: healthy against real dependencies, unhealthy with the cache
pointed at a dead port.

**TEST-6 closed** (D116) after eight tests were run at a phone viewport for the
first time: 4 failed, all four on locators, 8 of 8 after.

**RUNTIME-1's `AbortError` was reproduced and localised**, and the reproduction
is a script that exits non-zero unless bun raises and node does not. It corrected
the entry twice. The first model — the browser cancels prefetches, each
cancellation raises — was wrong: prefetches that *complete* raise, cancelled ones
raise nothing. The second — `partialPrefetching` is the trigger — was also
wrong: the option decides whether a browser ever sends `next-router-prefetch: 3`,
and sending that header by hand raises with the option removed. The option
governs the client; the defect is in the server either way, which is better news
for the upstream report than either wrong version.

**Four probe failures paid for that**, each producing a confident wrong answer
first, and all four are `STATUS.md` trap 9 wearing a new face: a server that had
refused to boot, a port held by somebody else's process, a redirect nobody
followed, and a listener that was not rendering. The last one is the sharpest —
the process printed `✓ Ready`, bound the port, and refused every render, because
the probe's secret was 30 characters against a 32-character floor. The readiness
loop was waiting on curl's *exit code*, which a 500 satisfies as well as a 200.


### Instant navigations, and the three races that were hiding behind slack (2026-08-25)

Asked for directly: server-first, using Next 16.3's Cache Components rather than
a client island. The flags cost two edits to build green — and then took the
browser suite from 135 to 7 failures, which is where the value turned out to be.
Not one of the seven was caused by the migration. Every one was a race that had
always existed and had always been won by the slower path; a shell that renders
instantly simply stopped giving them that slack.

| Unit | Commit |
|---|---|
| An unread queue reports itself as saved — `hydrated`, surfaced as `data-sync` (D107) | `16306b8` |
| A restored read cache suppressed the refetch that would have corrected it; two suite races with it (D108) | `27d8ef2` |
| `cacheComponents` and `partialPrefetching`, the root layout blocking to keep the nonce (D109) | `2b6eba5` |

The nonce question was the owner's and was put to them rather than settled: a
per-request nonce and a prerendered shell are structurally incompatible, and the
answer was to keep the nonce. It is written beside the code as an answer, not as
a to-do.

### The record catches up with the work (2026-08-25)

Triggered by a red CI run on `e13c540` that turned out to be TEST-5 rather than
a regression. Verifying that led to the ledger below it, which had drifted
badly: its Status table called Phases 5 and 6 complete while the Done section
recorded neither, four campaigns had no section at all, and Phase 4's closing
prose still named as unbuilt two things built the following day. 165 commits
had no representation.

| Unit | Commit |
|---|---|
| Phases 5 and 6, the CI reshape and production hardening enter the ledger; Phase 4's false prose extended rather than erased | `511dfc6` |
| The design-system week — 115 commits, twelve campaigns, D100–D104's work | `35add07` |
| pnpm is 11.22.0; `corepack pnpm` stopped refusing, measured rather than assumed | `fbd7f53` |
| bun 1.4.0 measured against TEST-5 — it does not fix it, and the sequential measurement lied (D106) | `00a4586` |
| BUILD-1 filed — the image and CI pin different bun versions, and nothing compares them | `b2b1505` |

**What this cost, and the rule it argues for.** The backfill was only possible
because the commit messages were written for a reader; every row above was
recovered from them and then re-checked against its own diff. That is the
cheapest version of this work and it was still two commits and a lot of
verification. The rule the ledger already states — a row per unit, written when
the unit lands — is not bureaucracy; skipping it for six days cost more than
following it would have.

### The §10 tail — unowned items leaving the list by being done (from 2026-08-25)

| Unit | Commit |
|---|---|
| The ± stepper mounted on the product detail — Journey 4 passes (§3 flow 3, D105) | `74cff4b`, `e13c540` |
| A device identifier in a cookie, so the screen choice can be a server decision (D110) | `f3957c8` |
| The screen choice per `(userId, deviceId)` — Journey 8 passes, server-first (D110) | `300f665` |
| The starting screen is changeable from settings, and says which one it is (D111) | `295fadc` |

### Phase 7 — the review itself, and the class it found (2026-08-26)

The phase's actual deliverable, four years of good intentions after its backlog
closed. It found four instances of one household-isolation defect — three of
them new — and the fourth, SEC-1, had been rated HIGH and fixed months earlier
without anybody looking for its siblings.

| Unit | Commit |
|---|---|
| A receipt line belongs to its receipt, and a product to a household | `26ca43a` |
| A storage location belongs to one household, in all four stock procedures | `e7e1b0f` |
| The base image stops waiting for a distro fix — CVE-2026-14456 shipped | `ccde2e1` |
| A receipt is filed against its own household's shop | `b1ecbdd` |
| A tripwire on the isolation defect, so the review is repeatable (D112) | `8bb2547` |
| The review itself, and the two false claims it found in `SECURITY.md` | `8081104` |
| The security headers asserted on a real response — finding 12 closed | `4c6fb90`, `082c189` |
| A sha guard that cannot answer on a shallow clone says so (D113) | `5995ace`, `88f5fe8` |
| Image decoding bounded in pixels — finding 14, a 446 KB bomb | `69c1bd5` |

### Development in the image, and the phone photograph that will not decode (2026-08-25)

Reported from Android: tapping to upload a receipt opened a filtered gallery
rather than a file chooser, and the `accept` attribute measured as
`image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp` — Android builds its
picker from MIME types and does not reason about `.jpg`. Tidying the attribute
found the real complaint underneath it: "only some photos" is HEIC, which is
what both platforms save camera photographs as, and which this build of `sharp`
cannot decode. Alpine's packaged `vips-heif` converts them, so the way in
exists; taking it means rebuilding the production image *and* every machine that
runs the suites. That is a decision, not a consequence of tidying an attribute —
so it was measured rather than taken.

| Unit | Commit |
|---|---|
| One `accept` list in `src/lib/validations/receipt.ts` — types, not extensions; HEIC measured and still out | `9df4ab9` |
| The `development` image runs the suites — Bun pinned, Prisma generated, git present | `dc06795` |
| The pre-plan, not an executable one — fourteen measured runs and a "what is NOT known" section | `611cd2c` |

### Settings grows the screens its procedures were waiting for (2026-08-24)

§2's pattern again, three more times: `location.create`/`update`/`delete` had no
caller in the application, `User.locale` was written at registration and read by
nothing, and `User.snackbarDuration` was a column with no control. Theme,
language and duration were meanwhile living in the navigation sheet, where
`/settings` already rendered them — the same three preferences in two places.
The split that came out of it is deliberate: what follows the account moves to
the account; the theme stays the device's, because WCAG 2.2.1 is about the
screen in front of you, not the person behind it.

| Unit | Commit |
|---|---|
| Storage locations can be created, renamed and removed — three procedures had no caller | `1710297` |
| Theme, language and duration leave the nav — `/settings` already rendered them | `ae31241` |
| `User.locale` read at last — the language follows the account, the cookie answers `/login` | `265e2f8` |
| `User.snackbarDuration` follows the account, the theme stays the device's (WCAG 2.2.1) | `e28a273` |
| `mt-3` off the duration control — the cluster's own `gap-y-3`, so `/settings` reads as one group | `c0e9739` |

### The design system — nine ways of drawing one row become one (D104, 2026-08-20/24)

The owner's review gave the plainest possible symptom — "en cada pantalla se
muestran de una manera" — and `DESIGN_AUDIT.md` A5.3 gave the count: the
hardcoded copies of the target-size floor had grown from 74 to 100. Nine screens
drew the same object nine ways, and the drift was not only untidy, it hid
defects that were invisible while nine implementations each got them differently
wrong: a title that guaranteed 48px of height and none of width, so "Lidl" was a
25×48 target at every tier, and a whole-row `<Link>` that made a row's
accessible name its entire contents. `ItemRow` is the inventory card — the row
the owner picked — with `density` for the tier and `variant` for whether it is a
card at all, because A5.4's "no cards except where justified" is a decision the
Panel and the kitchen had already made. The reasoning is D104; the gate that
keeps it from drifting is `src/__tests__/unit/target-floor.test.ts`, which took
142 hardcoded floors outside the design system down to 13, each with a reason
checked for staleness as well as for presence.

**The extraction, and the contract written where an agent reads first.**

| Unit | Commit |
|---|---|
| One `cn`, imported — `button.tsx` stops keeping a second copy of it | `6ea8c4d` |
| `BackLink` — the way out carries an `aria-hidden` arrow, `/products/[id]/edit` its first caller | `71ca3ec` |
| The snackbar and chart tokens land with their audit pairs — 76 checks over 32 tokens | `6908ec2` |
| `ItemRow` and `Badge` lifted from the inventory card, the row the owner picked (D104) | `9be4ea7` |
| The four rules written into `CLAUDE.md` and `AGENTS.md`, where an agent reads first | `45d27e8` |

**UI-11 — one answer for stock state, closed and then closed properly.**

| Unit | Commit |
|---|---|
| Run out beats low, in the single `StockStatus` the extraction left | `8128d04` |
| `stockTone` beside `StockStatus` — the row's tint and its badge stop disagreeing | `ee508c7` |
| The catalogue states the stock in words, not in amber — WCAG 1.4.1, `StockStatus` reused | `a7a6f6d` |

**The sweep — nine lists onto `ItemRow`.**

| Unit | Commit |
|---|---|
| The shopping detail at `touch` density — the removal gains its 48px | `1368707` |
| The catalogue is `ItemRow` and `Button` — row actions reach the card tier at last | `aef6ec9` |
| Receipts and prices drop the whole-row `<Link>` — and `ItemRow`'s title gains a `min-w` | `90b4ba7` |
| Stores and people on `ItemRow`, `Button` and `Input` — Cancelar had no floor at all | `b43fa23` |
| The Panel and the kitchen take `ItemRow` `plain` — the grammar without the card (A5.4) | `6581625` |
| The lists index joins; auto-generada goes neutral, and the pill gate learns the chip | `7fe1ae2` |
| The last four hand-written pills become `<Badge>`, held there by a source scan | `73829cd` |

**The primitives, and the 48px floor that stops being retyped.**

| Unit | Commit |
|---|---|
| `RadioOption` — the stretched radio is a primitive, not a technique retyped thrice | `8a5237c` |
| Eight screens take `Button` and `Input` — 33 hardcoded 48px floors gone with the classes | `2cca84d` |
| Forty-six link-shaped buttons become `<Button asChild>` — still anchors, one size | `6a9349f` |
| `Select` and `Textarea`, native — four selects and three textareas stop being hand-written | `b5a2e5d` |
| `target-floor.test.ts` — a hand-written 48px floor now needs a reason; A5.3 closed | `6faca1c` |

**The way back out.**

| Unit | Commit |
|---|---|
| Eight typed `←` out of the catalogue, six more ways back on `BackLink`, glyphs gated | `550fb10` |
| `/settings/stores` gets a `BackLink` — the only settings sub-page with no way back out | `6aa593c` |
| Nothing types `←` — the scan reaches JSX, where the catalogue sweep could not | `261888e` |
| Six hand-rolled ways back on four sub-pages become `BackLink` — WCAG 2.4.9, gated on the key | `0478a97` |

**Consistency, once there was something to be consistent with.**

| Unit | Commit |
|---|---|
| Three actions get the variant their kind calls for; the scan link stops copying `bg-primary` | `1a32a31` |
| `Select` takes `Input`'s fill, and the kitchen row stops spending «Queda» twice | `d7a843c` |
| The `link` variant drops `px-4` so it aligns with its column; two lists lose the outer card (A5.4) | `6a446d2` |
| Every dashboard screen states its width — five ran the full 7xl, `/receipts` was inset twice | `c82d7dd` |

**The paper trail.**

| Unit | Commit |
|---|---|
| D104 recorded, A5.3 closed in the audit, and A5.4's third pass filed beside its second | `9254fd2` |

### Toolchain, and suites that can fail (2026-08-19/24)

Four of these are the same lesson from four directions: a gate that cannot go
red is not a gate. `verify:ci` does not include Playwright, and two commits in
this run claimed green on it plus a subset of specs they had chosen themselves —
the subsets happened to exclude the specs covering what had changed. 94
component assertions were written in a shape that could hang the run but never
fail it. An accent-collation test compared against a name no fixture held. And
the Prisma CLI had been broken since Phase 0's own tidy-up: `prisma.config.ts`
silenced the `.env` loading it was expected to replace, and nothing caught it
because Next and Bun load `.env` themselves — only the bare CLI takes that path.

| Unit | Commit |
|---|---|
| `packageManager` bumped to pnpm 11.22.0 | `5289e2b` |
| `prisma.config.ts` loads the `.env` its own presence silenced — the CLI broken since `436cfea` | `6d5d3c3` |
| Three browser assertions two earlier commits left behind — `verify:ci` is not the suite | `b6771eb` |
| `toBeAbsent` — 94 assertions that could hang but never fail, converted | `b49abcc` |
| The accent-collation test can fail — it had compared against a name no fixture held | `ec67cef` |
| The global boundary renders detached; the nested `<html>` was wedging the component suite | `f947182` |

### Prices — the screens finally have something to draw (2026-08-21/23)

Phase 8 item 3 closed PRICE-1, so for the first time a price screen had records
to chart rather than a table nothing could populate — and what it drew turned
out to be wrong in four ways nobody had been able to see. Prices were formatted
by hand in fifteen places, so a Spanish reader was shown «€1.19»; a shop
unvisited on a date was drawn as a shop that had ended; two lines from one
receipt on one date collided on a React key; and the trends table below the
chart wrote its dates in whatever language the device happened to be in. The
last move is a subtraction: the trends table gave three numbers the chart and
`StoreComparison` directly above it already gave.

| Unit | Commit |
|---|---|
| Fifteen hand-written prices move to `src/lib/money.ts` — «€1.19» is not Spanish; the four scratch probes a batch `git add -A` swept in, removed | `f54777d`, `9b93921` |
| Three renderings of one store list become one sorted bar per store, in HTML, scaled from zero | `9c0e54f` |
| `PriceChart` — markers drawn once the animation is off, four CVD-validated tokens, a table view | `8dc3e58` |
| `connectNulls` on the price chart — a shop unvisited on a date is not a shop that ended | `421f5e4` |
| `PriceChart`'s table view keys by date and index — a receipt's two lines collided in React | `e064c72` |
| `toLocaleDateString()` with no locale asked the device — a source scan now forbids it | `b9e2ac8` |
| The trends table goes, and with it `getPriceTrends` and `PriceChart`'s never-drawn `showStores` branch | `9da2c93`, `57f25f4`, `5e96924` |

### Defects found by reading, not by a suite going red (2026-08-20/23)

A full read of the week's diff rather than a run of it. None of these was
reported and none of them failed a gate: a screen that says «No falta nada»
whether the household is stocked or the query died; a shops screen offering a
MEMBER four controls the server will refuse; a catalogue silently stopping at a
hundred products with nothing saying so; «3 3 artículos», which is what a
hand-built plural does when it meets a count; and four callers who had each
written their own definition of low stock and agreed only by luck.

| Unit | Commit |
|---|---|
| One definition of low stock in `src/lib/stock/low-stock.ts` — four callers had agreed only by luck | `de4ded9` |
| «No falta nada» told apart from a failed `getStockOverview` on the kitchen tablet | `05a7df7` |
| The shops screen hides what a MEMBER cannot do, and a refused write says so without guessing | `68479bb` |
| The catalogue says when `product.list` stopped at a hundred, and at what number | `d7bdc1a` |
| Two counts take ICU plural rules; a scan holds every `{count}`, and «3 3 artículos» fell out | `92ea46d` |

### Feedback gets a pattern — D100, D101 and the one snackbar (2026-08-20/23)

The trigger was small and the consequence was not. «Deshacer» on the kitchen
screen was unusable in the common case: online, the queue drains in one
round-trip, so the button lived for a single render — a flash, not an
affordance. Fixing it (D100: a change waits ten seconds before it becomes
eligible to send, so D57's "undo is cancellation, never a compensating write"
survives intact) opened the wider question, which was that feedback had no
pattern at all — five ways of saying a thing had happened, and six writes that
said nothing. D101 is the answer, and the hard part was deciding what a snackbar
is *not* for: a message that removes itself must not be the only account of
something still true.

**The hold that makes undo real (D100).**

| Unit | Commit |
|---|---|
| The kitchen's change waits ten seconds, so «Deshacer» exists online too (D100) | `51712b3` |
| `holdRemainingMs(id)` — the queue says how long one change can still be taken back | `778956a` |

**The snackbar itself (D101).**

| Unit | Commit |
|---|---|
| A failed receipt upload reaches its own handler — the await had left the `try`'s stack | `6d55138` |
| One snackbar, polite and mounted once — with normal / larga / hasta descartar | `01c76d4` |
| The kitchen's undo moves into the snackbar — D100's ten seconds and D57's cancel intact | `510d5b5` |

**The four surfaces that are not it.**

| Unit | Commit |
|---|---|
| A `Dialog` primitive on Radix, and the last `window.confirm` gone — the delete now names the list | `4c6786d` |
| The three success screens become a dialog over the form they came from — A11Y-1 strengthened | `98e3601` |
| Ten inline live regions sorted by event or state — four move to the snackbar, six stay put | `1c4b1fc` |
| `FormErrorSummary` extracted from five forms — a refused submit keeps its focused `role="alert"` | `bfd89d4` |

**The writes that had said nothing.**

| Unit | Commit |
|---|---|
| The three store writes invalidate the list below them — a delete had no callbacks at all | `fef41f1` |
| Confirming a review stays on the review — `confirmAll` sets CONFIRMED, and only apply sets APPLIED | `6323056` |
| Six silent writes gain a confirmation, and no test stubs the snackbar module any more | `3af1d4e` |
| Undoing a save is its own mutation — one confirmation, and a refusal that can be read | `33314bf` |

**What using it found.**

| Unit | Commit |
|---|---|
| An undo lives exactly as long as the window it measures, and a second no longer arrives spent | `f93faab`, `4a16287` |
| A failure snackbar is tinted and iconed — `--snackbar-danger`, AAA in both themes | `05281c9` |

**The record.**

| Unit | Commit |
|---|---|
| D101 recorded — three files already cited it and the log had no D101 in it | `03dd254` |

### The shop, the kitchen, and what already covers what (2026-08-22/23)

"Is this already on a list?" turned out to be a question three screens each
answered differently, and two of them answered it wrong: the kitchen offered
Apuntar for things already bought, and «Generar desde stock bajo» counted only
its own list's coverage, so a second list generated the same items again. It is
now one server-side question over stock plus every list. The rest of this
section is the shopping detail screen itself, which D103 had just rebuilt and
which no audit had ever visited.

| Unit | Commit |
|---|---|
| Apuntar gives way to «Ya en la lista» where stock plus the lists clear the minimum | `9b3bb48` |
| `/shopping/[id]`'s rows sit in a `<ul>` — the parent asserted, the scan generalised | `71fc1cd` |
| `/shopping/[id]` audited at last — three sub-48px targets, the wrapping label measured | `e87d247` |
| The store include moves to `getById`, which draws it, off `list`, which does not | `63d0251` |
| Four of the five writes report, the bin held ten seconds (D100, D57) — the tick silent | `5473c34` |
| «Generar desde stock bajo» asks `needsMoreOnList` over every list, not just its own | `f81e773` |
| A quantity the shopping row refuses is put back — the uncontrolled box had kept it | `6060cf0` |
| `canWrite` reaches the tick and the bin too; a badge keeps what the tick said (D88) | `eca0b12` |

### The accessibility review's five findings (2026-08-20/22)

A review of the surfaces this fortnight added, against the AAA bar Phase 2b set.
Five findings, one commit each. Two of them were the same shape from opposite
ends — a live region that only exists once it has something to say has nothing
to announce, because the region and its content arrive in the same render — and
one was not an accessibility defect at all underneath: the receipt review's
three writes were unhandled rejections, so "a refused apply says nothing" was a
correctness bug wearing an announcement bug's clothes.

| Unit | Commit |
|---|---|
| The nav sheet's trap counts tab stops, not focusables — a radio group is one stop | `07ca252` |
| `aria-pressed` on a receipt match candidate — the choice was a tint and a hidden tick | `f818d0a` |
| The reconcile panel earns its `aria-modal` — focus trap, Escape, opener restored | `55ad343` |
| The receipt review's three writes report a refusal — two were unhandled rejections | `1a73c45` |
| A region that appears only when it speaks announces nothing — `RouteState` and both auth pages hold theirs from the first render | `58a24ad`, `f0438c2` |

### The inventory list learns the address bar (2026-08-22)

Phase 8 item 2 made the Panel's cards doors, and a door needs a destination that
can be told what to show. `/inventory` read no params and fired one hardcoded
query; the honesty rule from that item — the card's number and the destination's
rows are the same set — could not survive a list that filtered and paged in
JavaScript over a page it had already truncated, which is why a filtered page
came back short.

| Unit | Commit |
|---|---|
| `getStockOverview` filters, sorts, pages and counts in Postgres — a filtered page came back short | `9f729d9` |
| The inventory pages, filters, sorts and searches from the address bar; `Pagination` born with it | `25054bc` |
| `page` capped at ten thousand — an unbounded offset was a `bigint` error, not an empty page | `40bd9b5` |

### The owner's review, continued — D102 and D103 (2026-08-22)

Two more of the owner's observations, and both are deletions. "Para editar el
producto en la página de producto no tiene ningún sentido tener una pantalla
aparte": correcting a typo meant leaving the record and losing everything else
it showed — the stock, the batches, the price history, the rating — and coming
back. And "las listas de compra te dejan añadir cualquier artículo con cualquier
cantidad, existan o no": a free-text item cannot be priced, counted against the
cupboard, matched to a receipt line, or suppressed when it is already covered,
and each of those features carried a branch for the case where the item names
nothing. The kindness free text bought survives where it belongs — the add form
creates the product inline. Migrated expand → code → contract, which is why the
three schema steps are three commits rather than one.

**D102 — the edit screen absorbed.**

| Unit | Commit |
|---|---|
| The catalogue fields edit in place on the product, with Guardar, Descartar and an inverse undo (D102) | `a8917f8` |
| `/products/[id]/edit` becomes a `permanentRedirect`; the 476-line form and its two links go | `ed8beb6` |
| D102 recorded — the edit screen absorbed, D92 narrowed rather than reversed | `98ec365` |

**D103 — a list item is a product and a quantity.**

| Unit | Commit |
|---|---|
| `ShoppingItem.storeId`, nullable and unread — per item, because one shop rarely covers a week | `f30bc08` |
| Every free-text shopping item gets a product — D103's expand half, reuse before minting | `8e4bea1` |
| A list item is a product and a quantity — D103's code half, SHOP-1 superseded | `9d4e62e` |
| The shopping row gains an editable quantity, a shop and a prices link — all four writes queued | `d093433` |
| D103's contract half — `productId` NOT NULL asserted before `customName` is dropped | `bfaf957` |
| SEC-1's hole again, on `ShoppingItem.storeId` — both writes check whose store it is | `04c9690` |
| D103's inline creation actually creates — the nested `<form>` submitted natively | `82551a3` |
| An item added with no signal carries its name from the op's own label | `19739c2` |
| `ShoppingItem_productId_fkey` pinned at RESTRICT — D103 left it nulling a NOT NULL column | `abf5778` |

### The owner's second pass — a phone in a real hand (2026-08-19/20)

Phase 8 closed on the 19th; the owner picked up their own phone the same day and
the second pass began before the ink was dry. It started with the scanner, which
on a real device over `tailscale serve` did not work at all and blamed the
browser for it — the requirement is a secure context, not a missing API. What
followed was not a defect list but a set of rules, and they are worth writing
down because most of the sections above obey them: an icon on a button previews
the action, never the state; anything that collapses needs a visible chevron; no
cards except where a card is concretely justified; nothing is said twice on one
screen; no action is duplicated from persistent navigation or offered on a tier
that cannot perform it; and an alert exists only for something that wants
attention, reason first, count second. The Panel took three passes at the last
of those, recorded as one argument rather than three changes of mind: the alert
cards restated the lists below them, the one-line summary that replaced them
restated the same counts, and what was left underneath had always been both the
detail and the door.

| Unit | Commit |
|---|---|
| The scanner names the real requirement — `https://` or localhost — and `allowedDevOrigins` gains the `tailscale serve` hostname | `536a3e2`, `830b1cf` |
| The torch icon previews the action — a dark torch offers a lit bulb, not a ban sign | `1282b25` |
| The trolley reads as a drawer, not a heading — chevron, and the count in words | `36d5994` |
| The Panel leads with its actions and raises only true alerts, reason before count | `21e7539` |
| The Panel says each thing once — a sentence over the lists, the overflow note the door; A5.4 re-recorded | `5b253e2`, `3dd99ab` |
| The shop's rows and headers shed their cards — dividers, and the row's 64px target intact | `5bd16e6` |
| The Panel's summary sentence goes too — the sections were always the doors | `e5a3b63` |

### Phase 8 — the owner's first pass (started 2026-08-18)

| Unit | Commit |
|---|---|
| UI-10 — the auth panels leave `bg-primary` for their own hero surface | `d7c178d` |
| Product editing — `/products/[id]/edit`, and `product.update`'s first caller | `8114501` |
| The Panel's cards become doors — `product.count`, `needsRestock`, the loud filter | `cf18b52` |
| The stock form in two layers — store and price recordable at last, PRICE-1 closed | `4bbb82d` |
| The kitchen writes down what is needed — D88 enforced, Apuntar per row | `941d1ed` |
| The catalogue's real actions — two new screens, admin-only two-step delete | `70386ea` |

### The browser suite: its own data, the deployed artefact (2026-08-17/18, unplanned)

Triggered live: a suite run reseeded the demo household in the owner's own
database while they were testing with it, and the suite's `next dev` fought
their `next dev` for the per-directory lock until one killed the other. Plan:
`docs/superpowers/plans/2026-08-17-e2e-isolation-and-production-build.md`.

| Unit | Commit |
|---|---|
| The two high audit advisories cleared before they turn the trunk red | `d5e6f9e` |
| `e2e/db-url.ts` — the suite's isolated database and cache, derived once | `262bdf0` |
| The seed project migrates and seeds `stoky_e2e`, never the dev database | `7a45ddc` |
| `upgrade-insecure-requests` keyed on transport — found by the new suite | `e8dafd7` |
| webServer → the standalone production build, on the suite's own data | `8ef124c` |
| CI's e2e job hands the suite its own URLs, one setup path | `60cb0a4` |
| The prod config folded in — one suite, one artefact, 117 tests | `d60b1b3` |
| `deepmerge-ts` overridden in the image's own Prisma install too — the copy pnpm audit cannot see | `0a85740` |
| The suite names `127.0.0.1` and pipes the webServer's build output (D86) | `219b103` |
| The suite's server binds `0.0.0.0` — Docker's exported `HOSTNAME` hid it from the probe | `f87b48a` |

Isolation proven the strong way: the owner's dev server and demo data survived
three full suite runs untouched, mid-session. The suite found a real product
defect on its second run (WebKit vs `upgrade-insecure-requests` on plain http —
a live Safari-on-LAN failure, not a test artefact), which is the argument for
production parity made by the parity.

### Phase 7's slice of the backlog — every filed defect but one

Fifty-two commits closing `§10 Carried forward`. What is left in `ISSUES.md` is
TEST-5, and it is undiagnosed rather than untouched.

**Security — rate limiting's four gaps, one commit each.**

| Unit | Commit |
|---|---|
| Sign-in counted per account as well as per address, on a hashed key (NIST SP 800-63B §5.2.2) | `4c3e2f8` |
| `receipt.upload` metered before the file is decoded (ASVS V11.1.4) | `1bd7745` |
| `Retry-After` on a 429, read off the refusal (RFC 9110 §10.2.3) | `f25f6e5` |
| Refusals logged as JSON from a tRPC middleware (ASVS V7.1.3) | `64a5b58` |

**Correctness and debt.**

| Unit | Commit |
|---|---|
| DEBT-1 — length over composition (SP 800-63B), and the 128-char cap Argon2id lacked | `d5a320b` |
| INV-2's second half: `transferStock` guards inside its transaction | `dbb1748` |
| DEBT-5 — sixteen indexes, measured at 12,000 rows | `1841758` |
| DEBT-6 — services throw domain errors, translated at the boundary | `15c1a23` |
| DEBT-3 — the Open Food Facts cache moved to Valkey, failing *open* | `83faab9` |
| OCR-1 — the language model baked into the image, pinned and checksummed | `0bc399f` |
| UI-3's last three items | `4d05c60`, `fa61a86` |
| PROD-1 and SHOP-1, both found while writing DOCS-1 | `13061e3`, `e0f496b` |

**Language.** I18N-2 through I18N-6 and I18N-8, one commit each — `7acd8fa`,
`e65a2ff`, `2e4bb4d`, `497775b`, `f8807ed`, `b834163`.

**Documentation.** DOCS-1: 58 of 58 procedures, one commit per router.

**Built rather than fixed.** Error boundaries (`c66086c`), `/api/health` with a
container healthcheck (`ec7b0b4`, `f238312`), and data export (`073abe8`).

**The suite.** The service worker now runs under a real production build
(`39fe0e9`), and the spec that drives it is kept out of the ordinary suite by
`testIgnore` — collected by the default config it ran against `pnpm dev`, where
the worker never registers, and waited thirty seconds for a controller that was
never coming (`b44fcb7`). `NAVIGATION_TIMEOUT_MS` is driven through a stubbed
worker at the constant the file declares, against a shell navigation measured at
14–37 ms warm and 368 ms cold — 2,500 ms is ~70× a healthy navigation, so half
of "a guess calibrated on supermarket lie-fi" is measured and the entry says
which half is not (`3054454`). The browser suite re-seeds the fixture it spends
(`6faf0cd`); the integration harness builds its connection from credentials that
work (`46f767d`), which is what TEST-1 had been waiting on behind a stale note
about Docker.

---

### The pipeline reshaped — build beside the tests, publish behind them (2026-08-12, unplanned)

Not in the plan, and it started as noise rather than as a project: every image
job had ended red for days on three separate platform refusals, each one *after*
the build, the scan and the push had already succeeded. The cost was not the red
job — it is that a pipeline which is always red trains everyone to stop reading
it. Clearing the refusals exposed the shape underneath: the image job gated
nothing but its own publish and still waited for every test to finish first.
Measured on runs `31567346179` (the old shape, every other change already in)
against `31568215727` and `31570504804`, a green push reached a published image
in **628s against 902s**. The figures, and what each knob was actually worth,
are in `STATUS.md` "The pipeline".

**The three platform refusals, and the finding underneath them.**

| Unit | Commit |
|---|---|
| `actions: read` for the SARIF upload — the image job went red after shipping the image | `448ad88` |
| The SARIF pair gated on visibility, the Trivy exit-code gate left unconditional (D80) | `a5455c1` |
| npm removed from the production image — all seven Trivy findings were its own (D81) | `c1c0849` |
| Provenance attestation gated the same way — the last platform refusal in the image job | `425a480` |

**The pipeline held to the standards the code is held to.**

| Unit | Commit |
|---|---|
| `scripts/check-ci.sh` — pinned actionlint over the workflow, shellcheck over `scripts/*.sh` | `9bb4b20` |
| `persist-credentials: false` on every checkout — no job in the pipeline pushes via git | `3f37688` |
| Bun pinned to 1.3.14 in `.bun-version`, so an upstream release cannot redden master alone | `5ec7068` |

**The shape: two jobs, and a gate that decides whether either runs.**

| Unit | Commit |
|---|---|
| The image job split — build and scan beside the tests, publish behind them | `dc68b21` |
| The `changes` job — a docs-only push skips the image pair, never the tests | `bf14d97` |
| `changes` diffs a full clone — the fetch it replaced left the gate a no-op | `aee25ed` |

**The e2e job into Playwright's own image, and the A/B that corrected what it was worth.**

| Unit | Commit |
|---|---|
| The e2e job runs in Playwright's pinned image — 57–136s of apt off the critical path | `f9e0887` |
| `unzip` added to the e2e container — `setup-bun` needs it, and the seed runs on Bun | `a1bf0a6` |
| `HOME=/root` in the e2e container — Firefox and WebKit refuse `pwuser`'s home | `2a7127e` |
| `--shm-size` on the e2e container, kept as prevention rather than as the fix it shipped as | `9973a29` |
| A temporary uncontainerised twin of the e2e job, to time both shapes in one run | `e591080` |
| The twin drops the container's `unzip` step — apt on a plain runner needs sudo | `a4e4f64` |
| The A/B answered 400s bare against 405s containerised — the twin deleted, the claim corrected | `1cf8cbb` |

The last three rows are this campaign's own correction, and the reason it is
recorded in this much detail. Three consecutive runs said the container had made
`playwright test` ~100s slower, which is a pattern rather than variance — and it
was wrong: twin jobs from the same commit on identically-specified runners at
the same moment (run `31583973041`) measured 400s against 405s. Runner
throughput had drifted over the session by as much as the effect being measured.
The container stays for the variance it removes, not the average.

The `changes` gate is worth its own line for how it failed: it originally
*fetched* the before-commit, which cannot authenticate on a private repository
once the checkout stops persisting the token, so it fell back to "build" — the
safe direction, shipping nothing wrong, while skipping nothing, ever, and
appearing to work. A gate whose failure mode is doing nothing quietly has to be
watched being exercised.

### Phase 6 — Rating

Extend the Open Food Facts fields, compute, display. *Done when:* a product with
no data and a non-food product both behave well — not just the happy path. Three
commits, in that order, because each is useless without the one before it.

| Unit | Commit |
|---|---|
| Open Food Facts asked for the rating's six fields; the cache prefix moved to v2 (D79) | `18e6ad6` |
| `src/lib/rating.ts` — 60/30/10, and the honesty rules above the arithmetic (D77, D78) | `c575b49` |
| `ProductRating` on the product detail, where the scan lands — the word leads, colour follows | `01f58c1` |

**Phase 6 is complete except T7.** §6's worked example scores 25 — the bottom
edge of poor, which is what harmless additives on a grade-e product are worth,
and the sanity check that the arithmetic was transcribed rather than invented.
The honesty rules run *before* the formula structurally rather than as a
disclaimer: no data is a state the screen says out loud, absence of a verdict is
never a clean bill, and the worst additive decides its component. What stays in
§10 is T7 — an offline scan resolved later — because it needs local-id
resolution, which leaks `local:` ids into the cache and into components.

### Test isolation and the runner's own defects (2026-08-11/12, unplanned)

Four red runs that looked like four problems and were three, none of them in the
product. Each one made a green suite a claim about something other than the
code: about the order bun happened to load files in, about what else was running
against the same database, or about the runner. A suite that answers a different
question depending on its neighbours is not a gate.

| Unit | Commit |
|---|---|
| `test-integration-local.sh` tears down only the services it started, not those it found | `16a20b0` |
| Every `next/navigation` mock completed (D50) — CI's file order turned an omission red | `d69a8f1` |
| `auth.flow` stops deleting every suite's users — half of TEST-5's replay failures were this | `2069c5f` |
| TEST-5 absorbed — `{ retry: 2 }` on the two tests bun abandons, 4 failures in 24 to 0 | `3dd3789` |

The last two are one investigation, and the order matters: with the cross-suite
deletion fixed, the user-deleted failure signature went from 2-in-24 to 0-in-24
under identical load *while the runner defect's signature persisted*, which is
what separated a test-suite bug from TEST-5. TEST-5 itself stays filed rather
than closed — bun 1.3.14 is the newest bun, so there is nothing to upgrade to —
and the retry is scoped to the two tests whose deliberate outcome is a rejected
promise out of a rolled-back transaction. A real regression in `withReplay`'s
refusal logic still fails deterministically and survives every attempt, which
was verified by breaking it.

### Production hardening — driving the artefact nobody had driven (2026-08-11, unplanned)

Every suite was green and the deployed application could not sign anybody in.
Auth.js v5 defaults `trustHost` to false off Vercel and refuses any request whose
Host it cannot vouch for; `next dev` does not apply the check, and every suite
ran against `next dev`. `/login` served perfectly the whole time, which is
precisely why it could sit there — a failure that returns 200 looks like a
success. Driving the image itself, on an `--internal` Docker network with a
read-only rootfs, found receipt scanning broken in it too. This is where
`e2e/auth.prod.spec.ts` comes from, and the argument the 2026-08-17 suite move
later generalised to the whole suite.

| Unit | Commit |
|---|---|
| The example `NEXTAUTH_SECRET` refused in production — sessions anyone could forge | `7051ba5` |
| Production auth answered 500 until `trustHost` — `e2e/auth.prod.spec.ts` fails without it | `108304d` |
| A real sign-in against the standalone artefact, under the production CSP — no violations | `f7b3539` |
| `serverExternalPackages` unbakes tesseract.js's worker path; OCR-2 filed for the rest | `3af30a9` |
| OCR-2 closed — tesseract.js staged whole in the image, scanning proven air-gapped | `5577b80` |

**OCR-1's entry was corrected rather than left reading as a finished job:**
baking the language model into the image was necessary and not sufficient, and
its own caveat — that nothing had scanned a receipt *inside* the image — turned
out to be the whole defect. The air-gapped run is also the first measurement
behind the model choice, which had shipped reasoned but unmeasured: UPLOADING →
NEEDS_REVIEW in under three seconds, with "LECHE ENTERA 1,19" read
character-perfect by the 2.3 MB fast model.

Unlike the other two, the signing-key refusal is not an outage, and an outage is
what announces itself: `.env.example` publishes the placeholder in this
repository, so an instance deployed with that line unchanged signs sessions with
a key anybody can read and nothing about the running system looks wrong. Its
first version broke `docker build` — `next build` sets NODE_ENV=production and
evaluates every route module — so the guard skips `phase-production-build`,
because trading a forged-session risk for an unbuildable image is a bad bargain.

### Repository housekeeping (2026-08-11, unplanned)

One commit, recorded because the fix is an index change and an index change is
the kind that silently comes back.

| Unit | Commit |
|---|---|
| The ralph-loop state file untracked — per-session state no checkout should inherit | `61c16ce` |

The file was tracked and carries a session id and an iteration counter, so
committing it means the next checkout inherits somebody else's half-finished
loop — which is what its own `.local.` name says was never intended.

### Phase 5 — Kitchen screen, and Screen A's layout

Expiries, one-tap use, useful data — plus the two things Phase 4 handed over and
named rather than counted: Screen A's layout and a sign-out control. Both screens
were built the same day and deliberately together, because they share vocabulary
and building them apart is how one product comes to wear two different words.

Three things had to land first, and none of them is a screen. The queue reads a
tRPC status to decide what to do next, so `classify.ts`'s table was only *true*
once the database's own complaints were translated. `queue.purgeAll` and the
shell purge were written in Phase 4 as controls for a *shared* device and nothing
could fire them. And `KITCHEN` had been enforced on the server since Phase 3 and
creatable only by a direct database write ever since — so a week-long run on a
tablet under an owner's account would have proven nothing about what a kitchen
account can reach.

**The three the phase could not be run honestly without.**

| Unit | Commit |
|---|---|
| T1 closed — `P2025` reaches the client as `NOT_FOUND`, so the queue stops retrying it | `80be873` |
| A sign-out control on `/settings` — it fires `queue.purgeAll` and the shell purge (D50, D51) | `ab4686b` |
| `/settings/people` creates a `KITCHEN` account — ASVS V4.1.1, plus three `/shopping` defects | `aeefa9c` |

**The two screens.**

| Unit | Commit |
|---|---|
| Screen A — `/shopping` is the shop; filing moved to `/shopping/lists` (§3, D54–D56) | `ad916d3` |
| Screen B — `/kitchen` read from a metre away, undo cancels the queued write (D57) | `a8ce555` |

**Closed on the way.**

| Unit | Commit |
|---|---|
| A11Y-1 closed — the stock forms report what they wrote instead of redirecting | `cae2c43` |
| Read persistence — six queries kept per account for 24 hours, never mutations (D59, D60) | `e324e00` |
| `/settings/unsaved` — every failed change with its timestamp and its reason (D62) | `15e765f` |
| The read-cache test asserts on an empty restore instead of throwing | `2b148a2` |

Two of the decisions here reverse the obvious reading of the design, and both are
about undo. On Screen A the trolley *is* the undo — an undo that expires is one
you miss while reaching for the next shelf, and a mis-tick is usually noticed at
the till — so it is permanent and lives where somebody would look anyway. On the
kitchen screen undo cancels the still-pending write and refuses once it is in
flight; a compensating `addStock` would record that the household acquired
something it never did, and every downstream reader would see a fabricated event
it cannot tell from a real one.

Read persistence is the other one worth re-reading: query-core's default persists
paused mutations and replays them on the next visit, which would have been a
second, uncontrolled path to the server racing the queue's drain — contained by
the idempotency key, and invisible.

**Phase 5's actionable work is complete; the done-when is not met and cannot be
met by a test.** §4 says the kitchen screen runs for a week on a real tablet
untouched except for using things up. What exists is the screen and its
five-minute refresh; the week is owed, and it sits in §10 next to the iOS pass
for the same reason — naming them beats closing the phase over them.

### WCAG AAA — the two criteria a machine can decide (2026-08-11, unplanned)

pa11y's `WCAG2AAA` standard was run first, before deciding anything: against
`/login` it returned 0 errors, 1 warning and 60 notices, every AAA item beginning
"Check that…". So no tool automates the AAA half at all. What this does is
measure the two criteria that are mechanically decidable and were missing, and
leave the rest as a documented manual pass rather than a check that either passes
vacuously or floods the log (D36).

| Unit | Commit |
|---|---|
| WCAG 3.1.5 measured on both catalogues — Fernández-Huerta for Spanish (D36) | `2c21dea` |
| WCAG 2.2.6 — the session slides on activity, and an idle one warns two minutes out (D36) | `17e7c38` |

Neither is a compliance exercise. `REDESIGN_PLAN.md` states the premise as
"anyone in a household can use this, including people with limited technical
confidence", and nothing checked that sentence against the words the application
shows — the Spanish corpus measures 69.0 on the INFLESZ bands, English 66.3, with
the floors set below the measurement rather than at it. The timeout half is data
loss, not etiquette: a fifteen-minute ceiling from sign-in ended a slow shop or a
half-reviewed receipt at a login form.

**The reading-level gate was watched fire, and only passed on the second
threshold.** A deliberately unreadable seventeen-word sentence pasted into both
catalogues changed nothing — too short to be judged at a twenty-word threshold,
and one string among 515 does not move a corpus average, though it scored −47.
At twelve words both languages go red on that probe. The honest limit is in the
module's own docs: a formula counts syllables, not jargon, and "trigrama de
similitud" scores well and means nothing to most people.

---

### Phase 4 — Phone screen, offline from the start

**Groundwork.** Three defects were closed before the offline layer was written
rather than after, because each one is load-bearing for it.

**Groundwork** — three defects closed before the offline layer, because each
one is load-bearing for it.

| Unit | Commit |
|---|---|
| UI-9 closed — a failed query no longer claims the household is empty | `6214efe` |
| The availability guards measure net stock, not gross purchases | `a6f1d49` |
| INV-1 closed — the expiry views report what is left of a batch | `8961376` |

**Paid down while the offline design was being pressure-tested.** A workflow of
eleven agents read the repository and produced the build order the units below
follow; it found SEC-1 and three stale claims in this plan on the way.

| Unit | Commit |
|---|---|
| The scan flow speaks from the catalogue | `a3dbfa6` |
| DEBT-2 closed — the torch toggle reaches the camera | `9af0345` |
| I18N-7 closed — the stock overview speaks from the catalogue | `faec173` |
| TEST-4 closed — the low-stock badge checked where a phone sees it | `1a6561b` |

**The server half of offline.**

| Unit | Commit |
|---|---|
| SEC-1 closed — a price record can no longer name another household's store | `7c0190c` |
| The database client comes from the context | `ed7bb0f` |
| A purchase writes its entry and its price together, or neither | `33246a4` |
| Data first: a failed refetch no longer replaces a working page | `b28a9a5` |
| `withReplay` — a queued mutation applies once, however often it arrives | `eb401be` |
| An identifier mintable without a secure context | `ecdd8e1` |
| The five writes a shop composes are replay-safe | `5e31c5c` |
| INV-2's consume half closed — the product is held while the guard decides | `910e941` |

**Asked for mid-phase**, and two of the three reverse recorded decisions, so the
plan was amended before anything was built (`017eea3`).

| Unit | Commit |
|---|---|
| The React Compiler, measured before and after | `d4a6d13` |
| The locale is validated before it reaches a dynamic import | `22a768c` |
| One instant per render on the product page | `27452bf` |
| `react-doctor` gates on errors, not on its score | `f75f321` |

**The client half of offline.**

| Unit | Commit |
|---|---|
| A refusal, a retry and a disagreement told apart | `5bca67f` |
| The queue, in a `zustand` store | `0e84c91` |
| The query client starts knowing whether there is a signal | `6292ce5` |
| A queued change shows as done before it is sent | `d7a6f40` |
| The drain, its triggers, and the shell that mounts them | `9994d40` |

Filed in passing: INV-2's `transferStock` half, still open — its guard sits
outside its transaction, and it is deliberately not replayable, so it never
reaches the queue.

**The interface, and the proof.**

| Unit | Commit |
|---|---|
| The sync indicator, and the reconciliation prompt | `2d3c42c` |
| Ticking an item off without a signal | `928ae8c` |
| The service worker, its CSP, and the gitignore that hid it | `8363f17` |
| Registering it, and `/offline` to fall back to | `f7ca71c` |
| A shop composed in aeroplane mode, applied once | `079d097` |

**Phase 4 is complete against its done-when.** `e2e/offline-shop.spec.ts`
composes a shop with the network off, shows it as done, reconnects, and proves
the server applied it exactly once — including across a lost reply, where both
attempts carry the same key.

**Screen A's layout is not built**, and that is stated rather than counted.
Phase 4's title said "phone screen"; its done-when said "a full shop in
aeroplane mode". The second is met and the first is not: a shop today is the
existing `/shopping/[id]`, which now works offline. The design that preceded
the phase marked the layout as its droppable tail — a UX change riding on a
correctness phase — and it moves to Phase 5, next to the kitchen screen it
shares vocabulary with. **It was built there the next day** (`ad916d3`,
2026-08-11): `/shopping` became the shop — Scan on top, TO BUY with the minimum
notch, IN THE TROLLEY folded away — and filing moved to `/shopping/lists`. The
paragraph stays as written because it was right twice over: the layout was not
Phase 4's, and the one piece of §3 that travelled with it and did *not* land
next to the kitchen screen was the ± stepper, which was counted as done in §10
without being checked and did not arrive until 2026-08-25 (`74cff4b`).

Also moved to Phase 5, and uncomfortably: **a sign-out control**. There is none
anywhere in this application, so `queue.purgeAll` and the shell-cache purge are
security controls nothing can fire. The cache is purged on reaching `/login`,
which is the only end-of-session signal that exists today. **Closed the next
day** (`ab4686b`, 2026-08-11): `/settings` signs out, purges the queue, the
cached shell and — once read persistence landed — the read cache with them, and
asks first when there are unsent changes rather than deleting somebody's
shopping in silence (D51). Left standing rather than rewritten, because "the
security control exists and nothing in the interface can fire it" is a defect
shape worth recognising on sight, and `signOut` was exported from
`src/lib/auth.ts` and called nowhere for four phases.

### Phase 3 — Roles, and the security gap that outlived every phase

| Unit | Commit |
|---|---|
| `KITCHEN` added to `HouseholdRole` | `05be1e9` |
| The role reaches the JWT and the session | `cd23d3c` |
| The capability matrix enforced per procedure, all 45 | `7dcea39` |
| DEBT-4 closed — every router throws `TRPCError` | `8cbf641` |
| CRITICAL-4 closed — sign-in and registration limited per IP | `93cb97d` |
| HOUSE-1 and UI-8 closed — a way out of the no-household state | `039d911` |
| The second, unmetered credential endpoint removed | `422803c` |
| TEST-3 fixed and TEST-4 filed; the browser suite green again | `2f8552a` |

**Phase 3 complete.** Journey 2 passes. Filed in passing: DEBT-6 (the services
layer still throws bare `Error`), UI-9 (`/shopping` and `/settings/locations`
show an empty state on a failed query) and TEST-4 (the card tier's low-stock
badge is asserted by nothing).

### Phase 2b — Foundations of use

| Unit | Commit |
|---|---|
| Every page on the tokens; real dashboard | `4eafd1c` |
| Auth pages on the tokens; opacity contrast fixed | `0158b1b`, `c839cde` |
| axe-core AAA audit, 30 checks over 15 routes × 2 themes | `1c6b2d6` |
| Theme and language controls | `24a2203`, `c6d02d2` |
| Mobile-first: bottom bar, tablet rail, tables to cards | `fcb3cad` |
| axe extended to all three viewport tiers — 90 checks | `fcb3cad`+ |
| `/receipts/[id]/applied` built and driven; sixth dead route closed | `364528b` |
| Every interactive element raised to the AAA target size | `e6aadea` |
| A4.2–A4.4 measured in a browser — `e2e/a11y-structure.spec.ts`, 16 routes × 3 tiers | `225bc19` |
| `check:links` — the checker, then the gate on CI and `verify:local` | `1ffc2df`, `a0b388a` |
| UI-5 and I18N-1 closed: the receipts pipeline fits a phone and speaks both languages | `621185d` |
| UI-2 and UI-4 closed: the location picker is a real listbox and offers the whole tree | `a6b01c2` |
| A4.5 — the AAA criteria no tool checks, in `e2e/a11y-aaa.spec.ts` | `7c7206f` |
| Catalogue drift caught by a unit test | `14164d3` |
| UI-6 closed: the picker opens where it can be seen | `0e74c32` |
| Two receipts in the seed; the dynamic routes audited by following links | `fe8bbcf`, `ad6cc6b` |
| Journey states corrected; I18N-5 filed | `e93428b` |
| A4.6 automatable half — `e2e/screen-reader.spec.ts`; A11Y-2 and UI-7 fixed | `31d5358`, `7139359` |
| The tree audit skipped outside Chromium, where `newCDPSession` throws | `81d6f45` |

**Phase 2b is complete except the human screen-reader pass**, which is the one
piece of this phase that cannot be delegated to a machine or to an agent. Four
journeys are audited against the accessibility tree; what is left is whether the
result sounds right to a person using it.

### Test infrastructure — unplanned, and it had become the bottleneck

| Unit | Commit |
|---|---|
| Target size decided from CSS instead of from a browser | `f775436` |
| Every CI test job held to ten minutes, and the guard made to fire | `08a2153` |
| E2E from 27 minutes to 6; two tests that asserted nothing deleted | `b64eae1` |
| UI-8 and I18N-7 filed | `4ea3a25` |
| `routers/receipt.ts` — 39 tests over ten procedures, 28.6% to 90.9% of functions | `ad214d9` |
| D33–D35 — the engine axis separated from the specs, 182 tests in 5.6 min to 89 in 2.9 | `655f8af` |

Not in the plan, and it should have been: the suite had reached 27 minutes for a
full matrix, which is long enough that a healthy run and a hung one look
identical from outside, and long enough that people stop running it. Writing a
feature took minutes; verifying it took half an hour.

The second pass, a day later, did the same thing to the browser matrix: the
suite was not too big, it was asking the same questions in the wrong place and
then asking each of them five times (D33, D34), and the ceiling was moved to
five minutes so that it is a contract rather than a safety net (D35).

### Phase 2 — One design system

| Unit | Commit |
|---|---|
| 26 tokens in `globals.css`; primitives fixed; audit reads the CSS | `86c2149` |
| Token existence and focus indicators enforced by tests | `4eec006` |
| Contrast figures corrected; UI-3 item 5 closed | `2da0bb5` |
| Design lab retired; stepper rehomed and retargeted | `3612a36` |

**Phase 2 complete.** `.bg-primary` went from zero occurrences in the built CSS
to a real rule; the login button has colour for the first time, measured at
`#0e4f42` on white with a solid 2px focus outline in both themes.

### Phase 1 — Close the dead routes

| Unit | Commit |
|---|---|
| `/inventory/add` built and driven in a browser; filed UI-2, UI-3 | `fb26255`, `1ce42e1` |
| `/inventory/consume` built and driven, incl. the over-consume path | `b7f06bb` |
| `/products/new` built and driven; found a fifth dead route | `21e9cf5` |
| `/settings` and `/products/[id]` built and driven | `d09dd94` |
| Four `test.fixme` tests enabled and green; filed NAV-1, HOUSE-1 | `249fb8d` |

**Phase 1 complete.** All five dead routes exist and the E2E suite runs 70
passed / 10 skipped / 0 failed across all five browser projects. The ten skips
are the stock flows on phone viewports, scoped with a reason and a pointer to
Phase 4.

### Phase 0 — Clean slate

| Unit | Commit |
|---|---|
| Removed `zustand`, `@biomejs/biome`, `@types/react-test-renderer` | `3be8b2e` |
| Untracked `spa.traineddata` (3.3 MB); filed OCR-1 | `b3bd432` |
| Removed vestigial `tailwind.config.ts` | `a3b3efe` |
| Moved the Prisma seed config to `prisma.config.ts` | `436cfea` |
| Folded `INFRASTRUCTURE_SOLUTIONS.md` into `LOCAL_BOOTSTRAP.md` | `bcc8b1b` |
| Corrected the stack claims in CLAUDE/AGENTS/README | `7aa6c7f` |
| Corrected the theme-token count | `b4097c8` |
| Filed INV-1 (expiring items report entry quantity) | `8bdc2a8` |
| Rewrote `SMOKE_JOURNEYS.md` around the two screens | `f780623` |
| Rewrote `DESIGN_PROPOSALS.md` as a decision record | `8a95dcf` |
| Pruned the design lab to Estante and Horizonte | `f501ec0` |
| Retired `DETAILED_PLAN.md` and the dead branch references | `43476e1` |

---

## Decisions taken without asking

Recorded so they can be overruled on sight rather than archaeologically.

**D1 — Phase 1 routes are built plain, not on the new design system.**
The four dead routes are needed before Phase 2 merges the design tokens. Waiting
would serialise two phases for no reason. They are built with accessible,
semantic markup and the existing primitives; Phase 2 restyles them. The risk is
one restyle pass, which is cheap. The alternative is leaving the scanner
pointing at a 404 for another phase, which is not.

**D2 — Order within Phase 1: `/settings` last, stock movement first.**
`/inventory/add` and `/inventory/consume` unblock three of the four `test.fixme`
tests and Journey 1, and their procedures already exist. `/products/new`
unblocks the scanner, which currently dead-ends. `/settings` is a navigation
link on every dashboard page but reaching it is not blocking anything, so it
goes last.

**D3 — Each route ships with its own E2E proof.**
The plan's acceptance for Phase 1 is the four `test.fixme` tests passing without
`fixme`. A route is not counted done until its test is un-skipped and green, so
the phase cannot drift into "written but unproven".

**D5 — Product selection uses `product.list`, not `searchByName`.**
`searchByName` is a raw pg_trgm query; under the default 0.3 similarity
threshold a short prefix matches nothing, and an empty query returns nothing at
all, so it cannot back a picker. `product.list` does substring matching and
returns `defaultUnit` for prefilling. Trigram similarity stays where it belongs,
matching OCR'd receipt lines.

**D6 — Defects found while building are filed, never fixed in passing.**
Building `/inventory/add` surfaced UI-2 and seven smaller issues. Fixing them
inside a feature commit would have hidden them; each is now tagged with the
phase that closes it. The exception is anything that would make the new work
untrue — none did.

**D7 — Verification is a browser, not a green typecheck.**
The delivered route passed lint and typecheck while I could still not tell
whether it worked. Driving it as a user found the truth in one run: stock went
from 0 to 3 and the status badge changed. Every route in this phase gets the
same treatment before it counts as done.

**D8 — `/products/new` reports the outcome instead of redirecting.**
Its siblings redirect on success. This one cannot: the natural destination,
`/products/{id}`, is a 404. Rather than redirect to `/products`, which says
nothing about which of three outcomes occurred, the page keeps the result on
screen with onward links. Revisit once the detail route exists.

**D9 — Stock flows are scoped to desktop until Phase 4.**
They failed on both phone viewports because the dashboard has no mobile
navigation at all (NAV-1) and the forms were built desktop-first under D1.
Running them on a phone today measures an absence rather than a regression. The
skip carries its reason inline, and removing it is part of Phase 4's definition
of done.

**D10 — E2E selectors target hrefs, not link text.**
The app ships in two languages, so a selector matching "Añadir" passes in
Spanish and fails in English. Href-based selectors are stable across both and
survive copy changes.

**D11 — Estante's palette becomes the application's, not a merge of two.**
Phase 2 was written as "merge the Estante and Horizonte tokens". Averaging two
AAA-verified palettes would produce a third that is verified as neither, and the
contrast headroom is what makes them safe. Estante wins because it is the phone
app's basis and therefore the everyday surface; the token set is checked against
the kitchen screen's needs — large type, calm dark theme — rather than blended
with Horizonte's.

**D12 — The CSS is the single source of truth for tokens, not a TypeScript module.**
Tailwind 4 is CSS-first and the JS config was removed as vestigial, so tokens
live in `globals.css` under `@theme`. The contrast audit is reworked to parse
that file instead of importing the design-lab module. An audit that measures a
different copy of the palette than the one shipped is how a green check comes to
mean nothing — which this repository has already experienced once with the
component tests.

**D13 — The lab goes, the stepper stays.**
Retiring `src/app/design` nearly took the ± stepper with it, which is exactly
what lifting it out of Bolsillo in Phase 0 was meant to prevent. It now lives at
`src/components/inventory/QuantityStepper.tsx` with its stylesheet retargeted
from the lab's tokens to the application's. Caught only because the deletion was
checked afterwards rather than assumed complete.

**D14 — Three sizes, two breakpoints, and tablet is the least dense.**
Density normally rises with width. The kitchen tablet inverts it: read from a
metre away, it needs the largest type and the fewest elements of the three tiers,
at a width where a naive layout starts adding columns. So the rule is viewing
distance, not screen width — phone at arm's length, tablet at a metre, desktop
at half a metre. Tables therefore become cards on phone *and* tablet and survive
only from `lg`.

**D15 — The phone navigation is a bottom bar with four destinations.**
Not a hamburger: on a phone used one-handed in a shop, the top corner is the
furthest point from a thumb and a drawer hides the destinations behind a control
you have to know about. Seven destinations do not fit at 48px targets, and they
should not — the phone answers "what do I need to buy". Compra · Inventario ·
Escanear · Más. The tablet keeps a side rail instead, because a bottom bar wastes
the most valuable strip of a screen read from a metre away.

**D16 — The structural a11y checks are an E2E suite, and a separate one.**
A4.2 is a measurement in CSS pixels, A4.3 assembles a layout and a page, and
A4.4's colour rule compares an element with its peers' computed styles. The
component suite runs on happy-dom, which has no layout engine — every rect there
is 0×0 — so it can only assert that a class name is present, which is what
`DashboardNav.test.tsx` does and which is a proxy for the property rather than
the property. They live in `e2e/a11y-structure.spec.ts` rather than inside
`accessibility.spec.ts` so that suite's 90 axe checks keep meaning one thing.

**D17 — The target-size floor is 48px everywhere, not 44 with a phone exception.**
WCAG 2.5.5 asks for 44 and A4.2 asks for 48 "where a thumb is expected". Written
mobile-first (A3.4), unprefixed describes the phone, so the floor is simply 48
and no call site has to reason about which tier it is visible at. The test still
keeps the tiers honest — 48 at 390px, the AAA 44 above it — so a desktop-only
control is not held to a phone rule it can never be used under.

**D18 — `getAppliedSummary` counts what `applyReceipt` applied, not a list of
match statuses.** It filtered items to `USER_CONFIRMED | USER_CREATED`, which is
narrower than the condition `applyReceipt` writes stock under: `confirmAll`
accepts a subset of the lines, so a partly-reviewed receipt can reach CONFIRMED
with lines still AUTO_MATCHED and those get stock too. The filter now mirrors
`applyReceipt`'s own condition, and the procedure also returns the store and the
count of lines that produced nothing. Fixed rather than filed under D6, because a
confirmation screen that under-reports what it just did is the one defect that
would make the new page untrue.

**D19 — 3.3.5's help must be attached, and only fields inside a `<form>` owe it.**
The criterion says help must be *available* and stops short of requiring it to be
programmatically associated. This project requires the association anyway: its
premise is that anyone in a household can use it, and a hint that exists only as
text under an input is help for sighted mouse users and nobody else. The evidence
is `/register`, whose household hint was written, visible, and unreachable by a
screen reader. The other half of the decision is the boundary: a language
selector and a filter box change the view rather than collect information, so
demanding a sentence of help for "Buscar" would be padding dressed as
accessibility. `<form>` membership is where "requires user input" actually lands.

**D20 — Two defects found while verifying a fix are filed, not folded in.**
Verifying the receipts and picker work turned up UI-6 (the picker's panel opens
under the fixed bottom bar) and UI-7 (the review page's pending count is frozen
at zero). Both are real and both are in files that were open at the time, which
is exactly when D6 is tempting to skip. They are filed. UI-6 is then taken as
its own next unit rather than silently — because a picker whose options a phone
user cannot see is not a working control, and closing UI-2 and UI-4 while
leaving it would make those two closures read as more than they are.

**D21 — The seed owns the fixtures the dynamic routes need.**
`/receipts/[id]/review` was unreachable through the interface on a fresh install
and in CI, because the seeder deleted receipts and created none. Every suite here
works from a list of static paths, so a route with an id in it was audited by
nobody — which is how a 505px-wide page survived three responsive sweeps, and
how a dead `/products/[id]` survived three link audits before that. The fixtures
go in the seed rather than into a test's setup, so that one dataset serves the
suite, CI and anyone opening the app for the first time. `e2e/dynamic-routes.spec.ts`
then discovers ids by following links rather than by reading the database: a
route reachable by clicking is a route that gets checked, and an index that stops
linking to its own detail pages fails the discovery step, which is worth knowing
on its own.

**D22 — A11Y-2 was fixed, not filed, and that is the exception D6 needs.**
D6 says defects found in passing get filed rather than fixed, and it has held all
phase. This one broke it deliberately. "Confirmar" wrote `USER_CONFIRMED` to the
database and left the page byte-identical — no refetch, no count change, no
announcement — so the only reasonable response to it was to press it again, and
that was a second write. A defect whose symptom is "the control lies to
everyone" is not a finding with a workaround; it is the control not working. The
rule stays: file when the fix is a separate piece of work, fix when leaving it
would mean shipping something that does not do what its label says.

Fixing it closed UI-7, which was the same root cause seen from the outside, and
exposed a third thing neither entry had noticed: "Confirmar todos" is disabled
while anything is pending, so with the count frozen above zero the bulk action
was disabled *permanently*. Its name is now the only thing wrong with it, which
is filed as I18N-6 rather than renamed, because wording is a product decision.

**D23 — The predicate for "reviewed" lives in one module.**
`ReviewCard` computed it correctly from `matchStatus` while the review page kept
a `useState(0)` that never moved, so the heading said "4 productos pendientes"
above four cards all reading "Confirmado". Two definitions of one word, one of
them wrong — the same shape as D18. It is `isItemReviewed` in
`src/lib/receipts.ts` now, imported by both.

**D24 — Ten minutes is the budget for all verification, and it is enforced in
three places.** Not a runner constraint — a product decision. Verification that
takes longer stops being run, and a suite nobody runs still has to be maintained
while telling nobody anything. `verify-local.sh` holds the whole ladder to 600
seconds and every step to its own ceiling; each CI test job is capped at ten
minutes; Playwright's `globalTimeout` is nine, so it fails first and names the
test rather than the runner killing the job with no report. The first attempt
set it at seven, which would have failed CI runs that still met the contract —
a ceiling that cries wolf only teaches people to raise it.

**D25 — A check belongs in the cheapest tier that can answer it honestly.**
Three tiers: static facts about source and CSS in Bun; DOM facts in Bun with
happy-dom; layout and interaction in a browser. The line is not a preference —
axe itself draws it, running under happy-dom for `button-name`, `heading-order`,
`label` and `link-name` while returning `color-contrast` as *incomplete*. The
target-size floor moved to the middle tier via Tailwind's own compiler, which
resolves a component's class string to the CSS a browser would apply. What
cannot move is anything about composition: a parent that clips, a sibling that
shrinks, a fixed bar drawn on top.

**D26 — A test that cannot fail is deleted, not maintained.** Four went: three
asserted that `page.viewportSize()?.width` equalled the width just passed to
`setViewportSize`, and one ran a registration, a product creation and a stock
movement before ending on `// Assertion omitted`. This is the same rule that
retired 352 tautological component tests in Phase 0, applied to the suite that
replaced them — the rule does not stop applying once the tests are ours.

**D27 — Authorisation reads the database, not the JWT.**
The plan says to carry `role` through the session callbacks, and it is carried —
but the session copy exists for the interface, which uses it to hide what an
account cannot do. `householdProcedure` reads membership and role per request.
Two things follow that are worth one indexed lookup: a demotion or a removal
takes effect on the next request rather than whenever the 15-minute token
happens to expire, and an account that has just created its household can use it
immediately instead of signing out and in again to mint a token that knows about
it. The second is not a nicety — without it the HOUSE-1 fix appears to do
nothing for fifteen minutes. In five routers the lookup is free: those
procedures were already making exactly that query, one copy each, to find the
household id. 36 copies are gone.

**D28 — The per-procedure check is a static test, and the behavioural one is
separate.** The phase's *done when* says "repeated per procedure rather than
sampled", and calling all 45 procedures with valid input as three roles is 135
calls of scaffolding whose failure modes are mostly its own. So the coverage is
split by what each tier can answer honestly (D25): a unit test reads how every
procedure is *declared* and compares it against the matrix, and an integration
test proves the middleware actually refuses. The static half earns its place
independently — when a `TRPCError` was reverted to a bare `Error` in `price.ts`
to check the tests could fail, only the static test went red. No behavioural
test provokes that path, and none would have noticed.

**D29 — The rate limiter fails closed, and the limits are configurable.**
An attempt that cannot be counted is refused. Failing open hands an unlimited
auth endpoint to anyone who can take the cache down, which is the state
CRITICAL-4 describes; the cost is that Valkey becomes a hard dependency of
signing in, which is stated in `SECURITY.md` and named in the server log rather
than left for an operator to discover through a login form that rejects a
correct password. The limits are read from the environment because the browser
suite registers dozens of accounts per run against a server with no proxy in
front of it, so the whole matrix shares one bucket; `playwright.config.ts`
raises them rather than switching the limiter off, so it still runs on every
request the suite makes, and a unit test asserts the shipped defaults with the
environment unset so the override cannot become the product's behaviour.

**D30 — A successful sign-in clears its counter.**
`CLAUDE.md` says 5 login *attempts* per 15 minutes. Taken literally that locks
out a household signing in from a phone, a tablet and a laptop before anyone has
mistyped anything. Clearing on success leaves the ceiling exactly where the
specification puts it for someone who cannot sign in, which is the only case the
limit defends against.

**D31 — The second credential endpoint was removed, not limited.**
An adversarial review of the finished phase found `auth.login`: a public tRPC
procedure doing its own `argon2.verify` and returning the account's identity,
which the interface has never called and which the new limiter did not cover. So
five wrong passwords on the Auth.js door locked an address out while the same
guesses through `/api/trpc/auth.login` were unlimited. Deleting it beat limiting
it — Auth.js already owns credential verification, and a second path nothing
calls is a liability whether or not it is metered. Its four tests were repointed
at `authorize`, which had no coverage below the browser until then; that
immediately caught a second thing, which is that
`authConfig.providers[0].authorize` is Auth.js's placeholder `() => null` and the
configured function lives in `options`. Three sign-in tests passed against a stub
for one run. *Amended by D135 (2026-10-15):* the one credential path is now the
auth route, `POST /api/auth/sign-in/email`, and the tests that drove
`authorize` sign in through the route module itself
(`src/__tests__/utils/authorize.ts`), so they reach no library internals.

**D32 — TEST-3 was fixed rather than left filed, on D22's reasoning.**
D6 says file, do not fix in passing. TEST-3 — one E2E journey writing the stock
another journey asserts — was filed and then fixed inside the same phase,
because a filed defect that keeps a gate red is not a finding with a workaround;
it is a gate nobody can use, and the next person to run the suite would have had
to rediscover it. The rule stands: file when the fix is separate work, fix when
leaving it means the project cannot tell whether it is broken.

**D33 — Cross-engine coverage is a separate axis from test coverage, and the
matrix stopped multiplying them.** The browser suite ran every spec on five
projects: 182 tests and 1,098 seconds of processor time for 26 distinct
behaviours. Duplicating a sign-in across five engines does not test five
things — the flow is tRPC, Prisma and Argon2id, none of it rendered, none of it
different because the engine is. What does vary by engine is layout. So
chromium runs everything as the reference, Mobile Safari runs the two layout
specs because WebKit at a phone width is where this project's layout defects
have actually appeared (UI-5, UI-6), and Firefox and desktop WebKit run a
four-test `@smoke` set. Mobile Chrome is gone: Blink at 393px, a width chromium
already visits on every route through `setViewportSize`. 89 tests, 2.9 minutes.

**D34 — A browser test must name the thing only a browser can answer.**
The corollary of D25, applied as a rule for adding tests rather than a
description of the tiers. Five picker tests failed it — keyboard navigation,
Escape with focus returned, and tab order are facts about the DOM, and
`LocationPicker.test.tsx` already asserted every one against the real component
in milliseconds. They cost five tests on five projects and twenty-five page
loads to re-answer a question that was already answered. The two that stayed
name their reason: composed target size and whether a fixed bar is painted over
an option, neither of which happy-dom can decide, because every rectangle in it
is 0×0.

**D35 — The E2E ceiling is the contract, not a safety net.**
`globalTimeout` was nine minutes everywhere while the suite measured 5.6. A
ceiling three times the measurement cannot fail before the suite has already
become something nobody runs. It is five minutes locally, where the suite takes
2.9, and nine in CI — not a weaker contract but a different machine: two
workers on four cores that also run the dev server, with two retries on
failure.

**D36 — The two AAA criteria a machine can decide are decided here, and the
rest are a documented manual pass.** pa11y's `WCAG2AAA` standard was run before
deciding anything: 0 errors, 1 warning, 60 notices on `/login`, every AAA item
beginning "Check that…". So no tool automates the AAA half, and the project
measures the two that are mechanically decidable and were missing — 3.1.5
reading level, on the catalogues, with Fernández-Huerta for Spanish because
Flesch reports Spanish as harder than it is; and 2.2.6 timeouts, by sliding the
session on activity and warning before an idle one ends. pa11y and
Accessibility Insights are documented as the manual procedure in
`DESIGN_AUDIT.md` §5 and deliberately kept out of CI: a check that can only say
"ask a person" either passes vacuously or floods the log.

**D4 — Strings go into both catalogues in the same commit.**
`REDESIGN_PLAN.md` §5.6 requires Spanish and English. Enforced per commit rather
than swept up later, because a translation backlog never gets paid off.

**D37 — Phase 4's prerequisites were fixed first, not filed and worked around.**
Three defects stood directly under the offline layer. `ISSUES.md` INV-1 said so
in as many words — "Phase 4 must not build replay on top of this" — because the
availability guards measured gross purchases and would have let a replayed
consumption drive stock negative. UI-9 sat on `/shopping`, the route the phone
screen is built on, and `REDESIGN_PLAN.md` §7 rule 5 is "never an empty, silent
screen": a new screen standing on a route that lies about being empty inherits
the lie. This is D32's rule, not an exception to D6 — file when the fix is
separate work, fix when leaving it means the next thing built is wrong.

**D38 — The drawdown rule is stated in a module, not assumed in a router.**
Stock is an append-only ledger with no link between a purchase and the
consumption that drew it down, so "how much of this batch is left" has to be
derived, and the derivation needs a rule for which batch a consumption came out
of. Soonest-expiry-first, with undated batches last. It is an assumption and it
is written down as one, in `src/lib/inventory/batches.ts`, because the
alternative — attributing each consumption to a batch at write time — is a
schema change `ISSUES.md` has twice declined to make as a side effect. Putting
it in a named module also put it at the tier that can test it: 19 tests in
35ms, against a browser or a database for the same arithmetic.

**D39 — Commits are unsigned, because every commit in this repository is.**
`commit.gpgsign` is `true` and `user.signingkey` points at
`~/.ssh/git-signing-key`, but the key is passphrase-protected with no agent
running, so signing fails. Checked before assuming: `git log --format=%G?` says
`N` for every commit in the history, so unsigned matches what this repository
actually does rather than departing from it. The configuration is left alone —
it is the operator's to fix, by loading the key into an agent.

**D40 — Zustand comes back, and Phase 0's reason for removing it is why.**
Phase 0 removed `zustand` (`3be8b2e`) and `CLAUDE.md` recorded the rule: server
state is TanStack Query's, local UI state is React's, and nothing else *without
a case React cannot serve*. Asked to reintroduce it, the honest move was not to
delete the rule but to find the case — and Phase 4 had produced one. The
offline write queue is read by four unrelated surfaces, written from outside
React by the `online` event, a backoff timer and another tab's `storage` event,
and it outlives every component that reads it. A context would re-render every
consumer on every change to any entry; lifting it means threading it from the
dashboard layout. So the rule stands and the exception is taken deliberately.
Scope is stated in `REDESIGN_PLAN.md` §5.7 so it does not creep: the store
holds the queue and what derives from it, never server data and never form
state. A second store is a decision, not a convenience.

**D41 — The React Compiler is on in full mode, not annotation mode.**
`next@16.3` takes `reactCompiler: true` as a top-level key and applies the
Babel plugin only to files with JSX or hooks, chosen by an SWC pass. Full
rather than opt-in because opt-in memoisation fails the same way manual
memoisation does: the components that need it are the ones nobody thought
about. The build time is measured into `STATUS.md` before and after rather than
described as small, because the ten-minute budget is a contract.

**D42 — `react-doctor` gates on errors, not on the score.**
Run before deciding anything: 176 files in 90ms, so it costs nothing against
the budget, and the first run found a real defect rather than a style
complaint — an unauthenticated `"use server"` action writing an unvalidated
string into a cookie that `src/i18n/request.ts` interpolates into a dynamic
`import()` path. The score is 59 with 54 warnings, and a gate on a number
either blocks every commit or gets raised until it means nothing; errors are
few and specific. Warnings are read, and the ones worth acting on become their
own commits. Pinned exactly, because a pre-1.0 gate can change its mind about
what counts as an error.

**D43 — Stock has a floor, and a refused consumption becomes a question.**
Decided by the plan's owner, against the open question the Phase 4 design
raised. Stock may never go negative, so two people who each use the last unit
cannot both be right and the second is refused — that part was already built
and stays.

What changes is what happens next. Discarding the refused change would throw
away a real event: they *did* take the milk. So the refusal is surfaced as the
question only a person can answer — the count and the house disagree, and only
someone who can see the shelf knows which is true — and the answer is written
as an `adjustStock`, which is precisely the primitive for "the count is wrong
and here is the truth". Allow and reconcile, never discard.

`REDESIGN_PLAN.md` §5.5.3 also corrects the claim that made this a surprise:
deltas merge "without a fight" in one direction only. Adding always merges,
because a household has no ceiling. Consuming has a floor.

**D44 — The reconciliation is not a modal at the moment of conflict.**
The owner asked for "a modal that asks for it, or other best suited for UX", so
this is the second half. A conflict is discovered on *reconnect*, which may be
minutes after the shop with the phone in a pocket: a dialog thrown then
interrupts someone who is not looking at the item and cannot answer it. §7 rule
3 rejects interruptions for the same reason. So the sync indicator carries it
as something needing attention, in words, and opens the reconciliation when the
person chooses to deal with it — which also makes it survive being ignored for
an hour, the realistic case.

A KITCHEN account cannot reconcile: `adjustStock` is a `writeProcedure` and the
matrix gives that role looking and consuming only. On the tablet the conflict
is reported and names who can fix it, rather than offering a control the server
would refuse. Offering a control that cannot work is worse than hiding one.

**D45 — Two guards for one property is one guard too many.**
The drain had a single-flight check in the queue *and* in the provider that
mounts it. Breaking the provider's changed nothing, because the queue already
owned the property — so it was a second thing to keep in step, and the copy is
what rots. Removed, and the test that covers it now names where the guard
actually lives rather than implying it is in the component. Recorded because
the tell was a test that would not go red, which is the same signal as D42's
gate that would not fire.

**D46 — The React gate caught the commit that added it, twice over.**
`react-doctor` landed four commits before the drain, and the drain's first
version failed it: a ref assigned during render, which is wrong under a
re-render React throws away and stops the compiler optimising the component.
The same rule then caught the test file capturing a handle out of render.
Both were mine, both were invisible to `tsc` and `oxlint`, and neither would
have failed a test. That is the argument for the gate, made by the gate.

**D47 — The browser found four defects every cheaper tier had passed, and that
is the argument for keeping it.**
A hydration mismatch (the queue read storage while its store was being built);
a stored queue destroyed by enqueueing before hydrating; a retry timer keyed on
a count that a failure does not change, so it fired once and never again; and
`t("shopping.items")` against a catalogue with no such key. None of them could
be seen by the 906 tests below the browser tier — the first three because they
need a real page lifecycle, the fourth because `messages.test.ts` compares the
two catalogues only with each other. The fourth is now caught in milliseconds
by `message-usage.test.ts`, which scans every `t("…")` in the source. The first
three are why five browser tests exist.

**D48 — A locator that filters on state stops matching when the state changes.**
`getByRole("checkbox").and(locator(":not(:checked)"))` resolves to nothing the
instant it is clicked, so the assertion after the click fails on *correct*
code. Read the state once, then address elements by position. Recorded because
it is indistinguishable from a real failure and cost a full run to diagnose.

**D49 — Phase 4 is closed against its done-when, not its title.**
The title said "phone screen, offline from the start". The done-when said "a
full shop can be done in aeroplane mode and syncs correctly on reconnect". The
second is proven; Screen A's layout is not built and moves to Phase 5. Closing
against the done-when and naming the gap is honest; closing against the title
would require either building the layout or quietly redefining what was
promised, and the second is how a plan stops being worth reading.

**D50 — A `mock.module` replaces that module for every suite in the process.**
Bun's module mocks are not file-scoped. Three consequences bit in one commit:
a mock that omitted an export turned that export into `undefined` elsewhere; a
*complete* mock of `@/lib/sw/register` then replaced the real module in the
suite that tests it; and mocking `queue-context` made
`WriteQueueProvider.test.tsx` read a stubbed hook instead of the provider's own
value. All three passed until a new test file changed the load order, which is
the worst way to find it.

Two rules, in order:

1. **Never mock a module another suite tests for real.** Stub the browser
   instead — `SignOutButton.test.tsx` now asserts the `postMessage` the worker
   receives rather than that `forgetCachedShell` was called, which is both
   safer and a stronger claim.
2. **A suite that renders a real component must not read a hook other suites
   mock.** `WriteQueueProvider.test.tsx` drives the queue directly; everything
   it asks about is observable there.

The structural half: `useWriteQueue` moved out of `WriteQueueProvider.tsx` into
`queue-context.ts`, so mocking the hook cannot reach the provider. That is the
shape it should have had anyway — a consumer needing the hook has no business
importing the provider.

**D51 — Sign-out asks only when there is something to lose.**
A queue with unsent changes is somebody's shopping, and signing out silently
would delete it — so the control offers three answers: send them first, discard
them, or stay. With nothing pending it says so and gets on with it, which keeps
§7 rule 3 (undo rather than confirm) for the case that is actually routine.
"Send first" is offered even with no signal, where it will not succeed; the
attempt is what tells the person the changes are still there rather than gone.

**D52 — "Not completed" is not "has something unticked".**
`/shopping` filtered on `items: { some: { isChecked: false } }`, which also hid
every list with **no items at all** — so creating one made it vanish. Combined
with two missing cache invalidations (creating a list, and adding an item), the
whole flow looked broken in three independent ways at once, and none of them
had a test. All three were found by writing a browser test that needed to
create its own list, which is the second time this phase that making a test
independent of the seed found real defects.

**D53 — A test that shares seeded state is a test that will fail later.**
`offline-shop.spec.ts` opened the seeded list. It passed alone and failed in a
full run, because another journey ticks that list's items and `/shopping` hides
a completed one. It creates its own list now — four extra actions, and
independence from the seed, from the order specs run in, and from each other.
`ISSUES.md` TEST-3 is the same lesson; this is its third appearance, so the
rule is worth stating plainly: **a browser test that reads seeded state must
either create what it reads or assert nothing about its shape.**

**D54 — The trolley is the undo, not a toast.**
§7 rule 3 asks for undo instead of confirm, and the obvious reading is a
ten-second "Deshacer" toast after each tick. Rejected: an undo that expires is
one you miss while reaching for the next shelf, and the mistake it exists for —
ticking the wrong row — is usually noticed at the till, not within ten seconds.
The trolley section holds everything ticked and unticks with one tap, so the
undo is permanent and in a place someone would look for it anyway. It also
costs no timer, no live region and no state machine.

**D55 — Screen A's row is a button, not a checkbox with a label.**
A checkbox beside a label is two targets and one of them is thirteen pixels
(the same defect `a11y-structure` caught on `/settings/people` this week). The
whole row is one `button` with `aria-pressed`, so the target is 64px tall, the
accessible name can say what the tap will *do* — "Marcar «Leche entera» como
comprado" rather than just the product name — and there is nothing to miss with
a thumb.

**D56 — `getBuyList` is one flat list, not a list of lists.**
§3's question is "what do I need to buy", and which list something is filed
under is not part of the answer. The procedure returns every item across the
household with the product's stock and minimum already attached, because
standing in an aisle "how much is at home" is the question and a round trip per
row to answer it is not available on a supermarket connection. Filing stays on
`/shopping/lists`.

**D57 — Undo on the kitchen screen cancels the queued change; it never writes a
compensating one.**
§4 asks for a ten-second undo after "he usado uno". Implemented as removing the
still-queued `consumeStock`, not as an `addStock` that reverses it. A
compensating write would record that the household *acquired* something it
never did, and every downstream reader — the expiry view, the price history, a
future report — would see a fabricated event indistinguishable from a real one.

The affordance is therefore offered exactly while the change is still in the
queue and disappears when it can no longer work, which is *more* honest than a
countdown: a ten-second timer offers undo for ten seconds whether or not
pressing it would do anything. `queue.cancel` refuses the operation currently
in flight for the same reason — taking one back after it left would keep the
server's copy and lose ours, the one outcome worse than not offering undo.

**D58 — A failing component test can look exactly like a hung one.**
Proving a kitchen test could fail timed out at 120s: the assertion failed
quickly, and the *reporting* did not. `DEBUG_PRINT_LIMIT` is now capped, which
did not fix it — so the cost is elsewhere, most likely `getAllByRole`
computing accessible names across a larger tree. Recorded with what was
measured rather than what was assumed, and worked around by proving the same
property through a mock-call assertion instead of a DOM query. STATUS.md trap 3
is the same shape one tier up.

**D59 — A paused mutation must never be persisted.**
query-core's default `shouldDehydrateMutation` is `mutation.state.isPaused`,
and `networkMode` is `"online"` — so a write made with no signal is *paused*,
not failed, and the default would persist it and let `resumePausedMutations`
replay it on the next visit. That is a second, uncontrolled path to the server
racing the queue's drain. The idempotency key would contain the damage, but the
path would be untested and nothing on screen would know it existed. Set to
`() => false`, with a test that goes red if it is ever relaxed.

**D60 — The read cache is scoped to the account, and that costs a flash.**
Persistence is set up inside the dashboard rather than in the root provider,
because the root has never known who is signed in and a shared tablet must not
restore one person's household under the next person's session. The
consequence is that restoration happens *after* the first render, so a screen
opened with no signal shows the "nothing saved" panel for a moment before the
cache arrives. Stated in `STATUS.md` rather than left for someone to discover:
the alternative — gating the first render on restoration — means persisting at
the root, keyed by nobody.

**D61 — Throttled writes need a seam, not a sleep.**
`createSyncStoragePersister` batches writes through a `setTimeout`, so a test
that awaits the save's own promise observes nothing — and one that sleeps
"long enough" is the unbounded wait STATUS.md trap 7 is about. `throttleTime`
is injectable and set to zero in tests, with a single bounded macrotask flush
to let the timer fire. A second in the browser, because a screen settling fires
several cache changes and each one serialises the whole allowlist on the main
thread.

**D62 — A banner and a page are not the same control twice.**
The sync indicator names failures where you are; `/settings/unsaved` is where
they can be found on purpose. The reason both exist is not redundancy but
*time*: an hour after a shop, the banner is on whatever screen you happen to
be on, and it cannot say when anything was recorded. The page is the only
surface that answers "was this the milk from Tuesday?", which is the question
somebody actually has by then. Retry, discard and the reconciliation are the
queue's and the dialog's — nothing is reimplemented.

**Phase 5's actionable work is complete.** Screen A, Screen B, provisioning,
sign-out, `P2025` translation, A11Y-1, read persistence and `/settings/unsaved`.
What is left of the phase is a week on a real tablet and a pass on a real iOS
device — both unowned in `REDESIGN_PLAN.md` §10, and both things no suite can
answer. Naming them as unowned rather than closing the phase over them is the
same rule D49 set when Phase 4 closed against its done-when.

**D63 — DEBT-1 was answered against the standard, not against its own
suggestion.**
The entry proposed four composition regexes — uppercase, lowercase, digit,
symbol. NIST SP 800-63B §5.1.1.2 advises against exactly that: composition
rules push people toward `Password1!`, which is more predictable than a longer
passphrase, and they are why passwords get written down. This project already
cites SP 800-63B for rate limiting; applying it there and ignoring it here
would have been picking the easy half. Twelve characters, no composition rules,
a common-password check and a refusal to contain the account's own name.

Twelve rather than the standard's floor of eight, because that floor assumes
the verifier also checks against breached lists at scale — which a self-hosted
install with no outbound network cannot do.

**The larger finding was the one DEBT-1 did not mention.** There was no maximum
length anywhere, so `argon2.hash` and `argon2.verify` took unbounded input on
`register` and `authorize`, both reachable without an account, with Argon2id
configured at 64 MB per call. The rate limiter bounds how often, not how much.
Capped at 128.

The policy governs a password being *set*, never one being *checked*. A
verifier that refused a stored password because the rule changed would lock
people out of their own household — so sign-in keeps only the maximum, and a
test asserts a short legacy password still gets in.

**D64 — Rate limiting counts accounts on a hash, not on an address.**
NIST SP 800-63B §5.2.2 asks for consecutive failed attempts to be limited
against *an account*, which a per-IP limit does not do: a hundred addresses buy
a hundred budgets against one password. Ten per fifteen minutes rather than
five, because the counter cannot tell a household's phone from its tablet.
Keyed on a SHA-256 of the normalised address, because a counter named after the
email turns `KEYS rl:login:acct:*` — reachable by anything on the Docker
network — into a list of who has tried to sign in.

**D65 — The product cache fails open; the rate limiter fails closed.**
Two caches in the same Valkey with opposite policies, and the difference is the
point. An attempt the limiter cannot count is an unlimited attempt, so it
refuses. The fallback for a product cache it cannot reach is to ask Open Food
Facts, which is what a miss already means — refusing would break scanning to
protect an optimisation.

**D66 — The image carries a smaller OCR model than the CDN serves.**
tesseract.js defaults to a model that is over 12 MB on disk because it carries
the legacy engine's data. The image bakes in `tessdata_fast` at 2.3 MB, which
Tesseract recommends for printed text. **Nothing here measures OCR accuracy** —
the parser tests run against fixed strings, not OCR output — so this is reasoned
rather than measured, and is the first thing to look at if receipt parsing
degrades.

**D67 — "Ticket" beat "recibo", which was the larger change.**
The catalogue used both for the same piece of paper. §3 writes for somebody
standing in a supermarket and rules out system vocabulary: a Spanish supermarket
hands you a ticket, and a recibo is what a bank sends. Twenty-three strings
changed rather than nine — the direction the argument pointed rather than the
direction the smaller diff did.

**D68 — `formatDate` was deleted rather than given a locale argument.**
I18N-3 suggested parameterising it. It had no call sites at all; the only
mention anywhere was a comment in the receipts route explaining why that route
*could not* use it. A locale-pinning helper on the shelf is a trap for whoever
reaches for it next, so it went, and a unit-tier sweep now refuses a literal
language tag anywhere under `src/`.

**D69 — The browser suite re-seeds rather than each test creating its state.**
TEST-3's class for the third time. The two previous answers were local — make
*this* test create its own — and that does not transfer to the receipt journey,
because producing a receipt with parsed lines means an upload and an OCR pass.
So the fixture is restored before every run instead. The seed deletes only the
demo household's rows, which is what makes that safe.

**D70 — `global-error.tsx` is bilingual and inline-styled, on purpose.**
It replaces the root layout rather than rendering inside it, so it has no intl
provider and no stylesheet: `useTranslations` would throw inside the boundary
meant to catch things, and a Tailwind class would have no rules behind it.
Reading `navigator.language` would put a branch in the one component that must
not have bugs. Two short sentences in two languages fit.

**D71 — The health endpoint is not rate limited, which is a deliberate
exception.** The limiter lives in Valkey and fails closed, so metering
`/api/health` would make it stop answering in precisely the situation it exists
to report. Its body says nothing the status code does not, because it is
reachable through Traefik and "database: unreachable" tells an attacker which
half to push on.

**D72 — A refused delete explains itself; the rule it enforces is unchanged.**
PROD-1. Cascading would take the price history the price screens exist to show,
so `product.delete` and `store.delete` still refuse — they now count the
references first and name them, instead of leaving a foreign key to report it as
"That refers to something that does not exist", which describes the opposite of
what happened.

**D73 — The export is JSON with named columns, and admin-only.**
CSV flattens a household into one table and loses which entry belongs to which
product. Every query names its columns rather than using `include`, so a column
added to the schema later cannot arrive in an export by default — the first one
it would have taken is `passwordHash`. Admin, because it is the whole household
including everybody's address, which §5.2 already puts behind admin.

**D74 — Error tracking is a decision, not a backlog item.**
Every option ships a household's errors to somebody else's server, which is the
opposite of what this product is for. "Absent" may be the correct permanent
answer, and it is recorded in the plan as one rather than sitting there implying
it is owed.

**D75 — Documenting the procedures was worth it for what it found, not for the
docblocks.** DOCS-1's own example — "Search for products by name" over
`searchByName` — restates the identifier. Each docblock says what the signature
cannot: what the procedure refuses, what it writes, which role may call it.
Establishing those found four assumptions about this codebase that were false:
`auth.me` has no callers, `addStock` verifies the store *before* its transaction
rather than inside it, `product.delete` refuses rather than cascades, and a
shopping item with no name at all was accepted. The last two became PROD-1 and
SHOP-1.

**D76 — TEST-5 is filed undiagnosed, with six ruled-out causes.**
An intermittent failure in the suite that guards the offline queue, about one
run in seven. Two plausible fixes were tried and *measured* rather than assumed:
random keys instead of a deterministic generator, and `expectCode` taking a
thunk. Neither helped, so neither was kept as a fix — the entry records what it
is not, with the evidence, and the production path is not in doubt.

**D77 — The honesty rules run before the formula, structurally.**
`computeRating` returns `noData` or `notApplicable` before any arithmetic: no
Nutri-Score means no number built from the remaining 40%, and OFF's own
"not-applicable" means non-food is not scored rather than scored low. Breaking
this inversion fails four tests, which is the point of having written them
first.

**D78 — The worst additive decides its component, and no verdict is not a clean
bill.** One azo colourant among ten harmless gums is still an azo colourant, so
averaging would dilute the exact signal the component carries. An additive not
in the curated risk table scores `limited`, and an *absent* additive list
scores `limited` too — only OFF's explicit `additives_n: 0` is a statement of
none. The display says this out loud ("no additive data, so this part is not
counted as clean") because the caution is a decision the person deserves to see.

**D79 — The OFF cache prefix is versioned by the shape of what it stores.**
v1 entries predate the rating fields, parse cleanly — everything is optional —
and would have presented every previously-scanned product as "no information"
for up to thirty days. `off:product:v2:` makes them misses; the stale keys
expire on their own TTL. The version is the cached shape, not the code.

**D80 — Platform features the repo's tier cannot use are gated, not retried.**
The image job failed for days on SARIF upload and provenance attestation — both
refused on a user-owned private repository after the build, the scan gate and
the push had succeeded. Both now run only when the repository is public, with
the enforcement steps (Trivy's exit-code gate) unconditional. A pipeline that
is always red trains everyone to stop reading it, which is how a genuine
component-test failure hid in the same period.

**D81 — npm is removed from the production image.** Every CRITICAL/HIGH the
scan gate flagged lived in npm's own vendored tree, which goes stale on node's
release schedule. Nothing at runtime uses it — the entrypoint runs the Prisma
binary directly — and a shipped container without a package manager is worth
having regardless.

**D82 — The browser suite's isolation is a different database, not careful
scoping.** The seed always deleted only the demo household's rows, and that
scoping failed the day it mattered: the demo household was exactly what the
owner was testing with. Scoping protects data nobody is using; a separate
database (`stoky_e2e`, Valkey db 1) protects all of it, including the part
someone is in. The derivation lives in one module both the config and the seed
import, so they cannot disagree.

**D83 — The suite drives the standalone build, and the cost was nothing.** The
reasons were three (dev-only defect classes, the `next dev` lock, the shared
database), but the deciding evidence is measured: 117 tests in 2.9 minutes
*including* the build, against 2.7–2.9 for 108 against `next dev` — the
production server serves faster than dev compiles. The separate prod config's
reason to exist died with the move, so its nine tests folded in.

**D84 — `upgrade-insecure-requests` is keyed on the request's transport, not on
NODE_ENV.** The suite's second production run failed nine WebKit tests with
data that never arrived: WebKit upgrades subresource fetches to https even on
localhost, where Blink and Gecko exempt them, so the directive killed every
tRPC call against a plain-http server — which is what a Safari user on a
plain-http LAN install would get. Alternatives rejected: dropping the directive
entirely weakens the Traefik deployment it exists for; stripping it only in the
suite hides a real defect. `x-forwarded-proto === "https"` (or the URL's own
scheme) is what actually distinguishes the two deployments.
*D138 (2026-10-15): a plain-HTTP LAN install reached at several addresses
lists them all in `STOKY_URLS`, so a sign-in is accepted at each.*

**D85 — The ordinary suite blocks service workers; the worker's own specs opt
in.** With the production build the worker registers everywhere, and its
2,500 ms navigation race serves the cached shell under load — 9 of 108 failed
as pages that rendered with no data. A worker in every test makes ordinary
assertions dishonest; no worker anywhere means the worker specs test nothing.
`serviceWorkers: "block"` in `use`, `test.use({ serviceWorkers: "allow" })` in
the one file whose subject it is.

**D86 — The suite names 127.0.0.1, never localhost.** The standalone server
binds IPv4; `localhost` resolves to `::1` first in WebKit's fetch on this
machine and can for Node's own readiness probe inside the CI container, and a
refused connection to a server that is up reads as anything but what it is.
The address in the URL removes the class.

**D87 — The owner's six observations become a phase, not six unowned rows.**
§10's unowned table is where work goes to stay visible while nobody owns it.
These arrived owned: they are the owner's own direction, verified against the
code the day they were given, and they share a theme — the product meeting its
first real use. A phase gives them what the unowned table cannot: a done-when
(the owner repeats the pass and nothing reproduces) and a claim on being the
next work rather than the perpetually visible backlog.

**D88 — The KITCHEN role widens by exactly two capabilities, on the server.**
The owner asked for a kitchen panel that can consume (it already can), create
a shopping list, and add to one. The alternative — showing list actions on
`/kitchen` only to write-capable roles — was rejected: the kitchen tablet runs
a KITCHEN account by design, so the actions would be missing exactly where
they were asked for, and §5.5.3 already rules out offering a control the
server refuses. So `shopping.create` and `shopping.addItem` change tiers, and
nothing else — no tick-off, no rename, no delete, no generate. This overrules
§4's "Nothing else" and §5.2's "look and use one up", both amended in place
with the date and the trade.

**D89 — "El formulario de consumir stock" is read as the add-stock form, and
both forms get the treatment.** The fields the owner named — expiry date,
store, price — exist only on the add side; the consume form has no expiry, no
store, no price. Rather than guess which screen was meant, both get the same
two layers: the essentials above the fold, the rest behind a disclosure. The
receipt upload's missing store picker rides with the same item (PRICE-1),
because the owner's underlying complaint is that prices are never captured,
and the stock form is only half of why.

**D90 — A referenced product stays undeletable, and price history is why.**
The owner scoped deletion to products with no stock and no shopping-list use.
The schema is stricter: no relation declares `onDelete`, so the database
refuses while any stock entry, price record, receipt line or shopping item
references the row — and relaxing that for price records would delete the
record the price screens exist to show. PROD-1 left exactly this question
open; it closes as: delete is admin-only, confirmed, and possible only when
nothing references the product at all. The two conditions the owner did not
name are surfaced in the interface rather than discovered as a CONFLICT.

**D91 — The hero panel got its own token, not `bg-muted`.** Both were
AAA-clean and muted was cheaper — zero gate changes. But muted is the same
green-grey family as every other surface, and the owner's complaint was not
"too dark"; it was the action colour worn as a background. The fix that reads
as an answer is a different *kind* of surface, which the palette did not
have: one warm token (`#f1eee1` light, `#201b14` dark), the ordinary ink on
top, three new audited pairs. The aside card went solid `bg-card` rather than
keeping its translucent wash, because a point-of-use opacity modifier is the
one way to break contrast the token audit cannot see.

**D92 — The edit screen is its own inline form, not an extraction of the
create form.** The plan called extraction "the natural move", and reading the
create page said otherwise: its 560 lines hardcode create-mode behaviour
throughout — the scanned-code context, the Open Food Facts panel, the success
screen with "create another" — so a shared component would be a props-driven
mode switch through code that is already verified and shipping. This
codebase's idiom is that a page owns its form (add, consume and new all do);
the edit page duplicates the six field blocks and nothing else. The cost is
~200 lines of markup twice; the alternative's cost was re-verifying the
create journey to ship an unrelated screen.

**D93 — On the edit screen, a blank optional field means "remove it".**
`updateProductSchema` treats absence as "leave it alone" (partial update), so
the form sends every field and blanks go as `null` — before the schema
learned `nullish`, removing a wrong barcode was impossible: omission kept it
and `""` would have landed in the `[barcode, householdId]` unique index. The
alternative — blanks omitted, a separate "clear" affordance per field — makes
the common correction two controls instead of one. The component test pins
the semantics by asserting the exact payload, and was watched to fail against
an omit-blanks implementation.

**D94 — `needsRestock` is a new flag, not a widening of `lowStock`, and both
ends of the door ask it.** The Panel's restock definition (out of stock, or
below a set minimum) was deliberately broader than the server's `lowStock`
filter, and the card's count and the filtered list must be the same set — so
the definition moved server-side once and both sides query it. Widening
`lowStock` itself was rejected because the kitchen screen already reads it,
and silently changing what an existing consumer sees is the drift the
capability and journey suites exist to prevent. The third card's door is the
plain `/inventory`: its alert block renders the same two expiry queries the
card sums, so the promise holds without a third filter.

**D95 — The stock forms' disclosure is uncontrolled, opened imperatively.**
A controlled `<details>` (open prop + onToggle) races hydration: a native
click before React attaches flips it open, and the first post-hydration
render snaps it shut — found as a coin-toss failure in the browser suite,
same steps passing in one test and failing in the next. The one programmatic
need — a refusal about the folded unit must not point into a closed drawer —
is a `ref.setAttribute("open", "")`, which never fights the person. The
specs that reach the folded picker open it open-if-closed with a retry, for
the same reason.

**D96 — The usual location is derived client-side, not a schema column.**
A `defaultLocationId` on Product would need a migration, a form control to
set it, and someone to maintain it; the habit is already in the ledger
`product.getById` returns, and a pure function over it costs no query and no
schema. Rules: only incoming entries vote (a consumption's location says
where something was taken from, not where it lives), the most frequent
wins, ties to the most recent, no history guesses nothing. If deriving ever
proves too magical, the column is still available — the function's call site
is one line.

**D97 — Creating the first list from the tablet is online-only, and says
so.** `shopping.addItem` is offline-replayable and rides the queue;
`shopping.create` is not, and making it so would mean a replay envelope, a
queue path and a conflict story for a case that happens once per household —
the first ever "Apuntar" with no list. The tap tries, and when there is no
connection a live region says the list cannot be created right now, instead
of the tap vanishing. §5.5.3's rule applied in the small: offering a control
that cannot work is worse than saying why it will not.

**D98 — Delete lives on the product's page, not in the list's actions
column.** The owner's list named it among the row actions; it moved one tap
away because a destructive, unrecoverable action beside twenty visually
identical rows invites the wrong row, and the product's own page names its
target unambiguously. Every other requested action is in the column. One tap
of distance against an irreversible mistake is the trade; the owner can
overrule it by asking again.

**D99 — The client learns its role from `auth.me`, not from new plumbing.**
The alternatives were threading `role` through the layout's ComposerProvider
(whose job is offline composition identity, not authorisation courtesy) or a
SessionProvider the app has deliberately never had. `auth.me` existed,
documented as waiting for its first caller, reads the database rather than
the token, and TanStack caches it — one query, no new conduit. Hiding the
delete section is still only courtesy; `adminProcedure` is the control.

**D100 — The kitchen's queued change waits ten seconds, so undo exists online.**
D57 made undo "cancel the queued change" and rejected the countdown as a
timer that offers undo whether or not it would do anything. What that missed:
online — the common case — the queue drains in one round-trip, so «Deshacer»
lived for a single render. The owner found it unusable, a flash. Fixed by
holding a change enqueued with `holdMs` (the kitchen passes ten seconds, §4's
original number) in the queue before it becomes eligible to send. D57's
invariant stands — undo is still cancellation, never a compensating write —
and the countdown objection dissolves, because for the whole window pressing
the button genuinely works. The hold is measured from `createdAt`, so a
change restored after a reload owes no second wait; a held head blocks the
queue behind it, because order is correctness (`consumeStock` refuses when
the quantity exceeds what the writes in front of it leave). Only the kitchen
opts in: shopping ticks keep D54's trolley-as-undo and sync immediately.
*Amended 2026-10-06:* ten seconds is now the default, not the rule. The hold
follows the snackbar-duration preference — 10, 30 or 60 seconds, the last
capped because a held head blocks the queue — since an undo is a time limit
too (WCAG 2.2.3), and "Larga" had bought longer to read a button that had
already stopped working. One table, `UNDO_HOLD_MS` in
`src/lib/snackbar-duration.ts`, read through `undoHoldMs()`; it had been
written three times.

**D101 — One snackbar for events, and four other surfaces that are not it.**
Feedback had no pattern: five ways of saying a thing had happened, and six
writes that said nothing at all. The owner asked for one snackbar with undo,
in Material's shape. The hard part was not building it but deciding what it is
*not* for, because a snackbar removes itself and a message that removes itself
must not be the only account of something still true. The taxonomy: a
transient confirmation of an event is the snackbar; a persistent state stays
in a live region where the control you would act on is (`SyncStatus`,
`RouteState`, `ReconcileDialog`, `Scanner`, the kitchen's list failure); a
success carrying next steps is a dialog over the screen that produced it,
because that screen is still useful and closing the dialog is "do it again";
destructive-and-irreversible-with-no-inverse is a confirmation dialog, since
§7's "undo instead of confirm" assumes an undo exists and deleting a list
cascades its items; and a refused submit stays an in-page `role="alert"`
summary, because it is the target of a focus move that must land beside the
fields, it lists several reasons at once, and it is still true while the form
is invalid. **D54 survives unchanged**: `/shopping` keeps the trolley and gets
no snackbar — an undo that expires is one you miss reaching for the next
shelf. **D100 survives unchanged**: the kitchen's hold is still ten seconds
and undo is still `queue.cancel`; only the button moved, out of the card and
into the snackbar, because a second button appearing under the one just
pressed moved the next row out from under the thumb. Undo is offered in
exactly two shapes — cancelling a queued operation (D57), or an inverse write
where an exact one exists — and never as a compensating write dressed up as
one. Deleting a product is the deliberate asymmetry: it leaves the page and
the sentence travels in the snackbar, because a confirmation on top of a
record that no longer exists is the strangest option available.

**D102 — The edit screen is absorbed into the product, and D92 is narrowed
rather than reversed.** The owner's review: "para editar el producto en la
página de producto no tiene ningún sentido tener una pantalla aparte". It was
right. Correcting a typo meant leaving the record and losing everything else
it showed — the stock, the batches, the price history, the rating — and coming
back. Two screens for one row, and the second existed only because the first
refused to be edited. D92 said the edit screen should be its own inline form
rather than an extraction of the create form, and that still holds: the form
is used by one page and shared with nothing, and the create page keeps its
own. What changes is which page owns it. The route stays as a
`permanentRedirect`, because it has been linked for the life of the project
and a 404 is a worse answer than the page somebody wanted. D93 survives
untouched — a blank optional field still sends `null` and still means "remove
it". Editing is a mode with an explicit Guardar and Descartar rather than
fields that save as they are left: a catalogue row is read far more often than
it is changed, and a screen whose values are always inputs invites a change
nobody meant. Saving offers an inverse undo, which is legitimate here and
nowhere near stock (D57, D101): the previous values are still in hand, so undo
restores the row rather than writing a compensating anything.

**D103 — A list item is a product and a quantity, and free text is gone.**
SHOP-1 required exactly one of `productId` and `customName`; the owner's review
went further: "las listas de compra te dejan añadir cualquier artículo con
cualquier cantidad, existan o no, eso añade complejidad ya que si o si deberán
ir asociados". The argument holds. A free-text item cannot be priced, cannot be
counted against what is in the cupboard, cannot be matched to a receipt line,
and cannot be suppressed when it is already covered — and every one of those is
a feature this application has, each carrying a branch for the case where the
item names nothing. The kindness free text provided survives where it belongs:
the add form creates the product inline, so writing "sellos" on a list still
takes one step and leaves the household with something it can price next time.
Migrated expand → code → contract, with the middle step reusing an existing
product per household when the normalised names match and minting one otherwise,
carrying the original spelling as the product's name. `quantity` gained
`.positive()` in the same pass: it was a bare number with a default, so a line
asking you to buy zero was accepted and rendered as "0 L".

**D104 — The nine list rows are one component with three densities.** The
owner's review found the plainest possible symptom: "en cada pantalla se muestran
de una manera". Nine screens drew the same object nine ways — cards on inventory
and products, bordered boxes on the shopping detail, `divide-y` rows on prices
and the Panel, a whole-card `<Link>` on receipts, a full-width button on the shop
screen — and the drift was not only untidy, it hid defects. `ItemRow` is the
inventory card, which is the one the owner picked, with `density` for the tier
(Screen A is used with a trolley in one hand, Screen B is read from a metre away)
and `variant` for whether it is a card at all, because A5.4's "no cards except
where justified" is a decision the Panel and the kitchen already made. Sharing
the grammar is the point; forcing the chrome would have reversed a recorded
decision. Two defects surfaced that no screenshot would have shown: the title
guaranteed 48px of height and none of width, so a short name like "Lidl" was a
25×48 target at every tier; and the whole-row link made a row's accessible name
its entire contents. Both were invisible while nine implementations each got them
differently wrong. `Badge` absorbed seven separately-written pills whose tones
were reserved for state and then used for "auto-generated"; `Select`, `Textarea`,
`RadioOption`, `BackLink`, `Pagination`, `Dialog` and `FormErrorSummary` each came
out of the same question asked honestly — "why is this floor written here?" — and
`src/__tests__/unit/target-floor.test.ts` keeps the answer from drifting: 142
hardcoded target floors outside the design system became 13, each with a reason
that is checked for staleness as well as for presence (DESIGN_AUDIT A5.3, closed).

**D105 — The stepper's minus is a consumption, and the stepper is not a
correction tool.** §3 flow 3 says "add to stock — the ± stepper" and Journey 4
says "plus and minus adjust the quantity", which left minus's ledger meaning
open: it could have been `adjustStock` (a correction) or `consumeStock` (a
use). It is a consumption, because the stepper's presses are things that
happened — bought one, used one — and the ledger should say so; a correction
carries a reason precisely because nothing happened, and the reconcile dialog
and `/products/[id]/adjust` already own that vocabulary. Consequences taken
with it: plus books the purchase at the product's usual location (D96's
default, since a one-tap flow has nowhere to ask) while minus names none, like
the kitchen's "he usado uno"; the pair reuses the kitchen's exact undo shape
(D100's shared hold, now one exported `UNDO_HOLD_MS`, and D57's
never-a-compensating-write); and the value paragraph is deliberately **not** a
live region — the snackbar already announces each press as a sentence, and two
regions saying the same thing is the same thing said twice. The old unmounted
component's local count, hardcoded Spanish and hand-written CSS all went: the
value is the queue projection, the labels are catalogue keys, and the buttons
are the `Button` primitive so the 48px floor is inherited rather than
restated.

**D106 — A runner upgrade is measured before it is adopted, and measured
interleaved.** TEST-5's entry said a version pin was the workaround and that
there was nothing to pin forward to; bun 1.4.0 had shipped five days earlier, so
the obvious move was to bump `.bun-version` and hope. Two things stopped it.
First, measurement: 1.4.0 still reproduces the defect, so the bump fixes
nothing — and `.bun-version` governs strictly more than the Dockerfile pin does
(three CI jobs, the integration suite where TEST-5 lives, two quality scripts,
the browser suite's seed), so a change that buys nothing is not free. Second,
and worth more than the answer: **the first measurement was wrong in this
repository's own documented way.** Run one binary after the other it gave 2 in
24 against 11 in 24, which reads as a five-fold regression and is machine drift
— the same trap that once made the CI container look 100s slower until twin jobs
measured 400s against 405s. Alternated inside one continuous load the same pair
gave 10 in 40 against 14 in 40. The rule this settles: comparing two runtimes
means alternating them inside one load, and reporting the interval rather than
the point estimate — forty runs an arm can say 1.4.0 still reproduces and cannot
say whether its rate is worse. The version split itself went to `ISSUES.md` as
BUILD-1 rather than being resolved here, because the direction is a judgement
sitting next to an open decision in the image pre-plan, and choosing now could
be choosing twice.

**D107 — An unread queue is not an empty one.** The offline store starts empty
and `hydrate()` fills it in an effect, so for one paint "three changes are
waiting" and "nothing is waiting" were the same object — and `SyncStatus`
renders nothing for both, telling somebody with unsent work that everything is
saved. `hydrated` is set once whether or not the device had anything on it,
because "read it and it was empty" is a different claim from "have not read it"
and only the first licenses the reassurance. Surfaced as `data-sync` rather than
as a visible state: it lasts one effect, and a spinner would be worse than
silence. The browser suite had been reading the empty region as proof the queue
had drained, which is asking a question and taking silence for yes.

**D108 — A restored answer is shown, never trusted.** The read cache restores
each query with its original `dataUpdatedAt`, and the client's `staleTime` is 30
seconds, so a copy written moments ago comes back *fresh* and TanStack Query
declines to refetch it. Correct in general and wrong here: this cache exists so
a screen opened with no signal shows what was last seen, and it must never
become a reason not to ask when there *is* signal. It cost a shopping list that
rendered "Lista vacía" over two items the database actually held. The restore is
now followed by an invalidation — the cached answer still paints immediately,
mounted queries correct it, and offline the refetch simply pauses, which is the
whole point of having it.

**D109 — The root layout blocks, and the nonce is why.** Cache Components asks
every route to stream, cache or block. The root layout reads the locale and the
per-request CSP nonce, both driving things with no child to wrap in `<Suspense>`
— and while the locale could move to a pre-paint script, the nonce cannot,
because a nonce that survives prerendering is not a nonce. That is a security
posture against a navigation feel, so it went to the owner rather than being
settled by whoever was typing. Decision: keep the nonce, `instant = false` at
the root. Nine routes below still prerender. The comment beside the export is
written as the answer, so that nobody later reads a deliberate trade as
unfinished work.

**D110 — The device identifier is a cookie, and the landing is a redirect.**
§5.1 asks for the screen choice to be kept per `(userId, deviceId)` with the
device id "generated on first run and kept locally", and *locally* was read as
`localStorage` in every earlier sketch — which forced the whole feature into a
client island that reads storage after the first paint, lands somebody on one
screen and then moves them. A cookie arrives with the request, so `/` reads the
session, the cookie and one row and redirects before anything is drawn. Nobody
sees a screen they did not pick, not even for a frame.

Three consequences worth stating. It is minted in **middleware**, because that
is the only place that can both set a cookie and let the render that follows
read it — and the ordering inside that function is load-bearing, since writing
to `request.cookies` is what rewrites the header Next forwards to the render.
It is **`httpOnly`**: nothing on the client needs it, a value no script can read
is one no injected script can exfiltrate, and it keeps the id from becoming a
fingerprint a page could hand to somebody else. And `/start` is **three submit
buttons and a server action** rather than a component, because it is the first
screen somebody meets after signing in and a question that works before
hydration is a question that always works.
*Amended 2026-10-15:* not on every request any more. The proxy mints nothing
under `/api/auth/` and nothing for a request carrying `Authorization: Bearer`;
a valid id the client did send is still forwarded. Neither renders a screen,
and a just-minted id was never one a sign-in had recorded, so a first sign-in
is charged as before. A client that keeps cookies but never renders a page
loses something: its sign-in used to record the minted id, giving its later
ones a budget of their own, and now they stay on the shared account budget
(SECURITY.md, known devices). What the minted cookie did there was harm: Better
Auth reads any cookie as a browser and then demands an Origin a native client
never sends (the spike measured 403 `MISSING_OR_NULL_ORIGIN`), and URLSession
would store and replay a `Set-Cookie` on a bearer response. A browser renders
`/login` before it posts, so it has its id by then.

The enum offers all three screens rather than the two §5.1 names. `DESIGN_AUDIT`
A5.4 leaves "whether three entry points is the right number" explicitly open and
explicitly the owner's, so offering all three decides nothing that has not been
decided — and what people actually choose is the first evidence that question
has ever had.

**D111 — A persistent state is a live region, not a message that appears.** The
settings screen for the starting choice needed to confirm a write, and the first
attempt did the obvious thing: redirect back to the page with `?saved=1` and
render a sentence when the flag was there. It does not work — Next keeps the URL
when a server action redirects to the route it was called from, so the flag
never arrived. The failure mode is the one worth remembering: the write
succeeded every time, and only the sentence about it was missing, so the screen
looked broken while the feature worked.

What replaced it is not a workaround but the rule D101 already settled: a
persistent state belongs in a live region beside the control, and only an event
belongs in the snackbar. The page states which screen is current, permanently
and politely, and changing the choice changes that sentence — so the
confirmation *is* the state, there is nothing to time out, and a reader who
tabs back later hears the same answer as somebody looking at it. The action
revalidates rather than redirecting.

**D112 — A review that does not leave a test behind is an audit that decays.**
Phase 7 asked for "either a passing test or a written finding with an owner",
and the temptation with a security review is to produce a document and call the
phase closed. The document is the smaller half. What made this one worth doing
was noticing that the four defects were *one* defect: every instance was written
by copying a sibling that happened not to carry the ownership check, so the
convention was being followed — from the wrong example. A convention cannot
catch that and a code review only catches it once.

So the rule became `tenant-scoped-ids.test.ts`. Deliberately crude: it cannot
tell a correct check from a careless one, so it is a tripwire on the *shape* of
the mistake rather than a proof of isolation, and saying so in the file matters
more than the rule. Its two blind spots were found by removing real guards and
watching it stay green — it read only inline Zod, and its schema scan used the
`m` flag, where `$` means end of line, so every schema was truncated at its
first one. A guard with a silent blind spot is worse than no guard: it reports a
pass it has not earned.

The other half of the decision is what the review does *not* claim. Its
adversarial pass did not finish, so every finding it could not personally
reproduce is marked "reported" rather than folded in beside the verified ones.
A security document that launders unverified findings into conclusions is worth
less than no document, and the same is true in the other direction — `SECURITY.md`
was found to be *understating* its own posture in two sections, which would have
led an operator to conclude they could not rely on roles.

**D113 — Never compute a commit's own sha before amending it.** The Phase 7
ledger row cited `382bf9a`, which is a real git object and is on no branch: the
sha was read from `HEAD`, written into the file, and then the commit was amended
to include that file — which produced a different commit and orphaned the one
named. The row pointed at something a `git gc` will delete, in the file whose
entire job is to let somebody find the change later.

Nothing catches this. `check:links` validates internal links, not shas, and a
seven-character hex string looks equally plausible whether or not it resolves.
The rule is simply to record the sha in a *following* commit rather than in the
one being described, which costs one extra commit and cannot be got wrong. It is
the same shape as `74cff4b`/`e13c540`, where the code and its paperwork were two
commits on purpose.

**D114 — Sharp stays installed, as a cross-check, and "unreferenced" was the
wrong target.** The Bun migration plan's step 4 said sharp would become
unreferenced once the image tests stopped needing it. Doing the work showed the
goal was wrong. After the conversion it is imported by exactly two files —
`unit/jpeg-markers.test.ts` and `unit/exif-writer.test.ts` — and both exist *to
disagree with it*: one proves the hand-written JPEG marker readers give sharp's
answers, the other that the hand-written TIFF is something sharp can read back.

Removing it there is not a smaller dependency, it is deleting the only check
that this repository's hand-assembled binary formats are more than bytes it
believes in on its own authority. That is the same "stops testing while still
passing" failure the plan already warned about for the bomb fixture. So: sharp
stays in `devDependencies`, referenced nowhere else, costing 19 MB of
development install and nothing in production. The HEIC question becomes
independent of it — HEIC was the last reason sharp had to *ship*, which is a
different question from whether it is installed.

**D115 — The `middleware` → `proxy` rename was done by hand, and verified on a
served response rather than on a build.** Next 16 deprecates the filename and
offers `npx @next/codemod@canary middleware-to-proxy`. The change is one file,
one function name and eleven references; a canary codemod is a larger blast
radius than the edit it would make.

The verification is the part worth recording. **A build that finds the file is
not a proxy that runs.** Had Next not recognised it, nothing would have failed —
it would simply not have run, taking the per-request CSP nonce and the device
cookie with it, silently, with the deprecation warning gone and every gate
green. So it was checked on a served response: two requests to `/login`
returning different nonces, and `set-cookie: stoky_device=…` present.

**D116 — TEST-6 closed by fixing the tests, not by changing what runs where.**
Two inert mobile skips cited a phase that closed. Deleting them was the obvious
move and would have turned the suite red: run those eight tests at a phone
viewport and four fail. All four were the harness — `text=` and `a:has-text()`
locators matching the row's three action links and a hidden `aria-live` region,
eight elements, with `.first()` taking whichever the DOM ordered first.

The alternative was to add the file to the Mobile Safari project and let the
matrix grow. D33 scoped that project to the two layout specs deliberately, and
this does not overturn it: the locators are precise now (`getByRole` with
`exact`), the tests pass 8 of 8 on a phone, and they still run on chromium only.
What changed is that the scoping is a choice rather than a wall. The locator
fragility was latent on chromium too — it passed there by luck of DOM order
rather than by aiming at anything.

**D117 — A5.4 closed: how many entry points is the person's choice, not the
design's.** DESIGN_AUDIT A5.4's last open half was "whether three entry points
is the right number" — `/dashboard` beside `/shopping` and `/kitchen`. The
owner settled it on 2026-09-01: *the entry point should be user-configurable
from the main screens.* The decision needed no code, because that is exactly
what the per-device screen choice already does (Journey 8, §5.1). `landingPath`
(`src/lib/landing.ts`) sends a person to whatever `LandingScreen` they chose on
this device; `ScreenChoiceForm` offers all three at `/start` (asked once) and
`/settings/screen` (changeable); and the root `/` honours the choice. Nobody
lands on `/dashboard` unless they picked it, so it is not a third door imposed
on anyone — it is one of three the person may choose between. The question "two
doors or three?" dissolves: it is however many the person wants to be able to
land on, and they choose which. The Panel's own shape (its cards reduced to
pre-filtered sections over the three 2026-08-18/19/22 passes) is unchanged.

**D118 — ExpiringItems onto the design system, and no page of its own
(DEFERRED item 20).** The owner's direction on 2026-09-01: follow the same
design system as the rest of the app, and a dedicated page is not needed
because expiry is already shown on the pages that need it. Both halves matched
the ground truth. The component was the last pre-redesign holdout — hand-rolled
tinted `<li>` cards with SVG state icons and a restated `min-h-[48px]`, exempted
in `target-floor.test.ts` "while that screen's shape is decided." It is mounted
in exactly one place (`/inventory`); `/dashboard` and `/kitchen` render expiry
through their own design-system code already, which is why no page is warranted.
Rewritten to emit `ItemRow` + `Badge` the way the dashboard's expiry section
does — compact plain rows, a linked title, a tone-carrying badge, a
quantity + location meta list — so the state is a word rather than a colour or
an SVG (the icons-preview-the-action-not-the-state rule), and the 48px floor
comes from the primitive. The allowlist exemption is deleted, not moved: there
is no floor to exempt any more. The dashboard's own `ExpiryRow` helper stays as
it is; both now go through the one shared `ItemRow`, which is the sharing that
matters — a further extraction of the thin per-file wrapper was judged more
blast radius than the rule requires.


**D119 — Stock details need evidence (owner correction, 2026-09-12; INV-3).**
Supersedes the usual-location defaults in D96 and the earliest-expiry drawdown
assumption in INV-1. Recounting a product does not establish a new location or
expiry. Kitchen consumption now identifies the batch selected, and ambiguous
historic withdrawals leave batch quantities unknown. Product detail uses the
same remainder calculation as kitchen. Recounts carry their expected balance
and serialize with stock writes. Dozens are an exact factor of twelve, so the
migration and new writes use individual units; package sizes are not inferred.
The persisted read version changes with that basis. Queued list quantity edits
carry their unit; legacy edits lacking one are refused rather than reinterpreted.
The two-tap regression proves two rows and 36 → 34 eggs, including replay of an
already saved operation. No physical count or historical intent was guessed.

**D120 — The development image must run the checkout's own verification.**
The first-alpha preparation inspected the failed GitHub run rather than
assuming the documented Bun flake: seven failures came from missing Bash and
Git refusing the host-owned `/app` checkout. Bash belongs in the development
stage because bootstrap tests execute the actual shell script. Git trusts
exactly `/app` at system scope there because that is the intentional CI and
development mount; a wildcard would trust unrelated repositories too.
Production receives neither change. Existing behavioural tests caught both
defects and were watched to fail again with Bash removed or system Git config
disabled in disposable containers, then pass in the intact image (BUILD-2).

**D121 — Bun is the only application runtime, including install and migrations.**
The owner rejected the first-alpha image retaining Node 24. All Docker stages now
use the pinned Bun base, and build/Prisma commands select Bun explicitly. The
upstream `node` command is a symlink to Bun, verified by its resolved executable
and `process.versions.bun`; it is not a second JavaScript runtime. The old claim
that package lifecycle scripts required Node was disproven with a fresh locked
install plus Argon2, SWC, watcher and Sharp probes and a complete Next build.
The production migration CLI is staged from the same locked dependency tree,
replacing an independent npm resolution. UID/GID 1000 survives under username
`bun`, so existing upload volumes retain their ownership. New posture tests are
watched to fail with a Node base or a Node migration command restored.

**D122 — The alpha installs from a release bundle, with a reviewable publication.**
Following Immich's download/configure/start pattern, operators receive versioned
Compose, environment and Traefik files plus checksums. Deriving connection URLs
eliminates the old password/host mismatch. The third file is necessary: actual
Compose startup refused inline config in read-only Traefik. A file provider keeps
both the read-only boundary and the absence of Docker socket access. The project
name is distinct from development, while migration instructions require preserving
an existing deployment's volume identities. No repository/package visibility was
changed. Version tags run every gate, publish an exact image, smoke-test that
published digest with empty volumes and prepare a draft; reviewed alphas are
published as prereleases. `latest` remains the master development channel. The
first release records unsupported ARM/HEIC and outstanding human checks instead
of presenting alpha verification as stable-product support.

**D123 — Registration closes after the first account unless the operator opens it.**
The 2026-10-12 security review found `auth.register` open to anyone who could
reach an instance, with no switch, and an installation guide that told operators
to restrict access at a proxy the bundle gives them no way to configure. A
household never needed open sign-up: admins already add people through
`household.addMember`. `STOKY_REGISTRATION` is `open`, `first-user` or `closed`,
and **unset it is `first-user` in production** and `open` elsewhere — the
secure default where strangers can reach it, and no burden on the suites, which
register dozens of accounts (the browser suite sets `open` explicitly, because
it runs a production build). The alternative of an `open` application default
with `first-user` only in the bundle's `example.env` was rejected: an upgrading
operator keeps their old `.env`, so it would have protected nobody who already
had an instance. The cost is stated in INSTALL.md: on upgrade, an installation
that relied on strangers registering must set `open`. An unknown value is
`closed` and stops a production server, because a typo in a security setting
must not mean its least safe value. `first-user` counts accounts inside a
transaction holding an advisory lock, since a count followed by a create admits
two simultaneous claimants; the household became a nested write of the account
in the same transaction, which also ends the orphan households a failed
registration used to leave. *2026-10-15:* the household is now created first
and the account second, both on the same transaction and under the same lock,
because every account with a password is now made by
`src/lib/auth/credentials.ts`, which takes the household as a scalar id; a
failed account create still rolls the household back, so the no-orphan
guarantee holds (`registration.test.ts` goes red with the household created
outside the transaction). The claim window on a fresh install — whoever
registers first owns it — is accepted and documented rather than closed with a
setup token, which would be a bootstrap flow out of proportion for an alpha.

**D124 — A browser that has signed in before gets its own sign-in budget.**
The 2026-10-12 security review found that the per-account limit, which refuses
even the right password once full, let anyone who knew a member's address keep
them out by spending ten attempts every window from two addresses. Following
OWASP's device-cookie pattern, a `stoky_device` id recorded by a successful
sign-in to that account is counted on its own 5 per 15 minutes instead of the
shared 10. Trust is a server-side record, not the cookie: the id is
attacker-controlled, so an id nobody recorded — or one recorded for another
account — stays on the shared budget, and minting cookies buys nothing. A
Valkey sorted set (`rl:known:<account>`, fingerprints, newest twenty, a year)
was chosen over a signed token or a table: the id is already a 122-bit
`httpOnly` secret, so a lookup gives what a signature would without a key to
derive or rotate, and the limiter's store needs no migration. The set lives
outside `rl:login:` because a forged `X-Forwarded-For` could otherwise plant a
string there and make every sign-in to the account fail closed. "Count only
failures", the review's cheaper suggestion, was rejected: the attacker's
attempts are all failures, and a success already clears the counter. A success
on a known device clears only that device's counter, so the owner signing in
does not refill an attacker's budget. Accepted, not solved: a browser that has
never signed in to the account still shares the budget, because that is what
bounds a distributed guess; INSTALL.md gives operators the command that clears
an account's counter.

**D125 — A session ends thirty days after sign-in, however active.**
*Superseded by D135 (2026-10-15): sessions are database rows, a browser
session ends after fifteen idle minutes or a day from the sign-in, and signing
out deletes the row. The kitchen tablet's case this decision was sized for is
D141's remembered session: ninety idle days, a year at most, when the box at
sign-in is ticked.*
The 2026-10-12 security review found that the fifteen-minute `maxAge` is an
idle timeout and nothing else: with the JWT strategy Auth.js re-issues the
token, with a fresh `iat` and expiry, on every read of the session, so a
session in use — or a cookie copied off a device and read every few minutes —
never ended. Sign-in now stamps an `authTime` claim, which re-issue copies
forward untouched, and the `jwt` callback refuses a token more than thirty days
past it, before the revocation query. Thirty days is OWASP ASVS 4.0.3 V3.3.2's
Level 1 ceiling and the longest that fits the kitchen tablet; Level 2's twelve
hours would ask for the password every shift on a device whose point is to be
picked up. A constant rather than an environment variable, because nothing
about an installation makes another number right and every setting is one more
thing an operator must get right. A token without `authTime` predates the claim
and is refused rather than stamped: stamping would give a token stolen before
the upgrade a fresh thirty days, and the cost of refusing is one sign-in per
device, once. Per-session sign-out was not built with it: ending one token
needs an identifier in it and a denylist read on every page render, and a
denylist in Valkey either fails closed — every household signed out by a cache
outage — or fails open. SECURITY.md records it as a known gap, with "end all
sessions" as today's answer to a token that may have leaked.

**D126 — HSTS keeps `includeSubDomains` and drops `preload`.** The 2026-10-12
security review found both layers sending `preload` on whatever `DOMAIN` an
operator chose, which is a domain owner's consent to the browsers' built-in
lists, close to permanent, and given here by software rather than by the
owner. It is gone from Traefik and from the app; an operator who wants it adds
it at their own proxy. `includeSubDomains` stays, as ASVS 5 V3.4.1 asks, and
its cost on an apex domain is warned about in INSTALL.md rather than avoided
by weakening the header for everyone. SECURITY.md, *Release deployment*.

**D127 — `Referrer-Policy: same-origin`, not `no-referrer`.** The review found
every product page sending the instance's hostname to Open Food Facts with its
photograph. `same-origin` sends nothing to another origin. `no-referrer`, the
stricter answer, was rejected on a measurement: under it the Fetch standard
sends `Origin: null` on same-origin POSTs as well, Next aborts a Server Action
whose `Origin` does not match the host, and the no-JS screen choice failed its
e2e test; sign-out and the language switch are Server Actions too.
SECURITY.md, *Application headers*.

**D128 — Traefik without `sniStrict` or `curvePreferences`.** The TLS floor is
1.2 with forward-secret AEAD suites. `sniStrict` was left out because it
refuses the handshake for the configured name itself while ACME has not yet
issued, turning a pending certificate into an opaque failure and failing the
release smoke; the cost is that a client without SNI sees Traefik's default
certificate. `curvePreferences` was left out because replacing Go's list lost
the post-quantum hybrid `X25519MLKEM768`. SECURITY.md, *Release deployment*.

**D129 — Valkey evicts least-recently-used keys, never refuses.** The bundle
bounds Valkey at 160 MiB under its 256 MiB container. `noeviction`, the
default, refuses the limiter's `INCR` once full, and a refused count is a
refused sign-in; `volatile-ttl` evicts the soonest-expiring keys first, which
are the counters, so filling the cache would reset a lockout. `allkeys-lru`
keeps live counters, which every attempt touches, and drops cold product
cache entries; measured with 400 MB written against the bundle's own service.
SECURITY.md, *Rate limiting*.

**D130 — The bundle names every image by digest as well as tag.** PostgreSQL,
Valkey and Traefik by exact version and index digest; the application image by
digest in the packaged Compose file of each release; the Dockerfile's Bun base
likewise. A tag can be re-pushed and a digest cannot, so what a release was
smoked and scanned with is what `docker compose pull` fetches. The cost is that
upstream fixes arrive only through a change in this repository: a Stoky
release, or a Dependabot proposal once the owner lets Dependabot open branches.
SECURITY.md, *Container and runtime*, *Release deployment* and *Supply chain*.

**D131 — An anonymous tRPC request writes at most one refusal line.** The
final review of the security branch measured one anonymous GET batch of 100
calls writing 100 refusal lines, 13,100 bytes, to the security log; a few
thousand such requests would rotate a guessing run's `auth.signin.failed`
lines out of the bundle's 50 MB. The batch cap bounds the calls, not the
lines. Anonymous requests now write only their first refusal (a `WeakSet` of
the tRPC contexts, one per HTTP request), which still records that the request
happened, from where and for which procedure: measured at 1 line and 131
bytes for the same batch. A signed-in caller's refusals are each still
written, because they name an accountable account and each can be a different
row of somebody else's household. The cost, that an unauthenticated client can
still rotate the log by request volume, is accepted in SECURITY.md; shipping
logs off the host is the defence. "Write at most one refusal line per
anonymous tRPC request", on the security branch.

**D132 — The 2026-10-12 review names its commits by hash and subject.** The
first draft of its record named commits by subject alone, because the branch
is squash-merged and its hashes will not be on `master`. But a subject cannot
be checked by a command and a hash can, the pull request keeps the branch's
commits reachable after the squash, and the hashes are what the owner reads
while reviewing. So `docs/SECURITY_REVIEW.md` gives both. The hashes would
become dangling citations once the branch is deleted, and
`unit/ledger-shas.test.ts` would go red on every full clone, so they sit
between `branch-commits` markers. While the branch exists, the guard holds
them to a stricter rule than other citations: each must be one of that
branch's own commits. Once the branch is gone, the guard reports them as
unchecked. Outside a marked region, a ledger cites only commits that survive a
clone, and STATUS and this file name branch commits by subject. Per D113, the
commit that writes the record does not name itself.

**D133 — TEST-9 deferred, not fixed on the security branch.** The final review
found that nothing pins the people screen's refusal to offer a reset on the
caller's own row, and that `resetRefusalOf` would call the server's self-reset
refusal "too easy". The server refuses a self-reset and the screen offers
none, so nothing is exploitable or wrong today. Of the final review's 20
defects it is the only one that is purely a missing test of new behaviour, and
the branch was held for the other 19. It is filed with its two-part fix as
`ISSUES.md` TEST-9 and listed among SECURITY.md's accepted gaps until then.

**D134 — Passwords live in a credential Account row.** Better Auth, which
replaces next-auth later on the `feat/better-auth-2026-10-15` branch, reads a
password hash from the `Account` row whose `providerId` is `credential` and
whose `accountId` is the user's own id. The hash moved there, and
`User.passwordHash` was dropped, while next-auth was still the thing signing
people in. So the switch carries no data move, and this move can be checked
on its own: migration `20261015120000_credential_accounts` copies every hash
unchanged (Argon2id strings carry their own parameters), and
`integration/migration.credential-account.test.ts` migrates a database that
has accounts in it and signs them in with their old passwords.
`src/lib/auth/credentials.ts` stays the only code that reads or writes the
hash. `createCredentialUser` writes the user and its credential row in one
transaction, its own when handed the root client and the caller's otherwise.
`setPasswordAndEndSessions` keeps its guarded `User` write first, as the
guard and the row lock, and writes the hash only when that write matched.
`Account` cascades from `User`. That is a recorded exception to the schema's
rule that there are no cascades (the `ScreenChoice` comment): a credential
that outlived its account would be a password hash nobody can reach to
remove, ASVS 7.4.2 asks for an account's credentials to go with it, and
Better Auth's adapter never deletes these rows itself. The later auth tables
(sessions, verifications, second factors, passkeys) take the same exception
for the same reason. The migration is one way: returning to a release before
it needs the database dump taken before upgrading (`INSTALL.md`).

**D135 — Better Auth replaces next-auth; sessions live in the database.**
next-auth 5 was a beta whose credentials provider can only sign a JWT, so a
session could not be ended except by a line in time (`sessionsValidFrom`),
signing out left a copied token valid, and a second factor or a passkey would
have meant building them beside it. Better Auth 1.7.7 keeps a row per session,
and the swap moves no data: the hashes were already in its `Account` row
(D134). What it is configured to be, each part decided rather than defaulted:

- **Our policy wraps it, in our route.** `src/server/http/auth-handler.ts`,
  built like `trpc-handler.ts` with Better Auth's handler injected, answers
  five endpoints and 404s the rest (an allowlist, not `disabledPaths`, so an
  endpoint a later version adds is closed); bounds the body; refuses
  cross-site and non-JSON POSTs; rebuilds a sign-in body to the address, the
  password and `rememberMe: false`; charges `sign-in-policy.ts`'s budgets
  before the JSON is believed; and strips the token from every JSON answer.
  Better Auth's hooks were not used for the policy: there is no per-request
  state to carry a charge from a before-hook to an after-hook, and an injected
  handler is testable without a database.
- **Built lazily, never at import** (`getAuth()` in
  `src/lib/auth/instance.ts`), because `betterAuth()` starts its schema check
  when called and `next build` has no secret or database. It throws — and the
  route answers 503 and logs `auth.unavailable` — when production has no
  `NEXTAUTH_URL`, when `BETTER_AUTH_TRUSTED_ORIGINS` is set, or when
  `BETTER_AUTH_TELEMETRY` is on: each is an environment variable Better Auth
  obeys over its options. *D136 (2026-10-15) refuses the same at start-up.*
- **One key, named twice.** `NEXTAUTH_SECRET` is both `secret` and
  `secrets: [{version: 1}]`, so `BETTER_AUTH_SECRET(S)` and `AUTH_SECRET` are
  never read. Outside production, with none set, a per-process random key.
- **Every session is a browser session for now**: no `Max-Age` on the cookie,
  fifteen idle minutes on the row, a day from `authenticatedAt` at most
  (`session-policy.ts`). Only `auth.session`, which the keep-alive calls on
  real activity, slides it; reads never do, so background polling does not
  keep an unattended session alive. A database hook sets the expiry at
  creation and drops `expiresAt` from every update Better Auth makes. This
  replaces D125's thirty days, which fitted a token that could not be ended;
  a remembered session for the kitchen tablet is a later, separate decision
  (D141).
- **Revocation is deletion**, through one helper (`end-sessions.ts`), which
  refuses a filter with an undefined value because Prisma reads one as no
  condition. `auth.session.ended` replaces `auth.session.revoked`.
- **The cookie cache is off**, so a deleted row is refused on the next read;
  IP tracking is off; telemetry is off; Better Auth's limiter is off; its
  log is one line per message at level `error`, which leaves a refused
  sign-in to the security log alone.
- **`AppSession.sessionId` is required**, for the same reason as the
  helper's refusal.

Everybody signs in once after upgrading; passwords are kept. Nothing reads
`sessionsValidFrom` after the switch, and the next migration
(`20261015131000_drop_sessions_valid_from`) drops it, so rolling back needs
the pre-upgrade dump, as D134's move already did.

**D136 — The settings Better Auth would misread stop the server at start-up.**
D135 refused them only when the instance was first built, so the first
sign-in answered 503 while `/api/health` — which never builds it — reported
the instance healthy: the outage the secret guard was moved to start-up to
end (2026-10-06). `refuseToStartMisconfigured` now also exits on every
problem `authEnvironmentProblems` (`src/lib/auth/environment.ts`) finds:
production with no `NEXTAUTH_URL`, a `NEXTAUTH_URL` that is not a URL,
`BETTER_AUTH_TRUSTED_ORIGINS` set, `BETTER_AUTH_TELEMETRY` on. All of them in
one log, like the other refusals. Unlike the secret and the registration mode
these are refused in development too, because there the auth API refuses them
just the same. `getAuth()` keeps the same check, for anything that builds the
instance outside a Next server. The module imports nothing of Better Auth's,
so the start-up check loads none of it.

The variables an option already overrides are **ignored and said to be**: one
`[auth] warning:` line per variable set, naming what is read instead and never
the value — `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS` and `AUTH_SECRET`
(`NEXTAUTH_SECRET` is read), `BETTER_AUTH_URL` (`NEXTAUTH_URL` is). `AUTH_URL`
is warned about as well, beyond the plan: next-auth read it ahead of
`NEXTAUTH_URL`, so an install upgraded from next-auth that set only it would
otherwise stop at "`NEXTAUTH_URL` is not set" with no word about the line
that used to work. An empty value counts as unset, because Compose passes
`""` for `${X:-}`. A warning rather than a refusal because none of them can
change what the instance does (`unit/auth-secret.test.ts` reads back the key
it signs with); the line is for the operator who believes one is in use.
*D137 (2026-10-15) renames the key `STOKY_SECRET`, which these warnings now
name.*

The start-up warnings about a URL that is missing or not a URL are gone: the
refusal names them on its own line, and the warning said sign-in would answer
503 from a server that now never starts. Source deployments with no
`NEXTAUTH_URL` stop at boot from this release; the bundle has always set it.
Closes ISSUES AUTH-3. *D138 (2026-10-15) replaces the URL with the
`STOKY_URLS` list and widens these refusals to each of its entries.*

**D137 — Environment variables take the `STOKY_` prefix; `NEXTAUTH_SECRET` is
now `STOKY_SECRET`.** Owner's answer of 2026-10-15. `NEXTAUTH_*`, `AUTH_*` and
`BETTER_AUTH_*` are names libraries read on their own initiative, sometimes in
preference to the options they are given: `AUTH_SECRET` once signed every
session behind the guard's back (security review 2026-10-12, row 6), and
D136 exists because Better Auth obeys two of its own. A setting an operator
writes for Stoky should be read by Stoky alone, so its names carry `STOKY_`,
as `STOKY_REGISTRATION` and `STOKY_VERSION` already did.

The rule lives in one module, `src/lib/env-names.ts`: the new name is read
first; with it unset the old one is read and a `[config] … is deprecated`
line is logged; with both set the new one wins and the line says the old one
is ignored; an empty value is unset, because Compose passes `""` for an unset
`${X:-}`. The lines are written by `warnAboutRiskyConfiguration`, which runs
once from `register()`, so each is said once per process, in every
environment, and never with the value. The start-up guard, `/api/health`, the
account tag and the Better Auth instance all read the key through
`configuredSecret`, so none of them can disagree about which name won, and
every refusal names the variable the value came from. It returns the value
trimmed, so they cannot disagree about what it says either: the guard once
judged the raw line while the instance signed with the trimmed one, and the
published placeholder with a space after it started and signed with the
placeholder (review of 2026-10-16).

The bundle keeps existing installations signed in. `deploy/install.sh`
renames a non-empty `NEXTAUTH_SECRET` to `STOKY_SECRET` in `.env` in place,
keeping the value, unless `STOKY_SECRET` is already set: a generated value
beside the old one would sign everybody out and change every account tag in
the security log. The Compose file passes `STOKY_SECRET` and the legacy name
through with `${X:-}` instead of `${NEXTAUTH_SECRET:?}`, so an `.env` not yet
renamed starts with the warning; an operator who sets neither is refused by
the application, with a line naming `STOKY_SECRET`, instead of by Compose.

Why right after D136 and not before the swap: until D135 next-auth read
`NEXTAUTH_SECRET` and `AUTH_SECRET` itself, so "the new name wins" could not
have held. A separate change from the URL list (`STOKY_URLS`), which also
changes meaning: one URL becomes several. The old name stops being read in a
later release, not yet chosen. Historical records — closed ISSUES entries,
earlier decisions here, SECURITY_REVIEW rows, STATUS measurement history,
`docs/releases` — keep the names they were written with.

**D138 — `STOKY_URLS` lists every address; the first is canonical.** Owner's
answer of 2026-10-15; amends D84. `NEXTAUTH_URL` named one URL, and Better
Auth trusted its origin alone for a cookie-bearing sign-in, so a plain-HTTP
LAN install reached both as `http://stoky.lan:3000` and as
`http://192.168.1.10:3000` answered 403 `INVALID_ORIGIN` at whichever one it
did not name. `STOKY_URLS` is a comma-separated list of the URLs people type
(`src/lib/auth/public-url.ts`):

- **The first entry is canonical**: Better Auth's `baseURL`, the one thing
  that decides whether the session cookie is `Secure`, and later the passkey
  relying party. One cookie decision per instance, made once at build, never
  from a request's headers — the property D136 protects.
- **Every entry's origin is trusted** for the auth API. In production nothing
  else is: `DEV_ALLOWED_ORIGIN` adds its hosts outside production only.
- **Refused in production** (start-up, D136): no entry; an entry that is
  empty, not a URL, another scheme, or carrying a path, query, fragment or
  credentials (only an origin is compared, so anything more is a
  misunderstanding — next-auth once documented `NEXTAUTH_URL` ending in
  `/api/auth`); and an https first entry beside plain HTTP to another machine,
  where the browser drops the `Secure` cookie and sign-in loops. Loopback http
  beside it is accepted, since Chromium and Firefox keep a `Secure` cookie on
  localhost. Outside production these are warnings, except a first entry
  that is not an http(s) URL, which Better Auth cannot be built from.
- **Warned about in production**: each entry that is plain HTTP to another
  machine (D84 keeps those working, as before), and an https entry listed
  after a plain-HTTP first one, whose cookie is then not `Secure` either —
  beyond the plan, because the list is what made that configuration possible.
- **Messages name an entry by position and print only its origin**, never
  the text as written, which can hold a `user:password@`.

`NEXTAUTH_URL` is read through D137's rule, as a list of one. The bundle sets
`STOKY_URLS` to `https://${DOMAIN}` and nothing more, because Traefik routes
only `DOMAIN`: a second entry would be trusted for sign-in and never reach the
instance. Every listed origin can send a cookie-bearing sign-in, which is why
INSTALL says to list only addresses that reach this instance. Why after D137:
it reuses the rename helper, and since D135 no library reads `NEXTAUTH_URL`
or `AUTH_URL` itself.

**D139 — A sign-in ends the session its browser presented, and the account's
expired rows.** ASVS 5.0.0 7.2.4 asks that a new authentication terminate the
session it replaces. Better Auth issues a fresh token at every sign-in and
leaves the row the browser already had alive, so a person who signed in again
after the idle warning — or the next person on a shared kitchen tablet — left
a working session behind, reachable by any copy of the old cookie. The auth
route now reads the session the request presented *before* forwarding the
sign-in (`readSession`, without a refresh), and once Better Auth has let the
caller in — and only then, so a wrong password typed at somebody else's
tablet ends nothing — `tidyAfterSignIn` (`src/lib/auth/sign-in-tidy.ts`)
deletes, through `endSessions`, that session and the signing-in account's
expired rows, excluding the token just issued. The token is read from the
answer before the response guard strips it.

- **Whoever's it was.** The presented session is ended even when it belonged
  to another account: on a shared device that is the point. The log line
  (`auth.session.ended`, `reason: "replaced"`) names both: `userId` signed in,
  `targetUserId` held the replaced session.
- **Expired rows.** Better Auth deletes one only when its cookie is read
  again, and a closed browser never sends it, so they stayed until the
  account was deleted. They go at the account's next sign-in, from any
  browser; another account's are left alone. `count` on the line includes
  them.
- **The id clause is left out, not left empty,** when nothing was presented.
  The plan expected `{ id: undefined }` inside the `OR` to match every session
  on the instance. Measured against Prisma 6.19.3 it matches none: Prisma drops
  the `undefined`, and an `OR` holding `{}` selects nothing (`OR: [{}]` and
  `OR: [{ id: undefined }]` both counted 0 of 2 rows). The clause is still left
  out, because what an empty clause means is the client's choice and a filter
  that leans on it is one upgrade from ending everybody's session.
  `endSessions` checks only the top level, so `signInTidyFilter` is where it
  is guaranteed, and `unit/sign-in-tidy.test.ts` asserts it on the filter: the
  database cannot tell the two apart today.
- **The tidy never fails a sign-in.** It runs after the new session exists and
  its cookie is in the answer; an error is logged as one `[auth] error` line
  and the old session ends on its own clock (fifteen idle minutes, a day at
  most).
- **Called from the route, never from a session-create hook,** because Better
  Auth creates and then deletes a session at the password step of a two-step
  account. The two-step and passkey sign-ins (later commits) call the same
  helper; the session cap (a later commit) joins it there.

**D140 — Ten sessions per account; the eleventh sign-in ends the least
recently used.** ASVS 5.0.0 7.1.2 asks for a limit on concurrent sessions,
and there was none: every sign-in from a new browser added a row that lived
until it idled out. `MAX_SESSIONS_PER_ACCOUNT` (`src/lib/auth/session-policy.ts`)
is ten, the owner's number (2026-10-15), above what a household's phones,
laptops and kitchen screen add up to — so it bounds a leak, not ordinary use.
`capSessions` (`src/lib/auth/sign-in-tidy.ts`) lists the account's sessions
other than the one just issued, newest `updatedAt` first, skips nine, and ends
the rest through `endSessions`, logging `auth.session.ended` with `reason:
"evicted"` and the account as both `userId` and `targetUserId`.

- **Least recently used, by `updatedAt`.** Not `createdAt`: the phone signed
  in a week ago and used every day must outlive the laptop signed in on
  Tuesday and closed. `updatedAt` moves only when a row is written, and today
  that is the keep-alive's slide — at most every four minutes of activity,
  and only once more than a minute has passed — so it trails real use by
  about five minutes at most. No `lastSeen` column: a write per request is
  what D135 removed, and five minutes is far finer than the choice needs.
  *D141 adds the remembered session, whose `updatedAt` moves with Better
  Auth's daily refresh and so trails its use by up to a day.*
  Ties fall to `createdAt`, then the id, so the choice is deterministic.
- **After the tidy, in one transaction.** The tidy (D139) runs first, so a
  person signing in again in the same browser has already ended the session
  it presented and never costs another device its session. Both run inside a
  transaction that holds the account's `User` row `FOR UPDATE`
  (`$queryRaw`, a tagged template, so the id is bound). Measured over four
  runs with the lock removed: three sign-ins at once on top of nine still
  left ten, because every sign-in's row exists before its own cap reads the
  list and the last cap to read sees them all. The lock stays because two transactions deleting
  overlapping rows lock them in no promised order and Postgres resolves that
  by aborting one: a tidy that fails for no reason of its own. The log lines
  are written after the commit, so none describes a rolled-back delete.
- **From the route, never a session-create hook.** Better Auth creates and
  then deletes a session at the password step of a two-step account, so a
  hook would let a password alone end other sessions. The cap rides on every
  call of the tidy, which the two-step and passkey sign-ins will make too.
- **What it costs.** An account signed in on more than ten devices loses its
  least-used one at each new sign-in, the kitchen screen included if that is
  the one.

**D141 — "Mantener la sesión iniciada": a remembered session is ninety idle
days under a year, and the box starts unticked.** D135 made every session a
browser session — fifteen idle minutes, a day at most — and left the kitchen
tablet for a separate decision, because a screen whose point is to be picked
up cannot ask for a password at nearly every glance. The owner settled it on
2026-10-15: a box on the login form, unchecked by default, whose hint says to
tick it on home devices used every day, the kitchen screen included.

- **The numbers.** Ticked, the row is `persistent`, created ninety days out
  and slid back to ninety days by Better Auth's refresh, never past a year
  from `authenticatedAt` (`REMEMBERED_IDLE_S`, `REMEMBERED_CAP_S`,
  `src/lib/auth/session-policy.ts`). Ninety idle days ends a device left in a
  drawer; the year asks for the password again however the device is used.
  The cookie's `Max-Age` is the same ninety days, re-set at each slide.
- **Recorded on the row, not read from the cookie.** Better Auth's own signal
  is the `dont_remember` cookie, which is the browser's to keep or lose, and
  which it sets at an unticked sign-in and clears only at a sign-out or a
  read that finds the session gone — never at a ticked sign-in.
  `Session.persistent` is what every policy
  reads: the create hook sets it from the route's `x-stoky-remember` header
  (or, on a step the route does not rebuild, from no `dont_remember` and
  Better Auth's ninety-day proposal together), a re-create carries it over
  with `authenticatedAt`, and the update hook clamps a remembered row's slide
  to the year and drops a browser row's.
- **Exactly `true`.** Better Auth reads a missing `rememberMe` as true. The
  route passes `parsed.rememberMe === true`, so an old client, a typo or the
  string `"true"` is a browser session; and `x-stoky-remember` is deleted from
  every request it forwards before it sets its own.
- **A ticked sign-in clears `dont_remember`** from the request Better Auth
  reads and, once the password is accepted, from the browser, with the name
  asked of the instance because it carries `__Secure-` behind https. Without
  it a browser that once signed in unticked would keep Better Auth from ever
  sliding a remembered session there.
- **Slid at most daily, decided from `updatedAt`.** Better Auth decides from
  the expiry — "less than ninety days less a day ahead" — which the year's
  clamp holds still for the session's last three months, and would then
  write on every tRPC read. `readSession` reads without a refresh and asks
  again with one only for a remembered row last written a day or more ago:
  one extra read a day per remembered device. Renders never slide it, and
  `auth.session`, the keep-alive's call, only reads one: its browser formula
  would cut ninety days to fifteen minutes, and near the year write a time
  already past.
- **ASVS 5.0.0 7.1.1 and NIST SP 800-63B-4.** 7.1.1 asks for the timeouts to
  be documented with the justification for any deviation from SP 800-63B's
  re-authentication guidance. A password alone is AAL1, whose guidance is
  re-authentication at least every thirty days; a remembered session asks
  yearly. Accepted for the compensating controls — every session a row ended
  at once by signing out, by ending every session, by an admin or by a
  password change; ten per account (D140); the box off unless ticked — and
  written in SECURITY.md *Authentication*. A browser session meets AAL2's
  figures.
- **What it costs.** A remembered device's `updatedAt` trails its use by up
  to a day, so the ten-session cap's "least recently used" is that coarse
  between two remembered devices (D140). Kitchen tablets signed in before the
  upgrade are browser sessions and have to be signed in again with the box
  ticked (INSTALL); a forgotten KITCHEN password is reset by an admin from
  **Personas del hogar**.

**D142 — A native client signs in with a signed bearer token, and only a
cookie-less request is handed one.** The iOS app (`../stoky-ios`) cannot use
an `HttpOnly` cookie in any useful way and must not have to pretend to be a
browser, so Better Auth's bearer plugin is on: the token is the session
cookie's own signed value, carried in `Authorization: Bearer`, and Better Auth
reads it as that cookie on every endpoint and on tRPC's `getSession`. It is
the same row, so everything a session is — the tidy (D139), the ten-session
cap (D140), the remembered lifetime (D141), revocation by deleting the row —
applies unchanged.

- **Signed only** (`requireSignature: true`). Without it the plugin signs a
  bare token on the caller's behalf, and the `Session` table holds bare
  tokens: a read of the table, a backup or a log line with one, would be a
  credential. With it only the instance's HMAC opens a session, and a bad or
  forged signature reads as no session — 401 on tRPC, which the client treats
  as a sign-in to ask for.
- **The header is for clients without cookies.** The plugin copies the
  cookie's value into `set-auth-token`, and names it in
  `Access-Control-Expose-Headers`, on every answer that sets the cookie — a
  refresh included. Readable by a script, that would undo `HttpOnly`. The
  route drops both whenever the request carried a cookie, which a browser's
  always does here because rendering the login page gave it `stoky_device`;
  a native client keeps none. (The spike found this, and the proxy's injected
  `stoky_device` that made Better Auth demand an `Origin` from a client with
  no cookies; ISSUES AUTH-4.)
- **`rememberMe: true`, literally.** The route's coercion (D141) applies, so
  a native client must send the literal `true` to get the ninety-day row; any
  other value is a fifteen-minute browser session, which only `auth.session`
  slides.
- **Two-step verification on a native client is deferred** (owner,
  2026-10-15). Its second step is a cookie the browser carries between two
  requests; until the app has an equivalent, an account that turns two-step
  verification on signs in on the web only.
- **A password change or reset ends the bearer session** with every other —
  it is a row like the rest. The app then asks for the password.
- **What it costs.** Rotating `STOKY_SECRET` ends every native session along
  with the browsers'. The contract is written in SECURITY.md
  *Authentication*; ISSUES AUTH-4 and the 2026-10-12 review's #14 point
  there.

**D143 — A person lists their own sessions and ends one, every other or every
one, only after re-entering the current password; re-entering it does not
rotate the token.** ASVS 5.0.0 7.5.2 asks that a person can see their active
sessions and end any of them. `auth.revokeMySessions` could only end every
one, without a password, and nothing listed them. Now `auth.listSessions`
lists them and `auth.endSessions` ends them; **Tus dispositivos** at
`/settings/security` shows both, and `revokeMySessions` and its button are
gone.

- **What a session is shown as.** The browser and system its User-Agent
  names, coarsely and from a short list (`src/lib/auth/device-label.ts`) —
  never the string, which the client writes. What tells two Android tablets
  apart is the screen the device opens on: `Session.deviceId` (migration
  `20261015141000_session_device`) is the `stoky_device` cookie the sign-in
  carried, set by the create hook from the request on a sign-in and on a
  re-create alike, and joined to `ScreenChoice`, so the kitchen tablet reads
  as the kitchen screen. It is a cookie value: Better Auth is told never to
  return it (`returned: false`), and the list selects it only for the join.
  That same flag is why a re-create reads it from the request rather than
  from the prior session, as `authenticatedAt` and `persistent` are: the
  prior session reaches the hook as Better Auth answers clients, without it.
  Personal data, and listed in SECURITY.md's table.
- **The password every time.** A session somebody else holds must not end
  the owner's, nor the one it is about to be evicted from.
  `confirmCurrentPassword` (`src/lib/auth/reauth.ts`) is the one way any
  action re-asks for it, and later actions use it too.
- **Two budgets.** Per session (`reauthRateLimit`, five per fifteen minutes),
  so a thief guessing from a stolen session spends that session's budget and
  not the owner's — the owner, on their own session, can still end the
  thief's. Per account (`reauthAccountRateLimit`, twenty), so the ten
  sessions an account may hold (D140) are not ten budgets. A right answer
  refunds the per-session attempt to the window that counted it; the
  account's is never refunded. Both are counted before Argon2id.
- **Scoped in the filter, not after it.** `"one"` deletes by id *and* the
  caller's account id, so another account's id is `NOT_FOUND`, like an id
  nobody has. `"others"` keeps the asking session by its id; a context with
  no id is refused before the password is asked, and `endSessions` now also
  refuses a missing value one level down, because Prisma reads `{ id: { not:
  undefined } }` as no condition and "every other" would become "every one".
- **No token rotation — a deviation from ASVS 5.0.0 7.2.4**, accepted by the
  owner on 2026-10-15. 7.2.4 reads a re-authentication as an
  authentication, after which a new token is due. Here the password confirms
  one action and grants nothing beyond it — the session is not marked as
  freshly authenticated — and the call is tRPC, whose response headers are
  sent before a resolver could set a rotated cookie. Every later re-entry
  (two-step verification, passkeys, an admin removing a member's two-step
  verification) is the same and cites this decision.
- **What it costs.** A wrong password is `BAD_REQUEST`, logged as
  `auth.reauth.refused` with the action as `via`, because the refusal
  middleware does not record `BAD_REQUEST`. The per-session counter's key
  is the session id, which is not a credential.

**D144 — Changing your own password keeps this device signed in under a new
token and ends every other session.** Until now it ended every session, this
one's included, and the form signed the device out and purged its queue, its
saved reads and its cached shell — the person who just proved they hold the
password had to type the new one straight away, and lost any unsent changes
the form could not send first. ASVS 5.0.0 7.4.3 asks for the option to end
the other sessions after a credential change; the device that made the change
is not one of them.

- **Better Auth does the write.** Its `changePassword` with
  `revokeOtherSessions` sets the hash, deletes every session row and creates
  one for the request, whose cookie `nextCookies` puts on the tRPC answer.
  The create hook already carried `authenticatedAt` and `persistent` over on a
  re-create (D141) and reads the device from the request (D143); this is the
  first endpoint that re-creates, and the first test of it. So the day's
  limit still counts from the sign-in, and a remembered device stays
  remembered.
- **Our checks first.** The current password through `confirmCurrentPassword`
  — the D143 re-entry and its two budgets, replacing the password change's
  own per-account limit, which was one more budget a stolen session could
  spend — then the identity rule, so it answers only someone who knows the
  password. Better Auth checks the current password again (a second Argon2id
  run) and hashes the new one before it checks, which is why it is called
  only after both.
- **Not streamed.** tRPC's streaming batch link writes the answer's headers
  before any resolver finishes, so the new cookie never left and the device
  kept presenting the deleted token: measured, the e2e device was signed out
  by its own change. `auth.changePassword` goes by a plain `httpLink` through
  a `splitLink` (`src/lib/trpc/links.ts`); every other call still streams.
- **A read never expires the cookie.** Any request this device sent with the
  old cookie before the new one arrived — a batch in flight, the kitchen's
  five-minute refetch, another tab — is read after the old row went, and
  Better Auth's `get-session` answers that by expiring the session and
  `dont_remember` cookies, which `nextCookies` copies onto the tRPC answer.
  Arriving after the rotation's answer, it would expire the new cookie: the
  same sign-out as streaming, by a race. An after-hook of `stokyPolicy`
  takes those expiring lines out of every `get-session` answer; a dead
  cookie stays in the jar, refused on every read, until a sign-in replaces
  it, and only a sign-in, a rotation and a sign-out write the jar.
- **A request with no cookie keeps nothing.** A native client keeps no
  cookies, so a rotated session would be a row nobody can present and its
  bearer token would be the deleted one. It asks Better Auth for the hash
  alone and ends every session itself, its own included — what D142 says a
  password change does to a native session.
- **What it costs.** Better Auth's three writes are not one transaction, as
  `setPasswordAndEndSessions` was: a failure after the hash and before the
  delete leaves the new password beside sessions meant to end, and the form
  reports a failure although the hash is new. The sessions can be ended from
  **Tus dispositivos**. `household.resetMemberPassword` keeps the single
  transaction; it ends every session of somebody else, so nothing is
  re-created. The log line `auth.password.change.refused` is gone: a wrong
  password here is `auth.reauth.refused` with `via: "password-change"`.

**D145 — An admin lists a member's sessions and ends one or every one,
without re-entering a password.** ASVS 5.0.0 7.4.5 asks that an
administrator can end a user's sessions, individually or all at once.
`household.revokeMemberSessions` ended them all and nothing less, so the lost
kitchen tablet cost the member the phone in their pocket too, and it ended
the admin's own sessions with no password — a way round D143's question for
whoever held an admin's session.

- **Two procedures replace it.** `household.memberSessions` lists, with the
  member's own reading (`liveSessionsOf`, `src/lib/auth/session-list.ts`, now
  shared with `auth.listSessions`) so an admin is never shown more about
  somebody than they are shown about themselves: no token, no device id,
  no "this one". `household.endMemberSessions` ends one by id, or every one.
  Both are `adminProcedure`, so the capability count goes 67 → 68.
- **The guards of member management, in the same order for both.** The
  caller's own id is `BAD_REQUEST` (their own sessions are in **Tus
  dispositivos**, behind their password); `memberOfHousehold`, so another
  household's member is `NOT_FOUND`; `assertMayActOnOwner`, so only an
  owner lists or ends an owner's. Listing is guarded as ending is, because
  what an admin may not end they have no reason to see.
- **Scoped in the filter.** The delete names the member's id beside the
  session id — another account's session id is `NOT_FOUND` and ends nothing
  — and repeats the household and role that were checked, as
  `resetMemberPassword`'s write does, so a member who left or was made an
  owner between the check and the delete is not touched.
- **No password, and not asked twice.** The owner confirmed on 2026-10-15
  that an admin acting on somebody else is not re-asked; the household-wide
  ending planned for owners will be, because it includes the owner's own
  sessions. The inline "¿Cerrar todas las sesiones de…?" confirmation went
  with the old button: opening the dialog and pressing a button that names
  what it ends are already two acts, and nothing is destroyed.
- **The screen.** "Ver sus sesiones", absent from the admin's own row, opens
  a dialog titled with the member's name (`MemberSessionsDialog`): a compact
  `ItemRow` per session named as **Tus dispositivos** names it
  (`useSessionName`, extracted from `DeviceList`), **Cerrar esta** on each,
  and **Cerrar todas sus sesiones**. `FORBIDDEN` reads as
  `revokeFailedNotOwner`, `NOT_FOUND` as a session already ended. The list
  is dropped when the dialog closes (`gcTime: 0`). If it were kept, opening
  the dialog again within the client's 30-second `staleTime` would show the
  sessions "Cerrar todas" had just ended. The e2e test caught this.
- **What it costs.** Whoever holds an admin's session can sign the
  household's non-owners out without the admin's password. They sign
  straight back in — nothing about their password changes — so it is a
  nuisance rather than a takeover, and the owner's sessions and the admin's
  own are out of its reach.

**D146 — Removing somebody from the household signs them out everywhere.**
ASVS 5.0.0 7.4.2 asks that disabling or deleting an account ends its active
sessions. Removal is the nearest this application has to either: the account
stays (nothing in the application deletes one), but it no longer belongs to
the household. Until now it ended access to household data — every
`householdProcedure` re-reads the household — and nothing else, so a session
left alive on a device the household no longer controls, the kitchen tablet
or a phone, still reached the account itself: its password, its devices list,
a new household of its own.

- **In the same transaction as the removal.** `household.removeMember` calls
  `endSessions(tx, { userId })` inside `withOwnersLocked`, after the guards it
  already had. The household and the sessions go together or not at all, and
  a refused removal — another household's member, an admin on an owner, the
  last owner — ends nothing.
- **Every session, the remembered ones too.** A member removed is not
  "somebody whose phone was stolen" (D145, one or all): the household has
  decided they no longer belong, and every device they are signed in on is
  one the household may not control.
- **The account can sign in again**, to no household, which is what removal
  meant before: leaving a household is not ceasing to exist. An owner who
  removes themselves beside another owner is signed out too, this device
  included; they belong nowhere, and nothing about that needs a session.
- **Logged after the commit.** `auth.session.ended` with `reason:
  "removed"`, the admin as `userId`, the member as `targetUserId` and the
  count, written once the transaction has committed, so a refused or
  rolled-back removal writes no line.
- **Said before the fact.** The confirmation on **Personas del hogar** now
  reads "deja de pertenecer a este hogar y se cierran sus sesiones en todos
  sus dispositivos", replacing "pierde el acceso en su siguiente petición, sin
  necesidad de que cierre sesión", which the change made untrue.

**D147 — An owner ends every session in the household, their own included,
after re-entering their password.** ASVS 5.0.0 7.4.5 asks that an
administrator can end sessions, individually or all at once. D145 gives an
admin one member's, one or all; what it does not give is "everybody, now":
after a stranger has had a household account, or a device has gone missing
and nobody is sure whose, ending them member by member leaves the owners'
for last — an admin cannot reach them at all — and the owner's own never.

- **Owners only, decided inside the resolver.** `adminProcedure` lets an
  admin in, and `endHouseholdSessions` refuses anyone but an `OWNER` with
  `FORBIDDEN` before asking for the password: an admin may not end an
  owner's sessions one at a time (`assertMayActOnOwner`), so not all at
  once either. The capability matrix has no owner tier, and one procedure
  is no reason to add one; `capabilities.test.ts` says so beside the row.
- **The password, unlike D145.** This ends the owner's own sessions too, and
  a session somebody else is holding must not be able to sign the household
  out — the owner first, out of the very screen that would answer it. It is
  the same question D143 asks before a person ends their own, with the same
  two budgets. The owner confirmed on 2026-10-15 that this act is re-asked
  while an admin ending one member's is not.
- **Everybody, the caller included, with no exceptions.** No "but this
  device": the case it answers is one where the owner may not know which
  device is safe, and keeping the one asking would keep exactly the session
  a thief might be using. The screen then signs this device out the way
  **Cerrar todas** does (`useEndSession`), offering to send unsent changes
  first.
- **One filter.** `endSessions(db, { user: { householdId } })`: the
  household through each session's account, so nothing outside it is
  touched, and a member removed before has no household and is not
  included (removal ended their sessions already, D146).
- **One log line.** `auth.session.ended` with `reason: "owner"`, the owner as
  `userId`, the household and the count, and no `targetUserId`: it was
  everybody's, and a line per member would read as many acts.
- **Owners only on the screen too.** The section is absent for an admin, not
  disabled: nothing an admin could do on that page would enable it. A role
  that changes after the page is drawn is refused by the server and said in
  the dialog.

<!-- branch-commits spike/better-auth-2026-10-15 since f8090fe -->

**D148 — Two-step verification with an authenticator app, each code usable
once.** ASVS 5.0.0 6.5.1 asks that a time-based code be accepted once.
Better Auth's two-factor plugin accepts any code inside its window as often
as it is sent — the spike (`1c8156b`) signed in twice with one code — and
stores nothing that would say a code was used (ISSUES AUTH-5).

<!-- /branch-commits -->

- **The plugin, behind the route's allowlist.** `twoFactor({ issuer: "Stoky"
  })` in `src/lib/auth/instance.ts`, with its defaults: 30-second steps, six
  digits, a ten-minute challenge, five wrong codes per challenge and ten in a
  row per account before a fifteen-minute lock. Only the sign-in's second
  step is answered over HTTP in this commit: enrolment, disabling and
  backup-code generation open with the settings screen, after backup codes
  are stored as hashes, so no release between the two has weak codes to
  give. `/two-factor/get-totp-uri` is never opened: it returns the decrypted
  secret to whoever holds the session.
- **Single use is a column of ours, claimed in the statement that checks
  it.** A before-hook (`src/lib/auth/policy-plugin.ts`, `stokyPolicy`) finds
  whose code it is as Better Auth will — the session, else the signed
  `two_factor` cookie's challenge — decrypts the secret, compares the code
  against the three steps Better Auth accepts in constant time, and runs
  `UPDATE "TwoFactor" SET "lastTotpCounter" = step WHERE id = … AND
  ("lastTotpCounter" IS NULL OR "lastTotpCounter" < step)`. Zero rows is a
  replay, refused `INVALID_CODE`. A read and then a write would let two
  requests with one code both read the old step;
  `integration/two-factor.test.ts` holds the row locked while two requests
  reach the claim and that version lets both in. Monotonic rather than a set
  of used steps: an earlier step's code after a later one is refused too,
  which costs a person nothing.
- **A code matching no step is made a certain failure, not passed on.** The
  hook and Better Auth read the clock separately; a request straddling a
  step boundary would otherwise be checked by Better Auth against a window
  the hook never claimed in. Rewriting the code to `stoky-no-match`, which
  no step produces, keeps Better Auth's own counting — refusing in the hook
  would skip both its per-challenge limit and its account lockout.
- **±1 step stays** (ASVS 5.0.0 6.5.5 deviation, accepted by the owner on
  2026-10-15): Better Auth's window, kept for phones whose clocks drift.
- **An unreadable secret is its own answer.** `STOKY_SECRET` encrypts the
  secret; after a rotation it no longer decrypts. The hook answers
  `TWO_FACTOR_UNREADABLE` before Better Auth counts an attempt — no number of
  attempts would succeed, and a lockout would be a second wrong answer — and
  logs `auth.twofactor.unreadable`. Better Auth's versioned secrets are not
  adopted (the owner's "only if trivial", which it is not: a second variable
  of retired values, version numbers kept by hand); SECURITY.md *Secrets*
  and INSTALL list what a rotation costs.
- **Budgets.** The password step is where the account budget is settled: a
  right password is not the guess that budget counts, so at
  `twoFactorRedirect` the route clears the account or device counter and
  refunds the address (`signInChallenged`), without `rememberDevice`. The
  code step names no account, so it is charged per address only
  (`chargeSignInAddress`); Better Auth counts wrong codes per challenge and
  per account. Its lock is answered 429 `ACCOUNT_TEMPORARILY_LOCKED` with no
  `Retry-After`, so an after-hook of `stokyPolicy` adds one, the seconds
  left until the row's `lockedUntil` (fifteen minutes when it cannot be
  read). Those limits alone do not bound a guesser who has the password:
  the lock forgets its count when it ends and each new challenge is free,
  so ten codes a quarter of an hour, about 960 a day, for ever. Every code of
  a sign-in is therefore charged first to its account's budget for the day
  (`twoFactorCodeRateLimit`, twenty a day; a right code given back, nothing
  else, a right password included, clearing it) and refused 429
  `TOO_MANY_WRONG_CODES` once that is spent, the right code too, until the
  window ends; recovery codes are not counted. About 2% a year for a
  guesser, against an owner kept to recovery codes for the rest of a day.
  It is a sign-in only when it carried the challenge cookie,
  presented no session, and was answered with a session cookie; then the
  address is refunded, the browser remembered, and the account tidied and
  capped (D139, D140) — never from a session hook, as D140 says.
- **The presented session ends at the password step.** Better Auth expires
  its cookie in the answer that asks for the code, so on a shared tablet the
  previous person's row would otherwise outlive every browser holding it.
  Ended then, not when the code arrives, because the code may never come.
- **A challenge goes where the account's sessions go.** Whoever holds one
  has the password. `endSessions` deletes the challenges (`2fa-…` rows whose
  value is the account, and their attempt counters) of every account its
  filter names or whose session it matched, so a password reset, a
  removal, an owner's household-wide end and a person's own end all take
  them. The sign-in tidy and the cap pass `challenges: false`: an expired row
  going is no reason to stop the same person signing in on another device.
  Better Auth's password change deletes sessions with its own adapter, so
  `auth.changePassword` deletes the challenges itself.
- **The route passes on `code` alone.** `trustDevice` would set a cookie that
  skips the code on that browser for a month; `disableSession` spends a
  backup code without a session to show for it.
- **The schema departs from Better Auth's optional columns.** `userId` is
  unique, so the hook and Better Auth always read the same row; `verified`,
  `failedVerificationCount` and `twoFactorEnabled` are `NOT NULL` with
  defaults, because a null counter plus one is still null and the lockout
  would never fire. Cascades from `User`, the auth tables' exception (D134).
- **Coupled to 1.7.7's internals**: `secretConfig`, the `two_factor` cookie
  and the challenge row it names, how a before-hook's returned body is
  merged, and the `2fa-` identifier prefix. The version is pinned exactly
  and `integration/two-factor.test.ts` goes red if any of them moves.

**D149 — Backup codes of 120 bits, stored as hashes.** ASVS 5.0.0 6.5.2 asks
that lookup secrets be stored hashed, with a plain hash allowed only at 112
bits of entropy or more. Better Auth's are ten codes of ten characters from
62 (about 60 bits) kept encrypted with `STOKY_SECRET`: the database and the
secret together read every code back, and a rotation of the secret makes
them unreadable on exactly the day a person needs one, because the same
rotation has just made their authenticator unreadable (ISSUES AUTH-6).

- **Ten codes of 24 Crockford base32 characters**, 120 bits each, shown as
  six groups of four (`src/lib/auth/backup-codes.ts`). One random byte per
  character, its low five bits picking it: 256 is a multiple of 32, so no
  character is likelier than another. Crockford because the codes are
  copied onto paper and typed back: no I, L, O or U, and a code is read
  upper-cased, without spaces or dashes, O as 0 and I or L as 1.
- **Stored as `sha256:<hex>` of that normalised form**, through Better
  Auth's custom `storeBackupCodes`. Its `encrypt` is idempotent — it hashes
  only what is not already a hash — because Better Auth calls it twice: on
  the new plain codes at enrolment or regeneration, and on the list of
  remaining hashes after spending one. Its `decrypt` returns the stored
  list as it is.
- **The typed code is hashed before Better Auth compares it**, by a
  before-hook in the policy plugin, always, whatever was typed: a stored
  hash sent as a code is hashed again and matches nothing, so a read of the
  column is not a way in. Better Auth still does the rest — `includes` over
  the list, the list written back without the code conditionally on the one
  it read, so two requests cannot spend one code twice, and its own counting
  of wrong codes towards the challenge's five and the account's lockout.
- **A plain hash, not Argon2id.** At 120 bits nobody enumerates the code
  space, and the password's Argon2id (about 250 ms a hash) would cost some
  2.5 s for the ten at enrolment and, being salted, up to ten verifications
  for every code typed, for nothing ASVS asks. The comparison is `includes` over digests, not constant
  time; what it could leak is how much of a digest an attacker's guess
  shares, which says nothing about a code.
- **They survive a rotation.** No secret goes into them, so after
  `STOKY_SECRET` changes a backup code is the way back in, and turning
  two-step verification off and on again (which needs only the password)
  replaces the unreadable secret. INSTALL and SECURITY.md *Secrets* say so.
- **No release hands out the old kind.** The enrolment and regeneration
  endpoints were never opened with Better Auth's codes (D148). Rows written
  by development databases before this commit hold encrypted lists, which
  `decrypt` does not parse as a list: such a code is refused and counted,
  and the person regenerates.
- **Coupled to 1.7.7**: `customBackupCodesGenerate` and the object form of
  `storeBackupCodes`, `includes` plus the compare-and-set write, and how a
  before-hook's returned body is merged. `integration/two-factor.test.ts`
  goes red if any of them changes.

**D150 — A household admin removes a member's two-step verification, after
the admin's own password.** A member who loses the phone with their
authenticator and has no backup code left could not sign in again; the only
way back was the operator's SQL in INSTALL, which most households cannot
run and none should need for a lost phone. The owner decided on 2026-10-15
that a household admin can do it, re-entering their own password, logged,
ending all of the member's sessions (`household.removeMemberTwoFactor`).

- **Not yourself.** The caller's own id is `BAD_REQUEST`, owners included:
  your own is turned off from *Seguridad y acceso* with your password, and
  an admin session that could skip that would be the way round it.
- **The admin's password, first.** It weakens somebody else's account to a
  password alone, so a session somebody else holds must not be able to —
  unlike ending a member's sessions (D145), which the owner decided is not
  re-asked. Asked before the member is looked up, so without it a stolen
  session cannot tell `NOT_FOUND` from `FORBIDDEN` and learn which ids are
  whose. The D143 budgets and `via: "member-two-factor"`; no token
  rotation, as for every re-entry (D143's 7.2.4 deviation).
- **The member guards of the rest of member management**: this household's
  (`memberOfHousehold`), and only an owner on an owner
  (`assertMayActOnOwner`), so an owner's can be removed only by another
  owner. A sole owner with no backup code keeps the operator's runbook.
- **One transaction, its write repeating the guards.** `updateMany` clears
  `twoFactorEnabled` only where the household, the role that was checked
  and `twoFactorEnabled: true` still hold; a count of zero is `CONFLICT` —
  the member changed, or never had it — and rolls back, so nothing is
  deleted and no session ends. Then the `TwoFactor` row (the secret and the
  backup codes) and `endSessions(tx, { userId })`, which also deletes the
  member's challenges in progress (D148): whoever has the lost phone may be
  signed in on it, or halfway through a sign-in with it. The household in
  that guard is for a member leaving between the check and the write; no
  test can make that happen without a race, which is why it is the same
  guard `resetMemberPassword` has.
- **Two log lines**, after the commit: `auth.twofactor.removed` and
  `auth.session.ended` with `reason: "two-factor-removed"` and the count,
  the admin as `userId` and the member as `targetUserId`. Neither carries a
  code, a secret or an email address; the client address is in, as on
  every line.
- **Passkeys will be left alone.** None exist yet; when they do they are
  another way in, with their own removal, and losing the phone with an
  authenticator says nothing about a passkey on a laptop. Whether removing
  one should remove the other is left to the owner.
- **The screen** offers it only where it can succeed: rows that have it,
  not the caller's own, not an owner's to an admin. Each row says in words
  whether it is on. *Seguridad y acceso*'s explanation, once it is on,
  names the admin as the way back after the backup codes.
- **The risk accepted**: a compromised admin session together with that
  admin's password can strip a non-owner's second step. That is the trust
  `resetMemberPassword` already grants — the admin can set the very password
  this leaves standing alone — and the log records who did it to whom.

**D151 — Passkeys, on the server: user verification required, a step-up
before adding or removing one, the remember-me box honoured, bound to the
first `STOKY_URLS` address, and only where WebAuthn can work.**
`@better-auth/passkey` 1.7.7, exact, with `@simplewebauthn/server` 13.3.3
under it; the plugin resolves its own zod 4.6.6, as Better Auth's core
does, beside the application's zod 3, and `bun audit` is clean. Every
role may have them, the kitchen's shared account included (the owner's
decision of 2026-10-15). The settings screen (the next commit) and the login
page's offer (the one after) are what make them usable.

- **One relying party: the first `STOKY_URLS` entry** (D138). Its hostname
  is the `rpID`, its origin the one `origin` a ceremony is accepted from.
  Not the list: `@simplewebauthn/server` accepts any of several origins, and
  a signature made for one listed address would then pass at another.
  So a passkey works at the first address only; the others sign in with the
  password, and **changing the first entry orphans every passkey** — people
  sign in with the password and add a new one (SECURITY.md, INSTALL).
- **Only where WebAuthn can work** (`src/lib/auth/passkeys.ts`): the first
  entry https, or http at `localhost`, and never an IP literal, since a
  relying party id must be a domain name. Elsewhere the plugin is not
  registered and its paths answer 404 like any other; a plain-HTTP LAN
  install has no passkeys. `passkeyOfferedAt(host)` — the request came to the
  canonical host and port — is what the login page asks before offering
  one (the commit "feat(auth): offer passkey sign-in on the login page",
  after `await connection()`, with the page out of the shell).
- **User verification is required, and checked.** Registration asks for it
  as `required`; both ceremonies refuse an answer without the UV flag
  (`USER_VERIFICATION_REQUIRED`), in Better Auth's `afterVerification`,
  after the signature and before anything is written. Better Auth asks only
  for "preferred" at sign-in and checks nothing (`requireUserVerification:
  false`), so a security key without a PIN would be one factor. With UV a
  passkey is two, which is why a passkey sign-in is not asked for an
  authenticator code (Better Auth's two-factor hook does not run on it).
- **A step-up before adding or removing one** (ASVS 5.0.0 7.5.1). Better
  Auth's endpoints take a session and a ceremony, never a password, and
  `freshAge` is 0 (its freshness check counts from the row's creation, which
  a re-create resets and a remembered row's age defeats). So the settings
  page calls `auth.confirmPassword` first — `confirmCurrentPassword`, the
  D143 budgets, `via: "step-up"` — which writes a `Verification` row
  `stoky-step-up:<session id>`, value the account, five minutes
  (`src/lib/auth/step-up.ts`). The policy plugin requires it before the
  registration options, and spends it at the registration and the removal,
  in the `deleteMany` that checks it, so of two requests one passes. Bound to
  the session: the same account's tablet cannot spend the phone's.
  `403 STEP_UP_REQUIRED` otherwise. `endSessions` deletes the step-ups of
  the sessions it ends; one whose session Better Auth deleted itself is
  usable by nobody, since the check reads that session, and lapses. Renaming
  and listing need the session alone. No token rotation (D143's 7.2.4
  deviation).
- **A registration never signs anybody in**: the route forwards `response`
  and `name` only, and the plugin forces `createSession` to `false` — false,
  not removed, because a before-hook's body is merged with `defu`, which
  keeps the caller's value for a key left `undefined`.
- **A passkey sign-in is a sign-in** (`passkeySignIn` in the route): charged
  per address against sign-in's budget and refunded when it gets in, the
  device remembered for the account, the presented session ended and the
  account tidied with the ten-session cap (D139, D140), and
  `auth.signin.succeeded` with `method: "passkey"`. A refusal is
  `auth.passkey.signin-failed` with Better Auth's code and stays counted.
- **The remember-me box** (D141): `rememberMe === true` only, said in
  `x-stoky-remember` for the create hook, `dont_remember` stripped and
  expired for a ticked box — the password sign-in's code, now one helper
  (`rememberChoice`). Better Auth's passkey endpoint sets the session cookie
  with ninety days' `Max-Age` whatever was asked, so for an unticked box the
  policy plugin's after-hook sets it again with `setSessionCookie(ctx, s,
  true)` — no `Max-Age`, plus `dont_remember` — and first removes the earlier
  `Set-Cookie` for it. **Measured: Better Auth does not deduplicate**; without
  the removal the answer carried two session cookies, the first with
  ninety days (the test pins exactly one).
- **The options have a budget of their own**, a deviation from the plan,
  which charged them to sign-in's: `passkeyOptionsRateLimit`, thirty a
  quarter of an hour per address (`RATE_LIMIT_PASSKEY_OPTIONS_*`). They are
  not a guess, but each writes a challenge row, so they are metered; and
  nothing ties them to the sign-in that follows, so they could not be given
  back — every passkey sign-in would have spent one of the address's five
  for good, and a household behind one address would lock itself out,
  passwords included, after five passkey sign-ins a quarter of an hour.
- **Logged**: `auth.passkey.added` and `auth.passkey.removed` with whose it
  was, never the credential, its public key or the signature. The `Passkey`
  table (public key, credential id, counter, AAGUID, name) cascades from
  `User` (D134) and is not in the JSON export.
- **Rotating `STOKY_SECRET` leaves passkeys working**: nothing about them is
  encrypted with it.
- **Removing a member's two-step verification (D150) leaves their passkeys
  alone**, as D150 said; the owner's follow-up question stands.
- **Not done here**: `next.config.ts` still denied
  `publickey-credentials-create`, which blocks registration in a browser;
  the settings screen that first calls it lifted it (the next commit, "feat(auth):
  manage passkeys in settings", which also grants `publickey-credentials-get`
  as `(self)` and shows the list, adding, renaming and removal, with the
  reason wherever adding cannot work).

**D152 — The names from before the `STOKY_` rename are no longer read
(the owner's decision of 2026-10-25: a 0.x release keeps no compatibility).**
`NEXTAUTH_SECRET` and `NEXTAUTH_URL` (D137, D138) were read when their new
names were unset, with a `[config]` warning, and `deploy/install.sh` renamed
the secret's line in place. All of that is gone: `src/lib/env-names.ts`,
the warnings, the rename in `install.sh`, and the `NEXTAUTH_SECRET` line in
the bundle's Compose file. An `.env` that still has only the old name refuses
to start with `STOKY_SECRET is not set` (or `STOKY_URLS is not set` outside
the bundle), which names the line to write; renaming the key and keeping its
value keeps every session and account tag. v0.1.0-alpha.4's `install.sh`
already renamed it, so an installation upgraded through that release has
nothing to do. The next release's notes must say so under *Cómo actualizar*
(`docs/RELEASING.md`), since the commit is marked `!`.
