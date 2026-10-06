# Agent instructions

Read by Claude Code as `CLAUDE.md` and by other agent harnesses as `AGENTS.md`,
which is a symlink to this file. They were two hand-maintained copies until
2026-08-27 and had drifted into contradicting each other on an architectural
rule; a symlink is the only arrangement in which that cannot happen again.

**This file is loaded into every context, so it holds only what is true for
every task.** Versions, commands, directory layouts and CI job breakdowns are
deliberately not here: they are derivable from the repository or owned by a
document that is kept current. Repeating them here is how they go stale, and a
stale instruction is worse than an absent one.

| Need | Read |
|---|---|
| Where the project is — gates, versions, known gaps, what is next | [`docs/STATUS.md`](docs/STATUS.md) |
| Which document owns which question | [`docs/README.md`](docs/README.md) |
| Getting it running | [`docs/LOCAL_BOOTSTRAP.md`](docs/LOCAL_BOOTSTRAP.md) |
| Which command to run and what it proves | [`docs/VERIFICATION_SEQUENCE.md`](docs/VERIFICATION_SEQUENCE.md) |
| Is this defect known | [`ISSUES.md`](ISSUES.md) |

Stoky is a privacy-first, self-hosted household inventory platform: stock
tracking, receipt scanning with OCR, price intelligence, shopping lists.
**User-facing strings are Spanish (es) first**, English second; the default
currency is EUR.

---

## The runtime is Bun

Not Node, and not only for the test runner. `bun run dev`, `bun run start` and
the production image all run Bun. Every application Docker stage uses the pinned
`oven/bun` base. Its `node` compatibility symlink also executes Bun; there is no
separate Node.js runtime or npm installation. Two consequences worth having in mind
before writing server code:

- Bun's own APIs are available. Image processing already uses `Bun.Image`
  (`src/server/services/image.ts`) — `sharp` is a devDependency kept for test
  comparisons and is not shipped.
- The application has left Next's supported runtime, so interop defects are
  ours to notice. `ISSUES.md` RUNTIME-1 is the open one.

---

## Architecture

**Single repo, single Next.js application. No monorepo.** tRPC needs colocation
for end-to-end type inference. This is an enforced constraint, not a stage.

- **Feature slices.** Code is organised by domain (inventory, receipts, prices),
  not by technical layer. `src/server/trpc/routers/` and `src/components/<domain>/`
  follow the same split.
- **Every tRPC procedure takes a Zod input schema**, and the shared ones live in
  `src/lib/validations/` so client and server validate against one definition.
- **Client Components fetch, through tRPC + TanStack Query — because offline is
  a requirement, not a preference.** A screen that must work with no signal (the
  Phase 4 write queue, the persisted reads in `src/lib/offline/`) cannot be born
  on a server that is exactly what's absent, so the dashboard routes are client
  components and the server's job is the data, not the render. Server Components
  are the deliberate exception: the landing/start screens and anything that must
  work without JavaScript, which reach the server through Server Actions
  (`src/lib/landing/choose.ts`, `src/lib/auth/actions.ts`, the locale cookie) —
  the one sanctioned surface beside tRPC, for no-JS flows only. There is no
  server-side tRPC caller; do not reintroduce one, or move a dashboard page to
  SSR, without revisiting the offline design (`REDESIGN_PLAN.md` §5).
- **Server state is TanStack Query's. Local UI state is React's. A `zustand`
  store is neither and must not become either.** The one store that exists is
  Phase 4's offline write queue — read from everywhere, written from outside
  React (the `online` event, a backoff timer, another tab), and outliving the
  components that read it. `REDESIGN_PLAN.md` §5.7 has the case and the scope. A
  second store is a decision, not a convenience.
- **`prisma/schema.prisma` is the single source of truth** for the data model.
  Changing it means a migration, committed with the change.
- **The receipt pipeline is a state machine.** Upload → OCR → parse → match →
  review → apply, with `ReceiptStatus` enforcing the progression. Matching is
  `pg_trgm` similarity: auto above 0.7, candidates 0.3–0.7, no match below.

---

## Design System

**Before building anything that renders, look in `src/components/ui/`.** This
section exists because nine screens grew nine ways of drawing the same list
row, seven pills were written separately in four sizes, and 177 hardcoded
`min-h-[48px]` declarations restated a floor the primitives already guarantee
(`docs/DESIGN_AUDIT.md` A5.3). A new component that duplicates one of these is
a regression, not a feature.

### The list row

Every list of things uses `<ItemRow>` (`src/components/ui/item-row.tsx`). Its
grammar is fixed: a **title** that links to the thing, a **status** badge
opposite it, the details as a two-column **meta** definition list, and
**actions** last.

| Density | Used by | Why |
|---|---|---|
| `compact` | dense desktop lists | fits more on a screen read at a desk |
| `default` | inventory, products, prices, receipts, settings | the reference — this is the row the owner picked |
| `touch` | `/kitchen`, `/shopping` | Screen A is used with a trolley in one hand and Screen B is read from a metre away (`REDESIGN_PLAN.md` §3) |

Two rules the component enforces, and callers must not work around:

- **The title links; the row does not.** A row that is entirely a link
  announces its whole contents as its accessible name and leaves nowhere to
  put an action.
- **`tone` is never the only carrier.** A tinted row always has the badge that
  says the same thing in words (`REDESIGN_PLAN.md` §8).

A screen that needs a different arrangement needs a conversation, not a fourth
hand-written `<li>`.

### Badges

`<Badge tone=… variant=…>` (`src/components/ui/badge.tsx`) is the only pill.
`ok` / `warn` / `danger` are **reserved for state** and mean healthy,
needs-attention and wrong; anything that is not a state (`auto-generated`,
`best price`) takes `neutral`. Each tone carries the foreground
`scripts/check-contrast.ts` measured for it, so a badge cannot invent an
unaudited colour pair. `variant="outline"` is for a badge sitting on a row
already tinted with its own tone.

Stock state has one answer, in `src/components/inventory/StockStatus.tsx`.
Do not re-derive it: four screens each deriving it is how one product came to
wear two different words (ISSUES UI-11).

### Buttons and links

- **Anything that *does* something is a `<Button>`** — `src/components/ui/button.tsx`,
  colour chosen by the kind of action: `default` to commit, `destructive` to
  destroy, `outline`/`secondary` to step aside, `ghost` for a row action.
  Never a bare `<button>` with hand-written classes, and never a `<Link>`.
- **Anything that *goes* somewhere is a link.** The way back out of a sub-page
  is `<BackLink>` (`src/components/ui/back-link.tsx`), which carries the arrow
  as an `aria-hidden` icon. Never put an arrow in a message string: it is a
  layout decision in a translation file and the screen reader pronounces it.

### Sizes and tokens

- **Never write `min-h-[48px]` outside `src/components/ui/`.** Every primitive
  clears the 48px floor already (PROGRESS D17, above the AAA 44). Restating it
  means changing the floor leaves the restatements behind, which is exactly the
  `h-10` defect `src/__tests__/components/target-size.test.tsx` exists to
  prevent.
- **Colour comes from `src/app/globals.css` and nowhere else.** A new token
  goes in the light block, *both* dark blocks, and `@theme inline` — and needs
  a row in the `PAIRS` list of `scripts/check-contrast.ts`. That list is
  hand-written, so a token added without one is a token nothing audits and
  nothing goes red to say so.

---

## Security Constraints

- Every tRPC procedure has Zod input validation.
- **Receipt uploads:** validate MIME type *and* magic bytes, re-encode to strip
  EXIF, store under a UUID filename in an isolated volume, serve only through
  authenticated tRPC queries. Re-encoding goes through
  `src/server/services/image.ts`, the one seam that *transforms* image bytes;
  the upload procedure itself (`receipt.ts`) validates magic bytes and writes
  the re-encoded file, and nothing else touches them.
- Passwords are Argon2id, tuned to roughly 250ms.
- Rate limiting is per account as well as per address, and a refusal carries
  `Retry-After`. The current limits live in the code, not here.
- Only Traefik exposes ports. PostgreSQL and Valkey have none.
- Never raw SQL without parameterised queries (tagged template literals). An
  `ORDER BY` built by interpolation is the one that looks fine.
- Never commit secrets. `.env.example` is documentation, and the application
  refuses to start on its published `NEXTAUTH_SECRET`.

---

## Commit Convention

**Conventional Commits**, `<type>(<scope>): <description>`.

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`. Scopes: `auth`, `inventory`, `products`, `receipts`, `prices`,
`shopping`, `household`, `ocr`, `db`, `ui`, `i18n`, `pwa`, `docker`, `ci`.

## Git Workflow (trunk-based)

`master` is the trunk. Work done **with a person watching** — someone reading
each change as it lands — goes straight to `master`: no feature branches, no
pull requests, and no work left parked on a branch "just for review".

**Unattended and semi-attended agent work is the exception.** When an agent
runs a long, multi-commit task without someone reviewing each commit as it
lands (a fan-out of subagents, a review-and-fix sweep, a session the owner
checks only at the end), it works on a branch cut from `master` named
`<type>/<topic>-<YYYY-MM-DD>` (e.g. `fix/project-review-2026-10-05`), pushes
it, and opens a pull request. The branch is a review buffer, not a place for
work to live: it is closed, or **squash-merged into `master` once the owner
has reviewed and approved it**, and never used for a second, unrelated task.
On the branch itself a merge commit is fine — bringing `master` or the
branch a stacked PR sits on into it is a merge, not a rebase and a force
push over what the owner may already be reading. `master` stays linear
because the squash is what lands there. If the owner asks for a branch
explicitly, that settles it.

Either way, the commit is the reviewable unit — on a branch, the unit the
owner reviews; on `master`, the squash — and `git revert` is the only undo
once it reaches `master`. That is what makes the rules below hard, on a
branch as much as on the trunk:

- **One commit, one change.** If the subject line needs "and", split it.
- **It stands on its own.** Checked out in isolation it builds and its gates
  pass. Never a call site in one commit and the function it calls in the next.
- **It can be reverted alone**, without taking unrelated work with it.
- **The message explains why, not what.** The diff says what changed. Record
  the reasoning, the evidence it was verified, and anything surprising a future
  reader would otherwise rediscover.
- **Stage deliberately with `git add <path>`.** Never `git add -A` when the tree
  holds more than one change — it has swept a migration, and once an unrelated
  in-progress security hole, into unrelated commits.
- **Never commit something known-broken.** If work must pause mid-change, leave
  it uncommitted or stash it. Push when the tree is green.

---

## Agent Instructions

1. **Check `src/components/ui/` before writing anything that renders.** A list
   row, a state pill, an action, a way back — they exist. A second one is a
   regression.
2. **Add tests, and make sure each one can fail.** An assertion that holds
   regardless of the implementation is not a test. Break the code deliberately
   and confirm it goes red. This has caught five tests here that could not.
3. **Measure rather than recall.** Every claim in the documents must be
   reproducible by a command. Before reporting a number, check the thing you
   measured was actually running — `docs/STATUS.md` lists the traps that have
   produced confident wrong answers here.
4. **Validate before committing**, not after a batch: `bun run verify:ci`, plus
   `bunx playwright test` for anything that renders. Then judge whether the
   change introduced a regression, a security weakness, or a standards drift —
   green gates are necessary, not sufficient.
5. **Update the owning document** when a change makes it wrong. `docs/README.md`
   says which one owns what; if two disagree, the owner wins and the other is
   the bug.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
