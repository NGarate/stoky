# Development in the image, and the Bun runtime question — PRE-PLAN

> **PARTLY EXECUTED, 2026-08-26.** The Bun migration in this file was taken
> and it worked: `a120517` consolidated image handling into one module,
> `b81102d` moved the runtime to Bun and the image pipeline to `Bun.Image`,
> and `c1f5248` stopped shipping `sharp` at all. Unknown 1 below is answered —
> **148 of 148 browser tests pass** against a Bun-served production build, so
> `sharp` was the only thing that broke. One new gap opened; it is recorded
> under "What is NOT known" as item 6. Stages 2 and 3 of the container work
> are still untouched, and the HEIC question is unchanged.
>
> **PRE-PLAN — not executable.** This is the evidence and the shape of the
> work, written before the plan so the decisions are taken on measurements
> rather than on recollection. One stage has already landed (`dc06795`); the
> rest is undecided and is deliberately written as questions with prices
> rather than as tasks with checkboxes. Do not hand this to an executing
> agent. When the open decisions below are answered, this becomes an
> implementation plan and this file becomes its historical record.

**Written:** 2026-08-25. Every number below was produced by a command on this
machine or in a container on it, on that date, and says which.

---

## Why now

The owner's position, and the reason the rest of this exists:

> "Lo mejor es mover el sistema de desarrollo a un contenedor, lo mejor es
> acercarse lo más posible a producción, alejarse solo añadirá más huecos
> donde pueden colarse bugs y fallos inesperados."

This project had just paid for exactly that gap, twice in one evening.

**The incident.** A receipt upload from Android showed only some of the
phone's photos. The cause looked like HEIC being missing from the `accept`
attribute, so the fix looked like adding it. It was implemented — client and
server — before anyone asked whether the server could actually *decode* a
HEIC. It cannot: `sharp`'s bundled libvips has no HEVC decoder, and four real
phone photographs proved it. The change was reverted before it shipped, but it
was only luck that the question was asked at all, and the reason the question
was hard is that **the host and the image do not run the same `sharp`**.

**The second gap, found while checking the first.** The test suites run on the
host and on the CI runner. Neither is the image. So a defect that only exists
in the image — a missing codec, a different libc, a native module that
resolves differently — cannot be caught by any gate this project has. That is
not hypothetical: `STATUS.md` already records production auth broken with
every suite green, because `next dev` applies neither `trustHost` nor the
production CSP. This is the same class, one layer down.

---

## What already landed

**`dc06795` — `build(docker): the development image can run the suites`**

The `development` target could serve the app and not run a single assertion.
Three things were missing:

| Missing | Why it mattered | Measured before |
|---|---|---|
| Bun | every test script is `bun test`; the image is Node + pnpm | no test could run at all |
| `prisma generate` | `deps` runs `pnpm install`, which leaves `@prisma/client` uninitialised | 3 unit files failed on "did not initialize yet" |
| `git` | three tests ask the repository about itself | 4 failures, plus `ENOENT: /app/.gitignore` |

Bun is **copied in from `oven/bun:1.4.0-alpine`, not used as the base.** The
runtime stays Node because production starts Next's standalone output with
`node server.js`; basing development on `oven/bun` would put the dev server on
one runtime and the deployed one on another, which is a wider gap than the one
being closed. The tag is pinned rather than `1-alpine`, which resolved to
1.4.0 while the host was on 1.3.14 — a floating runner can change underneath a
green suite.

**Measured inside the image**, source bind-mounted the way compose mounts it:
569 unit and 593 component, 0 fail — the same numbers the host reports.

---

## What is measured, and what it showed

Everything in this section is a command that was run. Nothing here is
recollection.

### The HEIC question

| # | What was run | Result |
|---|---|---|
| 1 | `sharp.format.heif` in `node:24-alpine` | `input=true` — looked sufficient, was not |
| 2 | `sharp().heif({compression:"hevc"})` | **fails**: "Unsupported compression" — no HEVC *encoder* |
| 3 | `strings` over the bundled `libvips-cpp.so.8.18.3` | `de265` → **0 hits**. `aom` → 40 |
| 4 | A HEIF encoded here with AV1, read back | **OK** — the container path works; the codec is the problem |
| 5 | **Four real phone HEICs** (2 Android, 2 iPhone) through `sharp` | **all four fail**, before reaching the codec: libheif's own security limits — `iloc box contains 50 items` on the Android pair, `Number of references` on the iPhone pair |
| 6 | The same two files through Alpine's `apk add vips vips-heif` | **both convert** — 843 KB and 385 KB of JPEG |

**What this establishes:** HEIC is reachable, but only through a libvips built
with libheif — not the binary npm ships. That is a change to the production
image *and* to every machine that runs the suites, which today decode through
the bundled binary.

### The Bun-as-runtime question

| # | What was run | Result |
|---|---|---|
| 7 | `@prisma/client`, `sharp`, `tesseract.js` required under Bun | **all three load** |
| 8 | `bun .next/standalone/server.js`, real `NEXTAUTH_SECRET` | Next 16.3.0 boots; `/login` **200**, `/register` **200**, `/api/health` **200**, no errors |
| 9 | **The full browser suite against a Bun-served build** | **84 passed, 8 did not run, 2 errors outside any test** (Node: 134 passed) |
| 10 | The failure, from the server log | `Failed to load external module sharp: Could not load the "sharp" module using the linux-x64 runtime` |

**What this establishes:** Bun runs this application far better than caution
suggested — it serves pages, and Prisma, Sharp and Tesseract all load in
isolation. The break is specific: **Bun + Next's external-module loader +
sharp's platform-specific resolution.** Not "Bun is incompatible with Next".

### `Bun.Image` as sharp's replacement

`Bun.Image` exists in both 1.3.14 and 1.4.0. Its prototype carries `jpeg`,
`png`, `webp`, `heic`, `avif`, `resize`, `rotate`, `metadata`, `modulate`,
`flip`, `flop`, `placeholder`, `toBuffer` and more.

| # | What was run (all in `node:24-alpine`) | Result |
|---|---|---|
| 11 | JPEG, PNG and WebP → `.jpeg({quality:90})` | **all three OK** |
| 12 | EXIF-tagged source → `.jpeg()`, metadata re-read | **EXIF stripped** — the `CLAUDE.md` privacy requirement is met |
| 13 | A 120×60 source tagged orientation 6 | `sharp().rotate()` → 60×120; **`Bun.Image.jpeg()` → 60×120** |
| 14 | Two real phone HEICs through `Bun.Image` | **fail**: "format not supported on this machine (HEIC/AVIF/TIFF require the OS codec)" |

**Two corrections to earlier reasoning, recorded because they were wrong in
the room:** `Bun.Image.rotate()` demanding an explicit 90/180/270 looked like
a missing feature, and `metadata()` exposing no orientation field looked like
a blocker. Neither is: **orientation is applied at decode**, so no `rotate()`
call is needed at all. Test 13 is the proof.

`sharp` has exactly two callers: the re-encode in
`src/server/trpc/routers/receipt.ts` and one `metadata()` probe in
`src/server/services/ocr.ts` that transforms nothing.

### Executing it — 2026-08-26

| # | What was run | Result |
|---|---|---|
| 15 | The 144-megapixel bomb through `new Bun.Image(buf, { maxPixels })` | **refused**: "input exceeds maxPixels limit"; an ordinary photograph is not |
| 16 | **The full browser suite against a Bun-served standalone** | **148 of 148 passed** |
| 17 | The production image built, run on the compose network | migrations applied; `/api/health`, `/login`, `/register` all **200**; `bun 1.4.0` as pid 1 |
| 18 | `sharp` excluded from tracing, rebuilt | standalone 128 MB → **110 MB**, image 828 MB → **800 MB**, no `@img` package left |

**A third correction, and this one nearly cost a security control.** In the
room I said `Bun.Image` had no pixel bound, having looked for one on the
prototype. It is a **constructor option**, `maxPixels`, and it makes Sharp's
promise exactly: checked after the header is read, before any buffer is
allocated. Had that mistake been trusted instead of re-checked, the migration
would have quietly dropped `SECURITY_REVIEW.md` finding 14 — a control added
the day before. Run 15 is the check.

---

## What is NOT known

Written out because the value of this document is the line between the two.

1. ~~**Whether sharp is the only thing that breaks under Bun.**~~
   **Answered 2026-08-26.** It was. Run 16: with `sharp` gone, 148 of 148
   browser tests pass against a Bun-served production build.
2. **Whether Alpine's `vips-heif` is enough for `sharp`.** Run 6 used the
   `vips` CLI. Building `sharp` against the system libvips is a further step
   and was not attempted.
3. **Whether `Bun.Image` can reach an OS codec on Linux at all**, or whether
   "OS codec" means macOS/Windows only. Run 14 says it found none on Alpine;
   it does not say one could be provided.
4. **Performance.** Nothing in this document measures it. The case for Bun
   here rests on closing a gap, not on a benchmark that has not been taken.
6. **Why Bun surfaces a rejection Node consumes.** Next starts a prerender of
   `/`, which always bails out because `auth()` reaches for
   `crypto.getRandomValues()`. Under Node that bail-out never appears; under
   Bun it arrives as an unhandled rejection — 73 in one suite run, twice per
   request to `/`. No response changes and no gate fails, but 73 spurious
   rejections are enough to bury a real one. Declaring the dependency up front
   with `connection()` was tried and changed nothing, so it was reverted. This
   is Bun/Next interop, not application code, and it is the one thing the
   migration made worse.
5. **`Bun.SQL`.** Raised as a motivation for the migration. It is not a
   runtime change: it would replace Prisma, which `CLAUDE.md` calls the single
   source of truth and from which the migrations and every type derive. It
   belongs to its own conversation and is out of scope here.

---

## The shape of the work

### Containerising development — three stages

| Stage | What | State |
|---|---|---|
| 1 | The image can run the suites | **landed**, `dc06795` |
| 2 | CI runs its suites on that image | not started |
| 3 | The editor works against it (`devcontainer.json`) | not started |

Stage 2 is the one that matters most and is easiest to skip. Today `quality`
and `test` run on `ubuntu-latest` with the runner's toolchain; only `e2e` uses
a container, and it is Microsoft's Playwright image rather than this project's.
**If development moves into the image and CI does not, the gap is not closed —
it moves.**

Stage 3 is friction, not risk: the TypeScript language server reads a
`node_modules` that would live in a container volume.

### The Bun runtime — one crack, and a way through it

The only identified blocker is sharp, and `Bun.Image` covers everything the
two call sites need (runs 11–13). But adopting `Bun.Image` **couples the
server to Bun** — it is a Bun global and does not exist under Node — so it is
not a step that can be taken before the runtime switch. Runtime and image
library move together or production breaks.

Proposed order, if this is pursued: swap both call sites to `Bun.Image`, serve
the standalone build with Bun, **run the full browser suite**, and only then
decide. That converts "feasible" into "verified" and costs one experiment.

### HEIC

Two doors, both currently shut on Alpine:

- **`sharp` + system libvips** — works (run 6), needs a build change and a
  change to every developer's machine.
- **`Bun.Image`** — needs an OS codec Alpine does not have (run 14).

HEIC is therefore **downstream of both other decisions** and should not be
attempted before them. The owner has already asked for it to be a separate
commit after the container work.

Until then the current state is honest rather than broken: `9df4ab9` made the
file picker offer exactly the types the server accepts, from one shared list
in `src/lib/validations/receipt.ts`, and recorded next to that list why HEIC
is not on it.

---

## Open decisions

1. **Stage 2 — does CI move to the image?** Recommended yes; without it the
   principle that motivates all of this is only half applied.
2. **Is the Bun runtime pursued at all?** The evidence says the crack is
   narrow and probably closeable. The cost is coupling image processing to a
   Bun global and leaving Next's supported runtime.
3. **If yes, is the verification experiment run first?** Recommended yes. It
   is one browser-suite run and it answers unknown 1.
4. **HEIC, after the above — which door?** Only one can be taken and they
   point at different infrastructure.

---

## Constraints every future task inherits

Copied from `CLAUDE.md`, because a plan derived from this file will need them:

- `master` only. No branches, no PRs. Atomic commits, each green on its own.
- Conventional Commits; the message explains **why**.
- `pnpm verify:ci` before every commit, plus the browser suite for anything
  that touches the interface.
- Stage with `git add <path>`, never `git add -A` with more than one change in
  the tree. *(This was violated once during this work — a Prisma migration
  rode into an unrelated UI commit. See `abf5778`.)*
- Ten minutes is the budget for all verification, enforced.
- A test must be able to fail. Break the code deliberately and confirm red.
