# Stoky Project Status

Updated: 2026-08-10

Single source of truth for where the project actually is.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why. If a number is a measurement,
say what measured it.

---

## Gate status

Measured on 2026-08-10 against a live PostgreSQL and Valkey, and a dev server on
port 3102, after Phase 3.

| Gate | Command | Result |
|---|---|---|
| Lint | `corepack pnpm lint` | ✅ 0 warnings, 0 errors — 142 files, 101 rules |
| Typecheck | `corepack pnpm typecheck` | ✅ clean |
| Internal links | `corepack pnpm check:links` | ✅ 74 links against 24 routes, none broken |
| Contrast | `corepack pnpm check:contrast` | ✅ 54 checks over 26 tokens × 2 themes, all AAA |
| Unit tests | `corepack pnpm test:unit` | ✅ 134 pass / 16 files |
| Component tests | `corepack pnpm test:components` | ✅ 164 pass / 14 files |
| Integration tests | `corepack pnpm test:integration` | ✅ 281 pass / 12 files |
| Build | `corepack pnpm build` | ✅ 25 routes, all server-rendered on demand |
| Coverage | `bun test --coverage <dir>` | ℹ️ per tier, not a project figure — see *Known gaps* |
| Migration | `corepack pnpm prisma migrate deploy` | ✅ on a fresh database |
| Seed | `corepack pnpm db:seed` | ✅ idempotent across re-runs |
| E2E | `bunx playwright test` | ✅ 89 pass / 0 fail, **2.9 min** |
| Dependency audit | `corepack pnpm audit` | ✅ no known vulnerabilities |

`corepack pnpm verify:local` runs the first six — **17s** of a **600s budget**,
which the script enforces. Every step also has its own ceiling, so a hang fails
as a hang rather than as a long wait. `verify:ci` adds integration and build.

**Ten minutes is the contract for all verification**, not just the browser
suite. Every CI test job is capped at ten; Playwright's own `globalTimeout` is
nine, so it fails first and names the test it was sitting on instead of the
runner killing the job with no report. The budget exists because verification
that takes longer stops being run, and a suite nobody runs still has to be
maintained while telling nobody anything.

### End-to-end

Seven spec files plus a `setup` project. **89 tests in 2.9 minutes**, against
182 in 5.6 before the audit of 2026-08-11.

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

**Backend — substantially complete.** 8 tRPC routers (`auth`, `product`,
`location`, `inventory`, `receipt`, `store`, `price`, `shopping`) merged in
`src/server/trpc/router.ts`. 8 Zod validation modules. 4 services: `ocr`,
`receiptParser`, `productMatcher`, `openFoodFacts`.

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

**Security posture.** Per-request CSP nonce in `src/middleware.ts` with
`strict-dynamic`. CI pins every action by SHA, scans the image with Trivy before
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
- Password policy is `min(8)` only, and with CRITICAL-4 closed this is the
  largest remaining gap in the auth surface. (DEBT-1)
- Rate limiting covers the two auth endpoints and nothing else, and is per IP
  rather than per account — NIST SP 800-63B §5.2.2 asks for the latter, and a
  per-IP limit alone is defeated by a distributed guess. `receipt.upload` runs
  OCR on an authenticated request with no limit (OWASP ASVS V11.1.4), and a
  refusal carries no `Retry-After` header (RFC 9110 §10.2.3). It also **fails
  closed**, which makes Valkey a hard dependency of signing in. The full table,
  with the phase that owns each, is in `REDESIGN_PLAN.md` under Phase 3.
  (SECURITY.md)
- An authorisation refusal is logged nowhere (OWASP ASVS V7.1.3), so an account
  probing what it may write leaves no trace. Phase 7.
- Roles are enforced on the server per procedure, but **no interface creates a
  KITCHEN account** — the value exists in the enum and in the middleware, and
  the only way to get one today is a database write. Phase 5, with the kitchen
  screen.

**Correctness**
- `getExpiringItems` reports entry quantity rather than net stock, so a fully
  consumed batch still appears as expiring. (INV-1)
- The services layer (`ocr`, `productMatcher`, `receiptParser`,
  `openFoodFacts`) still throws bare `Error`, so a procedure that calls one
  still surfaces `INTERNAL_SERVER_ERROR` for a missing row. The routers no
  longer do. (DEBT-6)
- `openFoodFacts` caches in a process-local `Map`; multi-instance deployments
  diverge. (DEBT-3)
- The barcode scanner's torch toggle never reaches the camera. (DEBT-2, pinned
  by a test that documents the behaviour.)

**Accessibility and interface**
- `/shopping` and `/settings/locations` test `if (isLoading)` alone, so a
  failed query renders the empty state: someone with ten locations is told they
  have none. `/inventory` and `/products` were the worse half of this and are
  fixed. (UI-9)
- The low-stock badge is asserted only on the table tier; the card tier, which
  is what a phone and the kitchen tablet show, is covered by nothing. (TEST-4)
- Saving a stock movement announces nothing beyond the route name. (A11Y-1,
  pinned by a test that goes red when it is fixed.)
- The location picker, the low-stock badge and several wording items are still
  hardcoded Spanish or inconsistent. (I18N-2 through I18N-7)

**Operational**
- OCR fetches its Tesseract language data from a CDN at first use, so the first
  scan on a fresh container needs outbound internet and fails on an air-gapped
  or read-only install. (OCR-1)
- No error boundaries.
- No PWA. Deferred deliberately on iOS grounds, not overlooked.
- No error tracking, monitoring or health-check endpoint.
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
| 4 — Phone screen, offline | Next |
| 5 — Kitchen screen | Not started |
| 6 — Product rating | Not started |
| 7 — Security review | Not started |

Journey 1 of `docs/SMOKE_JOURNEYS.md` passes. The rest are tagged with the phase
that makes them passable.

### Environment notes

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
