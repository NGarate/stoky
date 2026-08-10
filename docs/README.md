# Index of the planning documents

Updated: 2026-08-10

**If you are an agent or a person picking this project up, start here.**

There are thirteen documents. That is a lot, and it is deliberate: an earlier
revision had six overlapping status files that contradicted each other, and a
fake test suite survived five months inside the gap between them. The rule that
replaced them is **one owner per subject** — every question below has exactly one
document that answers it, and the others link rather than restate.

---

## Read these three, in this order

| # | Read | To learn |
|---|---|---|
| 1 | [`STATUS.md`](STATUS.md) | What is true right now. Gate results, versions, known gaps, which phase is next |
| 2 | [`PROGRESS.md`](PROGRESS.md) | What has been done and **why the decisions were made that way**. Every judgement call taken without asking, numbered D1–D26 |
| 3 | [`REDESIGN_PLAN.md`](REDESIGN_PLAN.md) | What is being built, in what order, and what "done" means for each phase |

That is enough to start work. Everything else is reference for a specific task.

Then, before writing code, read `CLAUDE.md` in the repository root — it carries
the commit conventions and the git workflow, and this project has unusual rules
about both (trunk only, atomic commits, no branches, no pull requests).

---

## One owner per subject

If two documents disagree, the owner wins and the other one is the bug. Fix it
rather than working around it — a document nobody can trust costs more than no
document.

| Question | Owner |
|---|---|
| Does gate X pass, and what did it measure? | `STATUS.md` |
| Why was this built this way? | `PROGRESS.md` (Decisions) |
| What comes next, and what does done mean? | `REDESIGN_PLAN.md` |
| Is this defect known? Is it fixed? | `ISSUES.md` |
| What must work before calling a slice done? | `SMOKE_JOURNEYS.md` |
| What is the interface supposed to look like, and what is wrong with it? | `DESIGN_AUDIT.md` |
| What is the threat model, and what is hardened? | `SECURITY.md` |
| How do I get this running? | `LOCAL_BOOTSTRAP.md` |
| Which command do I run, and what does it prove? | `VERIFICATION_SEQUENCE.md` |
| How are the test suites configured? | `TEST_SETUP.md` |
| What does the product do? | `README.md` (root) |

---

## Every document, and when to open it

### Living documents — these must be updated as you work

**[`STATUS.md`](STATUS.md)** · 373 lines
The command-verified state of the project. Gate table, the three testing tiers
and which questions each can answer, dependency security, versions, known gaps
by severity, and the phase table.

*Its rule: every claim must be reproducible by running a command.* If you cannot
run a gate, the file says so and says why, rather than omitting it.

- **Read** before planning any work, and whenever you doubt a number.
- **Write** when a gate result changes, a dependency moves, or a gap opens or
  closes. Re-run the command; do not edit the number to what you expect.
- **How it goes stale:** by recording a measurement and never re-measuring. It
  has happened — a note about spec drift had itself drifted for a week.

**[`PROGRESS.md`](PROGRESS.md)**
Working memory for executing the plan. A table of completed units with their
commits, and — the part worth reading in full — **32 numbered decisions taken
without asking**, each with its reasoning.

The decisions are the highest-value thing in this repository for an agent
resuming work. They record why the target-size floor is 48 and not 44 (D17), why
structural accessibility checks live in E2E rather than the component suite
(D16), why defects found in passing are filed rather than fixed (D6), and the
one time that rule was deliberately broken (D22).

- **Read** third, after `STATUS.md`, and again whenever something in the codebase
  looks arbitrary. It probably is not.
- **Write** a row when you finish a unit, and a new D-number whenever you make a
  judgement call the next person could reasonably make differently.

**[`REDESIGN_PLAN.md`](REDESIGN_PLAN.md)** · 533 lines
The plan. Two entry screens (a phone screen for day-to-day use, a kitchen screen
for a tablet), the decisions that shaped them, and eight phases each with an
explicit *done when*.

Phases 0 to 3 are complete. **Phase 4 is next: the phone screen, offline from
the start.**

- **Read** to know what you are building and what finishing it means.
- **Write** when a phase closes — with what it actually did, including where the
  plan turned out to be wrong. Phase 1 said four dead routes; there were six.

**[`ISSUES.md`](ISSUES.md)** · 1365 lines
Every known defect, with a file reference, evidence, and a severity. Resolved
entries are kept with their resolution rather than deleted, because the same
defect recurs and the note about why it happened is worth more than the fix.

The summary table at the top drifts from the detailed entries below it if nobody
watches. It has twice.

- **Read** before fixing anything, in case it is known and scoped to a later
  phase. Search it before filing a duplicate.
- **Write** whenever you find a defect you are not fixing right now — which,
  per D6, is most of them.

**[`SMOKE_JOURNEYS.md`](SMOKE_JOURNEYS.md)** · 378 lines
Nine user journeys with a state column, canonical vocabulary for the domain, and
per journey: the trigger, the visible outcome, and the before/after evidence
required. Journey 1 passes; the rest are tagged with the phase that makes them
passable.

*Its closure rule:* a slice is done only when it names which journey it changes
and what evidence proves the new state.

- **Read** when you are about to claim something works.
- **Write** when a journey's blockers change — including when they disappear.

### Reference — read for a specific task

**[`DESIGN_AUDIT.md`](DESIGN_AUDIT.md)** · 407 lines
The interface and accessibility audit: every route, mobile-first, WCAG **AAA**.
Numbered actions A0–A5.4 with done markers. Explains the three viewport tiers,
the two breakpoints, and why tablet is the least dense rather than a small
desktop.

Still open: **A5.3** (the Phase 1 routes do not use the shared primitives, and
74 hardcoded copies of the target-size floor are the cost) and **A5.4** (what
`/dashboard` becomes once the phone and kitchen screens exist).

**[`SECURITY.md`](SECURITY.md)** · 367 lines
The threat model for a self-hosted deployment, what is already hardened
(container, network, CSP, image supply chain), what is *not* — read that part
first — and operator guidance.

Written so that every claim is checkable against a file. Hold it to that: it has
carried a false claim before, and a security document that overstates the
posture is worse than none.

**[`VERIFICATION_SEQUENCE.md`](VERIFICATION_SEQUENCE.md)** · 151 lines
The command ladder, what each gate proves, the environment each needs, and the
current measurements. **Note the time budgets** — the ladder has ten minutes and
each step its own ceiling, so an exit status of 124 means a step was *stopped*,
not that a test failed.

**[`TEST_SETUP.md`](TEST_SETUP.md)** · 275 lines
How the suites are configured: the database the integration tests need, the
happy-dom preload the component tests need, the seeded account and free port the
E2E suite needs, and a map of the test tree.

**[`LOCAL_BOOTSTRAP.md`](LOCAL_BOOTSTRAP.md)** · 110 lines
Clone to running app, the shortest supported path. Read this before asking why
something will not start.

### Historical — do not update, do not act on

**[`DESIGN_PROPOSALS.md`](DESIGN_PROPOSALS.md)** · 159 lines
A decision record. Five candidate designs were built and four discarded; this
says what was tried, what was chosen, and why. It describes an exercise that is
over — useful for understanding why the palette and the stepper look as they do,
not for planning.

---

## Where to write what, by what you just did

| You just… | Update |
|---|---|
| Fixed a defect | `ISSUES.md` (status + evidence), `PROGRESS.md` (row) |
| Found a defect you are not fixing | `ISSUES.md` only — file it, do not fix it in passing (D6) |
| Finished a phase | `REDESIGN_PLAN.md`, `PROGRESS.md`, `STATUS.md` phase table |
| Made a judgement call | `PROGRESS.md`, new D-number, with the reasoning |
| Changed what a gate measures | `STATUS.md`, `VERIFICATION_SEQUENCE.md` |
| Made a journey pass, or fail | `SMOKE_JOURNEYS.md` |
| Changed the security posture | `SECURITY.md` |
| Changed how tests are set up | `TEST_SETUP.md` |

---

## The rules these documents encode

Learned here, mostly the expensive way. They are stated in full in
`PROGRESS.md`; this is enough to avoid repeating the mistakes.

- **Verification is a browser, not a green typecheck** (D7). Compiling is not
  working. Drive the feature.
- **A test must be able to fail.** After writing an assertion, break the source
  deliberately and confirm it goes red. 352 tautological tests once reported
  "100% component coverage" against zero real coverage. Four more were deleted
  this month for the same reason.
- **A class name is not a measurement.** happy-dom has no layout engine — every
  rectangle there is 0×0. Anything geometric belongs in a browser, or in
  `src/__tests__/setup/tailwind.ts`, which resolves a class list through
  Tailwind's own compiler.
- **File, do not fix in passing** (D6). One exception, recorded as D22: a
  control that does not do what its label says is not a finding, it is broken.
- **Defects found while verifying a fix are the valuable ones.** UI-6, UI-7 and
  A11Y-2 were all found this way.
- **A guard nobody has watched fire is a comment.** The verification ladder's own
  timeout silently passed everything until someone set it to one second and
  watched the run succeed anyway.
- **Ten minutes for all verification.** Not a runner constraint — a suite that
  takes longer stops being run, and then it still has to be maintained while
  telling nobody anything.
- **Both catalogues in the same commit** (D4). A translation backlog never gets
  paid off. `src/__tests__/unit/messages.test.ts` enforces it.
- **Do not trust an agent's report** — including this one. Re-run the command.
