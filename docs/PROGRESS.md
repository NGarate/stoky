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
for one run.

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
