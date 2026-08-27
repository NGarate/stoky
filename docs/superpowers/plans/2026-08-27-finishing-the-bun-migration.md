# Finishing the Bun migration, and the end of Sharp

**Written:** 2026-08-27. Every number below was produced by a command on this
machine or in a container on it, on that date, and says which. Where something
was not measured, it says that instead.

The migration itself is done and deployed: Bun serves the application, the image
pipeline is `Bun.Image`, CI and the editor run in the same image. What is left is
the tail — the pieces that still assume Node, the dependency that was supposed to
go and did not, and the one question the migration narrowed instead of settling.

This file exists because that tail was scattered across three documents and none
of them held the shape of it.

---

## What already landed

| | Commit |
|---|---|
| Image handling consolidated into one module | `a120517` |
| Runtime moved to Bun, pipeline to `Bun.Image` | `b81102d` |
| `sharp` stopped shipping | `c1f5248` |
| CI and the image on one pinned Bun, asserted by a test | `e2a6a8e` |
| `quality` and `test` moved inside the image | `defd147` |
| Editor attached to the same container | `b5200da` |
| `auth()` declares itself dynamic — RUNTIME-1's prerender half | `d0e7566` |

Verified: 148/148 browser tests against a Bun-served standalone build, and
`verify:ci` green at 624 unit / 611 component / 494 integration.

---

## 1. Sharp is still installed, and swapping it is not one-for-one

`package.json:92` still carries `"sharp": "^0.35.3"` as a devDependency. Three
test files import it:

| File | What it does with sharp | Now |
|---|---|---|
| `src/__tests__/unit/image-reencode.test.ts` | builds fixtures **and** reads EXIF back | no sharp |
| `src/__tests__/integration/receipt.upload.test.ts` | builds a fixture, then asserts format and EXIF on what was stored | no sharp |
| `src/__tests__/integration/receipt.router.test.ts` | builds the decompression-bomb fixture | no sharp |

So sharp is doing **two** jobs, and they have different answers.

**Both are answered, and the third column is why the count did not go to zero.**
Sharp is now imported by two files that did not exist when this was written —
`unit/jpeg-markers.test.ts` and `unit/exif-writer.test.ts` — whose entire job is
to check the replacements against it. See the correction at the end of this
section: that is the intended end state, not a leftover.

### The assertion job: `Bun.Image` cannot see EXIF

Measured on the host (1.3.14) and again inside `oven/bun:1.4.0-alpine`, which is
the version that deploys:

```
metadata: {"width":60,"height":40,"format":"jpeg"}
```

Three keys. **There is no `exif`, on either version.** That matters more than it
looks: the assertion it would replace —
`expect((await sharp(output).metadata()).exif).toBeUndefined()` — is what proves
`CLAUDE.md`'s upload constraint, that a photograph's GPS coordinates do not
survive an upload. Deleting sharp without replacing it would delete the proof.

**A replacement was measured and works.** A JPEG carries EXIF in an APP1 segment
introduced by the literal `Exif\0\0`; walking the marker chain from SOI to SOS
finds it in about twelve lines and no dependency. Against the same two buffers
sharp was asked about:

| Buffer | sharp says EXIF | byte scan says EXIF | agree |
|---|---|---|---|
| source, written with `withExif` | true | true | ✅ |
| after `reencodeAsJpeg` | false | false | ✅ |

This is arguably the better assertion rather than a grudging substitute: it reads
the bytes the server produced, instead of asking a second library what it thinks
of them.

**Built, and it needed two readers the plan had not anticipated**
(`src/__tests__/utils/jpeg.ts`, `758f472`). The EXIF scan is as described. The
orientation assertion, however, **cannot be converted the obvious way**:

`Bun.Image` applies EXIF orientation *while decoding*, so `metadata()` reports
the **displayed** size. A source stored 120 × 60 and tagged "rotate 90" comes
back 60 × 120 — identical to its own re-encoded output. Swapping
`sharp(...).metadata()` for `readImageMetadata` there leaves a test that passes
because both sides agree, having quietly stopped comparing anything.

So the walker also reads `SOF` for the frame's **stored** dimensions and tag
`0x0112` out of IFD0 for the orientation itself. The resulting assertion is
stronger than the one it replaces: the source is stored 120 × 60 *with* a tag
and the output 60 × 120 *without* one, which says "baked into the pixels"
directly instead of inferring it from a decoder's summary.

Worth generalising: `Bun.Image.metadata()` being a three-key summary is not only
a missing-EXIF problem. It is a *normalising* reader, and a test that compares an
image before and after a normalisation cannot use the normaliser as its
instrument.

### The fixture job: there is no `Bun.Image.create`

`Bun.Image`'s statics are `backend`, `clipboardChangeCount`, `fromClipboard`,
`hasClipboardImage` — all clipboard, none constructive. The constructor takes
**encoded bytes**, so there is no equivalent of
`sharp({ create: { width, height, channels, background } })`. Fixtures have to
come from somewhere else:

- committed fixture files, which is the honest option for the ordinary cases; or
- bytes assembled in the test, which is the only option for the
  decompression bomb — it needs a header claiming an enormous canvas over almost
  no data, and that is a hand-written PNG IHDR rather than anything a library
  offers.

~~**Not attempted, and therefore not known:** whether a hand-built PNG bomb
reproduces the `maxPixels` refusal the current fixture triggers.~~ **Run on
2026-08-27, and it does.** Step 4 is unblocked.

A PNG signature, an IHDR declaring 9000 × 9000 with its CRC, a token `IDAT`
holding a deflate stream of sixteen zero bytes, and an `IEND` — **68 bytes in
total** — is refused with `Image: input exceeds maxPixels limit`, the same
refusal the 200 KB sharp-built fixture triggers today.

Three cases were run, because the first alone would not have been evidence:

| Case | Declared | Bytes | Result |
|---|---|---|---|
| A — huge header, token IDAT | 9000 × 9000 (81 MP) | 68 | refused, `exceeds maxPixels limit` |
| B — small header, **same token IDAT** | 60 × 40 | 68 | **accepted**, `{"width":60,"height":40,"format":"png"}` |
| C — genuinely valid small PNG | 60 × 40 | 87 | accepted |

**B is the case that makes A mean something.** Without it, a refusal in A is
equally well explained by the IDAT being sixteen bytes of nothing rather than by
the pixel count — and a bomb fixture that is refused for being malformed is a
security test that has stopped testing while still passing, which is the outcome
this section was written to avoid. B holds the malformed data fixed and changes
only the declared canvas.

It also settles a claim `src/server/services/image.ts` makes in prose: that the
bound is checked "after the header is read and before any pixel buffer is
allocated". Sixty-eight bytes containing no pixel data at all are enough to
trigger it, so the check cannot be happening after a decode.

### A trap that will be hit during the conversion

```
TypeError: Image(): resizable / shared ArrayBuffer is not supported;
pass a fixed-length view (e.g. buf.slice())
```

`Bun.Image` refuses a `Buffer` backed by a resizable `ArrayBuffer`, and **sharp's
output buffers are backed by one**. So the moment a converted test feeds a
sharp-built fixture to `Bun.Image`, it fails with an error about ArrayBuffers
rather than about images. `Buffer.from(new Uint8Array(buf))` fixes it.

**The application is not affected, and this was checked rather than assumed.**
Both callers build their buffer from a source that is never resizable —
`Buffer.from(input.fileBase64, "base64")` in `receipt.ts:155` and
`fs.promises.readFile` in `ocr.ts:91`.

### What removing it actually buys

Being honest about the size of the prize:

- **Nothing in production.** `outputFileTracingExcludes` already works: the
  standalone artefact carries `node_modules/sharp` as a **dangling symlink of 0
  bytes**, `@img/*` is absent entirely, and the 19 MB of `libvips` does not ship.
- **19 MB and its install time** off the dev image and every `pnpm install`.
- **The real prize is the premise.** Nothing prevents somebody importing sharp
  into `src/` tomorrow. It would work in development, pass every gate, and fail
  in production — where the trace exclusion has removed it — with
  "Could not load the sharp module". `next-image.test.ts` guards the sibling
  premise (that nothing imports `next/image`) and says in its own docblock why a
  build cannot notice. **There is no equivalent guard for sharp itself.**

That guard is worth writing *before* any of the conversion work, because it is
five minutes, it is useful whether or not sharp is ever removed, and it is the
only item here that closes a hole rather than tidying one.

**Written** (`92156c9`). It matches the three import spellings rather than the
word, because two files in `src/` explain sharp in prose and a guard that goes
red on an explanation gets deleted. It also pins the other half of the pair —
the trace exclusion, and sharp's place in `devDependencies` — since an import
ban is pointless without the exclusion and a change to either is a decision
about the other.

### And a correction to the target above

**"Sharp becomes unreferenced" is the wrong goal, and the conversion work is
what showed it.** After step 4 the library is imported by exactly two files:
`unit/jpeg-markers.test.ts` and `unit/exif-writer.test.ts`. Both exist *to
disagree with it* — one proves the byte readers give sharp's answers, the other
proves the EXIF writer produces something sharp can read back.

Removing sharp from those is not a smaller dependency. It is deleting the only
check that this repository's hand-written TIFF and PNG are anything more than
bytes it believes in on its own authority, which is precisely the "stops
testing while still passing" failure §1 already warns about for the bomb
fixture.

So the honest end state is: **sharp stays in `devDependencies` as a
cross-check, and is referenced nowhere else.** That is reached. What it costs is
19 MB of `pnpm install` in development and nothing in production. What it buys
is that two hand-written binary formats are continuously checked against a real
implementation.

This makes the HEIC decision below **independent of whether sharp is
installed** — it was the last reason sharp had to *ship*, and it is still a
decision, but it is no longer the thing standing between the repository and a
smaller dependency list.

---

## 2. HEIC is why sharp is still installed, and it is shut

Re-measured under `oven/bun:1.4.0-alpine` on 2026-08-27, both directions:

```
heic encode: Image: format not supported on this machine
             (HEIC/AVIF/TIFF require the OS codec; AVIF enc…)
avif encode: Image: format not supported on this machine
```

The error names its own cause. Alpine does not carry the OS codec `Bun.Image`
wants, so phone HEIC uploads are still refused — the defect that began this whole
investigation.

**The migration narrowed this rather than settling it.** The surviving route is
Alpine's `vips-heif`, which means reintroducing the library this work just
removed, and building `sharp` against the system libvips rather than its bundled
one — a step
`docs/superpowers/plans/2026-08-25-development-in-the-image-preplan.md` records
as never attempted. Its open decision 4 is this question and it is still the only
one that document leaves standing.

**Consequence for sequencing:** sharp cannot be uninstalled while it is the
only measured path to a HEIC. Removing it from the tests (§1) and removing it
from the repository are two decisions, not one, and only the first is available
today.

---

## 3. RUNTIME-1's second half

`d0e7566` closed the `crypto.getRandomValues()` family — 50 rejections over 39
requests to 0, in production as well as in the dev server. What remains is:

```
⨯ unhandledRejection: Error [AbortError]: The operation was aborted.
    at abort ([native code])   sourceURL: 'node:async_hooks'
```

~1500 per browser-suite run, and **pre-dating the fix** — 250 on master against
253 after, over the same 21-test subset. `ISSUES.md` RUNTIME-1 carries the four
hypotheses already eliminated (ordinary requests, a client hanging up, an RSC
request, the router prefetch) and names the next variable to move: every test
that reproduces it is signed in, and none of the probes were.

---

## 4. The Node ties that remain, and which are worth cutting

Listed because "the migration is done" reads as "nothing runs on Node", and that
is not true.

| Where | What | Worth cutting? |
|---|---|---|
| `Dockerfile:218` | healthcheck runs `node -e "fetch(…)"` | **Yes, cheaply.** It is the only Node process in a *running* container. `bun -e` is a one-line change, and it removes the container's dependency on a runtime it otherwise only stores |
| `Dockerfile:184,188` | `node -p` / `node -e` at build time to read and patch `package.json` | **No.** Build-time only, on a stage that has Node regardless |
| `Dockerfile:204` | `chown -R node:node` on the uploads volume | **No.** The user, not the runtime |
| `.github/workflows/ci.yml:235,250,303` | `e2e` and `audit` install Node and Bun on the runner | **No.** `e2e` correctly runs in Microsoft's Playwright image — it needs browsers, not this application's runtime — and `audit` needs only a package manager |
| base image | `node:24-alpine` for all four stages | **No, and this was decided.** The owner chose it: Bun runs on top, and there is no more suitable base |

Only the first row is a change. It is small enough to be a single commit and
independent of everything else here.

---

## Order, and what each step unblocks

1. **Guard the premise** — a unit test that nothing outside `src/__tests__/`
   imports `sharp`, in the shape of `next-image.test.ts`. Closes a hole that
   exists today and does not depend on any decision below.
2. **The healthcheck to `bun -e`** — independent, one line, removes the last
   Node process from a running container.
3. ~~**Run the missing experiment**: does a hand-built PNG bomb still trigger the
   `maxPixels` refusal?~~ **Done, and it does** — 68 bytes, with the control case
   that makes the answer evidence rather than a coincidence. See §1.
4. ~~**Convert the three test files** — byte-scan for EXIF, committed or
   hand-built fixtures. Sharp becomes unreferenced but stays installed.~~
   **Done** (`758f472`, `7f795fc`, `80c2d23`, `ec14fd9`, `00a3b07`), with one
   correction to its own goal.

   Every assertion reads bytes; every fixture is hand-assembled — PNGs from
   `../utils/png`, EXIF from `../utils/exif` writing real TIFF, and the base
   JPEG from `reencodeAsJpeg(pngOf(w, h))` on the runtime that ships.

   Sharp is **not** unreferenced, and should not be. It survives in exactly two
   files whose job is to disagree with it. See §1's correction: removing it
   there deletes the only check that the hand-written formats are more than
   bytes this repository believes in on its own authority.

   Three things the conversion turned up, each of which would have produced a
   test that passed while testing nothing:
   - `Bun.Image` **normalises orientation while decoding**, so it cannot be the
     instrument for a test about whether orientation was baked in;
   - the strict bomb control belongs at the unit tier, because through
     `receipt.upload` a bomb and a malformed image are both `BAD_REQUEST`;
   - a token `IDAT` passes the header check and fails the decode, so "accepted"
     depends on which of the two a test actually exercises.

5. **HEIC decision** (pre-plan, open decision 4). Until it is taken, sharp stays
   in `package.json` whether or not anything imports it, and saying so in the
   file is better than leaving a dependency nobody can explain.
6. **RUNTIME-1's `AbortError`** — its own investigation, upstream-shaped.

~~Steps 1, 2 and 3 are available now and independent of each other. Step 4 needs
3.~~ Steps 1, 2 and 3 are done (`92156c9`, the healthcheck, and the experiment
above), so **step 4 is the next thing anyone can pick up**. Step 5 is a
decision, not a task.

---

## Explicitly out of scope

**`Bun.SQL`.** Raised as a motivation for the migration, and it is not a runtime
change: it would replace Prisma, which `CLAUDE.md` calls the single source of
truth and from which the migrations and every type derive. It belongs to its own
conversation. Recorded here so that "we moved to Bun, why not use its SQL" has an
answer in writing rather than being re-litigated.

**Performance.** Nothing in this file or its pre-plan measures it. The case for
Bun rested on closing a gap, not on a benchmark, and no benchmark has been taken.
