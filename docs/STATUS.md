# Stoky Project Status

Updated: 2026-08-27

Single source of truth for where the project actually is.

Rule for this file: **every claim must be reproducible by running a command.**
If a gate could not be run, say so and say why. If a number is a measurement,
say what measured it.

---

## Gate status

Measured on 2026-08-17/18 against a live PostgreSQL and Valkey — at
`443718d` after Phase 6, the CI campaign and the browser suite's move to the
production artefact, and re-measured at `70386ea`, Phase 8's closing commit.
The four suite rows were re-measured **2026-08-27** on this machine: 650 / 611
/ 494, and the browser suite 148 pass / 0 fail against a Bun-served standalone
build. The unit tier grew 30 tests and 5 files that day — the sharp import
guard, the JPEG marker walker, the EXIF writer, the PNG builder and the upload
body limit.

The same three suites were also run **inside the development image** the day
they moved there (`defd147`, at 609 / 611 / 486 — fewer, because the commits
that added `bun-version.test.ts` and `devcontainer.test.ts` came after). That
is what `scripts/ci-in-image.sh` does and what CI's `quality` and `test` jobs
now call. One caveat that only in-image running exposes: the host's own `bun`
is whatever the developer installed — 1.3.14 here — while `.bun-version` and
the image say 1.4.0. `bun-version.test.ts` compares the two files, not the
binary you happen to be holding.

| Gate | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | ✅ 0 warnings, 0 errors — 371 files, 101 rules (2026-08-27) |
| Typecheck | `pnpm typecheck` | ✅ clean |
| React | `pnpm check:react` | ✅ 0 errors (react-doctor 0.9.11, gates on errors) |
| Internal links | `pnpm check:links` | ✅ 123 links against 35 routes, none broken (2026-08-26) |
| Contrast | `pnpm check:contrast` | ✅ 78 checks over 37 tokens × 2 themes, all AAA (2026-08-26) |
| Unit tests | `pnpm test:unit` | ✅ 650 pass / 72 files (2026-08-27) |
| Component tests | `pnpm test:components` | ✅ 611 pass / 57 files (2026-08-27) |
| Integration tests | `pnpm test:integration` | ✅ 494 pass / 32 files (2026-08-27) |
| Build | `pnpm build` | ✅ **35 routes, 8 of them Partial Prerender** since Cache Components landed 2026-08-25 (`2b6eba5`) — 9 was a miscount, see below. 45.8s cold was the 2026-08-11 measurement with the React Compiler on (39.8 off); ~10s warm. Not re-measured cold: a cold build deletes state a running dev server shares |
| Migration | `pnpm prisma migrate deploy` | ✅ on a fresh database, all four — re-proven continuously: the integration harness and the browser suite's seed project each run it against a database they create |
| Seed | `pnpm db:seed` | ✅ idempotent across re-runs |
| E2E | `bunx playwright test` | ✅ **148 pass / 0 fail** (2026-08-27) — against a **Bun-served** standalone production build, on the suite's own database. See *End-to-end* below: the suite changed shape on 2026-08-17 |
| Dependency audit | `pnpm audit` | ✅ clean again — it was **2 high** for five days; see *Dependency security* |

~~**Use `pnpm`, not `corepack pnpm`.**~~ **Resolved by the 11.22.0 bump**
(`5289e2b`), and re-measured here on 2026-08-25: `corepack pnpm --version`
answers 11.22.0 and exits 0. The refusal was a mismatch, not a policy —
corepack resolved 11.20.0 against a `packageManager` pin of 11.19.0 — and
bumping the pin past the version corepack was reaching for removed it. Either
command works now, which is what makes `docs/LOCAL_BOOTSTRAP.md`'s
`docker compose exec app corepack pnpm …` correct rather than contradicted. `verify-local.sh` still
prefers `pnpm` and falls back to corepack, so the scripts never depended on
this either way.

`pnpm verify:local` runs the first seven — **33s** of a **600s budget**,
which the script enforces. Every step also has its own ceiling, so a hang
fails as a hang rather than as a long wait. `verify:ci` adds integration and
build, and ran in 83–92s across three invocations on 2026-08-17/18.

**Ten minutes is the contract for all verification**, not just the browser
suite. Every CI test job is capped at ten; Playwright's own `globalTimeout` is
nine, so it fails first and names the test it was sitting on instead of the
runner killing the job with no report. The budget exists because verification
that takes longer stops being run, and a suite nobody runs still has to be
maintained while telling nobody anything.

### Cache Components, and what was proven about the image

Landed 2026-08-25 (`2b6eba5`), both flags: `cacheComponents` for
dynamic-by-default rendering with Partial Prerendering, and `partialPrefetching`
for one prefetched shell per route rather than one request per link. The
measurements, the migration and the owner's decision on the CSP nonce are in
`docs/superpowers/plans/2026-08-25-cache-components-and-instant-navigation.md`.

**The root layout blocks on purpose** (`instant = false`), because it reads the
per-request CSP nonce and a nonce that survives prerendering is not a nonce.
That trade was decided rather than deferred; the reasoning is beside the export.

**Eight routes are Partial Prerender, not nine.** Both this file and the plan
said nine, and the plan's own list gave it away: it enumerated prices,
products ×4, receipts ×2 and shopping, which is eight. The ninth was the
legend line — `◐  (Partial Prerender)` — counted as a route by whatever grep
produced the number. Re-counted from the build output on 2026-08-27.

**`partialPrefetching` also has a cost, and it is recorded rather than
implied.** Under Bun, each completed router prefetch raises one unhandled
`AbortError` — roughly ten per page load, in the only monitoring this project
has. Node raises none on the identical artefact, so it is an interop defect
this configuration exposes. The owner chose to keep the feature on 2026-08-27;
`ISSUES.md` RUNTIME-1 has the one-line reproduction and stays open for the
upstream report.

**The production image was built and run under the flags on 2026-08-26**,
because CI never did: the image jobs were skipped on the green commit (docs
only) and cancelled on the flags commit, so nothing had exercised
`output: "standalone"` with `cacheComponents` until this was done by hand.

| Check | Result |
|---|---|
| `docker build --target production` | ✅ builds |
| Container boots against Postgres and Valkey | ✅ migrations applied, ready |
| `/api/health` twice | ✅ `200 {"status":"ok"}`, 17–24 ms |
| `/api/health` with Valkey stopped | ✅ `503 {"status":"degraded"}` |
| `/api/health` after Valkey restarts | ✅ `200 {"status":"ok"}` |

That last pair is the point rather than a formality. `/api/health` used to state
its own contract with `dynamic = "force-dynamic"` and `revalidate = 0`, both of
which Cache Components refuses outright; removing them relies on
dynamic-by-default being real. A cached health check would have gone on saying
"ok" while the cache was down, and the container would have looked healthy while
it was not. It reports the outage and recovers, so the guarantee survived the
change — measured rather than assumed.

### The pipeline

Reshaped on 2026-08-12. Measured on runs `31567346179` (the old shape, with
every other change already in), `31568215727` and `31570504804` (the new one),
so the numbers differ in the reshape and nothing else.

| | Old | New |
|---|---|---|
| Green push → published image | **902s (15m02s)** | **628s** measured, ~530s when `e2e` runs at its usual pace |
| When the image build starts | after the slowest test | with the tests |
| Building and scanning | part of one 411s job | 428s cold, **233s** on a warm layer cache |
| Publishing the image | — | **44s / 51s**, from that cache |

The remaining wall clock is `e2e` and almost nothing else: on run
`31570504804` it took 572s of a 628s run, and everything except the 51s publish
finished inside it. That is why the section below matters more than any further
work on the image jobs.

Re-measured 2026-08-18 on run `32075663881`, the first green run with the
standalone-artefact suite: green push → published image **627s** — e2e 563s
(of which 157s is the post-step pnpm-cache save, and only 313s is Playwright),
image build 195s warm beside it, publish 59s. The verification inside `e2e`
got faster; the job's tail grew a cache save. If that tail ever matters, it is
a workflow knob, not a test problem.

`e2e` no longer installs browsers — it runs in `mcr.microsoft.com/playwright`,
pinned and asserted against `package.json` — which took its setup from 106–193s
to 84–97s. Three things the image does not carry had to be added back: `unzip`,
because setup-bun unpacks a .zip and the seed runs through Bun; `HOME=/root`,
because a container job runs as root while the image owns `/github/home` as
`pwuser` and Firefox refuses to start there; and the services answer to
`postgres` and `cache` rather than `localhost`, because the job now shares a
network with them instead of a host.

The build gated nothing but the publish, yet waited for every test: on run
`31567346179` the image job started at 05:49:08 and end-to-end had finished at
05:49:05. It is now two jobs. `image-build` declares no `needs`, so it runs
beside the tests, and it holds neither `packages: write` nor a push step — a
run whose tests fail can waste a build but cannot ship one. `image-publish`
waits for all four test jobs plus the build and rebuilds the same commit from
the layer cache the first job wrote, which is why it costs 44 seconds rather
than a second build.

`changes` decides whether the push could have altered the image at all — **5
seconds**, an explicit diff against `github.event.before` rather than
`paths-ignore`, because `paths-ignore` would skip the *tests* too and master
stays verified on every push. A push touching only `docs/**` or `*.md` skips
both image jobs; anything else builds, as does every case the diff cannot
resolve (a force push, a `workflow_dispatch`, a before-commit that no longer
exists). The decision function was checked against real ranges in this history
and ten representative paths before it shipped.

The gate had one bug worth keeping visible, because it failed silently rather
than loudly. `changes` originally *fetched* the before-commit, and the same
push stopped every checkout persisting the workflow token — on a private
repository that cannot authenticate, so the fetch died with "could not read
Username". The fallback answered "build", which is the safe direction and shipped
nothing wrong, but it meant the gate would have skipped nothing, ever, while
appearing to work. It clones the full history instead now, so the diff is local
and needs no credential. A gate whose failure mode is "does nothing quietly" has
to be watched being exercised, which is what the docs-only push is for.

**The pipeline lints itself.** `bash scripts/check-ci.sh` runs actionlint
(pinned to 1.7.12 and checksummed, like the Dockerfile's tessdata fetch) over
the workflow and shellcheck over `scripts/*.sh`, and runs as the first step of
the `quality` job. It exists because a workflow bug has no suite to fail: it
surfaces as a red run on a trunk with no PR gate, which is what most of this
repository's red runs actually were. Verified able to fail in both halves —
an injected `SC2168` and an `env` context in `runs-on:` were each caught, then
reverted.

**Bun is pinned** in `.bun-version` (**1.4.0** since 2026-08-26; 1.3.14
before), read by CI through `bun-version-file` where `setup-bun` still runs.
Unpinned, `setup-bun` resolved to whatever had shipped most recently, so a Bun
release could turn the trunk red with nothing to revert; the pin made the
version reviewable.

The pin now has a second job, and a test enforcing it. Bun is the **runtime**
as of `b81102d`, so the Dockerfile installs its own copy, and for a day the two
numbers disagreed — CI proving the suites passed on a runtime nobody deployed.
`src/__tests__/unit/bun-version.test.ts` compares `.bun-version` against the
Dockerfile's tag and fails if they drift, in the same shape as the Playwright
pin's assertion. That closed `ISSUES.md` BUILD-1, **in the direction that
entry recommended against** — read it before moving the number again; the
concern was TEST-5's rate under 1.4.0, which the alignment does not address.

No job in the pipeline pushes via git, so no checkout persists the workflow
token any more.

### End-to-end

**The suite changed shape on 2026-08-17, for three reasons that all bit the
same day.** It had always run against `pnpm dev` on the developer's own
database. That meant: it tested a server nobody deploys (which is how broken
production auth once shipped under green suites); it fought the developer's
own `pnpm dev` for Next's per-directory single-instance lock (a mid-run suite
lost its server to exactly that); and its re-seed reset the demo household the
owner was actively testing with — their words: not acceptable.

Now it builds and serves the **standalone production artefact** (the thing the
Docker image runs) on its **own database and cache** — `stoky_e2e` and Valkey
db 1, derived in `e2e/db-url.ts` — on `127.0.0.1:3100` by default. The
developer's dev server and data are out of reach by construction, proven by
the owner's live session surviving three full runs untouched. The separate
production config (`test:e2e:sw`) folded in with the move: its reason to exist
was the dev-server gap.

The parity paid for itself on the second run: nine WebKit-only failures turned
out to be a real product defect — the production CSP's
`upgrade-insecure-requests` upgrades every fetch to https even on localhost in
WebKit, so a Safari user on a plain-http LAN install got a rendered page whose
every tRPC call died. The directive is now keyed on the request's transport
(D84), and the suite is why anyone knows.

Ten spec files plus `seed` and `setup` projects. **117 tests in 2.9 minutes,
including the `next build`** — against 108 in 2.7–2.9 driving `next dev`
before the move: the production server serves faster than dev compiles, which
paid for the build. It was 96 after the Phase 4/5 audit, 182 in 5.6 before
that audit. The reductions are not fewer checks: the same checks placed in the
tier that can answer them, and the browser matrix no longer multiplying two
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
| `auth.prod.spec.ts` | The deployed artefact signs people in: `trustHost`, and the production CSP breaking nothing | chromium |
| `service-worker.prod.spec.ts` | A real worker registers, precaches, and serves offline — the one file that opts back into `serviceWorkers` | chromium |

`globalTimeout` is **5 minutes locally and 9 in CI**, and since 2026-08-17 it
covers the `next build` too, because the build runs inside Playwright's
`webServer`. Locally that still fits with room: 117 tests in 2.9 minutes,
build included.

**The CI ceiling story, which three pushes rewrote.** On 2026-08-12 the job
spent 84–193s on setup before a dev-served suite of 385–422s, and the 540s
`globalTimeout` could not fire before the 600s job ceiling — a gap this file
said wanted a product decision (raise the job to ~13 minutes) rather than a
commit. The move to the standalone artefact resolved it the other way:
**the suite got faster instead.** Measured on run `32075663881` (2026-08-18,
the first green containerised-standalone run):

| | Dev-served (2026-08-12) | Standalone (2026-08-18) |
|---|---|---|
| Setup before Playwright | 84–97s | **87s** |
| The `playwright test` step | 385–422s | **313s — 56s build + 117 tests in what Playwright reports as 5.2m** |
| Headroom under the 540s `globalTimeout` | ~120s | **~228s, build included** |
| Job total | 508–618s | 563s — of which **157s is the post-step pnpm-cache save**, not verification |

The production server serves pre-compiled pages; `next dev` compiled each
route on first hit under test traffic. That difference more than pays for the
build, which is why the same 117 tests with a build inside cost 70–110s *less*
than 108 without one. The largest non-test cost in the job is now the cache
save after the suite ends.

**Getting there cost two container-only failures**, both invisible locally
and both now guarded in `playwright.config.ts` comments: Docker exports
`HOSTNAME` as the container id and the standalone server binds it (the piped
build log showed the server ready on `http://<container-id>:3000` while the
probe spun against loopback — `HOSTNAME: "0.0.0.0"` is set explicitly now),
and `localhost` resolving to `::1` (trap 8). The webServer's stdout is piped
rather than ignored for exactly this class: the first timeout produced no
evidence at all, the second named the bind address.

Kept from the container measurements, because both were nearly got wrong: the
apt-install it replaced was 57–136s *depending on Ubuntu's mirrors*, so the
prize was variance off the critical path more than the average; and the
container briefly looked 100s slower against drifting runners until twin jobs
on the same commit measured 400s vs 405s (`31583973041`).

Two `test.skip`s remain in `critical-paths.spec.ts`, scoped to phone viewports
"because the phone UI is Phase 4" — and both are now **inert**: since the
matrix stopped multiplying (D33), no mobile project runs that spec at all, so
the guards can never fire, and the phase they name has closed. Filed as
TEST-6 rather than deleted in passing.

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
8. **`localhost` is two addresses, and stacks disagree about which comes
   first.** The standalone server binds IPv4; WebKit's fetch resolves
   `localhost` to `::1` first on this machine, and Node's readiness probe can
   inside a CI container — so a server that is demonstrably up produces
   instant `Load failed` / connection-refused, which reads as anything except
   what it is. The suite names `127.0.0.1` everywhere now (D86). The tell was
   a 4 ms failure: nothing real fails that fast.
9. **A server that refused to start reports zero of everything.** Counting
   unhandled rejections in the standalone artefact (RUNTIME-1), four probes came
   back clean and were written up as negative results. The server had exited at
   boot: they used `.env`, whose `NEXTAUTH_SECRET` is still the example value,
   and `src/lib/auth/secret.ts` correctly refuses to start on it. Every request
   answered `000` and the log was empty because nothing had run. It produced the
   confident, wrong conclusion that the fix helped only the dev server, when the
   real before/after in production is 50 rejections against 0. **The guard was
   working; the probe never asked whether its subject was alive.** Assert a 200
   before counting anything, and treat an all-zero result from a new harness as
   a claim about the harness until proven otherwise.

   **And a 200 is not enough**, which the same investigation demonstrated a day
   later. A probe server printed `EADDRINUSE` and exited, while `curl` answered
   `200` on that port — a `next-server` left over from something else was
   holding it. The prescribed remedy above would have passed, and every count
   would have been read from a log the answering server never wrote. So the
   check is not "does the port answer" but **"did the process I started say it
   was ready"**: grep the server's own log for its ready line, and pick a port
   after confirming nothing already holds it.

   **Nor is the ready line**, which is the fourth face of the same mistake and
   the subtlest. Checking whether the `proxy` rename had kept the CSP nonce
   alive, a probe reported no nonce and no cookie — which reads exactly like the
   rename having broken it. It had not. The probe's `NEXTAUTH_SECRET` was 30
   characters against a 32-character floor, so the server bound the port,
   printed `✓ Ready`, and then refused to render every request. Ready is about
   the listener; the render is a separate thing that can fail on its own.

   The readiness loop is where it hid: `until curl -s -o /dev/null …` waits on
   curl's **exit code**, and a 500 satisfies that exactly as well as a 200 does.
   **Wait on the status**, and read it out loud:
   `until [ "$(curl -s -o /dev/null -w '%{http_code}' …)" = "200" ]`.

   Four faces now, all the same shape: a server that never booted, a port held
   by somebody else, a redirect nobody followed, and a listener that was not
   rendering. The probe has to check what it is measuring, and each time the
   check that was sufficient last time was not.
10. **Truncating a log the server still holds open does not empty it.** `: > log`
   between runs leaves the writer's file offset where it was, so the file fills
   with NUL padding and `grep` switches to binary mode and stops printing
   counts. Use a fresh filename per run; `grep -a` rescues a file already
   ruined.

---

## What exists

**Backend — substantially complete.** 10 tRPC routers (`auth`, `data`,
`household`, `product`, `location`, `inventory`, `receipt`, `store`, `price`,
`shopping`) merged in `src/server/trpc/router.ts`, **59 procedures** — a count
that has moved four times (44 → 45 → 55 → 59) as phases closed and the export
router arrived, which is why `capabilities.test.ts` asserts it structurally
instead of anyone trusting a document. 10 Zod validation modules. 6 service
modules: `ocr`, `receiptParser`, `productMatcher`, `openFoodFacts`,
`product-cache`, `errors` — plus `src/lib/rating.ts`, the pure module behind
Phase 6.

**The rating — computed, explained, honest (Phase 6).** `computeRating`
weighs Nutri-Score 60%, additives 30% (the worst one decides its component),
organic 10% — but the honesty rules run before the arithmetic, structurally:
no Nutri-Score means "no information" rather than a number built from the
remaining 40%, and OFF's "not-applicable" means non-food is not scored. Shown
on the product detail the scan journey lands on, with what lowered it. The OFF
cache prefix is versioned (`off:product:v2:`) so month-old entries cannot be
served as complete.

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

**Frontend — 27 pages, and no route is linked that does not exist.** That last
part is enforced by `check:links` in CI rather than by audit; the manual version
missed a dead route three times running, twice from routes linked on every row
of a table. The five newest pages are Phase 5's: `/kitchen`, `/shopping` as
Screen A (the list manager moved to `/shopping/lists`), `/settings/people`,
and `/settings/unsaved`.

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
`src/server/trpc/trpc.ts`, and all 59 procedures assigned. Membership and role
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

**Security posture.** Per-request CSP nonce in `src/proxy.ts` with
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
| Announcements | `screen-reader.spec.ts` | ✅ refusals and saved movements both announced — A11Y-1 closed in Phase 5, and the pinned assertion flipped |
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

`pnpm audit` → **no known vulnerabilities** — again. It was clean on
2026-08-12, **2 high** when re-measured on 2026-08-17 (the world moved while
the repository did not: nanoid <3.3.18 under postcss, GHSA-2v37-7h3g-55p8, and
deepmerge-ts <8.0.0 under @prisma/config, GHSA-ggr8-5vv4-36mx), and clean
after two more overrides the same day.

The deepmerge-ts one is the first override to **cross a major** (7 → 8),
because that is where the only fix lives. Taken deliberately and verified
rather than assumed — prisma generate, migrate deploy and the full suites all
run through 8.0.x — and it needed fixing **twice**: `@prisma/config` pins
`deepmerge-ts` at exactly 7.1.5, and the image stages its own npm-installed
prisma under `/opt/prisma` for the entrypoint's `migrate deploy`, where the
workspace override never reaches. Trivy failed the image on the copy pnpm
audit could not see; the Dockerfile's own overrides map (the one already
holding tar and undici) now carries it too. One advisory, two package
managers, two override maps — worth remembering the next time one of these
"is fixed".

The original clearing (57 → 0, 2026-08-10) changed no source; every direct
dependency stayed within its major. Overrides are scoped to the single parent
that pulls them — `recharts>lodash`, not a bare `lodash`.

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
| pnpm | 11.22.0 |
| bun | 1.4.0 — `.bun-version` and `Dockerfile:40`, compared by a test |
| node | 24-alpine — the base image for all four stages; **no longer the runtime** |
| sharp | 0.35.3, **devDependency only** — not shipped, not loaded at runtime |

**The runtime changed on 2026-08-26 and this is the row that says so.** `next
dev` and `next start` run under `bun --bun` (`b81102d`), the production image
serves with `bun server.js`, and image processing went from `sharp` to
`Bun.Image` behind `src/server/services/image.ts`. `sharp` stays installed
because the HEIC investigation in the pre-plan still needs it for comparison;
`next.config.ts` excludes it and `@img/*` from output file tracing so it cannot
reach the standalone artefact. Two consequences worth knowing before changing
anything here: the application has left Next's supported runtime, and phone
HEIC uploads are still refused — `Bun.Image` wants an OS codec Alpine does not
carry.

No known drift as of **2026-08-26** — every row re-read out of `package.json`,
`.bun-version` and the `Dockerfile` today, not eyeballed. `CLAUDE.md`'s stale claims — tRPC as a release candidate,
a `household` router that never existed, a refresh token that was never
implemented — were corrected on 2026-08-10.

**The pnpm row had drifted for six days, and the sentence above it said it had
not.** `5289e2b` bumped the pin to 11.22.0 on 2026-08-19 while this table went
on saying 11.19.0 and the paragraph went on claiming the table had been checked
against `package.json`. A drift note is only worth the check behind it, and the
check is cheap: read the versions out of the file rather than trusting the
sentence that says somebody already did.

**This paragraph was itself wrong until 2026-08-25**, and it is worth saying
how: it claimed `CLAUDE.md` says Prisma 7.x, when that file said 6.x and always
had. A drift note that had drifted is the exact failure this file exists to
prevent, and it survived because nobody re-read the source it was describing.

**That whole class of drift is now closed at the source.** `CLAUDE.md` carries
no version numbers at all since 2026-08-27 — four of the nine claims it had
gone stale on were versions, and a file loaded into every context is the worst
place to keep a number that changes. This table is the only owner, and it is
read out of `package.json`, `.bun-version` and the `Dockerfile` rather than
recalled.

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
- ~~Roles are enforced on the server per procedure, but no interface creates a
  KITCHEN account.~~ **Closed in Phase 5.** `/settings/people` lists the
  household and creates an account with a role, which is what makes `KITCHEN`
  reachable at all — it had been enforced since Phase 3 and creatable only by
  a database write ever since.

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
- bun intermittently **abandons a test body at a rejecting `await`** — measured
  on 1.3.14 and again on 1.4.0: the
  `catch` beside it never runs, the test's own assertion never executes (one
  fewer `expect()` than a passing run), and the test is reported as failed with
  the error rendered at its origin. `withReplay` and its tests are both correct
  — the record it refuses matches on key, user and procedure, and differs only
  in the request hash, which is the condition it exists to refuse.
- It reproduces **only under load**: 3 failures in 24 with another suite running
  against the same database, 0 in 90 on a quiet machine. `docs/reproductions/`
  carries a self-contained file and the recipe. **TEST-5** in `ISSUES.md`
  (open alongside TEST-6 and RUNTIME-1; PRICE-1 closed on 2026-08-18), and it
  wants an upstream report rather than work here.
- **The `retry: 2` mitigation does not make CI green, and this is new.**
  Measured on run `31568215727`: the retry did its job — the test passed on
  attempt 2 and the suite reported `395 pass / 0 fail` — but bun also reported
  `1 error`, because the abandoned attempt's assertion lands after bun has moved
  on and is counted as an *unhandled error between tests*. `bun test` therefore
  exits 1 on a run where nothing failed, and the `test` job goes red. Re-running
  the job cleared it, which is the same signature and the same remedy as before.
  So the retry fixed the pass/fail tally and not the exit code, and the honest
  cost of TEST-5 is still roughly one CI run in seven — it did exactly this
  again on run `32792826678` (`e13c540`) on 2026-08-25. A pin forward was the
  documented workaround, and **it has been measured and does not work**: bun
  1.4.0 shipped on 2026-08-20 and still reproduces the defect, at a rate this
  many runs cannot tell apart from 1.3.14's. `ISSUES.md` TEST-5 carries the
  numbers, and the interleaving the comparison turns out to need. Narrowing the
  exit code without also hiding genuine unhandled rejections across the other
  442 tests is a judgement call that has not been made.

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
  errors to somebody else's server. (An earlier line here also said "no data
  export" — stale since the export closed above; a backup story beyond the
  JSON export is still absent.)
- Coverage is measured now, but **per tier, and the denominators differ**: each
  report counts only the files that tier loads, so the three numbers do not
  compose into a project figure and must not be added. Integration 90.2% of
  functions / 87.1% of lines; components near 100% on every component except
  `UploadZone` (83.5%); unit 70.0% / 63.4%, which is low by construction —
  it loads modules it only partly exercises on purpose (D25). No tier covers
  `src/app/**`; those routes are reached only by the browser suite.
- No visual regression coverage.
- ~~**The gates run on a toolchain nobody deploys.**~~ **Closed 2026-08-26.**
  `quality` and `test` now build the image's `development` stage and run inside
  it (`scripts/ci-in-image.sh`, wired by `defd147`), CI and the image share one
  pinned Bun (`e2a6a8e`), and `.devcontainer/` attaches the editor to the same
  container (`b5200da`). This was not hypothetical: `sharp` on the host decoded
  what `sharp` in the image could not, and an afternoon of HEIC investigation
  ran the wrong way round because of it. `e2e` stays in Microsoft's Playwright
  image, deliberately — it needs browsers, not this application's runtime. **The
  workflow wiring itself is unverified**: `actionlint` and `shellcheck` pass and
  the script was run here, but the first real pipeline run is the proof.
- **Phone HEIC uploads are still refused, and the door is narrower than it was.**
  Measured on four real files across both platforms: the bundled `sharp` binary
  carries AV1 but no `de265`, and `Bun.Image` wants an OS codec Alpine does not
  provide. Moving to `Bun.Image` closed the runtime gap and left this one open —
  the remaining route, Alpine's `vips-heif`, now means reintroducing a library
  this work just removed. It is the one question
  `docs/superpowers/plans/2026-08-25-development-in-the-image-preplan.md` leaves
  standing; nothing in that file chose a door.
- **Bun raises unhandled rejections that Node consumes** — `ISSUES.md`
  RUNTIME-1, **half closed on 2026-08-26**. It was two causes filed as one. The
  prerender chain — every route calling `auth()`, Auth.js minting a CSRF token
  with `crypto.getRandomValues()` merely to read a session — is fixed by
  `d0e7566`: `auth()` now declares that reading a session is request data, so
  Next attempts no prerender to interrupt. Measured on both servers and at no
  cost in prerendering — 13 dev-server routes go from 13 errors to 0, and the
  standalone artefact under Bun from **50 rejections over 39 requests to 0**, so
  production is fixed and not just the console. What remains is an
  `AbortError` out of `node:async_hooks` when a client abandons an in-flight
  request — ~1500 in a browser-suite run, and **pre-dating the fix**: the same
  21-test subset raised 250 on master and 253 after. No response changes and no
  gate fails, which is what makes it expensive — with no error tracking (bullet
  above), the logs are what this project has.

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
| 5 — Kitchen screen, and Screen A's layout | ✅ Complete against its done-when, except a week on a real tablet |
| 6 — Product rating | ✅ Complete against its done-when, except T7 (offline scan resolution) |
| 7 — Security review | ✅ **Complete** — `docs/SECURITY_REVIEW.md` (2026-08-26). Found and closed four household-isolation defects and a shipped OpenSSL CVE |
| 8 — The owner's first pass | ✅ All six closed; the done-when — the owner repeats their pass — is the owner's to run |

**What remains, in one place.** The three human
passes no suite can answer (the manual screen-reader pass, a week on a real
tablet, iOS Safari on a real device); **a household admin panel** — members and
roles, added to §10's unowned table on 2026-08-27, because a household can add a
member today and can never remove one or change a role; **session revocation**,
by the account itself and by an admin from that panel, which answers the one
question `SECURITY_REVIEW.md` finding 8 left open; T7, the offline scan
resolution; and
**Phase 8's human half** — the two §3/§5.1 promises the 2026-08-17 re-audit
found unbuilt have both landed, the ± stepper at `74cff4b` and the screen
choice at `300f665`, so Journeys 4 and 8 pass — all six of the
owner's observations are built and green (`70386ea` closes the last); what
remains of the phase is its done-when, which no suite can run: the owner
repeating the pass that produced them. All of it is in
`REDESIGN_PLAN.md` §10, which is the list an item may only leave by being done
or deliberately dropped.

Journeys 1, 2, 3, 4, 6, 7, 8, 9 and 10 of `docs/SMOKE_JOURNEYS.md` pass at the
tiers a suite can answer — 4 since 2026-08-25 and 8 since 2026-08-26. Only 5 is
short of its own promise, on T7. Journeys 2 and 7 pass against their pre-Phase-8 shape — the owner's
pass widened both on 2026-08-18, and the widened halves are not built. The
per-journey evidence is in that file.

### Environment notes

- `pnpm` and `corepack pnpm` both work since the 11.22.0 bump; corepack's
  refusal was a mismatch against the old 11.19.0 pin, measured gone 2026-08-25.
- ~~`pnpm prisma` commands need `DATABASE_URL` exported.~~ **Fixed** by
  `6d5d3c3`: `prisma.config.ts` calls `process.loadEnvFile(".env")` itself. Its
  own presence is what made Prisma 6 stop doing that, so the file that caused
  the problem is the file that solves it. It does not overwrite variables
  already set, so a CI-provided `DATABASE_URL` still wins.
- `scripts/test-integration-local.sh` stops the compose services when it
  finishes unless `KEEP_TEST_SERVICES=1`. Running it and then `db:seed` fails
  with "can't reach database" for that reason and no other.

- The `docker` group includes this user, but a login session started before that
  change will not have it. Re-login, or prefix with `sg docker -c "..."`.
- Port 3000 is occupied on this machine by an unrelated application, and 3001
  is routinely this project's own `pnpm dev`. The browser suite defaults to
  3100 and no longer conflicts with either — it may be run while a dev server
  is up, and touches neither its port nor its data.
- Next refuses a second dev server from the same directory — `next dev` only.
  The suite's standalone server takes no such lock, which is half of why the
  suite moved to it; the other half is `stoky_e2e`. Before the move, a suite
  and a developer's dev server could and did kill each other's.
- If message catalogues appear stale, the running dev server has cached them —
  `touch next.config.ts` makes it reload.

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
