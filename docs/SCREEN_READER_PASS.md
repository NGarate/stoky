# The manual screen-reader pass — runbook

Updated: 2026-09-01

This is the execution guide for the one accessibility check no tool and no agent
can make: driving Stoky with a **real screen reader**, driven by a person, and
judging whether it *sounds* sensible. `docs/DESIGN_AUDIT.md` §5 owns the *why*
and the tool rationale; this file is the *how* and the todo list. It is the last
open item of Phase 2b (`REDESIGN_PLAN.md`), and the result of this pass is dated
in `docs/STATUS.md` when it is done.

**Why this pass exists.** Automated testing decides roughly a third of real
accessibility problems. Until 2026-10-27 Stoky measured what a machine can: a
browser suite walked the accessibility *tree* across four journeys (sign in,
add stock, consume stock, review a receipt) and proved it well-formed — every
interactive node named, no raw translation keys leaking, outcomes announced,
reading order matching geometry on the desktop. It was deleted with the rest of
the browser suite's sweeps (PROGRESS D154), so nothing checks the tree now. What
a tree check **cannot** tell you is whether the tree *sounds* right to someone using it:
whether an announcement is useful or merely present, whether the focus lands
where a person expects, whether an error tells them what to do. That is this
pass.

---

## Before you start

### 1. Pick a screen reader (use the one you actually use, if you use one)

| OS | Screen reader | How to start | Get help |
|---|---|---|---|
| Windows | **NVDA** (free, the reference) | `Ctrl`+`Alt`+`N` after install | nvda-2xxx "Basic Training" |
| macOS / iOS | **VoiceOver** (built in) | `Cmd`+`F5` (Mac); triple-click side button (iPhone) | VO Utility; the built-in Quick Start (`VO`+`Cmd`+`F8`) |
| Linux | **Orca** (built in to GNOME) | `Super`+`Alt`+`S` | `orca --help`, GNOME docs |

**iOS Safari with VoiceOver is a required, separate pass** — Playwright's WebKit
is not iOS Safari, and Stoky's offline queue, `localStorage` and service worker
all need a real-device check (that pass is tracked separately in
`REDESIGN_PLAN.md` §10). If you can do this pass on an iPhone, do the offline
tests there too and note it.

### 2. Learn four keys before anything else

You do not need to be fluent. You need to be able to:

- **move to the next item** (NVDA/Orca: `Down`; VoiceOver: `VO`+`Right`)
- **move by heading** (NVDA/Orca: `H`; VoiceOver: `VO`+`Cmd`+`H`)
- **list the landmarks/regions** (NVDA: `D`; VoiceOver rotor: `VO`+`U`)
- **stop it talking** (`Ctrl` anywhere)

### 3. Run the app the way a person meets it

```bash
# One terminal: the app
bun run dev            # http://localhost:3001 on this machine (port 3000 is taken)

# Sign in with the seeded demo household
#   demo@stoky.local  /  Demo1234!
```

The seed has what every journey needs: 6 products (3 below minimum, some with
expiry dates), nested storage locations, stores, prices, a shopping list, and
**two receipts — one needing review, one already applied**. So every screen
below has real content to read.

### 4. Generate the pa11y checklist (the supporting half)

pa11y does not replace this pass; it hands you the AAA checklist to work through
per route. It needs the running server and nothing installed permanently.

```bash
# One route, everything HTML CodeSniffer knows about AAA
npx pa11y@8 --standard WCAG2AAA --include-notices --include-warnings \
  --reporter json --timeout 60000 http://localhost:3001/login > pa11y-login.json
```

Read the output as **three separate things**:

- **errors** → real defects. There should be none. If there are, the axe suites
  missed something — understand that before fixing.
- **warnings** → conditional. Answer the condition, move on.
- **notices** → the AAA checklist. This is the value. The notices that matter
  most, because the automated suites cannot reach them at all: **3.1.3** unusual
  words, **3.1.4** abbreviations, **1.3.2** meaningful sequence when linearised,
  **3.3.6** error prevention, **1.4.1** information conveyed by colour alone.

**Do not add pa11y to CI or `verify:local`** — its AAA half can neither pass nor
fail, so it floods the log or passes vacuously. It is a person's checklist.

### 5. Optionally, Accessibility Insights for Web (Chrome/Edge extension)

Use **Assessment** mode, not FastPass (FastPass is axe, which CI already runs).
Assessment walks you through the checks no tool makes: keyboard traps, focus
order against visual order, whether a live region says something *useful*,
contrast on states a test never enters, and whether an error message says what
to do.

---

## What to listen for — the general checklist (applies on every screen)

Run this list on each screen below. A "no" is a finding.

- [ ] **Every control announces a name and a role.** No "button", no "clickable"
      with nothing before it, no blank. (Buttons that *do* something, links that
      *go* somewhere — Stoky separates these deliberately; the screen reader
      should too.)
- [ ] **No raw translation keys.** You must never hear "offline.needsReview" or
      "inventory.expiring.title" — only real words, in the language you set.
- [ ] **Focus order matches the visual order.** Tab through; the spoken order
      should be the reading order, not a jump around the screen.
- [ ] **The keyboard can reach and leave everything.** No trap: you can always
      `Tab` out of a control and `Esc` out of a dialog or menu.
- [ ] **Nothing is announced by colour alone.** A low-stock row, an expiring
      item, a refused change — each must carry a *word* (a badge), not just a
      tint. (This is the rule the whole design system enforces; the pass
      confirms it holds *aloud*.)
- [ ] **State changes are announced.** When something saves, is refused, or
      needs your attention, you hear it — without having to go looking.
- [ ] **Error messages say what to do**, not just that something is wrong.
- [ ] **Headings and landmarks make the page skimmable.** Jumping by heading
      (`H`) or listing regions (`D` / rotor) should let you understand the page
      without reading every word.

---

## The journey walk — in this order

Do the journeys in this order (it is the order in `docs/SMOKE_JOURNEYS.md`,
because the journeys are where defects have appeared), not a route-by-route
crawl. Tick each todo; record every "no" as a finding (see *Recording* below).

### Journey A — Sign in and register (`/login`, `/register`)

The only surfaces a signed-out person meets.

- [ ] The form fields announce their label (Email, Password), not just "edit".
- [ ] A wrong password is **announced** — you hear the error without tabbing
      back to find it — and it tells you what went wrong.
- [ ] The Spanish page reads in Spanish; switch language and it reads in
      English. (Stoky is Spanish-first; both must sound native, not translated
      word-for-word.)
- [ ] Register: the household-name field explains itself; a validation failure
      is announced and actionable.
- [ ] pa11y notices for `/login`: work through 3.3.6 (error prevention) and
      1.4.1 (colour alone) especially.

### Journey B — Stock, with and without a form (`/inventory` → `/inventory/add` → back; the ± stepper on a product)

The automated tree-walk covers add and consume structurally. You are judging
whether the **save announcement sounds right** (A11Y-1 was closed in Phase 5 —
this pass is how a person confirms it *sounds* sensible, which no suite decided).

- [ ] `/inventory`: each row's stock state (Correcto / Stock bajo / Sin stock)
      is **spoken as a word**, not conveyed by the row tint alone.
- [ ] The **expiring-items block** at the top reads sensibly: the product name
      is a link, the badge ("En 3 días", "Caducado") is spoken, and the quantity
      and location follow. (This screen was just brought onto the shared row
      grammar — confirm it reads like the rest of the list.)
- [ ] `/inventory/add`: the **location picker** is operable by keyboard — arrow
      keys move between options, Escape closes it, and a nested location
      announces its parent ("Cocina → Nevera"), not just "Nevera".
- [ ] After a save, the movement is **announced** — you hear that the stock
      changed, with the number, without going to look for it.
- [ ] The **± stepper** on a product detail (`/products/[id]`): pressing + or −
      announces what happened, and the ten-second **undo** ("Deshacer") is
      reachable and announced as undoable.

### Journey C — Receipt review, the longest interaction (`/receipts` → `/receipts/[id]/review` → applied)

Open the receipt that needs review (the seed has one).

- [ ] Each line announces its parsed name and the decision controls (match,
      create, skip) with distinct names — not three identical "button"s.
- [ ] Confirming a line **changes something you can hear** (the pending count,
      the line's state) — a control that silently does nothing is A11Y-2/UI-7's
      shape and must not return.
- [ ] Finishing the review and applying it announces the outcome: what was
      added, and — the half people miss — what was **left out** (skipped lines,
      prices not recorded).
- [ ] The applied summary reads as a result, not a fresh form.
- [ ] pa11y notices for the review route: 1.3.2 (meaningful sequence) matters
      here — it is the densest screen.

### Journey D — The kitchen screen, at a metre, on the tablet (`/kitchen`)

**This one requires the real tablet.** No emulated viewport reproduces reading a
screen from a metre away with VoiceOver/TalkBack. The screen exists since Phase
5; this pass and the week-long tablet run are its outstanding human halves.

- [ ] The "use now" urgent items and the "this week" list are distinguishable by
      ear, and each item's urgency (caduca hoy / mañana / en N días) is spoken.
- [ ] The one-tap actions per row ("He usado uno", "Apuntar a la compra")
      announce what they did.
- [ ] A KITCHEN account hears *who can fix* a thing it may not do, rather than a
      control it cannot use (test with a KITCHEN account from
      `/settings/people`).

### Journey E — The offline surfaces (the sync indicator, reconcile, and the T7 review question)

These are Stoky's most distinctive flows and none is in the four automated
journeys. Trigger them by going offline (DevTools → Network → Offline, or
airplane mode on a device) while composing a change.

- [ ] **The sync indicator has two live regions on purpose** — a *polite*
      "status" region (calm: pending, syncing) and an *assertive* "alert" region
      (urgent: needs your attention). Confirm the calm states do **not**
      interrupt what you are reading, and the urgent ones **do**.
- [ ] Compose a change offline (tick a shopping item, or a ± step): you hear it
      recorded as done, and the pending state is announced.
- [ ] **Reconcile** (§5.5.3): make two people consume the last of something so
      the second is refused. The refusal is announced as a *question* ("how much
      is actually on the shelf?"), not as a failure, and the dialog it opens is
      reachable, labelled, and Escapable.
- [ ] **The T7 scan review question**: scan an unknown barcode offline
      (`/products/scan`, manual field). On reconnect the urgent region should
      announce a scan that needs a name, and the "Ponle nombre" / "Name it" link
      should take you to a form with the barcode already filled — confirm that
      prefill and the link's name are spoken.

### Journey F — Both languages, everywhere (a full walk in English)

Journey 9 in `SMOKE_JOURNEYS.md` is proven by construction and by Spanish
rendering, **but not by a human walking every screen in English**. Switch the
language to English and repeat a short version of A–C listening for:

- [ ] Anything still spoken in Spanish (a string that never reached a
      catalogue — I18N-5's blind spot).
- [ ] Anything that reads as a literal translation rather than natural English.

---

## Recording findings

Every finding goes in **`ISSUES.md`**, the same as any other defect, **with the
WCAG criterion number**. A finding from a manual pass is not a lesser finding.

Format each as: the screen, what you heard, what you expected, and the criterion
(e.g. "2.4.3 Focus Order", "4.1.2 Name, Role, Value", "1.4.1 Use of Colour",
"3.3.6 Error Prevention"). If it is something to fix now, fix it and note the
commit; if not, file it and scope it.

Criteria most likely to surface in a screen-reader pass here:

- **4.1.2** Name, Role, Value — an unnamed or mis-roled control
- **2.4.3** Focus Order — focus that jumps
- **4.1.3** Status Messages — a change that is not announced, or announced
  intrusively
- **1.4.1** Use of Colour — a state carried by tint with no word
- **3.3.1 / 3.3.3** Error Identification / Suggestion — an error that does not
  say what to do
- **2.1.2** No Keyboard Trap — a dialog or menu you cannot Escape

---

## Definition of done

The pass is done when:

- [ ] Journeys A–F have each been walked with a real screen reader.
- [ ] Journey D was done on the **real tablet**, and Journey E's offline flows on
      a real device (iOS Safari + VoiceOver if at all possible).
- [ ] Every "no" is recorded in `ISSUES.md` with its criterion, and the ones
      worth fixing now are fixed.
- [ ] The result — who ran it, on which screen reader(s) and device(s), and the
      date — is written into **`docs/STATUS.md`** (the Accessibility section's
      "the manual screen-reader pass has not happened" note is updated), and the
      **`REDESIGN_PLAN.md` §10** item is struck.

Until that last step, the item stays open. A green automated suite is not this
pass, and this pass is not done until it is dated.
