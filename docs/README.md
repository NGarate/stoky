# Index of the planning documents

Updated: 2026-08-18

**If you are an agent or a person picking this project up, start here.**

There are thirteen documents, plus two executed implementation plans kept as
records and one pre-plan waiting on a decision. That is a lot, and it is
deliberate: an earlier revision had six
overlapping status files that contradicted each other, and a fake test suite
survived five months inside the gap between them. The rule that replaced them
is **one owner per subject** — every question below has exactly one document
that answers it, and the others link rather than restate.

---

## Read these three, in this order

| # | Read | To learn |
|---|---|---|
| 1 | [`STATUS.md`](STATUS.md) | What is true right now. Gate results, versions, known gaps, which phase is next |
| 2 | [`PROGRESS.md`](PROGRESS.md) | What has been done and **why the decisions were made that way**. Every judgement call taken without asking, numbered D1–D99 |
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

**[`STATUS.md`](STATUS.md)**
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
commits, and — the part worth reading in full — **99 numbered decisions taken
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

**[`REDESIGN_PLAN.md`](REDESIGN_PLAN.md)**
The plan. Two entry screens (a phone screen for day-to-day use, a kitchen screen
for a tablet), the decisions that shaped them, and nine phases each with an
explicit *done when*.

Phases 0 through 6 are complete against their done-whens, each with its named
exceptions, and Phase 8 — the owner's first pass, six observations from real
use — was built in a day and a half, closing 2026-08-19. **What remains:
Phase 7's review document, Phase 8's own done-when (the owner repeating their
pass), three human passes no suite can answer, and the §10 list**, including
two §3/§5.1 promises found unbuilt when the journeys were re-audited on
2026-08-17.

- **Read** to know what you are building and what finishing it means.
- **Write** when a phase closes — with what it actually did, including where the
  plan turned out to be wrong. Phase 1 said four dead routes; there were six.

**[`ISSUES.md`](ISSUES.md)**
Every known defect, with a file reference, evidence, and a severity. Resolved
entries are kept with their resolution rather than deleted, because the same
defect recurs and the note about why it happened is worth more than the fix.

The summary table at the top drifts from the detailed entries below it if nobody
watches. It has twice.

- **Read** before fixing anything, in case it is known and scoped to a later
  phase. Search it before filing a duplicate.
- **Write** whenever you find a defect you are not fixing right now — which,
  per D6, is most of them.

**[`SMOKE_JOURNEYS.md`](SMOKE_JOURNEYS.md)**
Ten user journeys with a state column, canonical vocabulary for the domain, and
per journey: the trigger, the visible outcome, and the before/after evidence
required. Seven pass at the tiers a suite can answer; one is partial (T7); two
turned out never to have been built — the state column was re-audited against
the code on 2026-08-17, and journeys 2 and 7 were widened by the owner's pass
on 2026-08-18 and rewritten to the landed shape the same day.

*Its closure rule:* a slice is done only when it names which journey it changes
and what evidence proves the new state.

- **Read** when you are about to claim something works.
- **Write** when a journey's blockers change — including when they disappear.

### Reference — read for a specific task

**[`DESIGN_AUDIT.md`](DESIGN_AUDIT.md)**
The interface and accessibility audit: every route, mobile-first, WCAG **AAA**.
Numbered actions A0–A5.4 with done markers. Explains the three viewport tiers,
the two breakpoints, and why tablet is the least dense rather than a small
desktop.

Still open: **A5.3** (the routes do not use the shared primitives, and the
hardcoded copies of the target-size floor have grown from 74 to 100 with the
Phase 5 pages) and **A5.4** (what `/dashboard` becomes — half-decided
2026-08-18: the Panel stays; the 2026-08-19 second pass replaced its doors
with a one-line summary over the lists, which are the doors themselves;
whether three entry points is the right number is the half still open).

**[`SECURITY.md`](SECURITY.md)**
The threat model for a self-hosted deployment, what is already hardened
(container, network, CSP, image supply chain), what is *not* — read that part
first — and operator guidance.

Written so that every claim is checkable against a file. Hold it to that: it has
carried a false claim before, and a security document that overstates the
posture is worse than none.

**[`VERIFICATION_SEQUENCE.md`](VERIFICATION_SEQUENCE.md)**
The command ladder, what each gate proves, the environment each needs, and the
current measurements. **Note the time budgets** — the ladder has ten minutes and
each step its own ceiling, so an exit status of 124 means a step was *stopped*,
not that a test failed.

**[`TEST_SETUP.md`](TEST_SETUP.md)**
How the suites are configured: the database the integration tests bring up, the
happy-dom preload the component tests need, and the browser suite's own world —
the `stoky_e2e` database it migrates and seeds itself, and the standalone
production build it drives.

**[`LOCAL_BOOTSTRAP.md`](LOCAL_BOOTSTRAP.md)**
Clone to running app, the shortest supported path. Read this before asking why
something will not start.

### Historical — do not update, do not act on

**[`DESIGN_PROPOSALS.md`](DESIGN_PROPOSALS.md)** · 159 lines
A decision record. Five candidate designs were built and four discarded; this
says what was tried, what was chosen, and why. It describes an exercise that is
over — useful for understanding why the palette and the stepper look as they do,
not for planning.

**[`superpowers/plans/2026-08-12-ci-stability-and-speed.md`](superpowers/plans/2026-08-12-ci-stability-and-speed.md)**
The CI campaign's implementation plan — executed the same day (commits
`9bb4b20`–`0850942`). Its measured results live in `STATUS.md` §The pipeline,
which supersedes every estimate in it.

**[`superpowers/plans/2026-08-17-e2e-isolation-and-production-build.md`](superpowers/plans/2026-08-17-e2e-isolation-and-production-build.md)**
The browser suite's move to isolated data and the production artefact —
executed 2026-08-17/18. `PROGRESS.md` D82–D86 carry the decisions;
`TEST_SETUP.md` describes the result.

**[`superpowers/plans/2026-08-25-cache-components-and-instant-navigation.md`](superpowers/plans/2026-08-25-cache-components-and-instant-navigation.md)**
Measured, not landed. What Next 16.3's Cache Components and Partial Prefetching
cost this repository — the whole app builds green on two edits — and the one
question an agent must not settle: a per-request CSP nonce and a prerendered
static shell are structurally in tension. The saved patch sits beside it. Its
most reusable finding is about `e2e/settle.ts`, which waits for quiet and would
need to wait for data.

**[`superpowers/plans/2026-08-25-development-in-the-image-preplan.md`](superpowers/plans/2026-08-25-development-in-the-image-preplan.md)**
A **pre-plan**, not an executable one: the measurements behind moving
development into the Docker image, and behind the open question of whether the
server should run on Bun. Fourteen numbered runs with what each established,
and an explicit list of what is still unknown. Stage 1 landed (`dc06795`); the
rest is undecided. Read it before proposing either change.

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

## Where the unfinished work lives

`docs/REDESIGN_PLAN.md` §10, **Carried forward** — every known-unfinished item
in one table, each with the phase that owns it, plus an explicitly unowned
section for the ones that have no phase yet. Compiled when Phase 4 closed,
because a backlog spread across four files is a backlog nobody reads.

The rule for that list: an item leaves it by being done or by being
deliberately dropped, and a drop is written down. Nothing leaves by being
forgotten.
