# Security review — Phase 7

Reviewed: 2026-08-26, at `8bb2547`.

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
| 17 | A published image is never re-scanned | Medium | Reported | operator |
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
  Allocation is *not* unbounded — Next caps a request body at
  `experimental.proxyClientMaxBodySize` whenever a middleware is configured, and
  this application's matcher covers `/api/trpc`. Measured on a running server:
  10,000,080 bytes parsed, 10,485,840 did not.

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

- Every stage derives from the pinned `oven/bun` Alpine image, and the
  production stage runs `USER bun` and never returns to root
  (`unit/image-posture.test.ts`). `bun` is uid and gid 1000, the old `node`
  account's, so uploads written before the change stay writable; a `RUN` in the
  production stage fails the build if that stops being true.
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
cannot be the example one*). The re-scanning item is not re-examined by this
correction.

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
to exactly its two sources, which is what proves the dev tail (`ws:`,
`http://localhost:*`) never ships.

**The prefetch-skip is real, and bounded.** Measured: a request labelled
`Purpose: prefetch` does skip the proxy, so `proxyClientMaxBodySize` does not
apply to it — an oversized upload's whole body arrives instead of being
truncated. But it is still refused, one layer deeper, by `fileBase64`'s Zod
`.max` (`MAX_RECEIPT_BASE64_LENGTH`), the second bound added for exactly the
case where the proxy cap does not fire. So the label bypasses the cap, not the
refusal; the body stays bounded by validation on an authenticated,
rate-limited endpoint. Pinned by "an oversized POST is refused by two
layers": unlabelled → the proxy truncates → tRPC's `Unterminated string`;
labelled → the full body → Zod `too_big`. The residual — the full body is
buffered before Zod refuses it — is a low-severity memory cost behind auth and
the 30/hour upload meter, worth knowing rather than fixing.

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

---

## Related

| Document | What it holds |
|---|---|
| `SECURITY.md` | The threat model, what is hardened, and the operator's half |
| `ISSUES.md` | SEC-1, the first of §2's family, and every other filed defect |
| `docs/STATUS.md` | The gate results this review's verified claims were measured against |
| `docs/REDESIGN_PLAN.md` §9 | Phase 7's scope, which this document answers |
