# Stoky Project Status

Updated: 2026-08-11

Single source of truth for where the project actually is.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why. If a number is a measurement,
say what measured it.

---

## Gate status

Measured on 2026-08-11 against a live PostgreSQL and Valkey, and a dev server on
port 3102, after Phase 4.

| Gate | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | ✅ 0 warnings, 0 errors — 208 files, 101 rules |
| Typecheck | `pnpm typecheck` | ✅ clean |
| React | `pnpm check:react` | ✅ 0 errors (react-doctor 0.9.11, gates on errors) |
| Internal links | `pnpm check:links` | ✅ 74 links against 25 routes, none broken |
| Contrast | `pnpm check:contrast` | ✅ 54 checks over 26 tokens × 2 themes, all AAA |
| Unit tests | `pnpm test:unit` | ✅ 335 pass / 27 files |
| Component tests | `pnpm test:components` | ✅ 252 pass / 22 files |
| Integration tests | `pnpm test:integration` | ✅ 319 pass / 19 files |
| Build | `pnpm build` | ✅ 26 routes — **45.8s cold** with the React Compiler on, 39.8s with it off |
| Migration | `pnpm prisma migrate deploy` | ✅ on a fresh database, all three |
| Seed | `pnpm db:seed` | ✅ idempotent across re-runs |
| E2E | `bunx playwright test` | ✅ 96 pass / 0 fail, **3.3 min** |
| Dependency audit | `pnpm audit` | ✅ no known vulnerabilities |

**Use `pnpm`, not `corepack pnpm`.** On this machine corepack resolves 11.20.0
against the `packageManager` pin of 11.19.0 and refuses to run; the plain
binary is the pinned one. `verify-local.sh` already prefers `pnpm` and falls
back to corepack, so the scripts are unaffected — only the commands in earlier
versions of this file were wrong.

`pnpm verify:local` runs the first seven — **17s** of a **600s budget**,
which the script enforces — **31s** after Phase 4 added a React gate and 83
tests. Every step also has its own ceiling, so a hang fails as a hang rather
than as a long wait. `verify:ci` adds integration and build, and runs in 80s.

**Ten minutes is the contract for all verification**, not just the browser
suite. Every CI test job is capped at ten; Playwright's own `globalTimeout` is
nine, so it fails first and names the test it was sitting on instead of the
runner killing the job with no report. The budget exists because verification
that takes longer stops being run, and a suite nobody runs still has to be
maintained while telling nobody anything.

### End-to-end

Eight spec files plus a `setup` project. **96 tests in 3.3 minutes**. It was 89
in 2.9 before Phase 4, and 182 in 5.6 before the audit that preceded it.

The reduction is not fewer checks. It is the same checks placed in the tier
that can answer them, and stopping the browser matrix from multiplying two
independent axes together.

| Project | Runs | Why |
|---|---|---|
| chromium | Everything | The reference engine |
| Mobile Safari | `dynamic-routes`, `location-picker` | WebKit at a phone width — the combination where this project's layout defects have actually appeared (UI-5, UI-6) |
| firefox | `@smoke` — 4 tests | Register, sign in, write, read Spanish |
| webkit | `@smoke` — 4 tests | As above |

**Mobile Chrome was removed.** It is Blink at 393px, and chromium already
visits every route at that width: the three a11y specs loop the viewport tiers
with `setViewportSize`, and `dynamic-routes` checks overflow at all three. It
was an engine already covered, at a width already tested.

Five picker tests moved down to the component tier, which already asserted the
same contract — keyboard navigation, Escape, tab order — against the real
component in milliseconds. The two that stayed are the two happy-dom cannot
answer: composed target size, and whether a fixed bar is painted over an option.

| Spec | What it proves | Projects |
|---|---|---|
| `critical-paths.spec.ts` | The stock journeys, login, i18n | chromium, `@smoke` elsewhere |
| `accessibility.spec.ts` | axe at WCAG AAA — 16 routes × 2 themes × 3 tiers | chromium |
| `a11y-structure.spec.ts` | Target size, heading order, landmarks | chromium |
| `a11y-aaa.spec.ts` | 1.4.8, 2.4.9, 3.3.5 and reduced motion | chromium |
| `dynamic-routes.spec.ts` | Routes with an id, found by following links | chromium, Mobile Safari |
| `location-picker.spec.ts` | Composed target size and occlusion | chromium, Mobile Safari |
| `screen-reader.spec.ts` | The accessibility tree across four journeys | chromium — the tree comes over CDP |
| `offline-shop.spec.ts` | A shop composed in aeroplane mode, applied once | chromium |

`globalTimeout` is **5 minutes locally and 9 in CI**, where two workers share
four cores with the dev server and failures retry twice. It was 9 everywhere,
which is not a ceiling when the measurement is 2.9.

Two `test.skip`s remain in `critical-paths.spec.ts`, both scoped to phone
viewports with Phase 4 named as the reason.

### Which tier answers which question

Three tiers, split by what each can actually decide rather than by habit. The
rule is that a check belongs in the cheapest tier that can answer it honestly.

| Tier | Runner | Answers |
|---|---|---|
| Static | Bun, milliseconds | Facts about source and CSS: token contrast, catalogue parity, internal links |
| Rendered | Bun + happy-dom, seconds | Facts about the DOM: names, roles, labels, ARIA wiring, and — via Tailwind's own compiler — what an element *declares* |
| Browser | Playwright, minutes | Facts about layout and interaction: contrast as painted, target size as composed, overflow, occlusion, focus, the accessibility tree |

The middle tier is newer and is where the target-size floor now lives.
`src/__tests__/setup/tailwind.ts` runs Tailwind's real compiler over the real
`globals.css` and resolves a component's class string to the CSS a browser would
apply — `h-10` to 40px, `min-h-[48px]` to 48, `text-sm` to 0.875rem over a 1.5
line height. 13 checks in under two seconds, covering every button variant
rather than a sample. Booting a browser to learn how tall a button declares
itself was never a good trade.

Its limit is the reason the third tier exists: it knows what an element
declares, not what the layout does. A parent's `overflow`, a sibling's
`flex-shrink`, a fixed bar drawn on top — the last of which is a defect this
project shipped (UI-6) — are only visible on a rendered page.

axe was measured in both: it runs under happy-dom and correctly reports
`button-name`, `heading-order`, `image-alt`, `label` and `link-name`, and
returns `color-contrast` as **incomplete** rather than passing. That is the
boundary drawn by the tool rather than by opinion.

### Traps that have made measurements wrong here

These are recorded because each one produced a confident, wrong number.

1. **The migration could not apply to a fresh database.** It built a GIN index
   with `gin_trgm_ops` without creating the `pg_trgm` extension. Masked because
   the only path anyone ran created the extensions beforehand. Fixed in the
   migration itself.
2. **Playwright silently tested a different application.** The config hardcoded
   port 3000 with `reuseExistingServer`, so it adopted whatever was listening.
   It now honours `PLAYWRIGHT_PORT`.
3. **A wedged dev server looks exactly like a hung test suite.** One at 100% CPU
   answering nothing swallowed a 30-minute run: Playwright was waiting on its
   `webServer` and had not started a single test. The tell is zero browser
   processes. Related: piping a long run through `tail` buffers everything until
   it ends, so redirect to a file instead.
4. **`pgrep -f` and `pkill -f` match your own shell.** Both have reported the
   wrong answer here more than once. `ps -eo pid,args` and an explicit PID work.
5. **A class name is not a measurement.** happy-dom has no layout engine — every
   rectangle there is 0×0 — so a component test can only assert that a class is
   present. That is how every form control in the application sat below the
   44px accessibility floor since inception. Anything geometric belongs in E2E,
   or in the CSS resolver above, which measures the declaration itself.
6. **A guard nobody has watched fire is a comment.** `verify-local.sh`'s
   per-step ceiling was written as `if ! timeout … then code=$?`, which reads
   the status of the `!` expression and is always 0 — every ceiling passed
   silently. Found by setting one to a second and watching the run succeed.
7. **An unbounded shell wait is not covered by any test timeout.** Three
   `until … sleep` loops were left spinning on this machine while the suite was
   being tuned, one for six and a half hours on a log file that was never going
   to be written. No Playwright setting could have caught them: a shell loop is
   not a test. Every wait needs its own cap.

---

## What exists

**Backend — substantially complete.** 9 tRPC routers (`auth`, `household`,
`product`, `location`, `inventory`, `receipt`, `store`, `price`, `shopping`)
merged in `src/server/trpc/router.ts`, **55 procedures** — earlier versions of
this file said 45 and `capabilities.test.ts` said 44; both were counted before
Phase 3 finished. 9 Zod validation modules. 4 services: `ocr`, `receiptParser`,
`productMatcher`, `openFoodFacts`.

**Offline — a shop works with no signal, and applies once.** Five writes carry
an idempotency envelope and go through `withReplay`, which claims the key and
applies the effect in one transaction, so "key claimed, effect missing" is
unrepresentable. Changes made without a connection go into a `zustand` store
persisted to `localStorage` through SuperJSON, are folded onto the screen so
they show as done, and drain one at a time on reconnect. A refused consumption
is not a failure but a question — see *Reconciliation* below. Proven by
`e2e/offline-shop.spec.ts`, which is the phase's done-when.

**Auth — working.** Real forms wired to Auth.js `signIn()` with Argon2id
hashing, error mapping and i18n. Rate-limited per IP in Valkey since Phase 3 —
5 sign-ins per 15 minutes, 3 registrations per hour (CRITICAL-4 closed).

**Frontend — 22 pages, and no route is linked that does not exist.** That last
part is enforced by `check:links` in CI rather than by audit; the manual version
missed a dead route three times running, twice from routes linked on every row
of a table.

**Design system — one, and it is in CSS.** 26 tokens under `@theme` in
`src/app/globals.css`, light and dark, with a three-state System/Light/Dark
control and a language control on every surface. `src/components/ui/` holds
`button`, `input`, `ThemeControl`, `LocaleSwitcher`, `PreferencesCluster`.
Everything else is Tailwind against the tokens — the earlier plan to install
~23 shadcn primitives was not followed, and no page has needed them.

**Navigation — three renderers by tier.** Bottom bar below `md`, rail from `md`,
top bar from `lg`, with a focus-trapped sheet for the overflow. Audited by axe
at all three tiers in both themes.

**i18n — two catalogues that cannot silently diverge.**
`src/__tests__/unit/messages.test.ts` fails on a key present in one and not the
other, on an empty value, and on an English string that is a byte-identical copy
of the Spanish. It cannot see a string that never reached a catalogue at all,
which is what I18N-5 is.

**Roles — enforced on the server, per procedure.** Four values
(`OWNER`, `ADMIN`, `MEMBER`, `KITCHEN`), three procedure tiers in
`src/server/trpc/trpc.ts`, and all 45 procedures assigned. Membership and role
are read from the database on every call rather than from the JWT, so a
demotion takes effect on the next request rather than whenever the 15-minute
token expires. `src/__tests__/unit/capabilities.test.ts` checks the assignment
of every procedure against the matrix; the integration suite proves the
refusals by calling the router as a kitchen account.

**Reconciliation, not silent loss.** Stock has a floor: two people who each use
the last unit cannot both be right, and the second to reach the server is
refused. That refusal is surfaced as the question only a person can answer —
how much is actually on the shelf — and the answer is written as an
`adjustStock`. It does not interrupt: a conflict is discovered on reconnect,
possibly with the phone in a pocket, so the sync indicator carries it and the
dialog opens when the person chooses. A KITCHEN account is told who can fix it
rather than shown a control the server would refuse. `REDESIGN_PLAN.md` §5.5.3.

**Security posture.** Per-request CSP nonce in `src/middleware.ts` with
`strict-dynamic`, `worker-src` and `child-src` named explicitly, and `/sw.js`
excluded from the matcher so the page policy does not become the worker's. CI pins every action by SHA, scans the image with Trivy before
pushing it, fails on critical or high findings, and attaches an SBOM and a
provenance attestation. `SECURITY.md` documents the model for a self-hosted
deployment.

**Seed — the fixtures the dynamic routes need.** Demo household, 6 products (3
below minimum), 4 storage locations in two levels, 3 stores, 18 price records, a
shopping list, and **2 receipts** — one needing review, one confirmed. The
receipts were added on 2026-08-09; before them `/receipts` was empty on every
fresh install and in CI, so the review and applied routes were unreachable
through the interface and were audited by nobody. Login `demo@stoky.local` /
`Demo1234!`.

---

## Accessibility

The target is **WCAG 2.1 AAA**, decided as a product requirement rather than a
compliance exercise: the premise is that anyone in a household can use this,
including people with limited technical confidence.

What is measured, and by what:

| Criterion | Checked by | State |
|---|---|---|
| Contrast (1.4.6) | `check:contrast` on the tokens, axe on the rendered page | ✅ both |
| Target size (2.5.5) | `a11y-structure.spec.ts`, measured in CSS pixels | ✅ floor is 48px, above the required 44 |
| Headings, landmarks | `a11y-structure.spec.ts` | ✅ |
| Names and roles | axe, plus the tree walk in `screen-reader.spec.ts` | ✅ zero unnamed interactive nodes |
| Visual presentation (1.4.8) | `a11y-aaa.spec.ts` | ✅ ≤80 characters, ≥1.5 line spacing |
| Link purpose (2.4.9) | `a11y-aaa.spec.ts` | ✅ |
| Help (3.3.5) | `a11y-aaa.spec.ts`, form fields only | ✅ attached, not merely adjacent |
| Reduced motion (2.3.3) | `a11y-aaa.spec.ts` | ✅ |
| Reading order | `screen-reader.spec.ts`, tree order vs geometry | ✅ desktop only |
| Announcements | `screen-reader.spec.ts` | ⚠️ refusals yes, one success no (A11Y-1) |

| Reading level (3.1.5) | `src/__tests__/unit/readability.test.ts` | ✅ es 69.0 "fácil", en 66.3 |
| Timeouts (2.2.6) | `SessionKeepAlive.test.tsx`, driven in a browser | ✅ slides on activity, warns at T−2min |

**Two honest limits.** Automated testing catches roughly a third of real
accessibility problems, so this is a floor that stops regressions, not a
certificate. And **the manual screen-reader pass has not happened**. Four
journeys are audited against the tree; whether the result *sounds* sensible to
someone using it is the part no tool and no agent can answer.

The procedure for the manual half — pa11y for the AAA checklist, Accessibility
Insights for the guided assessment, and what neither covers — is in
`docs/DESIGN_AUDIT.md` §5. Both were evaluated rather than assumed: pa11y at
`WCAG2AAA` returns 0 errors and 60 "Check that…" notices on `/login`, which is
a good checklist and a bad gate, so neither tool is in CI.

---

## Dependency security

`corepack pnpm audit` → **no known vulnerabilities** (was 57).

Cleared without source changes; every direct dependency stayed within its major.
Four transitive packages had no fixed parent release and use overrides scoped to
the single parent that pulls them — `recharts>lodash`, not a bare `lodash`.

**The overrides live in `pnpm-workspace.yaml`, not `package.json`.** pnpm 11
stopped reading the `pnpm` field in `package.json`; it warns once and ignores
it. Had they been left there, four advisories would have silently returned on
the next install. pnpm 11 also refuses lockfile entries published in the last 24
hours (`minimumReleaseAge`); CI passes `--trust-lockfile`, which is the
documented case — the lockfile is committed and reviewed, so the age check has
already done its job at resolution time.

GitHub's Dependabot count is higher than pnpm's because it counts one alert per
advisory-path pair.

---

## Versions

| Package | Version |
|---|---|
| next | 16.3.0 |
| react | 19.2.8 |
| @trpc/server, @trpc/client | 11.18.0 |
| prisma, @prisma/client | 6.19.3 |
| next-auth | 5.0.0-beta.32 |
| next-intl | 4.13.4 |
| tailwindcss | 4.3.3 |
| zod | 3.25.76 |
| pnpm | 11.19.0 |

No known drift as of 2026-08-10. `CLAUDE.md`'s stale claims — tRPC as a release
candidate, a `household` router that never existed, a refresh token that was
never implemented — were corrected today.

**This paragraph was itself wrong until today**, and it is worth saying how: it
claimed `CLAUDE.md` says Prisma 7.x. `CLAUDE.md:14` says Prisma 6.x, and always
did. A drift note that had drifted is the exact failure this file exists to
prevent, and it survived because nobody re-read the source it was describing.

---

## Known gaps, by severity

**Security**
- ~~Password policy is `min(8)` only.~~ **Closed.** Twelve characters, no
  composition rules, common-password and identity checks, and a maximum — the
  last of which was missing entirely, leaving Argon2id at 64 MB per call taking
  unbounded input on two endpoints reachable without an account.
- ~~There is no sign-out control.~~ **Built.** `/settings` ends the session,
  purges the queue and tells the worker to forget the cached shell. It asks
  before discarding unsent changes and offers to send them first.
- ~~Rate limiting is per IP only, `receipt.upload` is unthrottled, and a refusal
  carries no `Retry-After`.~~ **Closed**, one commit each. Sign-in is counted
  per account as well as per address (NIST SP 800-63B §5.2.2), on a hashed key
  so the cache is not a list of who has tried to sign in. `receipt.upload` is
  metered at 30/hour per account, counted *before* the file is decoded, so
  sending rubbish and being refused is not the cheap way in (ASVS V11.1.4). A
  429 carries `Retry-After`, read off the refusal rather than recomputed (RFC
  9110 §10.2.3); the 503 from a dead Valkey and the sign-in redirect
  deliberately do not, and SECURITY.md says why. It still **fails closed**,
  which makes Valkey a hard dependency of signing in.
- ~~An authorisation refusal is logged nowhere (OWASP ASVS V7.1.3).~~
  **Closed.** One JSON object per event on stderr, written by a tRPC middleware
  rather than by the resolvers, so a new router cannot forget to be audited.
  Only UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS — logging everything would
  bury the refusals in NOT_FOUNDs.
- Roles are enforced on the server per procedure, but **no interface creates a
  KITCHEN account** — the value exists in the enum and in the middleware, and
  the only way to get one today is a database write. Phase 5, with the kitchen
  screen.

**Correctness**
- ~~`transferStock`'s availability guard is read-then-write.~~ **Closed.** Both
  halves of INV-2 now guard inside a transaction with the product row held.
- ~~The services layer still throws bare `Error`.~~ **Closed.** Three domain
  errors and a translator on the same middleware that handles Prisma's, so a
  missing row from a service reaches the client as `NOT_FOUND` — which the
  offline queue stops retrying instead of spending eight attempts on.
- ~~`openFoodFacts` caches in a process-local `Map`.~~ **Closed.** Valkey-backed
  and shared across replicas, failing *open* — the opposite of the rate limiter
  — because the fallback for an unreachable cache is to ask Open Food Facts,
  which is what a miss already means.
**Accessibility and interface**
- ~~The location picker and several wording items are still hardcoded Spanish or
  inconsistent.~~ **Closed**, I18N-2 through I18N-6, one commit each.
- ~~Assorted validation and accessibility gaps found while building
  `/inventory/add`.~~ **Closed.** The last of the eight: the stock procedures'
  inputs described a database row rather than what each one does, and
  `ProductPicker` read one page's namespace on both stock screens.

Closed since this section was written, and listed because a status file that
only ever grows is one nobody trusts: DEBT-2 (the scanner's torch), UI-9 (a
failed query rendering the empty state), TEST-4 (the low-stock badge on the
card tier), A11Y-1 (a saved stock movement announcing nothing), I18N-7 (the
hardcoded badge) and I18N-8 (both auth pages). `ISSUES.md` holds the detail;
where it disagrees with this file, it is right.

**Found while documenting, and fixed**
- ~~`product.delete` and `store.delete` fail on a foreign key and blame the
  caller.~~ **Closed** (PROD-1). Both count references first and refuse with
  CONFLICT naming them; the rule that a used product cannot be deleted is
  unchanged, and asserted.
- ~~A shopping item with neither a product nor a name is accepted.~~ **Closed**
  (SHOP-1). Exactly one of the two, whitespace not counting as a name; no
  existing row was in either state.

**Production authentication was broken, and every suite was green.**
Auth.js v5 defaults `trustHost` to false off Vercel and then refuses any request
whose Host it cannot vouch for: `/api/auth/session` answered 500 `UntrustedHost`
on a production build, so a deployed instance could not sign anybody in.
Setting `NEXTAUTH_URL` correctly does **not** help — verified against a build
whose value matched the server's own address exactly.

Nothing caught it because `next dev` does not apply the check and every suite
ran against `next dev`. `trustHost: true` is now set, with the trade written
down (Traefik's `Host(...)` rule is what makes trusting the header safe here),
and `e2e/auth.prod.spec.ts` guards it in the one config that serves the
standalone artefact. Verified to fail without the fix.

That suite now also **signs in for real** against the production build, and
asserts no Content-Security-Policy violation reaches the console while it does.
The production policy is stricter than any other suite exercises — no
`unsafe-eval`, no websocket origins, `upgrade-insecure-requests` — and a policy
that blocks the framework's own scripts renders a login form that does nothing,
which is the same shape as the defect above. It passes: the policy does not
break the application.

**Verified end to end on 2026-08-11**, at `2b148a2`, every gate in one sequence:

| Gate | Result |
|---|---|
| `pnpm verify:ci` — lint, typecheck, react-doctor, links, contrast, unit, components, integration, build | 436 unit, 342 component, 395 integration, build ✅ |
| `bunx playwright test` | 108 passed, 3.8 min |
| `pnpm test:e2e:sw` — the standalone artefact the image runs | 5 passed |
| `pnpm lint` | 0 warnings, 0 errors |

Two things that sequence surfaced, both operational rather than defects:

- **`verify:ci` fails roughly one run in seven, on TEST-5.** It took three
  attempts to get a clean one. The failure is always the same test, always out
  of `answerFromRecord`, and it is the diagnosed bun defect below — not a
  regression. Re-run before investigating. This is the concrete cost of that
  entry: the gate `CLAUDE.md` requires before every commit is the gate it
  breaks.
- ~~**`verify:ci` stops the `db` and `cache` containers when it finishes.**~~
  **Fixed.** It now tears down only what it started: if the services were
  already running when it began, it leaves them up. Before, running the
  integration suite took a developer's services away underneath whatever they
  did next — the browser suite then failed at its `seed` step with 107 tests
  unrun, which reads as a catastrophe and is a stopped container. Both paths are
  tested.

**One intermittent failure, diagnosed and upstream**
- bun 1.3.14 intermittently **abandons a test body at a rejecting `await`**: the
  `catch` beside it never runs, the test's own assertion never executes (one
  fewer `expect()` than a passing run), and the test is reported as failed with
  the error rendered at its origin. `withReplay` and its tests are both correct
  — the record it refuses matches on key, user and procedure, and differs only
  in the request hash, which is the condition it exists to refuse.
- It reproduces **only under load**: 3 failures in 24 with another suite running
  against the same database, 0 in 90 on a quiet machine. `docs/reproductions/`
  carries a self-contained file and the recipe. **TEST-5**, the one open entry
  in `ISSUES.md`, and it wants an upstream report rather than work here.

**Offline, honestly**
- ~~**The service worker is not exercised by any test.**~~ **Closed.**
  `pnpm test:e2e:sw` builds and serves the standalone artefact the Docker image
  runs, then drives a real worker: it registers and claims the page, `install`
  precaches `/offline`, the static cache holds real hashed chunks, a navigation
  with the network cut off is served from cache, and an uncached route gets the
  offline document. Separate from the ordinary suite because a `next build` is a
  minute the five-minute budget cannot absorb.
- **iOS Safari is unverified.** Playwright's WebKit is not iOS Safari, and §5.4
  defers installability on iOS grounds specifically. The queue, the storage and
  the worker all need a pass on a real device, and that pass must be dated here
  rather than implied by a green suite.
- The 2,500 ms navigation timeout in `public/sw.js` is a guess calibrated on
  "supermarket lie-fi", not a measurement.
- ~~Read persistence is not implemented.~~ **Built.** Six allowlisted queries
  are kept per account in `localStorage` for 24 hours. Restoration happens
  after the first render rather than before it, so a screen opened with no
  signal shows the "nothing saved" panel for a moment before the cache
  arrives — the cost of scoping the cache to the account, which the root
  provider could not do because it has never known who is signed in.
- Cross-tab locking is absent. Two tabs draining at once is *safe* because the
  same key applies once, so it is an efficiency question rather than a
  correctness one.

**Operational**
- ~~**Receipt scanning does not work in the production image.**~~ **Closed**
  (OCR-2). The Dockerfile stages tesseract.js whole — tracing had copied three
  of its ten dependency entries, the WASM engine among the missing — with
  build-time assertions on the two files whose absence broke scanning. Verified
  air-gapped: a real upload reached NEEDS_REVIEW in under three seconds and the
  lines read back character-perfect, which also puts data behind OCR-1's
  smaller-model trade.
- ~~OCR fetches its Tesseract language data from a CDN at first use.~~
  **Closed**, and still true as far as it goes: the model is baked in, pinned
  and checksummed, and `TESSDATA_PATH` points at it. That was necessary and, as
  OCR-2 shows, not sufficient.
- ~~No error boundaries.~~ **Closed**, one inside the intl provider and one
  outside every provider.
- ~~No health-check endpoint.~~ **Closed.** `/api/health` checks Postgres and
  Valkey; the image and Compose both use it.
- No PWA. Deferred deliberately on iOS grounds, not overlooked.
- ~~No data export.~~ **Closed.** `/settings` downloads the household as JSON;
  password hashes are never in it, and a test proves that by breaking the query
  that keeps them out.
- No error tracking or monitoring beyond the container's own healthcheck — and
  worth a decision rather than a ticket, since every option sends a household's
  errors to somebody else's server.
- No data export or backup.
- Coverage is measured now, but **per tier, and the denominators differ**: each
  report counts only the files that tier loads, so the three numbers do not
  compose into a project figure and must not be added. Integration 90.2% of
  functions / 87.1% of lines; components near 100% on every component except
  `UploadZone` (83.5%); unit 70.0% / 63.4%, which is low by construction —
  it loads modules it only partly exercises on purpose (D25). No tier covers
  `src/app/**`; those routes are reached only by the browser suite.
- No visual regression coverage.

---

## Where the plan is

Execution follows `docs/REDESIGN_PLAN.md`. Live progress and every decision
taken without asking are in `docs/PROGRESS.md`.

| Phase | State |
|---|---|
| 0 — Clean slate | ✅ Complete |
| 1 — Close the dead routes | ✅ Complete |
| 2 — One design system | ✅ Complete |
| 2b — Foundations of use | ✅ Complete except the manual screen-reader pass |
| 3 — Roles, rate limiting | ✅ Complete |
| 4 — Offline, and a shop that survives it | ✅ Complete against its done-when |
| 4b — Client state, the compiler, a React gate | ✅ Complete |
| 5 — Kitchen screen, and Screen A's layout | Next |
| 6 — Product rating | Not started |
| 7 — Security review | Not started |

**What "complete against its done-when" means here, exactly.** Phase 4's test
was "a full shop can be done in aeroplane mode and syncs correctly on
reconnect", and `e2e/offline-shop.spec.ts` proves it. Its *title* also said
"phone screen", and Screen A's layout — Scan on top, TO BUY, IN THE TROLLEY —
is **not** built: a shop today is the existing `/shopping/[id]`, which now
works offline. The design that preceded this phase marked the layout as the
droppable tail on the grounds that it is a UX change riding on a correctness
phase, and it moves to Phase 5, where it sits next to the kitchen screen it
shares vocabulary with. Named rather than quietly counted as done.

Journey 1 of `docs/SMOKE_JOURNEYS.md` passes. The rest are tagged with the phase
that makes them passable.

### Environment notes

- Use `pnpm`, not `corepack pnpm`: corepack resolves 11.20.0 here against a
  pin of 11.19.0 and refuses to run.
- `pnpm prisma` commands need `DATABASE_URL` exported. Prisma 6 with a
  `prisma.config.ts` no longer loads `.env` itself and says so. `set -a; . ./.env; set +a`.
- `scripts/test-integration-local.sh` stops the compose services when it
  finishes unless `KEEP_TEST_SERVICES=1`. Running it and then `db:seed` fails
  with "can't reach database" for that reason and no other.

- The `docker` group includes this user, but a login session started before that
  change will not have it. Re-login, or prefix with `sg docker -c "..."`.
- Port 3000 is occupied on this machine. Pass `PLAYWRIGHT_PORT`, and start the
  dev server on another port.
- Next refuses a second dev server from the same directory. If message
  catalogues appear stale, the running server has cached them — `touch
  next.config.ts` makes it reload.

---

## Related documents

| Document | Purpose |
|---|---|
| `docs/REDESIGN_PLAN.md` | What is being built, phase by phase |
| `docs/PROGRESS.md` | What is done, and every decision taken without asking |
| `docs/DESIGN_AUDIT.md` | The interface audit and its actions |
| `docs/SMOKE_JOURNEYS.md` | User journeys that must work before calling work done |
| `docs/LOCAL_BOOTSTRAP.md` | Clone → running app |
| `docs/VERIFICATION_SEQUENCE.md` | The command ladder and what each gate proves |
| `docs/TEST_SETUP.md` | Test database configuration and troubleshooting |
| `SECURITY.md` | Threat model and hardening for a self-hosted deployment |
| `ISSUES.md` | Open issues and technical debt, with file references |
