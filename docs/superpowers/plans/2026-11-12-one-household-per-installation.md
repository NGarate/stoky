# One household per installation

**Decided by the owner, 2026-11-12.** An installation is one household. Today
it can quietly become several that nobody can see or manage, and Stoky is
still an MVP: the simplest model wins. Several families means several
installations.

Read `CLAUDE.md` first; everything there holds. This plan is written for an
agent starting with no context from the conversation that produced it.

**State on 2026-11-13** (checked against `master` at `4df104c4`): nothing of
it is implemented — no commit, branch or stash carries any of the five below.
Every reference in it was re-checked that day; corrections are folded into
the text, not listed apart. Two things changed around it:

- **PR #25** (`refactor/integration-tests-2026-11-13`, open) reorganises the
  integration suite: it deletes `routers.test.ts` and rewrites
  `test-helpers.ts`, `cross-household.test.ts`, `capabilities.test.ts` and
  `auth.flow.test.ts`. Let it merge first and cut this branch from the
  `master` after it, or the two will conflict in the helpers both touch.
- **`v0.1.0-alpha.5` is about to be cut**, already carrying five breaking
  changes. Commits 3 and 4 are breaking too; landing them before that release
  keeps an operator's breakage to one upgrade instead of two.

---

## 1. Why — what is wrong today

There is no role above a household (`OWNER`/`ADMIN`/`MEMBER`/`KITCHEN` are
roles *in* one, `User.householdId` is a single nullable column), yet three
doors make more households:

1. **`STOKY_REGISTRATION=open`** (`src/lib/auth/registration.ts`, the
   default at ~90): every
   registration creates a household of its own. Nobody can list them, block
   an account, delete one, or see what they store. It is also the default
   outside production.
2. **`household.create`** (`src/server/trpc/routers/household.ts`), offered by
   `RouteState`'s `CreateHousehold` form (~251) (`src/components/household/RouteState.tsx`)
   to any account without a household — reachable even under the default
   `first-user`.
3. **`household.removeMember`** only sets `householdId: null`. The removed
   person keeps a working account, signs in, is offered the form above, and
   the installation has a second household.

And nothing can delete an account or a household, so whatever those doors
create stays for ever. `auth.register` also accepts no `householdName`
(`src/lib/validations/auth.ts` ~43, `.optional()`), making an account with no
household directly.

## 2. Decisions (the owner's — do not reopen)

- **One household per installation.** Close the doors above. No instance
  administrator role, no household list screen, no multi-household management.
- **A removed member's account is deleted**, not left householdless.
- **The data model does not change.** Every row keeps its `householdId` and
  every procedure stays household-scoped: that scoping is defence in depth,
  and it is what isolates the test suites from each other (integration tests
  create a household per test through Prisma; keep doing that). Making
  `User.householdId` required is *out of scope* (see §6).
- **No upgrade path, no shim** for an installation that set `open`: Stoky is
  pre-beta and the owner is its only user. `open` simply becomes an unknown
  value, which already refuses to start in production with a message.
- **E2E is the basic happy path of real use and nothing more** (owner,
  2026-11-12). Regressions, refusals and edge cases go in unit, component or
  integration tests. Never run the whole browser suite locally; CI's
  End-to-end job runs it. A single spec may be run when a commit changes it.
- **Who administers the installation is the household's OWNER and ADMIN**
  (`adminProcedure`). This is what unblocks `ISSUES.md` PARSE-5 (the
  receipt parser's keywords moving to the database, edited by "the
  administrator"); PARSE-5 itself is not part of this plan.
- **Added 2026-11-13: the household's names are editable** (commits 6
  and 7). An OWNER or ADMIN can rename the household, and set two more
  names:
  - **The name in the browser tab** — its own field, independent of the
    household's name. Empty, the tab says `Stoky` as today — never the
    household's name (owner, 2026-11-13: "muestra Stoky o el campo
    personalizado"). **It is shown
    without a session too** (`/login`, `/register`): whoever reaches the
    sign-in page sees it. The owner chose that knowingly.
  - **The name of the installed app** (the PWA manifest's `name` and
    `short_name`) — another field of its own. Empty, it is the household's
    name; with no household yet (a fresh installation before its first
    registration), `Stoky`.

## 3. Out of scope

- PARSE-5 (receipt keywords in the database).
- Making `User.householdId` non-nullable, or removing `householdId` anywhere.
- An instance-admin role, a households screen, account blocking, quotas
  (`ISSUES.md` UPLOAD-1 stays open; only its severity reasoning may change).
- Rewording every comment that mentions "an account with no household".
  Change a comment only where the code beside it changes, or where it is now
  false in a way that would mislead.

## 4. The commits

Step 0 comes first (0.1–0.10), then commits 1–7, in order. Work on a branch cut from
`master` after PR #25 has merged, named
`feat/one-household-<the date it is cut>`, and open a pull request
(`CLAUDE.md`, Git Workflow: unattended agent work). If the owner is watching
each commit land instead, it goes straight to `master`; the owner says which. Each commit
stands alone, passes its own gates, and updates the documents it makes wrong
**in the same commit** (`docs/README.md` says which document owns what). The
order matters: no commit may leave e2e red, which is why the e2e accounts
change first.

Before starting, list every reference yourself — the files named here are
what was found on 2026-11-12 and re-checked on 2026-11-13, not a promise of
completeness:

```
grep -rn "household\.create\|CreateHousehold\|isNoHouseholdError\|noHousehold" src e2e messages
grep -rn "\"open\"\|STOKY_REGISTRATION\|registrationAllows\|registrationOpen" src e2e scripts deploy playwright.config.ts .env.example
grep -rn "removeMember" src e2e messages
```

### Step 0 — clean up, and keep it clean (added 2026-11-13)

**The goal is not only to delete dead code but to leave the code better,
with rules that keep it that way** (owner, 2026-11-13). A sweep of every
file that day (eight read-only agents, each finding re-checked by grep)
found what nothing runs; the steps below delete it, then add the checks
that would have caught it, then retire the obsolete plan the code still
cites. Every item was true at `4df104c4`: **grep each again before
deleting it**, and keep a deletion out of its commit if anything now reads
it. One commit per kind of thing, each standing alone.

Two facts from the owner the sweep relies on: there is **no iOS app**
(`../stoky-ios` is an empty project), so a procedure with no web caller is
dead; and **`docs/REDESIGN_PLAN.md` is an obsolete plan**, so being listed
in it ("Already implemented", §2) is no reason to keep code.

#### 0.1 — `refactor: drop six tRPC procedures no client calls`

- `auth.logout` (`routers/auth.ts` ~626). Signing out is Better Auth's
  (`/api/auth/*`, `src/lib/auth/client.ts`). Its doc comment (~605) explains
  `z.void()` for procedures that take nothing, and `shopping.ts` ~479 and
  `trpc.ts` ~252 point at it: move that explanation to where it is still
  read, do not lose it.
- `product.count` (`routers/product.ts` ~257).
- `product.searchByName` (`routers/product.ts` ~483), one of the few
  `$queryRaw` calls; with it goes its only input, `productSearchSchema` and
  `ProductSearchInput` (`validations/product.ts` ~48, ~101), and their
  cases in `unit/validation-bounds.test.ts` (~180–207). `validations/bounds.ts`
  (~13) uses it as its example of an unbounded page size: give the comment
  another example or drop the line.
- `price.recordPrice` (`routers/price.ts` ~54). Comments cite it as the
  write that already guarded a field (`shopping.ts` ~58, `inventory.ts`
  ~361 and ~419, `receipt.ts` ~112): reword them so they do not name a
  procedure that no longer exists.
- `shopping.update`, the list-level one (`routers/shopping.ts` ~192), not
  `shopping.updateItem`.
- `inventory.transferStock` (`routers/inventory.ts` ~766). It is the only
  writer of the `TRANSFER` operation; 0.3 removes that.
- **Kept on purpose:** `household.current` has no web caller either, but
  commit 6's form reads the name through it.
- Tests that name the removed ones: `unit/procedure-inputs.test.ts` (~41,
  ~51), `integration/capabilities.refusals.test.ts` (~491, ~511, ~532),
  `unit/replayable.test.ts` (~46, ~49), `unit/procedure-input-bounds.test.ts`
  (~261–267), `unit/capabilities.test.ts` (their rows), and whatever else
  `grep -rn` finds. The documented procedure count drops by six in
  `SECURITY.md` and `docs/STATUS.md` (the sentences `capabilities.test.ts`
  matches); `SECURITY.md` ~1387 lists `transferStock` among guarded writes.
  `ISSUES.md` entries about them are history: leave them.

#### 0.2 — `refactor: drop validation schemas no procedure uses`

A schema no procedure's `.input()` and no form reads validates nothing,
whatever its unit tests say.

- `stockOperationSchema` (`validations/inventory.ts` ~11),
  `priceQuerySchema` (`validations/price.ts` ~26), `productListSchema`
  (`validations/product.ts` ~93): no user at all.
- `shoppingItemSchema` (`validations/shopping.ts` ~51),
  `householdMemberSchema` (`validations/household.ts` ~18),
  `inviteMemberSchema` (`validations/auth.ts` ~122): only their tests.
- `updateHouseholdSchema` and `createHouseholdSchema`, moved here from
  commit 4 because they are already dead: see there.
- The inferred `*Input` types nothing imports (about thirty, e.g.
  `AddStockInput`, `PriceQueryInput`, `ProductListInput`,
  `ShoppingListInput`, `UpdateStoreInput`, `LoginInput`, `RegisterInput`):
  0.9's checker lists them exactly; until then `grep -rnw` per name.
- Their cases in `unit/household.validation.test.ts`,
  `unit/auth.validation.test.ts`, `unit/shopping-item.test.ts`,
  `unit/update-schemas.test.ts` and `unit/validation-bounds.test.ts`.

#### 0.3 — `refactor(db): drop the TRANSFER stock operation, which nothing writes`

After 0.1 no code writes `TRANSFER`. Remove it from the `StockOperation`
enum (`prisma/schema.prisma` ~460), the `opTRANSFER` key from both
catalogues (the history screen builds `op${operationType}` dynamically, so
the key dies with the enum value), and any `switch`/table arm on it.
Pre-beta, this **regenerates the single baseline migration** (as in
commit 7: keep its header and hand-written tail) and the local `stoky` and
`stoky_e2e` databases need resetting, **with the owner's consent at that
moment**. If a local database holds `TRANSFER` rows, that is what the reset
is for; no data migration.

#### 0.4 — `refactor: drop helpers only their own tests call`

- `src/lib/inventory/usualLocation.ts`, the whole module, and
  `unit/usual-location.test.ts`.
- `pendingProductIds` (`src/lib/offline/project.ts` ~228) and its cases in
  `unit/offline.project.test.ts`.
- `OpenFoodFactsResponse` (`src/server/services/openFoodFacts.ts` ~160), a
  type nothing references.
- `cleanupAllTestData` and `createTestScenario`
  (`src/__tests__/utils/test-helpers.ts`), which no test calls (also true on
  PR #25's branch).

#### 0.5 — `refactor(i18n): drop catalogue keys nothing reads`

From both `messages/es.json` and `messages/en.json`: `auth.logout`,
`common.barcode`, `common.error`, `common.no`, `common.price`,
`common.store`, `common.total`, `common.currency`, `inventory.quantity`,
`prices.recordPrice`, `products.adjust.retry`, `products.detail.retry`,
`products.edit.retry`, `products.history.retry`, `receipts.applied.retry`,
`shopping.checked`, `shopping.days`, `shopping.year`, `stores.delete`, and
`receipts.store` (the least certain). The sweep matched keys to namespaces
loosely, so this list is a floor, not a census, and each key needs its
namespace checked, not just its last word grepped. Dynamic keys
(`` t(`role${…}`) ``, `op${…}`, `screen${…}`, `steps.${…}`, the receipt
statuses) are used whatever a grep says.

`unit/message-usage.test.ts` already fails on a key a component asks for
and no catalogue has. **Add the converse** to it: a key the catalogues have
and no component asks for fails, with the dynamic prefixes above as its
one explicit allow-list. Seen red with one of the keys above put back.

#### 0.6 — `refactor(ui): drop props no caller passes`

- `cancelLabel` on `ConfirmDialog` (`src/components/ui/dialog.tsx` ~201,
  ~213, ~226).
- `placeholder` and `className` on `StoreSelector`
  (`src/components/store/StoreSelector.tsx`). Grep multi-line JSX before
  trusting this; the sweep sampled props rather than checking every one,
  so look at every component in `src/components/` once, not only these.

#### 0.7 and 0.8 — the package manifest, one commit each

- `chore: drop the db:migrate script` — nothing names it; the documents use
  `bunx --bun prisma migrate dev` directly. Or keep it and point the
  documents at it; either way, not both.
- `build(deps): drop postcss` — no file imports it; `postcss.config.mjs`
  names only `@tailwindcss/postcss`. Only if `bun run build` and the
  component suite still pass without it (it may be a peer something
  resolves), and only in a commit of its own.

#### 0.9 — the rules that keep it clean

What the 2026-11-13 measurements found:

- **oxlint already reports unused imports and locals** (`no-unused-vars`,
  on by default), but as warnings, and `bun run lint` exits 0 on
  warnings, so nothing fails. There are none today.
- **TypeScript's `noUnusedLocals` and `noUnusedParameters`** are off;
  turned on, the whole project has **one** error
  (`openFoodFacts.comprehensive.test.ts` ~9, a file PR #25 deletes).
- **Neither can see an unused export.** oxlint 1.89 has no
  `import/no-unused-modules`, and TypeScript does not check exports. That
  needs a whole-project tool: **knip**, which understands Next.js's file
  conventions, Playwright and package.json dependencies. knip 6 parses with
  oxc and does not load TypeScript, so TypeScript 7 is no obstacle; it runs
  under Bun alone, in the Alpine CI image too.
- **What knip does not see**, and stays a manual check (or a test of its
  own): tRPC procedures nothing calls (they are members of a router
  object), props no caller passes, `package.json` scripts nothing names,
  and catalogue keys (0.5's test).
- **What knip found on landing that the sweep had not:** a duplicate export
  (`receiptRegionSchema` and `receiptReframeSchema`,
  `validations/receipt.ts`), `scripts/release-notes.ts` exporting its
  internals, and, in production mode, `src/lib/readability.ts` used only by
  its test — a measuring tool for the catalogues' Spanish, not application
  code: move it under `src/__tests__/` rather than delete it. Its count that
  day: default mode 59 unused exports, 49 unused types, 1 duplicate, nothing
  else; production mode adds the test-only seams (167 exports, 71 types,
  2 files).

So, in order:

- `build: fail lint on warnings, and typecheck unused locals and parameters`
  — `--deny-warnings` on the `lint` script (and wherever CI and
  `scripts/check-scope.sh` call oxlint directly), `noUnusedLocals` and
  `noUnusedParameters` in `tsconfig.json`. Prove each can fail: an unused
  import must turn `bun run lint` red, an unused parameter `bun run
  typecheck`.
- `refactor: export only what another module imports` — about a hundred
  types and constants are exported but read only in their own file (the
  sweep's lists: `src/lib/auth/*`, `src/server/services/ocr.ts`,
  `src/components/ui/*` prop types, the `*Input` types 0.2 left, …). Drop
  the keyword. **Exports read only by tests stay**: they are deliberate
  seams, and the checker below counts tests as users.
- **knip itself landed on 2026-11-13, ahead of this plan** (`build(deps):
  add knip …`, `025b88f6`, pinned at 6.45.0, the newest version past
  bunfig's three-day `minimumReleaseAge` that day): `knip.jsonc` (plugins
  enabled from what the repository holds, the entry points knip cannot
  infer, a production mode) and the `check:unused` and
  `check:unused:production` scripts,
  **deliberately not a gate yet**, because the tree it landed on still held
  everything 0.1–0.8 removes. Read its configuration and commit message
  before this step; they say what each entry and ignore is for.
- `ci: make knip a gate` — the last commit of 0.9, once `bun run
  check:unused` is clean on the tree after 0.1–0.8 and the two commits
  above. Wire it where the other static checks run: `bun run verify:ci`
  (`scripts/verify-local.sh`), `scripts/check-scope.sh` if the others are
  there, and CI's quality job in `.github/workflows/ci.yml`, run inside the
  Alpine image like the rest (`scripts/ci-in-image.sh`) — knip must run
  under Bun alone, with no Node.js. `src/__tests__/unit/ci-workflow.test.ts`
  holds the jobs' shape: make it fail if the step is removed. Prove the gate:
  an unused export added on a scratch branch must turn the job red. The
  default mode is the gate; `--production` (exports only tests read) stays
  informational, since those are deliberate seams.
- Whatever knip still reports at that point is either fixed in this step
  or given an ignore with a comment saying which runtime, framework or
  Dockerfile path loads it. Never an ignore to make it pass.
- `docs/VERIFICATION_SEQUENCE.md` gains the new check, and any document
  that says what `lint` covers says it now fails on warnings.

#### 0.10 — `docs: retire REDESIGN_PLAN.md, keeping the decisions it holds`

The plan is obsolete (owner, 2026-11-13), but parts of it still govern the
code, and about 68 files cite it:

- **Still in force, so they move:** §5 "Decisions taken" (5.1 screen
  choice, 5.2 roles, 5.4 PWA, 5.5 offline, 5.6 languages, 5.7 client state,
  5.8 the compiler) and §7–§8 (usability and accessibility rules).
  `CLAUDE.md` cites §3 (why `/kitchen` and `/shopping` take the `touch`
  density), §5, §5.7 and §8. Move these to one current document that owns
  "why the application is built this way" — a new `docs/DECISIONS.md` is
  the obvious shape; keep each decision's wording and date, and give each a
  stable anchor so citations can point at it.
- **Obsolete, so they go:** the screens as a plan (§3–4, beyond the reasons
  `CLAUDE.md` cites), the phases (§9; `docs/PROGRESS.md` is the record of
  what was done), the "Already implemented" table (§2), and §10 "Carried
  forward" — move anything in §10 that is still a real defect to
  `ISSUES.md`, the rest is gone.
- Repoint every citation (`grep -rn REDESIGN_PLAN`: code comments, tests,
  `CLAUDE.md`, `docs/README.md`'s ownership table and reading order, the
  other documents), then delete the file. `bun run check:links` must pass.
  `docs/README.md` says who now answers "what comes next" — `docs/STATUS.md`
  if nothing else does.

### Commit 1 — `test(auth): give the browser specs their accounts without registering`### Commit 1 — `test(auth): give the browser specs their accounts without registering`

Six specs register a fresh account with a household of its own through
`/register` (`e2e/account.ts` `register()`): `auth`, `password`, `passkeys`,
`two-factor`, `household`, `sessions`. They need an account no other worker
touches, because they change its password, its passkeys, its second factor
and its sessions. Registration will not be open to them once `open` is gone
(the e2e database always has the seeded demo account, so `first-user` refuses).

- Replace `register()` with a helper that creates a fresh household and its
  OWNER **directly in the suite's own database** (`e2e/db-url.ts`), then signs
  in through `/login` as today. Creating a household this way is test
  isolation, not the product — the same thing the integration suites do.
  The seed already writes that database from a child process
  (`e2e/seed.setup.ts` runs `bun run db:seed`); the account must be created
  the way the application creates one — `createCredentialUser`
  (`src/lib/auth/credentials.ts`) with `hashPassword`
  (`src/lib/auth/password-hash.ts`) — or sign-in will not find its password.
  Choose between importing those from the spec process and a small script
  run like the seed; check what the Playwright image can import first.
- `auth.spec.ts` "registers, picks a start screen, signs out and signs back
  in": registration is a once-per-installation step, not a journey a browser
  suite can repeat on a database that already has accounts. Keep the
  journey as *signs in, picks a start screen, signs out, signs back in*;
  registration is already proven against a real database in
  `src/__tests__/integration/registration.test.ts` and in
  `src/__tests__/components/auth-pages.test.tsx`.
- Leave `STOKY_REGISTRATION: "open"` in `playwright.config.ts` for this
  commit; it goes in commit 3.
- Gate: run each changed spec alone in the image (`bash scripts/e2e-in-image.sh
  e2e/<file>.spec.ts` — the script passes its arguments to Playwright). Not
  the whole suite.
- Docs: `docs/TEST_SETUP.md` where it says how the browser specs get their
  accounts, if it does.

### Commit 2 — `feat(auth): require the household's name to register`

`auth.register` makes the household and its OWNER together only when a name
is sent; without one it makes a householdless MEMBER.

- `src/lib/validations/auth.ts`: `householdName` required.
- `src/server/trpc/routers/auth.ts` `register`: always creates the household,
  always `OWNER`. Its doc comment says "The household is optional…
  (HOUSE-1)": rewrite it.
- `src/components/session/RegisterForm.tsx`: the field is required (and says
  so the way the form's other required fields do: the input has no
  `required` today); stop sending `householdName || undefined` (~61).
- `messages/es.json` / `messages/en.json` `householdHint` says the field is
  optional ("Opcional. Si lo completas ahora, se creará tu hogar inicial."):
  rewrite both.
- Tests: `integration/registration.test.ts`'s `account()` helper (~123)
  leaves the name out unless asked; the cases that registered without one
  now expect the refusal; the component test sends the name. Break the schema
  back to optional and watch the new assertion go red (CLAUDE.md, rule 2).

### Commit 3 — `feat(auth)!: refuse STOKY_REGISTRATION=open, one household per installation`

- `src/lib/auth/registration.ts`: `REGISTRATION_MODES` is `first-user` and
  `closed`. Unset is `first-user` **everywhere**, not `open` outside
  production. `registrationAllows` and `registrationOpen` lose their `open`
  arm. The module's doc comment explains the modes; say why `open` is gone
  (one household per installation), briefly.
- The refusal message for an unknown value lists the modes from the
  constant already; check `open` reads as "unknown" with a reason an
  operator can act on (`src/lib/auth/startup.ts`).
- `playwright.config.ts`: drop `STOKY_REGISTRATION: "open"` and its comment.
- Every test of `open`: `src/__tests__/unit/registration-mode.test.ts`,
  `auth-environment.test.ts`, `deployment.test.ts`, `auth.error-messages.test.ts`,
  `integration/registration.test.ts`; and the two that set
  `STOKY_REGISTRATION` for their own reasons, `unit/public-url.test.ts` and
  `components/auth-pages.test.tsx` — an `open` case becomes "is refused /
  unknown", not deleted silently. A dev or test default of `first-user` may
  break suites that relied on registering freely; fix them to create
  accounts directly.
- Docs, all in this commit (line numbers as of 2026-11-13; re-grep
  `` `open` `` and "open registration" before trusting them):
  `docs/INSTALL.md` (the modes table at ~164, ~172, ~676, ~1092, the
  troubleshooting row at ~1272), `.env.example` (~113–115),
  `SECURITY.md` (the registration section at ~2276–2282 and ~2326, ~2652,
  and the "under open registration" risk lines ~277, ~1761, ~1779, ~1818 —
  reword or drop each, do not leave them describing a mode that no longer
  exists), `ISSUES.md` (~771, ~976–978: the severity reasoning of those
  entries), `docs/STATUS.md` (~471). `deploy/example.env` and
  `deploy/docker-compose.yml` already say `first-user` and need nothing.
  `docs/releases/NEXT.md`: one line for operators — `open` is no longer
  accepted and an installation is one household. No upgrade instructions
  (pre-beta).

### Commit 4 — `feat(household)!: stop creating a household from an account without one`

- Remove `household.create` from `src/server/trpc/routers/household.ts`
  (~238). The schemas that already validated nothing went in step 0.2:
  `updateHouseholdSchema` (`src/lib/validations/household.ts` ~14, with
  `UpdateHouseholdInput`; it takes an `id`, and the household is the
  caller's) and `createHouseholdSchema` (`src/lib/validations/auth.ts` ~118,
  with `CreateHouseholdInput`), with their cases in
  `unit/household.validation.test.ts`, `unit/auth.validation.test.ts`,
  `unit/update-schemas.test.ts` (~24) and `unit/validation-bounds.test.ts`
  (~471, ~473).

  **Keep `householdSchema`** (~10): between this commit and commit 6 it
  validates nothing, and commit 6 makes it the rename's input. Its tests
  stay.
- `src/components/household/RouteState.tsx`: remove `CreateHousehold` and the
  no-household branch of `RouteState`. `isNoHouseholdError` goes if nothing
  else uses it; an account without a household can no longer be made, so
  that error now falls to the ordinary "could not load" state with a retry.
  `components/RouteState.test.tsx` tests `isNoHouseholdError` (~69).
- `householdProcedure` (`src/server/trpc/trpc.ts` ~306) **keeps** refusing an
  account with no household — defence against a hand-edited database. Its
  comment says the client resolves it by creating one: reword that, and
  leave the code as it is.
- `messages/es.json` and `messages/en.json`: `noHouseholdTitle`,
  `noHouseholdBody`, `createHousehold` and `creating` are used only by the
  form. `createFailed`, `nameHint` and `nameLabel` are also read elsewhere
  (`ScanProductDialog`, `products/new`, `RegisterForm`, …): delete each only
  if no other reader shares its namespace.
- Comments that name the form or the procedure and become false:
  `src/components/offline/WriteQueueProvider.tsx` (~77, "`CreateHousehold`
  invalidates…") and `removeMember`'s doc comment in `household.ts` (~433,
  "a new household of its own (`household.create`)").
- `src/__tests__/unit/capabilities.test.ts`: drop `create` (~64); the
  documented procedure count goes from 79 to 78 in `SECURITY.md` ("all 79
  procedures are assigned", ~2471) and `docs/STATUS.md` ("**79
  procedures**" ~1131, "all 79 procedures assigned" ~1235) — the test
  matches those three sentences. The matrix comment above `household.ts`
  explains `create`'s tier: rewrite it.
- Tests that call the procedure: only `integration/household.test.ts`, its
  `describe("household.create")` (~84–200). Remove those cases. (Every other
  `household.create` in the suites is `prisma.household.create`, setup that
  stays; `routers.test.ts` never called the procedure and PR #25 deletes it.)
- `ISSUES.md` HOUSE-1 is resolved; add one line to it saying the way out it
  describes was removed and why, rather than rewriting history.
- `docs/releases/NEXT.md` only if a household could notice; probably not.

### Commit 5 — `feat(household): delete a removed member's account`

`removeMember` sets `householdId: null` and ends the member's sessions.
Delete the account instead, in the same transaction, after the same guards
(`withOwnersLocked`, `assertMayActOnOwner`, `assertAnOwnerRemains`).

- Keep `endSessions` (`src/lib/auth/end-sessions.ts`) before the delete,
  but not for the reason first written here: sessions are `Session` rows
  only (no secondary storage; the cookie cache is off), and those cascade.
  What does not cascade is what `endSessions` also deletes from
  `Verification`, which has no relation to `User`: the account's two-step
  sign-ins in progress and its step-ups. The known-devices sets in Valkey
  (`src/lib/auth/known-devices.ts`) are keyed by account and expire on
  their own; a re-added person gets a new id, so they need nothing.
- `Account`, `Session`, `Passkey`, `TwoFactor` cascade from `User`
  (`onDelete: Cascade` in `prisma/schema.prisma`). `ScreenChoice` and
  `MutationReplay` key on `userId` with no relation: delete the member's rows
  in the same transaction. `StockEntry.createdBy` and `Receipt.uploadedBy`
  are plain ids with no relation and are never joined for display; leave
  them — the history keeps who did it, as an id.
- Keep the `auth.session.ended` security event; it should still record how
  many sessions ended and that the reason was removal.
- The removal dialog must say the account is deleted. Today it says the
  opposite: `removeConfirmBody` is "Su cuenta no se borra: deja de
  pertenecer a este hogar…" (`messages/es.json` ~948, and `en.json`);
  `removeConfirmTitle` and `removeConfirm` say "quitar del hogar". The
  screen is `src/app/(dashboard)/settings/people/page.tsx`.
- Tests (integration, `household.test.ts`): after removal the account row and
  its credentials are gone, sign-in with its password fails, its
  `ScreenChoice` rows are gone, and the same e-mail can be added again with
  `addMember`. Each seen red with the delete reverted.
- Docs: `SECURITY.md` where member removal is described (~799–811); `docs/releases/NEXT.md`
  (a household notices: a removed person's account no longer exists).

### Commit 6 — `feat(household): let an admin rename the household`

The form commit 4 removes promised a rename ("podrás cambiarle el nombre más
adelante") that never existed. Now it does.

- `household.update`, an `adminProcedure` taking `householdSchema`
  (`{ name }`), writing the caller's own household (`ctx.householdId`, never
  an id from the input). Follow the shape of `store.update`
  (`src/server/trpc/routers/store.ts` ~57), the closest existing rename.
- Where it lives on screen: a "Hogar" section on the settings hub
  (`src/app/(dashboard)/settings/page.tsx`), shown to OWNER and ADMIN only,
  built from `src/components/ui/` primitives (`CLAUDE.md`, Design System). If
  it becomes a route of its own instead, it needs a `ROUTE_TITLES` entry
  (`src/lib/route-titles.ts`) and a row in `src/lib/back.ts`.
- Whether it queues offline: decide by what the settings screens already do,
  and say which in the commit message; an admin rename is not a Phase 4
  write unless the stores rename is one.
- The web shows the household's name **nowhere** today; only the forms
  that create one ask for it. The form reads the current name through
  `household.current`, which step 0.1 kept for exactly this and which gets
  its first web caller here; saving invalidates it.
- `capabilities.test.ts` gains `update: "adminProcedure"`; the procedure
  count in `SECURITY.md` and `docs/STATUS.md` goes back up by one.
- Tests: integration — an ADMIN renames, a MEMBER and a KITCHEN account are
  refused, a blank or over-long name is refused, and another household's
  row is untouched. Each seen red with the guard removed.
- `docs/releases/NEXT.md`: a household notices.

### Commit 7 — `feat(household): name the browser tab and the installed app`

The owner's decisions are in §2. This is the one schema change in the plan.

- `prisma/schema.prisma`: `Household.tabName String?` and
  `Household.appName String?` (the names are suggestions). Pre-beta, a
  schema change **regenerates the single baseline migration** rather than
  adding one: `prisma migrate diff --from-empty --to-schema
  prisma/schema.prisma --script`, keeping its header (pg_trgm) and its
  hand-written tail (the `lower(email)` unique index and the
  `StockEntry_batch_balance` CHECK, which the diff cannot see). Resetting
  the local `stoky` and `stoky_e2e` databases needs the owner's consent at
  that moment.
- `householdSchema` gains both, optional, trimmed, bounded like the name;
  an empty string stores `null`. `household.update` writes them.
- **The tab.** `TITLE_SUFFIX` (`src/lib/route-titles.ts` ~60) becomes the
  fallback; `documentTitle` takes the name. `RouteTitle`
  (`src/components/ui/route-title.tsx`) is mounted once in the root layout,
  a Server Component, which can read the name and pass it down — that keeps
  the title right on `/login` and on a no-JavaScript `/start`, and needs no
  public tRPC procedure. It must not cost the routes their static or
  `instant` configuration without saying so.
- **The installed app.** `src/app/manifest.ts` is static and prerendered
  today (its comment says why); reading the name makes it per-request.
  `pwa-manifest.test.ts` holds its shape. An installed app picks up a new
  name only when the browser re-reads the manifest (Chrome on its own
  schedule, iOS only on reinstall): the form's hint says so.
- **Both names are public.** The tab name is served before sign-in by
  decision, and the manifest is fetched without credentials, so the app
  name (and, when it is empty, the household's name) is public as well.
  The form says so next to each field, and `SECURITY.md` records it with
  the decision.
- Tests: the fallbacks (empty tab name → `Stoky`, even with a household
  name set; empty app name → the
  household's name; no household → `Stoky`), the title on `/login`, and
  the manifest's name. `docs/releases/NEXT.md`: a household notices.

## 5. Gates

Per commit (`CLAUDE.md` rule 4, as the owner narrowed it):
`bun run lint`, `bun run typecheck`, and only the test files the change
touches — never the whole suite to find one case, never the whole browser
suite. Component tests need the DOM preload:
`bun test --preload ./src/__tests__/setup/register-dom.ts <file>`.
Integration tests need a database (`docs/VERIFICATION_SEQUENCE.md`). Do not
let them, or `verify:ci`, recreate the developer's database container (it may
be a different PostgreSQL major than the suite expects): run them against
throwaway PostgreSQL and Valkey containers on spare ports.

Before the push, once: the whole `bun run verify:ci`, read to the end — its
exit status is the last script's, and it stops at the first failing step, so
a failure early hides everything after it. Fold each fix into the commit that
caused it (`git commit --fixup` + `git rebase -i --autosquash`) while the
branch is unpushed. Do **not** run `bun run test:e2e` whole; CI runs it.

Push over HTTPS (`git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/NGarate/stoky.git <branch>`);
SSH asks for a passphrase nobody can type in an agent session. Open the PR
and stop: the owner reviews and merges.

CI was entirely green on `master` at `4df104c4` (2026-11-13), image build
and scan included; the bundle now runs our own PostgreSQL 18 image. A red
job on this branch is this branch's.

## 6. Risks and things to check, not assume

- **Data already householdless.** Pre-beta, local databases are reset rather
  than migrated; no data fix is needed. Do not reset anyone's database
  without asking.
- **`first-user` as the development default** changes `bun run dev` for a
  fresh database: the first registration claims it, which is the product's
  behaviour. The seeded demo account already exists on a seeded database.
- **`User.householdId` stays nullable.** After this plan nothing writes null
  except a hand edit. Making it required would let the database hold the
  invariant (`ISSUES.md` DB-1's class), but touches every test that creates a
  user without a household — a separate decision, not this plan.
- **Commits 6 and 7 are not breaking** and need not wait for, or hold back,
  a release; only commits 3 and 4 are.
- **The release.** If `v0.1.0-alpha.5` is cut before this lands, commits 3
  and 4 become the next release's breaking changes; `docs/releases/NEXT.md`
  is then a new file, not the one being renamed.
- **The receipt keywords (PARSE-5)** can follow this plan with
  `adminProcedure` as their editor. Once this merges, update PARSE-5's status
  line to say the question it waited on is settled.
