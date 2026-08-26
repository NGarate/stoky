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
| 7 | Half the restricted procedures have no behavioural refusal test | Medium | Reported | owner |
| 8 | No server-side session revocation | High | Reported | owner |
| 9 | The per-IP rate-limit key is attacker-controlled without a sanitising proxy | High | Reported | operator + owner |
| 10 | The registration rate limit is exercised by no test | High | Reported | owner |
| 11 | Fail-closed is unproven at every limiter call site | High | Reported | owner |
| 12 | Nothing asserts a security header reaches a response | High | ✅ Closed `4c6fb90` | — |
| 13 | The upload size cap is applied after the body is in memory | High | Reported | owner |
| 14 | The size cap counts bytes; decoding cost is in pixels | High | Reported | owner |
| 15 | No test ever performs a *successful* upload | Medium | Reported | owner |
| 16 | Uploaded images are never deleted | Medium | Reported | owner |
| 17 | A published image is never re-scanned | Medium | Reported | operator |

Nothing here is rated critical. Two findings were reported as critical by an
audit and are recorded above at high: they are the same defect as #1 and #2,
counted twice.

---

## 1. Authorisation, per procedure

**Verified, and this half is genuinely solid.** There are **60 procedures**
across ten routers. `src/__tests__/unit/capabilities.test.ts` pins every one of
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

**Reported, not verified:** of the 28 restricted procedures, roughly half have a
test that calls them as a role that must be refused; the rest rely on the
declaration test, which reads source text and calls nothing. The same audit
reports that the declaration test can miss a procedure declared across two lines
or inside a nested sub-router. Both are worth confirming before acting.

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
time. Ten exemptions carry their reason, and every one is a *read* whose query
already filters by household, which is the distinction the rule turns on.

Its two blind spots were found by removing real guards and watching it stay
green — it read only inline Zod, and its schema scan truncated every schema at
its first line. Both are recorded in the file, because a guard with a silent
blind spot reports a pass it has not earned.

**Reported, not verified:** the same audit lists ten queries whose household
scoping it could not confirm by reading. The tripwire covers the *write* path;
reads are a separate sweep and have not been done.

## 3. Rate limiting

**Verified as present and shaped correctly.** Sign-in is counted per address and
per account on a hashed key (NIST SP 800-63B §5.2.2); `receipt.upload` is
metered before the file is decoded (ASVS V11.1.4); a 429 carries `Retry-After`
read off the refusal (RFC 9110 §10.2.3); refusals are logged as JSON from a tRPC
middleware so a resolver cannot forget to be audited (ASVS V7.1.3). These are
the four gaps Phase 3 left and Phase 7 was to close, and they are closed.

**Reported, not verified, and the strongest set in this review:**

- The **per-IP key is attacker-controlled** on any deployment without a
  header-sanitising proxy — the documented Traefik setup does sanitise, but the
  project supports being run behind whatever the operator already has. With no
  proxy header at all, every caller shares one bucket, which turns a per-IP
  limiter into a global one.
- The **registration limit is exercised by no test**, because every test builds
  its tRPC context without headers.
- **Fail-closed is unproven at the call sites.** That `consumeRateLimit` throws
  when Valkey is down is tested; that each caller *refuses* rather than
  continuing is not.

Each is a finding with an owner rather than a fix, because the first is partly
an operator's decision and the other two are tests somebody has to write.

## 4. The offline queue as an attack surface

**Verified by the existing suite**, which is unusually thorough here: `withReplay`
claims the key and applies the effect in one transaction, so "key claimed,
effect missing" is unrepresentable; a replayed mutation carrying another
household's id is refused; the same key with a different request hash is
refused. Nineteen controls, all with tests.

The queue also inherited §2's defects, since `consumeStock` is replayable — which
is why the location guard sits *before* the replay envelope rather than inside
it. A queued write is a caller that is not a page.

**Reported, not verified:** cross-household ownership on the replayable
procedures is tested for one of the five; and a claim that role-freshness is not
what it appears to be. That last one contradicts what §1 verified, so it needs
settling rather than repeating.

## 5. Uploads

**Verified present:** MIME allowlist, magic-byte check against the declared
type, Sharp re-encode, UUID filenames, a household-scoped directory, and — since
this review — a store ownership check.

**Reported, not verified, and the two worth acting on:**

- The **10 MB cap is applied after the whole body is in memory** and after JSON
  parsing, because the image arrives base64 in a tRPC payload. The cap therefore
  bounds what is stored, not what is allocated.
- The **cap counts bytes; the decoding cost is in pixels.** A small, highly
  compressible image passes every check and expands on decode. Sharp has
  `limitInputPixels` for exactly this; whether it is set has not been confirmed
  here.

Also reported: no test performs a *successful* upload, so the four positive
claims `SECURITY.md` makes about this path are unproven; and uploaded images are
never deleted, since no `receipt.delete` exists.

## 6. Session handling

**Verified:** JWT with a 15-minute `maxAge`, the role read fresh per request,
sign-out purges the queue and the cached shell and asks before discarding unsent
changes, and an idle session warns before it ends.

**Reported, not verified, and the one with real consequences for the product's
own premise:** there is **no server-side session revocation**. A kitchen tablet
holds a long-lived session by design; if it walks out of the house, nothing ends
that session from inside the application. The 15-minute token bounds it, and a
role change bites on the next request — so the exposure is smaller than it
sounds — but "I have lost the tablet" has no answer beyond changing the signing
key, which signs everybody out.

That is a finding with an owner, not a defect to fix in passing: it is a feature
decision about what a household can do when a device is lost.

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

**Reported, not verified:** nothing in the image posture is enforced by a test —
`USER node`, the npm removal, the read-only rootfs are all true and all
unasserted; a published image is never re-scanned, so an advisory affecting a
shipped image is only noticed on the next push; and the placeholder-secret guard
does not stop the container, which reports healthy while refusing to sign
anybody in.

## 8. Headers in production

**Verified:** the CSP carries a per-request nonce minted in `src/middleware.ts`,
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

**Still reported, not verified:** prefetch requests skip the middleware by its
own matcher, and eight of the thirteen production directives remain unaudited —
though the new spec now asserts six of them are present.

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

- **The adversarial pass did not finish.** Every finding marked *Reported* above
  is exactly that. The pass that was meant to try to break each claim of
  protection — and, more importantly, to check that each control's named test
  would actually fail without it — died partway. That check is the single most
  valuable thing still owed here, because a control whose test would pass
  without it is not tested.
- **Nothing was run against a deployment.** No TLS configuration, no proxy
  behaviour, no real Traefik. The per-IP finding in §3 in particular depends
  entirely on how an operator has deployed.
- **The read path of household isolation.** The tripwire covers writes. Ten
  queries were flagged as unconfirmed on the read side and have not been swept.
- **Whether `limitInputPixels` is set on Sharp**, which decides §5's second
  finding.
- **iOS Safari, a real tablet, and a screen-reader pass** — three human passes
  §10 still owes. None is a security pass, and none substitutes for one.

## Which checks should become tests

Phase 7 asks that the review be repeatable. One is built; these are the rest,
in the order they would pay off.

| Test | Tier | Asserts |
|---|---|---|
| ~~Household-scoped ids are looked up~~ | unit | **Built** — `tenant-scoped-ids.test.ts` |
| Every restricted procedure refuses the wrong role behaviourally | integration | the other half of the 28, calling each as a role that must be refused |
| ~~Security headers reach a response~~ | browser | **Built** — `e2e/security-headers.spec.ts` |
| The registration limiter refuses | integration | a context with headers, so the limiter is reachable at all |
| Every limiter call site fails closed | integration | Valkey down means refused, not continued, at each site |
| A successful upload does what it claims | integration | EXIF stripped, UUID filename, re-encoded bytes |
| The image posture holds | build | `USER node`, no npm, read-only rootfs |

---

## Related

| Document | What it holds |
|---|---|
| `SECURITY.md` | The threat model, what is hardened, and the operator's half |
| `ISSUES.md` | SEC-1, the first of §2's family, and every other filed defect |
| `docs/STATUS.md` | The gate results this review's verified claims were measured against |
| `docs/REDESIGN_PLAN.md` §9 | Phase 7's scope, which this document answers |
