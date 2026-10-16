# Security review — Phase 7

Reviewed: 2026-08-26, at `8bb2547`. Reviewed again 2026-10-12, at `e9d62eb`:
[*The 2026-10-12 review*](#the-2026-10-12-review), near the end, records that
review, what became of each finding, and what it accepted. The move from
next-auth to Better Auth on 2026-10-15 is recorded after it, in
[*The Better Auth migration*](#the-better-auth-migration-2026-10-15).

Phase 7's deliverable (`REDESIGN_PLAN.md` §9). Its *done when* is that each of
the eight scope items has **either a passing test or a written finding with an
owner**, and that `SECURITY.md`'s known gaps reflect reality rather than intent.

---

## How to read this, and what it is worth

**Two categories, kept apart on purpose.**

- **Verified** — reproduced or refuted by running something, by the author of
  this document. Where a defect is marked verified and fixed, there is a test
  that was watched to fail before the fix existed.
- **Reported** — surfaced by an audit pass over the code and *not* independently
  confirmed here. Treat these as leads, not conclusions. Several will be real;
  at least one in this review turned out not to be.

The distinction is the honest part. This review was produced with eight parallel
audits, and the adversarial pass that was meant to check every claim did not
finish. Rather than launder unverified findings into a security document, the
ones that were not personally checked say so.

**What this review is not.** It is not a penetration test, and no part of it was
run against a deployed instance. It reads code, runs the test suites, and drives
the router directly as callers of the wrong household or role. The three human
passes `REDESIGN_PLAN.md` §10 still owes are not security passes and do not
substitute for one.

**The most useful output was not a list.** It was a *class*: four instances of
one mistake, described in §2, and a test that now fails on the shape of it.

---

## The findings, by severity

| # | Finding | Severity | State | Owner |
|---|---|---|---|---|
| 1 | `receipt.confirmAll` rewrote another household's receipt lines | High | ✅ Fixed `26ca43a`, verified | — |
| 2 | Both confirm procedures wrote an unverified `productId` | High | ✅ Fixed `26ca43a`, verified | — |
| 3 | Three of four stock procedures wrote an unverified `locationId` | Medium | ✅ Fixed `e7e1b0f`, verified | — |
| 4 | `receipt.upload` wrote an unverified `storeId` | Medium | ✅ Fixed `b1ecbdd`, verified | — |
| 5 | CVE-2026-14456 (OpenSSL) shipped in the image | High | ✅ Fixed `ccde2e1`, verified | — |
| 6 | `SECURITY.md` states two things about itself that are false | Medium | ✅ Corrected below, verified | — |
| 7 | Half the restricted procedures have no behavioural refusal test | Medium | ✅ Verified (21 of 28), closed `bc88635` `6ef3fda` | — |
| 8 | No server-side session revocation | High | ✅ **Closed.** `sessionsValidFrom` on `User`, enforced in the `jwt` callback where re-issue happens rather than beside the role check; both halves built — an admin ends a member's sessions from `/settings/people`, an account ends its own from `/settings` | — |
| 9 | The per-IP rate-limit key is attacker-controlled without a sanitising proxy | High | ✅ Verified, documented; the remedy is a decision | operator + owner |
| 10 | The registration rate limit is exercised by no test | High | ✅ Closed `33bdc14` | — |
| 11 | Fail-closed is unproven at every limiter call site | High | ✅ Closed `7a663a1` | — |
| 12 | Nothing asserts a security header reaches a response | High | ✅ Closed `4c6fb90` | — |
| 13 | The upload size cap is applied after the body is in memory | High | ✅ Verified, corrected `74788ab` | — |
| 14 | The size cap counts bytes; decoding cost is in pixels | High | ✅ Fixed `69c1bd5`, verified | — |
| 15 | No test ever performs a *successful* upload | Medium | ✅ Verified, refined, closed `5d49d99` `76f5c80` | — |
| 16 | Uploaded images are never deleted | Medium | Reported | owner |
| 17 | A published image is never re-scanned | Medium | ✅ Closed 2026-10-12: weekly `rescan.yml`; its first run on GitHub is an owner action of the 2026-10-12 review | — |
| 18 | The request-body ceiling sat below the documented upload limit | Medium | ✅ Fixed `74788ab`, verified | — |

Finding 18 was not on the list this review set out with. It came out of
measuring finding 13 instead of reading it, and it is the only entry here that
is a broken feature rather than a weak control — a 10 MB photograph could not
be uploaded, and the size check meant to refuse an 11 MB one was unreachable.
It is kept in this table because of where it was hiding: a framework default,
below the last line of code anybody in this repository had written.

Nothing here is rated critical. Two findings were reported as critical by an
audit and are recorded above at high: they are the same defect as #1 and #2,
counted twice.

---

## 1. Authorisation, per procedure

**Verified, and this half is genuinely solid.** There are **60 procedures**
across ten routers — at `8bb2547`; **63 since 2026-08-31** (corrected
2026-10-12: member management and session revocation added four, the dead
pipeline pair took two away, `product.resolveScan` added one). `SECURITY.md`
carries the current count, which `capabilities.test.ts` now holds to the
router. `src/__tests__/unit/capabilities.test.ts` pins every one of
them against `REDESIGN_PLAN.md` §5.2's matrix by declaration, exhaustively with
`toEqual` rather than by sampling, and it fails on a router file with no table
entry. Roles are re-read from the database on every call
(`src/server/trpc/trpc.ts:180`) rather than trusted from the JWT, so a demotion
takes effect on the next request. Two procedures are *stricter* than the matrix
requires — `product.delete` and `data.exportHousehold` are admin — which is the
safe direction.

The integration suite calls the router directly as the wrong role and asserts
that a refusal writes no row, which is what makes this a control rather than a
hidden button.

**But tier is only half of authorisation, and the other half is where this
review found everything.** The matrix answers *may this role do this?*. It says
nothing about *may this caller touch this row?*. That is per-resolver, and it
was not uniform. See §2.

~~**Reported, not verified:** of the 28 restricted procedures, roughly half have
a test that calls them as a role that must be refused.~~ **Verified, and it was
worse than reported: seven, not fourteen** (`bc88635`). The other 21 rested on
the declaration test, which reads source text and calls nothing.

All 21 are now called as a role that must be refused, and the file goes red
when every restricted procedure is degraded to `householdProcedure` — measured
across all nine routers rather than argued.

Two things that pass came out of writing it, and both are the same lesson:

- **Asserting `FORBIDDEN` would not have been enough.** `replay.ts:145` and four
  sites in `receipt.ts` throw that same code for reasons that are not the role,
  and seven of these procedures can raise one. A test that trips an impostor is
  green with the guard deleted and the code cannot tell. The refusal's *message*
  is what separates them.
- **The tier guard runs before Zod**, so schema-invalid input also yields
  FORBIDDEN. Valid input is not what makes these tests green — it is what makes
  them able to go red, and it is why the fixture list is long.

~~The same audit reports that the declaration test can miss a procedure declared
across two lines or inside a nested sub-router.~~ **Verified and fixed**
(`6ef3fda`). There are no nested sub-routers, but the two-line case is real and
worse than "miss": the comparison is `toEqual`, so a procedure absent from the
parse *and* absent from the table matches nothing against nothing and passes.
Adding one to `store.ts` left the file at 14 pass, 0 fail — a procedure on the
wrong tier with every gate green. The file now counts itself a second way and
fails if the two disagree.

## 2. Household isolation — the class this review exists for

**Verified: four instances of one mistake, three of them found here.**

`ISSUES.md` SEC-1 was the first, in 2026-08: `inventory.addStock` wrote a
caller-supplied `storeId` onto a price record without checking whose store it
was. It was rated HIGH and fixed. This review found three more:

| Where | What | Fixed |
|---|---|---|
| `receipt.confirmAll` | authorised the *receipt* named in its input, then updated every `receiptItemId` in the array **by bare id** | `26ca43a` |
| both confirm procedures | wrote a caller-supplied `productId` into `matchedProductId` without checking whose product it was | `26ca43a` |
| `consumeStock`, `adjustStock`, `transferStock` | wrote `locationId` unchecked, while `addStock` beside them had always checked it | `e7e1b0f` |
| `receipt.upload` | wrote `storeId` unchecked, while `price.recordPrice` verifies the identical field two files away | `b1ecbdd` |

The first is the worst: passing a receipt you own alongside line ids you do not
was enough to set another household's receipt lines to confirmed and point them
at your own product, with no error and nothing to see afterwards. It was
reproduced against two real households before anything was changed.

**Nobody wrote it wrong twice.** Each was written by copying a sibling that
happened not to carry the check — which is why an audit finds this class and a
convention does not: the convention *was* being followed, from the wrong
example.

**So the review's own check became a test.**
`src/__tests__/unit/tenant-scoped-ids.test.ts` (`8bb2547`) fails when a
procedure accepts a household-scoped id and never looks it up. It is
deliberately crude — it cannot tell a correct check from a careless one, so it
is a tripwire on the shape of the mistake rather than a proof of isolation. It
catches all four instances when their guards are removed, verified one at a
time. ~~Ten exemptions carry their reason, and every one is a *read* whose query
already filters by household, which is the distinction the rule turns on.~~
**Corrected 2026-10-12: eleven at `8bb2547`, nine since the sweep below removed
two dead keys, and not all of them reads.** Each carries its reason. Seven are
reads whose query already filters by household; `product.update` and
`product.delete` are writes that resolve the id against the household, by id
and `householdId` together, before they write anything. The distinction the
rule turns on is that lookup, not read against write.

Its two blind spots were found by removing real guards and watching it stay
green — it read only inline Zod, and its schema scan truncated every schema at
its first line. Both are recorded in the file, because a guard with a silent
blind spot reports a pass it has not earned.

**A third blind spot, found 2026-10-12: the fields it does not know.** The scan
checks only the ids it lists — `storeId`, the four location ids, `productId`,
`shoppingListId`, `receiptItemId`. It never looked at the primary `id` every
update, delete and getById takes, nor at `parentId`. Removing the household
filter from `store.update` or `location.delete`, or the parent check from
`location.create`, left it green; and those, with `location.update`,
`shopping.update` and `shopping.getById`, had no cross-household case in the
integration suites either, so every gate stayed green. No guard was missing —
each procedure was scoped when this was found — but nothing would have noticed
one going.

- `parentId` is now in the scan, which catches the deleted `location.create`
  parent check. In `location.update` its existence lookup satisfies the same
  pattern, so the field check there proves nothing.
- The primary `id` is deliberately **not** in the scan. The one pattern that
  fits every procedure — "the body mentions `householdId`" — is true of nearly
  every body for unrelated reasons, so it would stay green with the guard
  gone.
- Both are guarded behaviourally instead: `integration/cross-household.test.ts`
  now has household A call `store.update`, `location.create` (B's parent),
  `location.update` (B's id; A's id under B's parent), `location.delete`,
  `shopping.update` and `shopping.getById` on B's rows, and asserts NOT_FOUND
  and that B's row is unchanged. Each case was watched to go red with its own
  guard removed. `location.update` has two guards, the existence check and the
  household in the write's own `where`; with either one removed it still
  refuses, and it goes red only when both are removed.

`shopping.removeItem`, `shopping.delete`, `store.delete` and member management
already had cross-household cases (`cross-household.test.ts`,
`shopping.delete.test.ts`, `delete-guards.test.ts`, `household.roles.test.ts`)
and are unchanged.

~~**Reported, not verified:** the same audit lists ten queries whose household
scoping it could not confirm by reading. The tripwire covers the *write* path;
reads are a separate sweep and have not been done.~~ **Swept 2026-08-31.**
Every read in the exemption set is genuinely household-scoped — quoted
where-clause by where-clause — and the ones that had no cross-household test
now have one (`ISSUES.md` SEC-2's neighbours in the isolation suites). Two
exemption keys named procedures that do not exist (`price.getPriceHistory`,
`price.compareStores`) and were removed; `product.delete`'s exemption reason
misdescribed which query scopes it and was corrected. **The sweep also found a
real defect the write-path tripwire structurally could not — `consumeStock`
guarded one location id with `?? ` and wrote another with `||`, filed and
fixed as `ISSUES.md` SEC-2** — which is the sweep earning its place rather than
confirming a null result.

## 3. Rate limiting

**Verified as present and shaped correctly.** Sign-in is counted per address and
per account on a hashed key (NIST SP 800-63B §5.2.2); `receipt.upload` is
metered before the file is decoded (ASVS V11.1.4); a 429 carries `Retry-After`
read off the refusal (RFC 9110 §10.2.3); refusals are logged as JSON from a tRPC
middleware so a resolver cannot forget to be audited (ASVS V7.1.3). These are
the four gaps Phase 3 left and Phase 7 was to close, and they are closed.

**Reported, not verified, and the strongest set in this review:**

- ~~The **per-IP key is attacker-controlled** on any deployment without a
  header-sanitising proxy.~~ **Verified, and the second half of that sentence was
  the wrong worry.** With no proxy header at all every caller shares the
  `unknown` bucket, which over-restricts and is safe. The real exposure is a
  caller who *sends* the header: measured, `X-Forwarded-For: 1.2.3.4` is counted
  against `1.2.3.4` and `9.9.9.9` gets a fresh counter, because with one entry
  the last hop is the only hop. `X-Real-IP` is trusted the same way.

  Not a defect in the code — HTTP gives it nothing to tell a proxy's entry from
  a client's — so it is a **deployment requirement**, now stated as one in
  `SECURITY.md` instead of implied by a parenthetical that called the last hop
  unforgeable. `unit/rate-limit.test.ts` pins the behaviour under "what the
  identifier cannot know", so changing the trust model means changing those
  tests and that paragraph together. The remedy — a trusted-proxy allowlist, or
  refusing to start without one — is a decision with costs and stays with the
  operator and the owner.
- ~~The **registration limit is exercised by no test**.~~ **Verified and
  closed** (`33bdc14`). The finding was right about the cause: every test built
  its tRPC context without headers, and `auth.register` meters only
  `if (ctx.headers)`, so the limit was unreachable from the suite. Two tests now
  drive the real router with an address — the budget is spent and the next call
  refused with `TOO_MANY_REQUESTS`, the over-limit account is confirmed not to
  exist (the count happens before the write, which no status code can show), and
  a second address is unaffected. Confirmed to fail by guarding the limiter with
  `if (false && …)`.
- ~~**Fail-closed is unproven at the call sites.**~~ **Verified and closed**
  (`7a663a1`), and the finding understated it. Each caller decides in its own
  hand-written `catch`, so each needed its own test; both were confirmed by
  making the change they exist to catch.

  Worth recording, because it is the failure mode this whole document is about:
  the sign-in test **passed with the first `catch` already mutated to fail
  open**. `authorize` consults two limits, the account one refused instead, and
  the identical error came back. It now submits credentials that fail
  `loginSchema`, so the procedure returns before the second limit is reached.
  Written the obvious way, it would have been a test that could not fail.

The first remains a finding with an owner rather than a fix, because it is
partly an operator's decision.

## 4. The offline queue as an attack surface

**Verified by the existing suite**, which is unusually thorough here: `withReplay`
claims the key and applies the effect in one transaction, so "key claimed,
effect missing" is unrepresentable; a replayed mutation carrying another
household's id is refused; the same key with a different request hash is
refused. Nineteen controls, all with tests.

The queue also inherited §2's defects, since `consumeStock` is replayable — which
is why the location guard sits *before* the replay envelope rather than inside
it. A queued write is a caller that is not a page.

~~**Reported, not verified:** cross-household ownership on the replayable
procedures is tested for one of the five; and a claim that role-freshness is not
what it appears to be. That last one contradicts what §1 verified, so it needs
settling rather than repeating.~~ **Both settled 2026-08-31.**

**Replayable ownership is now tested for every id every one of the five
accepts** — `integration/cross-household.test.ts` (household A asks for B's
rows by id) plus the store/location isolation suites: `shopping.addItem`'s
list and product, `updateItem`'s and `removeItem`'s item, `addStock`'s and
`consumeStock`'s product and location, each refused and each proven to leave
B's row untouched. The earlier "one of five" counted only the store dimension.

**Role-freshness: §1 is right, the §4 suspicion is false for authorisation.**
Every server gate re-reads `householdId` and `role` from the database per call
(`trpc.ts` `householdProcedure`), so `withReplay` — called inside the resolver,
after that read and after the tier guard, and carrying no role at all — cannot
replay under a stale privilege. The one true grain: the *JWT's* `role` claim is
minted at sign-in and never refreshed, so `session.user.role` can be stale for
an active session's life — but it drives only UI affordances (which buttons
show), never a server decision, and the fallback is to `KITCHEN`. "Not what it
appears" is true of the session object and false of authorisation, which is the
settling sentence; the audit note that spawned it was never committed, so this
is the record.

## 5. Uploads

**Verified present:** MIME allowlist, magic-byte check against the declared
type, Sharp re-encode, UUID filenames, a household-scoped directory, and — since
this review — a store ownership check.

**Reported, not verified, and the two worth acting on:**

- ~~The **10 MB cap is applied after the whole body is in memory**.~~
  **Verified, half right, and the half it got wrong was the more interesting
  one** (`74788ab`).

  Right about the mechanism: the image arrives base64 in a tRPC payload, so the
  cap runs after the body is read and JSON-parsed. Wrong about the consequence.
  ~~Allocation is *not* unbounded — Next caps a request body at
  `experimental.proxyClientMaxBodySize` whenever a middleware is configured, and
  this application's matcher covers `/api/trpc`.~~ Measured on a running server:
  10,000,080 bytes parsed, 10,485,840 did not. **Corrected 2026-10-12:**
  allocation was unbounded for any request the matcher skips — see §8, "The
  prefetch-skip" — and the bound is now the route's own.

  What the measurement found instead is finding 18. The lesson worth keeping is
  that the audit reasoned from the application's code and stopped at its edge;
  the number that governed the behaviour was a framework default nothing in this
  repository mentioned.
- **The request-body ceiling sat below the documented upload limit**, so the
  10 MB the product promises could not be sent and the router's own size check
  could never fire. **Fixed** (`74788ab`) — finding 18, and it is not a
  vulnerability: it is a control that did not exist and a feature that did not
  work, found by going after one that did.

  The ceiling has to exist somewhere, so above it the reply is still a parse
  error. `005ec2c` refuses an oversized photograph in the browser instead,
  before the encode and before the request — because the server genuinely
  cannot answer this one. A body it never received in full is not something it
  can write a sentence about, and the sentence is what the person needs.
- ~~The **cap counts bytes; the decoding cost is in pixels.**~~ **Verified and
  fixed** (`69c1bd5`). Neither Sharp call site set `limitInputPixels`, and
  Sharp's own default of 268 megapixels was not helping. Measured: a 12,000 ×
  12,000 PNG of one flat colour is **446 KB** — past the byte cap, past the
  magic-byte check, and gigabytes to decode. Bounded at 50 megapixels at both
  sites, including the OCR path, which runs on bytes that came off disk rather
  than through the procedure that checked them.

~~Also reported: no test performs a *successful* upload, so the four positive
claims `SECURITY.md` makes about this path are unproven.~~ **Verified with a
correction, and closed** (`76f5c80`, `5d49d99`).

One test did perform a successful upload and asserted `expect(receipt)
.toBeDefined()` — the call did not throw, and nothing else. So the four claims
were unproven exactly as reported, for a reason the finding had slightly wrong.

They are now proven in two places, deliberately: `unit/image-reencode.test.ts`
holds the re-encoder to its four promises — EXIF gone including the GPS block,
format normalised, orientation baked into the pixels, the pixel bound enforced
— and `integration/receipt.upload.test.ts` holds the *procedure* to what it
writes. Those are different claims. A correct re-encoder whose output is not
the thing written to disk passes the first and fails the second, which is what
one of the mutations does.

Worth noting what had no test at all: `src/server/services/image.ts`, the
module carrying two of `CLAUDE.md`'s upload requirements and the fix for
finding 14 — and freshly rewritten from `sharp` to `Bun.Image`, so a different
library was making the same four promises with nothing watching.

Also reported, and still open: uploaded images are never deleted, since no
`receipt.delete` exists. The suite had its own instance of it —
`uploads/receipts/` held 48 orphaned household directories from previous runs.
The new file cleans up after itself; the product side is finding 16.

## 6. Session handling

> **Superseded 2026-10-15** (PROGRESS D135). next-auth and its JWT were
> replaced by Better Auth, with a `Session` row per session: signing out,
> ending sessions and setting a password delete rows, a browser session ends
> after fifteen idle minutes or a day from sign-in, and the cookie is
> refused the moment its row is gone. What follows is the review as it was
> written, against the JWT; `SECURITY.md`, *Authentication*, is current.

**Verified:** JWT with a 15-minute `maxAge`, the role read fresh per request,
sign-out purges the queue and the cached shell and asks before discarding unsent
changes, and an idle session warns before it ends.

~~**Reported, not verified**~~ **— verified 2026-08-27, and the exposure is
larger than this said.** There is no server-side session revocation. A kitchen
tablet holds a long-lived session by design; if it walks out of the house,
nothing ends that session from inside the application.

The mitigation named here — "a role change bites on the next request" — is
**true and unreachable**. `householdProcedure` really does re-read `householdId`
and `role` from the database and ignore what the token claims, and
`integration/session.freshness.test.ts` now proves it: a token claiming OWNER
against a KITCHEN row is refused, a demotion written mid-session bites on the
very next call, and a deleted account's token stops working immediately.

~~But **nothing in the product can perform any of those changes.**
`householdRouter` is `current`, `create`, `members`, `addMember` — there is no
way to remove a member and no way to change a role. Every state change those
tests make needs a direct database write. So "I have lost the tablet" has no
answer from inside the application at all, not even a partial one, and the
15-minute token is the whole of the bound.~~ **True at `8bb2547`; closed
2026-08-27** (`a264c42`, `c358e96`; corrected here 2026-10-12, the table above
having said so since). `household.updateRole` and `household.removeMember`
change a role and remove a member, `household.revokeMemberSessions` ends a
member's sessions and `auth.revokeMySessions` an account's own; both stamp
`sessionsValidFrom`, which the `jwt` callback checks where the token is
re-issued. "I have lost the tablet" is answered from `/settings/people`.
Since 2026-10-15 (D135, D143) both delete session rows instead, and an
account's own sessions are listed and ended one at a time, every other or
all together from **Tus dispositivos** at `/settings/security`, after the
password — `auth.listSessions` and `auth.endSessions`, which replaced
`auth.revokeMySessions` and its button. Since D145 an admin lists a member's
sessions and ends one or every one (`household.memberSessions`,
`household.endMemberSessions`), which replaced
`household.revokeMemberSessions`.

**And the mitigation had no test.** Replacing that query with the token's own
values — an obvious optimisation, one fewer database round trip per request —
leaves `integration/capabilities.test.ts` at 9 pass / 0 fail. Measured, by doing
it. The existing suite would not have noticed the only thing this application
can do about a session it wants to stop trusting; the new file fails all four.

~~Still a finding with an owner, and now a sharper one: it is not only "should
there be revocation" but "there is no member management at all", which is a
product gap the review found by trying to write a test for the mitigation.~~
Closed with the paragraph above — finding 8.

**Both halves now have homes, and the open question is answered.** Two entries
went into `REDESIGN_PLAN.md` §10's unowned table on 2026-08-27:

- **A household admin panel** — list the members, change a role, remove one. It
  needs no new revocation machinery: the mechanism is already there and proven,
  and what is missing is the way to trigger it.
- **Session revocation**, by the account itself and by an admin from that panel.
  ~~Whether sessions should also be revocable stays open.~~ **Answered: yes.**

The second one does need new machinery, and the entry carries the three things
that are not obvious from this section. **The 15-minute token is not a bound on
a session in use** — `maxAge` is 15 minutes of *inactivity* and `updateAge`
slides it every 5, so an active tablet renews indefinitely and the expiry only
bites on a device nobody is worried about. **The check cannot live only in the
procedure tier**, because `/api/auth/session` re-issues the token through
Auth.js's own route and a revocation enforced beside the role check would leave
a revoked session sliding forever. And **coarse revocation is one column**,
where per-session revocation needs a record per session — with `stoky_device`
already supplying a stable per-browser identifier if that is the direction.

**Corrected 2026-10-12: both halves of the first point are now wrong.**
`updateAge` does not slide anything here: `@auth/core` reads it only on the
database-session path, and under the JWT strategy the token is re-issued with
a fresh `maxAge` on every read of the session. And a session in use no longer
renews indefinitely: since the 2026-10-12 security review every session ends
thirty days after sign-in however active it is (`MAX_SESSION_AGE_S` and the
`authTime` claim in `src/lib/auth.ts`; `PROGRESS.md` D125; SECURITY.md,
*Authentication*). The 15 minutes remains the idle timeout.

## 7. Dependency and image posture

**Verified today:**

- `pnpm audit --audit-level moderate` — **no known vulnerabilities**.
- The image scan **failed on master** and was fixed: CVE-2026-14456 in
  `libcrypto3`/`libssl3`, a denial of service in OpenSSL fixed in `3.5.8-r0`
  while `node:24-alpine` still carried `3.5.7-r0`. `ccde2e1` upgrades the base
  packages in the production stage. Verified as CI verifies it — rebuilt the
  production target, ran Trivy 0.69.3 with the workflow's own flags, and
  confirmed the image carries `3.5.8-r0` rather than trusting a clean scan to
  mean a patched package.

This is the one place the review found the gate working rather than missing: the
advisory was published, the next push went red, and the trunk could not ship
until it was fixed.

~~**Reported, not verified:** nothing in the image posture is enforced by a
test — `USER node`, the npm removal, the read-only rootfs are all true and all
unasserted;~~ **The posture is now asserted, 2026-08-31.** The text half is
`unit/image-posture.test.ts` (in the shape of `bun-version`/`ocr-tessdata`): the
production stage runs `USER node` and never returns to root, deletes npm in the
same `RUN` that installed with it, health-checks `/api/health` not the port, and
keeps `/app/uploads` chownable; and `docker-compose.prod.yml`'s app service is
`read_only: true` with only its three writable exceptions. The behavioural half
for npm is a build-time `RUN ! command -v npm` assertion in the production stage,
in the shape of the OCR-path assertions, so a reintroduced package manager fails
`docker build`. `USER node` and read-only holding on the running container stay
the CI image job's to prove, on the image it is about to scan. **Still open:** a
published image is never re-scanned, so an advisory affecting a
shipped image is only noticed on the next push; and the placeholder-secret guard
does not stop the container, which reports healthy while refusing to sign
anybody in.

**Corrected 2026-10-12: this section above describes the image before Bun
became its only runtime** (`c117052`, 2026-09-25) **and before the source build
became an override of the release bundle** (`eb44561`, 2026-10-05). The
2026-08-26 bullets stay as that day's record — `pnpm audit` and
`node:24-alpine` were what ran then. What holds today, and what asserts it:

- Every stage derives from the `oven/bun` Alpine image, pinned by version and
  index digest since 2026-10-12, and the production stage runs `USER bun` and
  never returns to root (`unit/image-posture.test.ts`). `bun` is uid and gid
  1000, the old `node` account's, so uploads written before the change stay
  writable; a `RUN` in the production stage fails the build if that stops being
  true.
- No stage installs Node.js, npm or npx, so there is nothing to delete. The
  test refuses an `npm install` or an `apk add nodejs`, and a build-time `RUN`
  fails unless the `node` on the path resolves to the Bun binary and neither
  `npm` nor `npx` exists.
- Read-only with its exceptions is asserted on `deploy/docker-compose.yml`, the
  one production definition: `read_only: true`, `tmpfs` for `/tmp` and
  `/app/.next/cache`, and the `uploads` volume. `docker-compose.prod.yml` is a
  source-build override, and the test lets it add only `build` and
  `pull_policy`, so it cannot restate the hardening and drift from it (the
  same test).
- The health check is the image's own `HEALTHCHECK` on `/api/health` (the
  same test).

On the running container, the release job starts the published image from
`deploy/docker-compose.yml` and waits for it to report healthy, so a read-only
start is exercised on every release tag. No job asserts the running user.

The dependency audit is `bun audit --audit-level moderate`: CI's `audit` job
runs it directly, and `scripts/check-audit.sh` locally. Of the two *Still
open* items, the placeholder-secret guard has been closed since 2026-10-06:
`src/instrumentation.ts` runs the check at start-up and the process exits with
status 1, and `/api/health` answers 503 on the same check, so the container
neither serves nor reports healthy (SECURITY.md, *The session signing key
cannot be the example one*). The re-scanning item is closed by the paragraph
below.

**Closed 2026-10-12: the published release is re-scanned every week (#17).**
`.github/workflows/rescan.yml` runs on Mondays and by hand. It takes the newest
non-draft release, prereleases included (`gh api
repos/NGarate/stoky/releases/latest` answered 404 that day, every release being
an alpha), downloads its `docker-compose.yml`, and scans each image
`docker compose config` resolves from it with `release-draft`'s scanner: Trivy
0.69.3 pinned, from the registry, no Actions cache, failing on a fixable
CRITICAL or HIGH finding. One job per image uploads its report under
`trivy-release-<service>`, apart from master's `trivy`. Only the scan job holds
more than `contents: read`: `security-events: write` and `actions: read`.
`unit/ci-workflow.test.ts` holds the schedule, the triggers, the permissions,
the pins (now in every workflow), the cache, the gate and the upload condition,
and goes red for each when it is undone. The first scheduled run on GitHub had
not happened when this was written; the owner dispatches one after the merge.

Run by hand the same day with the same scanner and flags, against
`v0.1.0-alpha.3`'s images:

| Image | Fixable CRITICAL/HIGH |
|---|---|
| `ghcr.io/ngarate/stoky:v0.1.0-alpha.3` | 0 |
| `valkey/valkey:8-alpine` | 0 |
| `postgres:16-alpine` | 25 in `/usr/local/bin/gosu` (Go 1.24.6 stdlib), 0 elsewhere |
| `traefik:v3.7.13` | 4 HIGH: Go 1.26.8 stdlib and `golang.org/x/net` 0.58.0 |

Two decisions came out of that table:

- **gosu is left out of the gate, not the report.** The 25 advisories are in
  `net`, `net/http`, `crypto/tls`, `crypto/x509`, `net/url`, `net/mail`, `mime`,
  `encoding/*`, `html/template`, `x/net` and `os.Root`. The gosu binary copied
  out of `postgres:16-alpine` (`sha256:721873c3…`) names no function from any
  of them (`strings` finds none), and the entrypoint runs it once, as root, to
  re-run itself as the postgres user (`exec gosu postgres "$BASH_SOURCE"`). Gating on it would keep the
  run red every week with nothing to act on. The test refuses any other skip.
- **Traefik stays gated, and the first run will be red because of it.** The
  four are denial-of-service advisories in HTTP/2, Range-header and TLS
  handling, published 2026-10-08, in the one component that faces the
  internet. `traefik:v3.7.14` carries the same four, so updating to it does not
  clear them; a Traefik release built with Go 1.26.9 and `x/net` 0.60.0, then a
  Stoky release naming it, does. That red run is the finding reaching the
  owner, which is what #17 asked for.

What the re-scan does not cover is what the release scan does not: the
packages Next compiles into `.next/server/chunks` (next-auth, `@auth/core`,
`jose`, tRPC, zod among them) have no `package.json` in the image, and the Bun
binary is in no package database. Re-scanning the image cannot see either.

## 8. Headers in production

**Verified:** the CSP carries a per-request nonce minted in `src/proxy.ts`,
with `strict-dynamic`, and the production policy has no `unsafe-eval`.
`e2e/auth.prod.spec.ts` signs in against the standalone artefact and asserts no
CSP violation reaches the console — which is what caught the
`upgrade-insecure-requests` defect in 2026-08. The nonce survived the Cache
Components migration deliberately: the root layout blocks (`instant = false`)
because a nonce that survives prerendering is not a nonce, and that trade was
put to the owner and decided.

**Verified, and closed** (`4c6fb90`). The finding was real: the whole layer —
the CSP and the six static headers in `next.config.ts` — was verified by
reading. `csp.test.ts` exercises `buildCsp()` in isolation and never touches a
response, and nothing named `X-Frame-Options`, HSTS or the other four.

Checking says they all arrive, so this was *unasserted* rather than broken.
`e2e/security-headers.spec.ts` now pins them against the standalone production
build, including the three that a cheaper tier could not see: that the nonce
differs between two requests — which is what `instant = false` on the root
layout exists to protect, so if they ever match that trade has silently been
lost — that `unsafe-eval` is absent in production, and that
`upgrade-insecure-requests` is absent over plain http, which is the defect that
once killed every tRPC call for a Safari user on a LAN install.

~~**Still reported, not verified:** prefetch requests skip the middleware by its
own matcher, and eight of the thirteen production directives remain unaudited —
though the new spec now asserts six of them are present.~~ **Verified
2026-08-31**, and the arithmetic was off — the spec asserted six, so seven
were unaudited, not eight.

**All thirteen are now audited at their exact values.**
`security-headers.spec.ts` splits the policy on `"; "` and matches each
directive by equality rather than substring — the name-only assertions passed
just as happily on `frame-ancestors 'self'` as on `'none'` — and asserts the
count is thirteen over plain http, which is the only check that catches a
directive silently added or dropped. `script-src` is pinned to its full shape
(`'self'`, a 32-hex nonce, `'strict-dynamic'`, nothing else), and `connect-src`
to exactly its sources, which is what proves the dev tail (`ws:`,
`http://localhost:*`) never ships. It had two then; it has one, `'self'`, since
2026-10-12 (below).

~~**The prefetch-skip is real, and bounded.** Measured: a request labelled
`Purpose: prefetch` does skip the proxy, so `proxyClientMaxBodySize` does not
apply to it — an oversized upload's whole body arrives instead of being
truncated. But it is still refused, one layer deeper, by `fileBase64`'s Zod
`.max` (`MAX_RECEIPT_BASE64_LENGTH`), the second bound added for exactly the
case where the proxy cap does not fire. So the label bypasses the cap, not the
refusal; the body stays bounded by validation on an authenticated,
rate-limited endpoint.~~ **Corrected 2026-10-12: real, and it was not
bounded.** The measurement held and the conclusion did not, because it was
drawn from the one procedure measured. The label skips the cap for *every*
POST, Bun's `node:http` server accepts a body of any size, and nothing else
in the stack set one. `receipt.upload`'s Zod `.max` refuses only after tRPC
has read and parsed the whole body, and behind authentication; the public
`auth.register` has no such field, and its rate limiter runs in the resolver,
after the parse. So an unauthenticated, prefetch-labelled POST of any size was
buffered and JSON-parsed whole. The Auth.js route under `/api/auth` was open
the same way.

**Fixed: the API routes bound the body themselves**
(`src/server/http/body-limit.ts`), so the proxy's cap is no longer the only
one. `/api/trpc` refuses a body over 15 MiB with 413, before it looks up the
session; a POST to `/api/auth` over 64 KiB likewise, before Auth.js reads it.
A declared length over the limit is refused unread, and a body with no
declared length is counted as it arrives. `proxyClientMaxBodySize` imports the
same 15 MiB, so the two layers cannot disagree about what an upload weighs.
Pinned by "what a prefetch label cannot do" in `security-headers.spec.ts`,
through the production build: a 16 MiB upload is 413 labelled or not; a
prefetch-labelled 16 MiB `auth.register` with no session is 413; a
prefetch-labelled 1 MiB sign-in is 413. With the tRPC route's bound removed,
both tRPC cases go red on a 400 — the register body read whole and refused by
Zod — and with the Auth.js route's removed, the sign-in case gets a 302. The unit tier
(`body-limit.test.ts`, `trpc-handler.test.ts`,
`auth-route-body-limit.test.ts`) pins the chunked case and the boundary:
exactly the limit passes, one byte over does not.

The residual is concurrency, not size: a body may still be up to 15 MiB,
held more than once while it is read and parsed, and nothing limits how many
arrive at once (`SECURITY.md`, *Request bodies*).

~~Prefetch responses also carry no `Content-Security-Policy` (it is set only in
the proxy), so a prefetched RSC payload has no nonce; harmless because such a
payload is data merged into a document that already has a fresh nonce and
`'strict-dynamic'`, never itself a top-level document.~~ **Corrected
2026-10-12: that reason covers one of the two labels the matcher skips.**
`next-router-prefetch` is the router's RSC prefetch, and for it the paragraph
holds. `Purpose: prefetch` is different: it can label a *document* request.
Measured against the standalone build: `GET /inventory`, signed in, with
`Purpose: prefetch` answers 200 with no `Content-Security-Policy` and no
`stoky_device` cookie. So a document labelled that way is rendered without a
nonce and without the policy.

Which browsers send it was measured too, not assumed. The 2026-10-12 finding
called it browser-set; the three browsers this repository pins (Playwright
1.62.1's Chromium 151, Firefox 153, WebKit 26.5), loading a probe page with a
`<link rel=prefetch>`, a speculation-rules prefetch and a speculation-rules
prerender, never sent it. Chromium and Firefox labelled
`<link rel=prefetch>` `Sec-Purpose: prefetch`; Chromium labelled its
speculation-rules prefetch `Sec-Purpose: prefetch` and its prerender
`Sec-Purpose: prefetch;prerender`; Firefox and WebKit did not act on
speculation rules, and WebKit did not prefetch the link. `Purpose` is the
legacy spelling, sent by whatever client still uses it — or by anyone who
types it. The matcher's `key: "purpose"` is the header's exact name, so
`Sec-Purpose` does *not* skip the proxy: measured, `GET /login` and
`GET /inventory` with `Sec-Purpose: prefetch` or `prefetch;prerender` carry
the nonce'd policy.

Each case is harmless for its own reason, and the two reasons are not
interchangeable:

- **`Purpose` — nothing keeps it.** Every page is a request-bound render (the
  root layout reads the nonce from `headers()` and sets `instant = false`),
  and Next sends such a render as `private, no-cache, no-store, max-age=0,
  must-revalidate` — measured on the labelled `/inventory` response, which also
  carries `x-nextjs-postponed: 1`. A `<link rel=prefetch>` result reaches the
  next navigation only through the HTTP cache, which keeps nothing `no-store`:
  on the probe, with the same `cache-control`, clicking the prefetched link
  sent a fresh, unlabelled request in all three engines. So the policy-less
  page goes only to whoever sent the label.
- **`Sec-Purpose` — it goes through the proxy.** `no-store` does not protect
  this one. Speculation-rules prefetch and prerender are navigational: on the
  probe, Chromium showed a `no-store` page from either without asking the
  server again. They are safe because the proxy runs on them, so the page the
  person is shown has its nonce and policy. Widening the matcher to skip
  `sec-purpose` — the natural "modernisation" of Next's documented shape —
  would hand a prerendered page to the person with no policy at all.

The residual, stated rather than measured: a browser that sent the legacy
`Purpose` on a prefetch it then *shows* as the navigation would show a
policy-less page. None of the three measured does. The matcher stays as it
is, the shape Next's own CSP guide documents.

Both reasons are pinned rather than recalled. "a document labelled a
prefetch" in `security-headers.spec.ts` asserts, for `/login` signed out and
`/inventory` signed in, that a `Purpose`-labelled response skips the proxy
(no policy, no device cookie) and is `no-store`, and that a
`Sec-Purpose`-labelled one (`prefetch` and `prefetch;prerender`) carries the
nonce'd `script-src`. If a page ever becomes cacheable, a policy-less prefetch
could become the document a person is shown, and the first pair goes red —
pointed at `/icons/icon-192.png`, which is served `public, max-age=0`, it
does. Swap the matcher's `purpose` clause for `sec-purpose` and all four go
red.

**Found 2026-10-12: the path exclusions skipped more than files.** The
matcher excluded `_next/static`, `_next/image`, `favicon.ico`, `icons/` and
`sw\.js` as unanchored prefixes, with the dot in `favicon.ico` unescaped. Only
a file that exists is served from disk; any other path except a
`/_next/static/` miss, which Next answers with plain text, falls through to
the App Router's not-found render — the root layout, a full HTML document on
this origin. So a link to `/icons/x`, `/sw.jsx` or `/faviconXico` opened a
page with the proxy skipped: no nonce and no `Content-Security-Policy`,
`next.config.ts` deliberately setting none for a page and Traefik setting
none at all. Unlike `Purpose: prefetch`, this needs no header, only a link,
and the result is a top-level document, so neither reason above covers it.
Defence in depth rather than an exploit: the not-found page reflects nothing
from the request, and `X-Frame-Options: DENY` still applies. The finding's
claim that the browser's automatic `/favicon.ico` request was one of these
renders did not hold — that fetch is `Sec-Fetch-Dest: image`, which Next
answers with a plain-text 404.

**Fixed: each exclusion is anchored to what it is for** — `_next/static/` (a
prefix, as before), `_next/image$`, the six files in `public/icons/` by name,
and `sw\.js$`. The icons are named rather than matched as
`icons/[\w.-]+\.(?:png|svg)$`, the anchoring the finding proposed: that
pattern also skips the proxy for a name that is not there, and
`GET /icons/does-not-exist.png` measured exactly the old result — 404
`text/html`, empty policy. `favicon.ico` is no longer excluded, because there
is none. `src/__tests__/unit/proxy-matcher.test.ts` compiles `config.matcher`
with Next's own `getMiddlewareMatchers` and asks `getMiddlewareRouteMatcher`
the way `resolve-routes.js` does, raw and decoded: the worker, every file in
`public/icons/`, `/_next/static/*` and `/_next/image` are skipped;
`/icons/does-not-exist`, `/icons/does-not-exist.png`, `/icons/a/b`, `/sw.jsx`,
`/favicon.ico` and the rest are covered; and the two prefetch labels are still
skipped while `sec-purpose` is not. With the old source restored, the twelve
"covered" cases go red; with the `[\w.-]+` pattern, the three icon-shaped
misses; with a file left out of the list, that file. The `csp.test.ts` checks
it replaces read the source for substrings and passed on both versions.
`pwa-manifest.test.ts` now asks the same compiled matcher that every icon the
layout and the manifest reference is skipped: an icon left out of the list
would otherwise start going through the proxy unnoticed. "a page that is not
there" in `security-headers.spec.ts` asserts, against the production build,
that `GET /icons/does-not-exist`, `GET /icons/does-not-exist.png` and
`GET /sw.jsx` are 404 `text/html` carrying the nonce'd `script-src`; with the
old source restored it fails on the first of them with an empty policy, after
the status and the content type have passed — the finding, measured — and with
the `[\w.-]+` pattern it fails the same way on the second.

**Found 2026-10-12: the image optimiser was live.** Nothing renders
`next/image`, and `next.config.ts` left `sharp` out of the production image on
the grounds that `/_next/image` "cannot be reached"; `next-image.test.ts`
guarded that premise by checking for an import, and said the route "would
fail at runtime" without the library. Both were wrong. Next 16 registers
`/_next/image` whatever the source imports, and with no `images` config it
answers unless `unoptimized` is set or a custom loader is configured
(`next-server.js`, the one branch that 404s the route). The built config had
`unoptimized: false` and `localPatterns: [{ pathname: "**", search: "" }]`, so
any same-origin path without a query was accepted — `/dashboard`,
`/api/trpc/receipt.list` — and fetched with an internal request through the
whole router, proxy, root layout, `auth()` and a database lookup, for an
anonymous caller. An answer that sniffed as a raster image was sent back and
cached under `.next/cache/images`; without `sharp`, Next catches the missing
module and serves the original bytes. All of that was read from Next 16.4.0
and the built config by the audit; measured on the production build without
the switch, `GET /_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75` is 200
`image/png`. Low, and unneeded surface rather than an exploit:
`remotePatterns` is empty, the internal request carries no cookies
(`headers: {}`), receipt images are only ever tRPC JSON, `public/` holds only
the icons, and SVG is refused.

**Fixed: `images: { unoptimized: true }`, and the matcher no longer skips the
route.** It is Next's documented switch, and with it the route answers 404
before reading a parameter. That 404 is the app's not-found document —
`text/html`, a full page — and with `_next/image$` still in the matcher's
exclusions, as the anchoring fix above left it, it arrived with no
`Content-Security-Policy`: the defect just closed for `/icons/x`, reopened
at a new path. Measured, before and after dropping the exclusion: 404
`text/html` with an empty policy, then 404 `text/html` with the nonce'd
`script-src`. `next-image.test.ts` now asserts the config Next is given has
`images.unoptimized === true` and no custom loader; the import check is gone,
because with the endpoint off `next/image` renders the source file as it is,
in development and production alike. `proxy-matcher.test.ts` asks that the
proxy run for `/_next/image`. "the image optimiser" in
`security-headers.spec.ts` asks the production build for the icon above and
expects 404 `text/html` with the nonce'd `script-src`. With the option removed
it fails on the status — 200, the PNG — and with the exclusion restored on the
policy, an empty string; the unit tests fail on the same two mutations, and
the loader assertion on `loader: "custom"`.

**Found 2026-10-12: HSTS invited preloading of the operator's domain.**
`next.config.ts` and Traefik's `stoky-security` middleware both sent
`max-age=63072000; includeSubDomains; preload` on whatever `DOMAIN` the
operator chose, and nothing in `example.env` changed it. `preload` is the
domain owner's consent to the browsers' built-in HSTS lists, and
hstspreload.org checks the header, not who submits: on an apex install the
bundle met every criterion it controls (the header and the same-host HTTPS
redirect; HTTPS on `www` depends on the operator's DNS), so anyone could have
listed the domain and every host under it, and removal is slow. hstspreload.org asks software that ships
HTTPS defaults not to send it. Low, and harm to the operator rather than an
attack: the documented example is a subdomain, which the list does not accept.

**Fixed: no `preload` in either layer, the rest kept.** The app sends
`max-age=63072000; includeSubDomains` and Traefik has `stsPreload: false`.
`includeSubDomains` stays because ASVS 5 V3.4.1 asks for it; its cost on an
apex — every plain-http host under the domain unreachable for two years in a
browser that has opened Stoky — is now a warning beside `DOMAIN` in
`docs/INSTALL.md` instead of a surprise. Both layers change together because
each reaches someone the other does not: Traefik's middleware replaces the
app's value behind the bundle, and the app's is the only one behind an
operator's own proxy. "HSTS" in `deployment.test.ts` asserts Traefik's options
(no preload, two years, subdomains), the app's exact value, and that the app's
equals the string Traefik builds from its options; restoring `stsPreload: true`
fails the first and third, restoring `preload` in the app the second and
third, and dropping `includeSubDomains` from the app alone the second and
third. `security-headers.spec.ts` pins the new value on the production build.

**Found 2026-10-12: no Cross-Origin-Opener-Policy or
Cross-Origin-Resource-Policy.** The app's static set had neither, and neither
did Traefik's middleware. Without COOP, a page on another origin that opens
Stoky with `window.open` keeps a live handle to the window: it can navigate it
to a look-alike sign-in page — inbound tabnabbing against a credentials-only
app — or time its navigations. Without CORP, another origin can request any
Stoky response as a no-cors subresource. Low, and defence in depth rather than
an exploit: `X-Frame-Options: DENY` and `frame-ancestors 'none'` already
refuse framing, the app has no frames for an opener to count, and browsers'
opaque-response blocking, with `nosniff`, already withholds most JSON and HTML
from another origin's no-cors request. Nothing in the app needs either
absence: there is no OAuth popup, the only new windows Stoky opens are the
Open Food Facts links (`rel=noreferrer`, which COOP on Stoky does not affect),
and every subresource its pages load is same-origin.

**Fixed: both, as `same-origin`, in `next.config.ts`; no embedder policy.**
`same-origin` rather than `same-origin-allow-popups`, because no popup Stoky
opens needs a way back. `Cross-Origin-Embedder-Policy`, the header usually set
with these two, is left out on purpose and the config says so. All it would add
is cross-origin isolation, which Stoky does not use, and `require-corp` would
refuse the product photographs: the product page loads them as a plain `<img>`,
and `images.openfoodfacts.org` sends no CORP. It does send
`Access-Control-Allow-Origin: *` (measured with `curl -I` on a product image,
2026-10-12), so `crossorigin` or `credentialless` would let them through — but
only while a host that is not ours keeps answering that way, for a capability
nothing here needs.
Traefik is not changed; the app's headers pass through it.
`security-headers.spec.ts` adds both to the headers every page must carry and
asserts the whole set on `/api/health` and on an anonymous tRPC 401 as well.
"isolated from other origins" opens Stoky from a page `page.route` serves at
`http://localhost:3999` and asserts the opener's handle reads `closed` while
the window is open on `/login`; loads `/icons/icon-192.png` as an image from
the same page and asserts it fails with
`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`; and renders a product page with
a stand-in Open Food Facts photograph and asserts it loads, with no embedder
policy and `crossOriginIsolated` false. With both headers removed, the two
header tests and the two browser tests go red (the handle reads open, the icon
loads). With `require-corp` added, the photograph test fails on the header,
and with that assertion set aside on `crossOriginIsolated`; the photograph
itself still rendered — a response `page.route` fulfils is evidently not held
to the check — which is why the decision is pinned on the header and the
isolation state. With the Open Food Facts host dropped from `img-src`, the
photograph does not load and the test fails on that.

Loaded from `http://elsewhere.test`, as the subresource test first did, the
icon fails before CORP is consulted: Chromium's Local Network Access refuses a
request from an insecure page to a loopback address (`InsecureLocalNetwork`,
measured on the icon and on `/api/health`), so a test that only expected the
failure could not tell the header from its absence. The other page is
`localhost`, granted `local-network-access`, and the error the test expects is
CORP's own.

**Found 2026-10-12: the Permissions-Policy denied three features and was
described as denying all of them.** `next.config.ts` sent `camera=(self),
microphone=(), geolocation=(), interest-cohort=()` under the comment
"Everything off", and `SECURITY.md` said it "denies everything else". The
header has no default-deny: every feature it does not name keeps the browser's
default allowlist, `'self'` for most of the powerful ones — payment, USB,
serial, HID, screen capture, wake lock and the rest. `interest-cohort` is
FLoC's token, an API Chrome retired, and its successor `browsing-topics` was
not denied. Info, and a document claiming more than the header did rather
than an exposure: with `frame-ancestors 'none'`, `X-Frame-Options: DENY` and
`default-src 'self'` there is no third-party frame to delegate a feature to,
and any script that could call these APIs is already same-origin.

**Fixed: an explicit deny list, of tokens the browser recognises.**
`camera=(self)` stays — the scanner's `getUserMedia` and its torch need it —
and nineteen features are `()`: microphone, geolocation, browsing-topics,
payment, usb, serial, hid, midi, display-capture, screen-wake-lock,
xr-spatial-tracking, the three motion sensors, publickey-credentials-create,
otp-credentials, idle-detection, local-fonts and compute-pressure.
`publickey-credentials-get` is left unset for passkey sign-in, and
`fullscreen` and `picture-in-picture` are left alone. (Since 2026-10-15 the
passkey settings screen, PROGRESS D151, needs `publickey-credentials-create`:
it left the deny list, and both passkey features are now written out as
`(self)`, so eighteen are denied.) Each token was kept
only if the browser recognises it, because an unknown one is ignored, with an
"Unrecognized feature" error on every page, and a deny list copied from a
generic recommendation can carry tokens of features that were renamed or
never shipped. A test now asks for that: "the browser
understands every feature the Permissions-Policy names" loads `/login` in the
suite's Chromium (151, Playwright 1.62.1) and fails on any console message
about the header. It caught `bluetooth`, which the plan for this fix listed
and that Chromium does not recognise; it was dropped. Measured the other way,
`interest-cohort` does not complain in Chromium 151, so the finding's "reported
as unrecognised" did not reproduce — it was replaced because the API it
guarded is gone, not because it was rejected. A made-up token in both the
config and the pinned value fails that test alone; dropping `usb=()` from the
config alone fails it and both header pins.

**Found 2026-10-12: the product photograph told Open Food Facts where it was
shown.** `Referrer-Policy: strict-origin-when-cross-origin` still sends the
origin to another origin, and the product page's `<img>`, the one remote image
Stoky renders, had no attribute of its own, so every product view sent
`images.openfoodfacts.org` the instance's origin — its hostname, however
private — alongside the viewer's address and the barcode in the image path.
Low, a privacy disclosure rather than a compromise: it lets a third party
enumerate instances and tie a household to a hostname. The Open Food Facts
links were already `rel=noreferrer`; the image was the inconsistency.

**Fixed: `Referrer-Policy: same-origin`, and `referrerpolicy="no-referrer"` on
the image.** Measured in the suite's Chromium with both reverted, the
photograph's request carried `Referer: http://127.0.0.1:3100/`; with either
layer alone, none. The header covers any cross-origin request a later change
adds, and the attribute holds behind a proxy that rewrites the header.
`no-referrer` was the obvious stronger choice and is wrong here: it makes the
browser send `Origin: null` on every POST, same-origin ones included, and Next
aborts a Server Action whose Origin does not match the host. Measured, with it
the no-JS screen choice in `e2e/screen-choice.spec.ts` fails and the server
logs "does not match `origin` header with value `null` … Aborting the action".
`same-origin` nulls the Origin only on a cross-origin POST, which Stoky's pages
do not make. `e2e/security-headers.spec.ts` pins the header and, on the product
page, checks that the photograph's request carries no `Referer` and that the
element carries the attribute. What still reaches Open Food Facts is the image
request itself, with the viewer's address; only a server-side image proxy
would remove that, and it is not part of this fix.

**Found 2026-10-12: `connect-src` allowed an origin no page contacts.** The
policy read `connect-src 'self' https://world.openfoodfacts.org`, and had since
the first CSP (`349680f`). Every Open Food Facts lookup is the server's
(`src/server/services/openFoodFacts.ts`), where the policy does not apply;
outside `src/server`, the host appears only in `ProductRating`'s links, which
are navigations, and in the policy itself. At `349680f` the same was already
true. Low, and least privilege rather than an open path: a script would first
have to get past the nonce and `'strict-dynamic'`, and one that did could still
send data out through an `img-src` query string or a navigation. But it was an
allowance with no use, to a service that accepts writes from anyone.

**Fixed: `connect-src 'self'`**, with the development websocket tail as
before. `img-src` keeps `images.openfoodfacts.org`; the photographs are images,
not connections. `src/__tests__/unit/csp.test.ts` now pins `connect-src` at its
exact value in both environments, so the unit gate notices without the browser
suite, and `security-headers.spec.ts` pins the production value; putting the
host back fails both unit assertions on it. The unit file also checks that
`img-src` keeps the image host, and fails when it is dropped.

---

## The `SECURITY.md` corrections

The done-when names this file specifically. Two of its "known gaps" were
**verified false** — checked against the code, not inferred:

**"Household roles are decorative"** says the role "is checked nowhere", "is not
carried in the JWT or the session", that "there is no role-aware tRPC
middleware", and that "any member of a household can perform any operation on
that household's data". All four are false. `CAPABILITY_ROLES`,
`writeProcedure` and `adminProcedure` check the role
(`src/server/trpc/trpc.ts:134,216,230`); `src/types/next-auth.d.ts` declares
`role` on the session non-optionally; roles have been enforced per procedure
since Phase 3.

**"The services layer still throws bare `Error`"** is false: `grep -c "throw new
Error(" src/server/services/*.ts` returns **0**, and
`src/server/services/errors.ts` defines a `ServiceError` hierarchy translated at
the tRPC boundary. `ISSUES.md` DEBT-6 closed it.

A security document that *understates* its own posture is less dangerous than
one that overstates it, but it is still a false claim in the file whose stated
premise is that every claim is checkable against a file — and an operator
reading it would conclude they cannot rely on roles.

Both sections are replaced in the same commit as this document.

---

## What this review could not settle

Named rather than omitted.

- **The adversarial pass did not finish.** Every finding still marked *Reported*
  above is exactly that. The pass that was meant to try to break each claim of
  protection — and, more importantly, to check that each control's named test
  would actually fail without it — died partway. That check is the single most
  valuable thing still owed here, because a control whose test would pass
  without it is not tested.

  It has since been run against §3's controls, and it earned its keep on the
  first try: the sign-in fail-closed test passed with the control it names
  already removed (`7a663a1`). One control, one test that could not fail, found
  by the only method that finds them. That is a rate worth assuming holds for
  the controls nobody has tried this on yet.
- **Nothing was run against a deployment.** No TLS configuration, no proxy
  behaviour, no real Traefik. The per-IP finding in §3 in particular depends
  entirely on how an operator has deployed.

  The TLS configuration has since been measured against the shipped bundle on
  an isolated network (2026-10-12): Go's defaults accepted CBC/SHA-1 suites at
  TLS 1.2, `deploy/traefik.yml` now refuses them, and the release smoke checks
  it (`SECURITY.md`, Release deployment). That is the shipped Traefik, not a
  deployment: a real installation's certificate and the network in front of it
  are still `scripts/smoke-proxy.sh --live`'s to prove, or an external TLS
  scan's.

  So have its connection timeouts, the same way and the same day: Traefik's
  defaults held a quiet keep-alive connection for 180s, the bundle now closes
  it after 60s, and `unit/deployment.test.ts` pins the flags. What a shorter
  timeout cannot do — stop one address holding enough connections to restart
  Traefik — has no fix inside the bundle and is a known gap in `SECURITY.md`.
- ~~**The read path of household isolation.** The tripwire covers writes. Ten
  queries were flagged as unconfirmed on the read side and have not been swept.~~
  **Swept 2026-08-31** — §2.
- **iOS Safari, a real tablet, and a screen-reader pass** — three human passes
  §10 still owes. None is a security pass, and none substitutes for one.

## Which checks should become tests

Phase 7 asks that the review be repeatable. One is built; these are the rest,
in the order they would pay off.

| Test | Tier | Asserts |
|---|---|---|
| ~~Household-scoped ids are looked up~~ | unit | **Built** — `tenant-scoped-ids.test.ts` |
| ~~Every restricted procedure refuses the wrong role behaviourally~~ | integration | **Built** — `integration/capabilities.refusals.test.ts` |
| ~~Security headers reach a response~~ | browser | **Built** — `e2e/security-headers.spec.ts` |
| ~~The registration limiter refuses~~ | integration | **Built** — in `integration/rate-limit.test.ts` |
| ~~Every limiter call site fails closed~~ | integration | **Built** — in `integration/rate-limit.test.ts` |
| ~~A successful upload does what it claims~~ | integration | **Built** — `integration/receipt.upload.test.ts` |
| ~~The image posture holds~~ | build | **Built** — `unit/image-posture.test.ts` (text) + a `RUN` in the Dockerfile that fails the build if `node` is not Bun or npm/npx exist (build); ~~`USER node`/read-only on the running image stay the CI image job's~~ the release job starts the image read-only; nothing asserts the running user (corrected 2026-10-12, §7) |

## The 2026-10-12 review

Reviewed: 2026-10-12, at `e9d62eb` (`v0.1.0-alpha.3`), on branch
`fix/security-hardening-2026-10-12`.

**How it was done, and what it is worth.** Parallel audit lanes read the
application, the HTTP edge, the data layer, uploads and outbound calls, the
release bundle and image, CI and the supply chain. They reported 116 findings.
Each went to two independent verifiers, who tried to refute it from the source
and by running things: 110 were confirmed (26 medium, 60 low, 24
informational), one was rejected, one stayed plausible, and four were disputed.
Merged by cause, the 116 are 75 distinct issues. Each was then decided:
fixed in a commit of its own (a code fix with a test shown to fail without
it); an action only the repository's owner can take; or a risk accepted, with
the reason written down. A final review of the finished branch, from the
angles of bypass, upgrade, pipeline, documentation and code quality, found 20
more defects in the remediation itself, most of them in its documents. The
branch fixed 19 and filed the twentieth as TEST-9 in `ISSUES.md`. As with
Phase 7, this reads code and runs suites and probes; it is not a penetration
test of a deployed instance.

Commits are named by their hash on the branch and by their subject. The squash
merge gives `master` one commit in their place; the pull request keeps every
branch commit, so `git fetch origin pull/<number>/head` makes these hashes
resolve again, and the subject finds the commit in the pull request's list.
Hashes, and not subjects alone, because a hash is the one name a command can
check (D132): `unit/ledger-shas.test.ts` checks that every hash between the
`branch-commits` markers below is a commit of this branch, for as long as the
branch exists.

<!-- branch-commits fix/security-hardening-2026-10-12 since e9d62eb -->

### What it found, and what became of it

The 116 reports, merged by cause, are 75 distinct issues; the remediation plan
counted about fifty, because it folded related headers, Traefik settings and
repository settings into one item each. Every report is in exactly one row
below. *Reports* is how many of the 116 described that issue, with the highest
severity the verifiers gave it; *accepted* points to SECURITY.md,
[*What the 2026-10-12 review accepted*](../SECURITY.md#what-the-2026-10-12-review-accepted),
and *owner* to [Owner actions](#owner-actions).

#### Accounts and sign-in

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 1 | Registration open to anyone who reaches the instance, with no switch; the advice to restrict it at the proxy had no supported way to do so | 3, medium | `e6d263e` close registration after the first account unless the operator opens it; `6974fb6` show that registration is closed instead of a form that cannot succeed (D123). The first-user claim window: accepted |
| 2 | No way to change one's own password or to reset a member's, so a leaked or admin-chosen password was permanent | 2, medium | `9c57340` hash and verify passwords through one helper; `f8f8205` let a person change their own password; `42fc6e9` let an admin reset a member's password |
| 3 | Anyone who knows an address can keep its owner out of sign-in | 2, medium | `f95f282` give known devices their own sign-in budget (D124). A browser that has never signed in: accepted |
| 4 | The identity password rule was documented and never applied; the screens stated a minimum of 8 | 1, low | `3d1c6a6` state the twelve-character password minimum; `65ad102` refuse a password built from the person's own email or name |
| 5 | `register` and `addMember` reveal whether an address has an account | 2, low | Accepted; `first-user` closes the first after the first account |
| 6 | `AUTH_SECRET` overrides the `NEXTAUTH_SECRET` the startup guard checks | 1, low | `1db505d` sign sessions with the secret the startup guard checked. Since the switch to Better Auth (2026-10-15, D135) the same holds by naming the key as both `secret` and `secrets`, so `BETTER_AUTH_SECRET(S)` and `AUTH_SECRET` are ignored |
| 7 | No absolute session lifetime; signing out does not invalidate a copied token | 1, low | `eed8b82` end every session thirty days after sign-in (D125). Per-session sign-out: accepted. Both superseded 2026-10-15 (D135): a day from sign-in for a browser session, and signing out deletes the session's row, so a copied cookie is refused |
| 8 | Cross-site requests rest on `SameSite=Lax` alone: tRPC takes multipart bodies, and input-less mutations take any input | 3, low | `5ebbd85` refuse cross-site and non-JSON requests to tRPC; `9068524` declare void inputs on the mutations that took none. A `__Host-` cookie prefix: rejected (Auth.js already sends `__Secure-` without `Domain`; so does Better Auth since 2026-10-15). The auth API applies the same two refusals since then, and checks `Origin` against `NEXTAUTH_URL` (D135) |
| 9 | `addMember` runs a 64 MiB Argon2id hash per call, unmetered | 1, medium | `cb4db92` meter adding members, which hashes a password; `8d04349` say a too-common password is the problem on the add-member form (final review) |
| 10 | IPv6 clients share the bridge gateway's address; once IPv6 is on, one client rotates through its /64 | 1, medium | `a653ab1` rate-limit IPv6 clients by their /64 prefix. The shared default: accepted |
| 11 | The security log holds every tried email in plaintext | 1, low | `511c193` log an account tag instead of the email a sign-in tried |
| 12 | A missing or plain-HTTP `NEXTAUTH_URL` goes unnoticed | 1, low | `6acd907` warn at startup when the public URL is missing or plain HTTP. Plain-HTTP LAN installs: accepted (D84). Since 2026-10-15 (D135) Better Auth decides `Secure` from `NEXTAUTH_URL` alone, never from a request, and a production instance without it refuses sign-in (503) instead of guessing |
| 13 | Saved offline reads outlive a session that ends without the sign-out button | 1, low | `0f92a3a` forget the previous account's saved reads when its session ends. Up to 24 hours on a device left offline: accepted |
| 14 | The native iOS client's sign-in is undocumented | 1, disputed | No change: nothing here consumes it, and #8 keeps clients without Fetch Metadata working. Since the switch to Better Auth (2026-10-15, D142) there is a native sign-in to document, and SECURITY.md *Authentication* states its contract: no cookies, a signed bearer token from `set-auth-token`, sent as `Authorization: Bearer`, never handed to a request that carried a cookie |

#### Authorisation and data

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 15 | Cross-household attempts were no longer security-logged | 1, low | `2f0d330` record household-scoped misses in the security log |
| 16 | The isolation tripwire ignores `id`, `userId` and `parentId` | 1, low | `1088e94` cover the cross-household cases the tripwire cannot see |
| 17 | Four write paths lock a product row before checking its household | 1, info | `46ce862` take row locks only inside the caller's household |
| 18 | Receipt reads return the OCR dump, image path and uploader to every member | 1, low | `e51c722` return only the receipt fields the screens use |
| 19 | An error log line can print Prisma's argument tree, hash included | 1, info | `96edf58` keep Prisma's argument dump out of error logs |
| 20 | Concurrent location moves can form a cycle, and a later move loops forever | 1, medium | `b03754b` keep location moves from forming a cycle |
| 21 | `register` and `household.create` can leave households with no members | 1, info | `2901d98` claim the account atomically when creating a household; `e6d263e` registers in one transaction |
| 22 | An offline change resent after seven days is applied twice | 1, low | `366b303` keep replay records for ninety days. The client-side age gate: `ISSUES.md` OFFLINE-1 |
| 23 | No `CHECK` constraints in the database | 1, info | Accepted; filed as `ISSUES.md` DB-1 by `cb972d4` file the defects the security review deferred |
| 24 | `generateFromLowStock` races itself | 1, disputed | An integrity defect, not a security one: filed as `ISSUES.md` SHOP-2 by `cb972d4` |
| 25 | Free-text inputs have no maximum length, including the unauthenticated ones | 2, medium | `bbf5c00` bound every free-text input; `b9a4221` accept only whole numbers for the history limit |
| 26 | No inventory of personal data, an export that cannot answer an access request, and no erasure | 3, low | `67f9126` inventory personal data, outbound connections and secret handling; `77d6db1` document deleting a person's account by hand. In-app erasure: accepted |

#### HTTP edge and headers

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 27 | A `Purpose: prefetch` header skips the proxy's body cap, and an unauthenticated POST is read whole | 2, medium | `2e9b15f` build the tRPC route handler in one testable function; `bbbdf54` bound request bodies in the API routes, not only in the proxy |
| 28 | One tRPC batch runs hundreds of calls and writes a log line for each | 2, medium | `881c578` cap the number of calls in one tRPC batch; `46564ae` write at most one refusal line per anonymous tRPC request (final review, D131) |
| 29 | tRPC responses carry no `Cache-Control` | 1, low | `3ff5fa8` mark every tRPC response no-store |
| 30 | The proxy matcher's exclusions are unanchored prefixes | 1, low | `5c580a6` anchor the proxy matcher's exclusions |
| 31 | `/_next/image` is live although nothing uses it | 1, low | `59b7e59` turn off the unused image optimizer |
| 32 | HSTS asks for preloading of the operator's domain | 2, low | `5ebd8ed` stop inviting HSTS preloading of the operator's domain (D126) |
| 33 | No Cross-Origin-Opener-Policy or Cross-Origin-Resource-Policy | 1, low | `ca43add` isolate Stoky's pages and resources from other origins |
| 34 | Permissions-Policy names four features and claims to deny all | 1, info | `7df7574` deny the browser features Stoky does not use |
| 35 | Product pages send the instance's origin to Open Food Facts; `connect-src` allows it needlessly | 2, low | `d9a2e37` keep the instance's origin out of the Referer sent to other origins (D127); `a18df04` drop Open Food Facts from connect-src |
| 36 | Prefetch-labelled document requests skip the proxy | 1, disputed | Documents are `no-store`, so nothing caches them: `d83d80e` corrects §8 and pins `no-store` in e2e |
| 37 | An absolute-form request line becomes an open redirect | 1, rejected | No change: a browser never sends an absolute-form request line to an origin server, so only the client that wrote one is redirected |

#### Logs

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 38 | Container logs grow without bound, and every failed sign-in printed a stack | 2, medium | `f860b9f` rotate the bundle's container logs; `32a324b` log failed sign-ins without a stack trace each. An anonymous client rotating the log out: accepted |

#### Uploads, OCR and outbound calls

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 39 | One receipt can exhaust the container's memory: OCR at full resolution with no timeout | 1, medium | `faf6ce8` downscale receipt photos to a 4000-pixel long edge; `8b86b42` time out recognition and replace a stuck worker; `a713491` fail receipts a restart left processing |
| 40 | Re-encoding can turn 7 MB into 47 MB, with no quota and nothing deleted | 1, medium | `c910183` refuse a re-encoded receipt larger than the upload limit. The quota: accepted, `ISSUES.md` UPLOAD-1; Phase 7 #16 stays open |
| 41 | ICC profiles and application segments survive the re-encode | 1, low | `88f1560` strip colour profiles and application segments from stored receipts |
| 42 | Open Food Facts lookups have no deadline, are unmetered, and ask again for every miss | 2, low | `dbc2756` time out Open Food Facts lookups; `dc2d9bd` remember barcodes Open Food Facts does not know; `addb78e` meter Open Food Facts lookups that miss the cache; `c7f243c` remove the unused Open Food Facts search; `e4a7fad` identify Stoky to Open Food Facts by version and project URL |
| 43 | The scanners cannot see the Bun runtime and its image decoders, and nothing re-scans a published image | 3, medium | `77356c8` re-scan the published release images every week (closes Phase 7 #17; its first run is an owner action). Bun's absence from Trivy's inventory: accepted |

#### Release bundle and image

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 44 | Valkey has no memory bound, no service has a process limit, Traefik runs as root | 2, low | `d3f44ee` bound Valkey's memory with least-recently-used eviction (D129); `47f700c` limit how many processes each service may start. Traefik as root: accepted. Fixed CPU limits: rejected |
| 45 | Traefik accepts CBC-SHA1 suites | 1, low | `ab7601c` require TLS 1.2 or later with forward-secret AEAD suites (D128) |
| 46 | Traefik holds idle connections, with no per-address cap | 1, low | `881f41e` close idle client connections sooner at Traefik. A per-address cap: accepted |
| 47 | Traefik checks for new versions | 1, info | `ca63982` stop Traefik checking for new versions |
| 48 | The bundle's service images and the Bun base are named by mutable tags | 5, medium | `526ca29` update Traefik to v3.7.14; `3574344` pin the bundle's service images by digest (D130); `069734b` pin the Bun base image by digest |
| 49 | Bun 1.4.0, three patches behind TLS and HTTP fixes | 1, low | `56be452` update Bun to 1.4.3 for its TLS and HTTP fixes |
| 50 | The install downloads follow any redirect | 1, info | `315efe0` refuse non-HTTPS redirects in the install downloads |
| 51 | The application is PostgreSQL's superuser, and Valkey has no password | 1, low | Accepted |
| 52 | Secrets reach the containers as environment variables, and backups hold them in plaintext | 1, info | Documented by `67f9126`; `_FILE` secrets: accepted |
| 53 | The production image ships the demo seed, runnable, with a published password | 1, info | `89edbb5` leave the demo seed out of the production image; `fe985f9` make the demo seed refuse production and apply atomically |
| 54 | `.dockerignore` matches only the context root | 1, disputed | Not exploitable from CI's clean checkout; fixed as hygiene by `8a6b485` exclude nested env files and local agent state from the build context |
| 55 | The Prisma engines enter the image unverified | 1, low | `7b5bbeb` verify the Prisma engines against pinned checksums |
| 56 | Next's preview id and Server Action key are in the public image | 1, info | `4660375` refuse Server Actions that would carry bound values. The keys themselves: accepted |
| 57 | A refused migration leaves the app in a restart loop, and the release notes' remedy fails | 1, low | `8a3a994` explain recovery from the failed email normalisation migration |

#### CI and release integrity

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 58 | Cancelling a run mid-publish can leave an image unattested | 1, plausible | `6165fa0` never cancel a started run that can publish an image |
| 59 | A `workflow_dispatch` from any branch publishes an image | 2, low | `b3fe22c` publish images only from pushes |
| 60 | Two actions pinned to tag objects, not commits | 1, info | `5bc8fc6` pin the attestation and SARIF actions by commit |
| 61 | Releases are rebuilt from shared caches, and the pushed digest is never scanned | 2, medium | `648f6c8` build and package releases without restoring caches; `7891107` scan the pushed release digest before promoting it. `master`'s `latest` from the cache: accepted |
| 62 | The bundle names the application image by a mutable tag | 1, medium | `09ecfb6` name the release image by digest in the packaged Compose file |
| 63 | Release assets are unsigned and releases mutable | 3, medium | `47692a9` attest the release installation files. Immutable releases: owner. alpha.1 and alpha.2 unattested, and the `candidate-` label: accepted |
| 64 | Unattended agents push as the owner, past the documented branch rule | 1, medium | `d6a999f` align the workflow summaries with the branch rule for agent work. An identity for agents and the signing decision: owner |

#### Supply chain and repository

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 65 | Nothing proposes dependency, action or image updates | 2, low | `d1d1723` let Dependabot propose dependency, action and image updates. Security updates and the ruleset exclusion it needs: owner |
| 66 | Packages are installed the day they are published | 1, low | `4c4e9f4` hold newly published packages for three days before installing them |
| 67 | Install scripts allowed for packages that do not need them | 1, low | `3f4f556` allow install scripts only for the packages that need them |
| 68 | Type packages and TypeScript listed as runtime dependencies | 1, info | `64c7d6d` list only what the application runs as dependencies |
| 69 | No licence text; empty OCI licence labels | 2, info | `c229051` add the ISC licence text the manifest declares. Confirming the holder: owner |
| 70 | The private reporting channel SECURITY.md names is switched off | 2, low | `fc63185` route vulnerability reports to the private advisory form. Switching it on: owner |
| 71 | Secret scanning, push protection and CodeQL off; any action allowed; fork runs approved only for first-timers | 4, low | `ec35c67` codify the repository's security settings with a drift check; `d141544` lint the workflows with zizmor. The settings: owner |
| 72 | Release tags can be moved; the signature rule is bypassed by its only pusher | 2, low | `ec35c67` (the tag rulesets). Applying them, and deciding on signing: owner |
| 73 | Merge and rebase merges allowed; merged branches kept | 1, info | `ec35c67` (squash-only merges). Applying them and deleting two branches: owner |

#### Documentation

| # | Issue | Reports | Outcome |
|---|---|---|---|
| 74 | The repository described as private and its attestations as absent | 6, low | `c36087b` describe the repository as public, with attested images |
| 75 | Procedure and exemption counts, the header and sign-out posture, and the pre-Bun production Compose file misstated | 3, info | `e465b2b` correct the procedure counts and image description in the security review |

#### Commits no audit report named

Two enabled others (`2e9b15f`, `9c57340`, above). `990c606` build the same
image whatever the host's umask fixed an image that would not start when built
from a checkout made under umask 077, found while building it. The final
review's own findings were fixed in the commits they concerned before this
record was written, or in commits of their own: `46564ae` and `8d04349`
(above), `7c31e41` point the rate-limit defaults at the code, and the
re-encoder at Bun.Image, `b633684` give SECURITY.md log commands that parse
Compose's output, `f31572c` count seven persisted offline queries in STATUS,
`f1c2921` title SECURITY.md's rate-limit section by what it limits, and
`13916c9` point the document map at the root ISSUES.md and SECURITY.md. The
twentieth, a test gap in the member reset, is `ISSUES.md` TEST-9 and is
accepted until fixed. `b61b451` and the commit after it record the review.

The four disputed findings (#14, #24, #36, #54) and the rejected one (#37) are
in the tables with the reason nothing, or only hygiene, changed. Remedies
considered and rejected, with their reasons, are recorded beside the change
each concerned (`SECURITY.md` and `docs/PROGRESS.md`): for example `sniStrict`,
Valkey `noeviction`, counting only failed sign-ins, comparing `Origin` with
`NEXTAUTH_URL`, `Referrer-Policy: no-referrer`, and `enable_ipv6` by default.

<!-- /branch-commits -->

### Accepted

`SECURITY.md`, [*Known gaps*](../SECURITY.md#what-the-2026-10-12-review-accepted),
lists each accepted risk with its reasoning and what would change it: the
nineteen the remediation plan accepted, and two the final review added (an
anonymous client can still rotate the log out, and TEST-9's untested guard).
None lets one household read or change another's data. The Better Auth
migration (below) closed one of the nineteen, per-session sign-out (PROGRESS
D135, D143), which leaves twenty accepted here; what the migration accepted
of its own is listed with it.

### Owner actions

The branch cannot change repository settings. Seventeen actions are the
owner's; `docs/STATUS.md` records which are still pending, as measured.

- **Ten settings `scripts/github-settings.ts` codifies** (`check` reads them
  with GET requests only; `apply` writes those that drift): private
  vulnerability reporting, immutable releases, secret scanning with push
  protection, CodeQL default setup with the extended suite, Dependabot
  security updates, an Actions allow-list with SHA pinning (once the
  re-pinned actions are on `master`), approval for every external
  contributor's workflow runs, squash-only merges that delete their branch,
  the two release-tag rulesets, and the ruleset exclusion that lets
  Dependabot open branches. Dependabot alerts, the script's twelfth check, are
  already on.
- **Seven with no script:** a decision on commit signing; an identity for
  unattended agents without the ruleset bypass; deleting two merged branches;
  refreshing the alpha.2 release notes; confirming the LICENSE holder;
  deleting the audit verifiers' test data from the development database and
  Valkey (a verifier registered `a@b.co` there, and agents may not write to
  it); and, after the squash merge, running `bun scripts/github-settings.ts
  check` and the new workflows once, the first `rescan.yml` among them.

---

## The Better Auth migration (2026-10-15)

Done on branch `feat/better-auth-2026-10-15`, stacked on the 2026-10-12
review's branch: next-auth 5.0.0-beta.32 replaced by Better Auth 1.7.7, with
sessions as database rows, two-step verification, passkeys and per-device
session control (PROGRESS D134–D151). Its findings came from four places,
and each was checked against the code, or measured, before a commit
answered it:

- **The spike** (branch `spike/better-auth-2026-10-15`, not for merging),
  which ran Better Auth beside next-auth against a production build on a
  scratch database. It found the schema it refuses, the native client's
  403, the bearer header past `HttpOnly`, single-use TOTP missing, the
  backup codes' storage and the missing session limits.
- **Better Auth 1.7.7's own source**, read for the swap: the environment
  variables it obeys over its options, the endpoints it mounts, how it
  defaults `rememberMe` and never clears `dont_remember`, and what
  `/two-factor/get-totp-uri` and `disableSession` do.
- **Three independent reviews of the migration plan** (*plan review* below).
  Every claim in them was checked against the code and the installed
  package before the plan changed for it; those that did not hold were
  rejected in the plan, not here.
- **The owner's answers of 2026-10-15** to the plan's eleven open questions
  (below).

As with the 2026-10-12 review, this reads code and runs suites and probes —
here against the real auth route, a software WebAuthn authenticator and the
release bundle — and is not a penetration test of a deployed instance.

Commits are named by hash and subject, as in the 2026-10-12 record and for
the same reason (D132): the squash merge replaces them, the pull request
keeps them, and `git fetch origin pull/<number>/head` makes them resolve
again. This record's own commit is not named (D113).
`unit/ledger-shas.test.ts` checks that every hash between the markers below
is a commit of this branch while the branch exists.

<!-- branch-commits feat/better-auth-2026-10-15 since f8090fe -->

### What the migration found, and which commit answered it

#### Two-step verification

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 1 | One TOTP code accepted as often as it is sent inside its window (ASVS 5.0.0 6.5.1; `ISSUES.md` AUTH-5) | spike | `1b0f250` add TOTP two-step verification with single-use codes (D148): a before-hook claims the code's time step in the `UPDATE` that checks it |
| 2 | A time-of-check gap: the hook's clock and Better Auth's can straddle a step boundary and let a code through unclaimed | plan review | `1b0f250`: a code matching no step is replaced with one no step produces, so Better Auth refuses it and counts it; a test holds the row locked while two requests with one code reach the claim, and one gets in |
| 3 | Backup codes of about 60 bits, kept encrypted with the signing secret (6.5.2; AUTH-6) | spike | `4df6c3b` store two-factor backup codes as hashes (D149): 120 bits, SHA-256. Enrolment opened only after it, in `6cb7597` set up two-step verification in settings, so no commit hands out a weak code |
| 4 | An authenticator whose secret no longer decrypts — the signing secret was rotated — would fail every code from then on, with nothing to say why | plan review | `1b0f250`: `TWO_FACTOR_UNREADABLE`, not counted, logged `auth.twofactor.unreadable`; `ab5fd7e` ask for the authenticator code when signing in says so; the way back is a hashed backup code (`4df6c3b`) or an admin (#8) |
| 5 | `/two-factor/get-totp-uri` hands the decrypted secret to whoever holds the session, with no password | plan review | Never allowlisted: `6cb7597` opens `enable`, `disable` and `generate-backup-codes` and not it, and `integration/auth.surface.test.ts` tries it |
| 6 | `disableSession` on a backup code spends the code without creating a session; `trustDevice` skips the code on that browser for a month | plan review | `1b0f250`: both verify steps forward `code` alone |
| 7 | A challenge in progress outlives a password reset, a removal and every "end these sessions" — whoever holds it has the password | plan review | `1b0f250`: `endSessions` deletes the account's challenges, and a password change does too |
| 8 | A lost authenticator with no backup code left is recoverable only by the operator's SQL | owner question | `ec337af` let an admin remove a member's two-step verification (D150), after the admin's own password, ending all of the member's sessions |
| 9 | A challenged password step leaves its charge standing, and the code step has no account to charge | plan review | `1b0f250`: the budget settles at the password step; the code is charged per address, and counts as a sign-in only with the challenge cookie and a session in the answer |

#### Session lifetime and count

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 10 | No idle timeout under a day and no absolute lifetime for a session that was not remembered | spike | `6d72999` replace next-auth with Better Auth (D135): fifteen idle minutes, a day from the password at most |
| 11 | Background polling would keep a session alive: any read that slides the row defeats the idle limit | plan review | `6d72999`: only the keep-alive's `auth.session` slides a browser session; a database hook drops `expiresAt` from every other update to one |
| 12 | Better Auth re-creates the session at a password change and at 2FA on or off, resetting `createdAt` — the cap would restart and the kind be lost | plan review | `6d72999`: `authenticatedAt` is the cap's clock and is inherited; `07ff646` inherits the kind; `5a72c10` keep this device signed in when its password changes tests both kinds and the device |
| 13 | Better Auth reads an omitted `rememberMe` as true, and never clears `dont_remember`, so a ticked box after an unticked sign-in was ignored | Better Auth's source, plan review | `07ff646` keep a person signed in when they ask to (D141): only a literal `true` counts, and a ticked sign-in expires the stale cookie |
| 14 | A sign-in leaves the session the browser presented alive, and expired rows forever (ASVS 5.0.0 7.2.4) | plan | `0454989` tidy a person's stale sessions at sign-in (D139) |
| 15 | No limit on concurrent sessions (7.1.2) | owner question | `48d45b6` cap each account at ten concurrent sessions (D140) |
| 16 | The warning before a session ends offered "Seguir conectado" when nothing could extend the deadline (WCAG 2.2.6) | plan | `6a4c1f1` tell an idle timeout from the session limit in the warning |
| 17 | Prisma reads `{ id: { not: undefined } }` as no condition, so "end the other sessions" without a session id ends every one | plan review | `86c2392` let a person end their own sessions after re-entering the password: the session id is required and `endSessions` refuses the filter; `0454989` builds the tidy's `OR` without the clause |

#### Tokens and native clients

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 18 | The bearer plugin's `set-auth-token` on every answer that sets the session cookie, readable by script: a long-lived credential past `HttpOnly` | spike | `6d72999`: the route drops it, and its `Access-Control-Expose-Headers` entry, from any answer to a request that carried a cookie; `f010959` sign native clients in with bearer tokens (D142) keeps that, with signed tokens only |
| 19 | Native clients refused 403 on sign-in and every bearer POST: the proxy wrote a device cookie into requests that carried none | spike | `5688e51` never mint a device id for an auth API or bearer request (AUTH-4) |
| 20 | The session token in JSON answers, and `/list-sessions` answering every session's token | spike, Better Auth's source | `6d72999`: `token` and `session.token` dropped from every body, `/list-sessions` closed; `86c2392`'s own list names its columns |
| 21 | The user agent alone cannot tell a household's devices apart in a session list | plan review | `86c2392`: `Session.deviceId`, never returned, joined to the screen the device chose; `f8e8ff8` show your devices in security settings |

#### Configuration and the endpoint surface

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 22 | Better Auth refuses to serve while `User` has a required column it never writes (`passwordHash`; AUTH-2) | spike | `835d08f` route every password hash through one credentials module; `b570f51` move password hashes into a credential Account row (D134) |
| 23 | `BETTER_AUTH_SECRET(S)` and `AUTH_SECRET` used over the options' secret; `BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_TELEMETRY` obeyed whatever the options say (AUTH-3) | Better Auth's source, plan review | `6d72999`: the secret named as both `secret` and `secrets`; `57f5ae3` refuse to start on settings Better Auth would misread (D136) |
| 24 | `betterAuth()` starts its initialisation and schema check at import, and `next build` runs with no secret | plan | `6d72999`: built on first use; the production image builds from the tracked files with no secret (measured in `docs/STATUS.md`) |
| 25 | About forty endpoints mounted, and whatever a later version adds | plan | `6d72999`: a method-and-path allowlist, 404 before Better Auth, each POST rebuilt from the keys its endpoint needs, a sign-in charged before its JSON is believed; seventeen answer at the end of the branch |
| 26 | Environment names that libraries read on their own (`NEXTAUTH_*`, `AUTH_*`, `BETTER_AUTH_*`) | owner question | `3069482` read the signing secret from STOKY_SECRET (D137); `6fd9ab6` list every address the instance answers at in STOKY_URLS (D138) |
| 27 | One trusted origin: a plain-HTTP LAN install reached at several addresses gets 403 | plan | `6fd9ab6`: every listed origin is trusted; an https first entry beside non-loopback plain HTTP is refused at start-up, since its `Secure` cookie would loop the others back to the login page |

#### Passkeys

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 28 | A relying party is one host, and accepting several origins would let a signature made for one address pass at another | plan | `b692fdd` sign in with passkeys on the server (D151): `rpID` and `origin` from the first `STOKY_URLS` entry only; `0472d47` manage passkeys in settings says which address works; `55d5b05` offer passkey sign-in on the login page offers it there only |
| 29 | Better Auth's `freshAge` counts from the row's creation, which a re-create resets and a remembered row's age defeats: no stand-in for a re-entered password | plan | `6d72999` (`freshAge` 0); `b692fdd`: a single-use step-up bound to the session, written by `auth.confirmPassword` |
| 30 | User verification only "preferred" at sign-in, and checked nowhere: a key without a PIN is one factor | Better Auth's source | `b692fdd`: `required`, and both ceremonies refuse an answer without the flag |
| 31 | `Permissions-Policy` denied `publickey-credentials-create`, so no browser could register one | the server half of passkeys, reading the headers | `0472d47`: both passkey features `(self)` |

#### Re-entering the password

| # | Finding | Found by | Answered by |
|---|---|---|---|
| 32 | A rotated cookie never reaches the browser: tRPC's streaming link sends the headers before the mutation sets it — measured, the device was signed out by its own password change | plan review | `5a72c10`: `auth.changePassword` goes through a link that does not stream |
| 33 | A stolen session could spend the re-entry budget the owner needs to end it | plan review | `86c2392`: five per session, refunded on a right password, and twenty per account |
| 34 | `household.revokeMemberSessions` accepted the caller's own id, ending an admin's own sessions with no password | building the admin's screen | `6304f23` let an admin end a member's sessions (D145) |
| 35 | Removing a member left their sessions alive (ASVS 5.0.0 7.4.2) | plan | `304efb3` end a member's sessions when they are removed (D146) |
| 36 | No way to sign a whole household out after a compromise (7.4.5) | plan | `77d8811` let an owner end every session in the household (D147), behind the owner's password |

#### Commits no finding named

Preparation the swap rested on: `68846e7` own the session type the app
reads, `231ccde` take sign-in throttling out of the credentials provider,
`f9b90a6` record each successful sign-in (ASVS 5.0.0 16.3.1), `4adfb27` put
the browser's auth calls behind one module, `2c91b88` render the login form
from a server page, `c1c1fc5` add a Checkbox primitive and `3a46dd8` add the
session and verification tables. After it: `771bb29` drop the
sessions-valid-from column and `1e67210` move the password form to security
settings.

<!-- /branch-commits -->

<!-- branch-commits feat/better-auth-2026-10-15 since f8090fe -->

### What the review of 2026-10-16 found

A review of the finished branch, before its full run: eleven reports, each
checked against the code and Better Auth 1.7.7's source and, where it could
be, reproduced through the real route. Two were one defect (the enrolment
code's budget), so ten fixes. Each has a test that went red without it.
Where the commit that brought the defect could take the fix, it was folded
in, which rewrote the hashes in the table above; where the fold conflicted
with a later commit, the fix landed after this record, as a commit of its
own that names the one it corrects.

| # | Finding | Severity | Fixed in |
|---|---|---|---|
| R1 | A bearer token skipped the passkey step-up, and its TOTP enrolment code was never claimed: Better Auth hands other before-hooks the request before the bearer plugin turns the token into a cookie, so the policy plugin saw no session and stood aside | high | `b692fdd` sign in with passkeys on the server (the step-up, which now refuses a request with no session too) and `1b0f250` add TOTP two-step verification with single-use codes (the claim): both read the session through the bearer plugin's own conversion |
| R2 | A member's password reset left any passkey added with the old password working | medium | `b692fdd`: the reset's transaction removes the member's passkeys |
| R3 | Wrong authenticator codes were limited per quarter of an hour and never capped: about 960 a day for whoever has the password | low | `ea7f74f` cap a sign-in's wrong authenticator codes per account per day |
| R4 | A request still carrying the pre-rotation cookie could expire the rotated one: a session read that finds the row gone expires the cookie, and `nextCookies` puts that on the tRPC answer | low | `67724d5` never expire the session cookie from a session read |
| R5 | A locked second step was refused 429 without `Retry-After` | low | `e870265` say when a locked second step may try again |
| R6 | The enrolment check's code was charged to sign-in's per-address budget and never given back | low | `ea455cd` charge a signed-in session's authenticator code to its own budgets |
| R7 | A page on another site could spend the passkey options' per-address budget with `<img>` GETs | low | `b692fdd`: Fetch Metadata on the auth API's GETs too |
| R8 | A passkey's name had no server-side bound | low | `b692fdd` (`passkeyNameSchema`) and `3baf15b` bound the passkey rename field by the route's own limit |
| R9 | "Mantener la sesión iniciada" came back unticked from the code step | low | `ab5fd7e` ask for the authenticator code when signing in |
| R10 | Focus fell to `<body>` when the action a dialog confirmed removed its opener | low | `f8e8ff8` show your devices in security settings (`Dialog`'s `fallbackFocus`), `6cb7597` set up two-step verification in settings, `ec337af` let an admin remove a member's two-step verification and `0472d47` manage passkeys in settings |

<!-- /branch-commits -->

### The owner's decisions of 2026-10-15

The plan's eleven open questions, answered by the owner, and recorded in
PROGRESS where each was built:

- **The kitchen's shared account may enrol** two-step verification and
  passkeys (D148, D151); the add dialog still advises against a passkey on a
  device other people use.
- **A household admin may remove a member's two-step verification**, after
  the admin's own password (D150).
- **Ten sessions per account**, the least recently used ended by the
  eleventh sign-in (D140).
- **"Mantener la sesión iniciada" unticked by default**, with a hint to tick
  it on home devices used every day, the kitchen screen included (D141).
- **No password for an admin ending a member's sessions** (D145); the
  owner's household-wide end asks for it (D147).
- **No two-step verification on native clients yet** (D142).
- **TOTP's ±1-step window** kept, an ASVS 5.0.0 6.5.5 deviation (D148), and
  **re-entry without token rotation**, a 7.2.4 deviation (D143).
- **Better Auth's versioned secrets not adopted**: the condition was "only
  if trivial", and keeping old enrolments readable needs a second variable,
  operator-chosen version numbers and every retired value kept until each
  enrolment is redone. Rotation's consequences are documented instead; the
  stored secrets already carry the `$ba$1$` envelope, so adopting versions
  later is additive.
- **`uqr` 0.1.3** draws the QR code in the browser (D148).
- **`STOKY_SECRET` and `STOKY_URLS`** replace `NEXTAUTH_SECRET` and
  `NEXTAUTH_URL`; the old names are read, with a warning, until a later
  release (D137, D138).

### What the migration accepted

`SECURITY.md`, *Authentication*, states each of these where it applies, with
the reason; none lets one household read or change another's data.

- A TOTP code is good for its step and the one either side, up to ninety
  seconds (ASVS 5.0.0 6.5.5); single use is what stops a replay inside it.
- Re-entering the password confirms one action and does not rotate the
  session token (7.2.4).
- A remembered session asks for the password once a year, against NIST SP
  800-63B-4's thirty days for a password alone; a browser session meets
  AAL2's figures.
- A second factor is each person's choice, not required (6.3.3).
- An account with two-step verification signs in from a browser only.
- Whoever holds an admin's session can sign the household's non-owners out
  without a password; they can sign straight back in.
- Rotating `STOKY_SECRET` signs everybody out, changes every account tag in
  the security log and makes every authenticator unreadable; passwords,
  passkeys and backup codes survive it.
- A password change is three statements of Better Auth's, not one
  transaction.
- "Least recently used" is as coarse as a day for remembered sessions,
  because no row is written on every request.
- A plain-HTTP LAN install, or one at an IP address, has no passkeys
  (added to D84's entry in *What the 2026-10-12 review accepted*).
- Somebody who has an account's password can spend its twenty wrong
  authenticator codes for the day and keep the owner's authenticator out
  until the day's window ends (R3); recovery codes and passkeys still sign
  in, and the cost says the password needs changing.

### What an operator meets on upgrading

- **Everybody signs in once**, and **each kitchen tablet should be signed in
  with "Mantener la sesión iniciada" ticked**, or it asks for the password
  after fifteen idle minutes
  ([Install](INSTALL.md#upgrade-and-rollback)).
- **`NEXTAUTH_SECRET` becomes `STOKY_SECRET`**: the new `install.sh` renames
  the line in place and keeps its value, and the old name is read with a
  `[config]` warning until it is renamed. **`NEXTAUTH_URL` becomes
  `STOKY_URLS`**, a list; the bundle sets it from `DOMAIN`
  ([Install](INSTALL.md#2-configure-env),
  [Upgrade](INSTALL.md#upgrade-and-rollback)).
- **Rolling back to v0.1.0-alpha.3 needs the pre-upgrade dump**: the
  password hashes move to a new table
  ([Install](INSTALL.md#upgrade-and-rollback)).
- **Rotating the secret voids every authenticator enrolment**
  ([Install](INSTALL.md#rotating-stoky_secret)); a lost one is recovered with
  a backup code, by an admin, or for a sole owner by the operator
  ([Install](INSTALL.md#a-lost-authenticator)).
- **Passkeys need https on a domain name, and work only at the first
  `STOKY_URLS` address**; changing that address orphans every passkey
  ([Install](INSTALL.md#2-configure-env)).

### Open for the owner

None blocks the merge.

- **Compose no longer refuses an empty secret** (`${NEXTAUTH_SECRET:?}` is
  gone): the line passes the value through so the legacy name and its
  warning work, and the app refuses an empty secret at start-up instead.
  Acceptable?
- **Which release stops reading `NEXTAUTH_SECRET` and `NEXTAUTH_URL`.** The
  documents say "a later release", without a date.
- **Should removing a member's two-step verification also remove their
  passkeys?** It does not (D150, D151): they are another way in, with their
  own removal.
- **The bundle lists only `https://DOMAIN`**, the one host Traefik routes;
  more addresses there would need Traefik routing as well as `STOKY_URLS`.
- **Should ending a member's sessions, or the whole household's, remove
  passkeys too**, as a password reset now does (R2)? It does not: neither
  changes a password, which already lets whoever knows it back in.
- **Twenty wrong authenticator codes a day per account** (R3,
  `RATE_LIMIT_TWO_FACTOR_CODE_*`) is the review's number, twice Better
  Auth's lock; the owner may prefer another.

---

## Related

| Document | What it holds |
|---|---|
| `SECURITY.md` | The threat model, what is hardened, and the operator's half |
| `ISSUES.md` | SEC-1, the first of §2's family, and every other filed defect |
| `docs/STATUS.md` | The gate results this review's verified claims were measured against |
| `docs/REDESIGN_PLAN.md` §9 | Phase 7's scope, which this document answers |
