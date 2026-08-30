# Discordance Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every point found by the 2026-08-29 full-codebase review where the
project's prose (CLAUDE.md, STATUS.md, docblocks) and its code disagree — by
fixing the code where the prose states the intended invariant, and rewriting the
prose where the code embodies a deliberate decision the prose never caught up
with (chiefly the offline-first, client-fetch rendering architecture).

**Architecture:** Two directions of repair. (1) The receipt router is brought up
to the conventions the rest of the codebase already enforces: `findFirst`+NOT_FOUND
lookups, `ctx.db` instead of the module-level `prisma` import, a real transaction
with an atomic status claim in `applyReceipt`, status-edge guards on the review
procedures, and a discriminated-union input schema that makes the cross-household
CREATE injection unrepresentable. (2) CLAUDE.md's rendering rule is rewritten to
describe the client-fetch architecture the offline requirement forced, the dead
server-side caller is deleted, stale comments are swept, and STATUS.md's rotted
counts are re-measured by command.

**Tech Stack:** Bun 1.4.0 runtime and test runner, Next.js 16.3, tRPC 11, Prisma 6,
Zod 3, next-intl 4, PostgreSQL + Valkey (integration tests need both running —
see `docs/TEST_SETUP.md`).

**Spec:** The findings table below (distilled from the 2026-08-29 review
conversation; there is no separate spec file). Each task names the finding(s) it
closes.

## Findings being addressed

| # | Finding | Direction of fix |
|---|---|---|
| D1 | CLAUDE.md "Server Components fetch; Client Components interact" is false in 27 of 32 pages; the app is deliberately client-first for offline. `src/lib/trpc/server.ts` is dead (zero importers, verified). | Rewrite prose, delete dead module |
| D2 | CLAUDE.md calls `image.ts` "the one seam that touches image bytes"; `receipt.ts` also decodes, magic-checks and writes bytes. Server Actions (`src/lib/landing/choose.ts`, `src/lib/auth/actions.ts`) are an unsanctioned second RPC surface. | Rewrite prose |
| D3 | `receipt.ts` is the only router using `findUnique` + FORBIDDEN (8 sites), leaking id existence; codebase convention is `findFirst({id, householdId})` → NOT_FOUND, argued in `assertOwnProduct`'s own docblock (`receipt.ts:78-81`). | Fix code |
| D4 | 7 of 10 routers import the global `prisma` against `trpc.ts:24-38`'s own stated rule (`ctx.db`). | Fix code |
| D5 | `applyReceipt` docstring claims "in one transaction" (`receipt.ts:609`); there is no `$transaction` and no lock. Concurrent applies double-book; a mid-loop crash leaves partial stock at CONFIRMED. | Fix code (make the docstring true) |
| D6 | The router header claims "each procedure acts on one edge and refuses if the receipt is not on it" (`receipt.ts:26-28`); only `applyReceipt` checks status. `confirmAll` can flip APPLIED back to CONFIRMED → re-apply → double stock. | Fix code |
| D7 | `confirmItem`/`confirmAll` with `action: "CREATE"`, a foreign `productId` and no `customName` skip `assertOwnProduct` AND the create branch, writing the unchecked foreign id into `matchedProductId` — cross-household injection (SEC-1's shape). The shared `receiptItemMatchSchema` in `src/lib/validations/receipt.ts` exists and the router inlines its own copy instead. | Fix code |
| D8 | `parseReceipt`/`matchItems` are exposed write procedures with zero client callers; `saveParsedItems` appends, so any re-parse duplicates every line. | Delete dead surface, make the service idempotent |
| D9 | STATUS.md says 59 procedures (`:478`, `:534`) — the real count is higher and moves again with D8; says "26 tokens" (`:515`) while its own line `:39` says 37. | Re-measure, rewrite prose |
| D10 | Four comments still say the upload re-encodes "through Sharp" (`receipt.ts:103,109`, `throttle.ts:17`, `rate-limit.ts:116`) — the runtime moved to `Bun.Image` on 2026-08-26. | Rewrite prose |
| D11 | `shopping.ts:30-36` docblock says both "always references a Product" and "Free text is what a shopping list is for"; `:281` keeps a dead `if (input.productId)` (schema requires it, `validations/shopping.ts:39`); getBuyList comment still describes free-text nulls. | Rewrite prose, unwrap dead conditional |
| D12 | `ExpiringItems.tsx` is 100% hardcoded Spanish with non-ICU plurals, live at `inventory/page.tsx:211`, while ISSUES.md marks all I18N entries resolved. | Fix code (i18n only; the component's *shape* is deliberately parked per the target-floor allowlist) |
| D13 | `/receipts` list labels `createdAt` as `t("purchaseDate")` (`receipts/page.tsx:116-117`) while fetching `purchaseDate` and never using it. | Fix code |
| D14 | `ui/snackbar.tsx:16` imports `useWriteQueue` from `components/offline/` — a design-system primitive depending on a feature slice. | Move the context to `src/lib/offline/` |
| D15 | Uncommitted `next.config.ts` diff hardcodes a personal Tailscale hostname as `allowedDevOrigins` (a bare string where Next documents an array). | Env-derive it |

## Global Constraints

- **Runtime is Bun**, not Node — `bun run dev`, `bun test`; `bunx` for Playwright.
- **Trunk-based, master only.** No branches, no PRs. One commit, one change; each commit stands alone and is revertible alone. Stage with `git add <path>`, never `git add -A`.
- **Validate before every commit:** `bun run verify:ci`, plus `bunx playwright test` for anything that renders. **TEST-5 caveat:** `verify:ci` fails ~1 run in 7 on `replay.test.ts` with the signature "TRPCError … already used for a different change" — re-run before investigating (`ISSUES.md` TEST-5).
- **Integration tests need PostgreSQL + Valkey running** (`scripts/test-integration-local.sh` or the compose services).
- **Every new test must be able to fail:** break the code deliberately, watch it go red, restore it.
- **User-facing strings Spanish first**, English second; keys must exist in BOTH `messages/es.json` and `messages/en.json` (parity enforced by `src/__tests__/unit/messages.test.ts` — a key in one catalogue only fails the suite, as does a byte-identical en/es pair).
- Conventional Commits: `<type>(<scope>): <description>`, scopes from CLAUDE.md's list; message explains **why**.
- When a change makes a document wrong, update the owning document in the same task (docs/README.md says which owns what).
- The uncommitted `next.config.ts` change on the tree belongs to Task 12 — do not sweep it into any other commit.

## File Structure (what this plan touches)

| File | Role in this plan |
|---|---|
| `CLAUDE.md` | Rewritten rendering rule, sanctioned server actions, corrected image-seam wording (Tasks 1) |
| `src/lib/trpc/server.ts` | Deleted — dead module (Task 1) |
| `src/server/trpc/routers/receipt.ts` | Lookup convention, `ctx.db`, transaction, edge guards, schema use, dead procedures removed (Tasks 2–6) |
| `src/lib/validations/receipt.ts` | `receiptItemMatchSchema` becomes a discriminated union (Task 5) |
| `src/server/services/receiptParser.ts` | `saveParsedItems` becomes replace-not-append (Task 6) |
| `src/app/(dashboard)/receipts/[id]/review/page.tsx` | Client payloads composed per-action (Task 5) |
| `src/server/trpc/routers/{auth,location,product,price,household,store}.ts` | `ctx.db` migration (Task 7) |
| `src/components/inventory/ExpiringItems.tsx` + `messages/*.json` | i18n (Task 8) |
| `src/app/(dashboard)/receipts/page.tsx` + `messages/*.json` | date label (Task 9) |
| `src/components/offline/queue-context.ts` → `src/lib/offline/queue-context.ts` | layering fix (Task 10) |
| `src/server/trpc/{routers/shopping.ts,throttle.ts}`, `src/lib/rate-limit.ts` | comment sweep (Task 11) |
| `next.config.ts`, `.env.example` | dev origin from env (Task 12) |
| `docs/STATUS.md`, `ISSUES.md` | re-measured counts, review entry (Task 13) |
| Tests | `src/__tests__/integration/receipt.router.test.ts`, `capabilities.refusals.test.ts`, `src/__tests__/unit/capabilities.test.ts`, new/updated component tests |

---

### Task 1: CLAUDE.md tells the truth about rendering, and the dead server caller goes

**Files:**
- Delete: `src/lib/trpc/server.ts`
- Modify: `CLAUDE.md` (Architecture section; Security Constraints upload bullet)

**Interfaces:**
- Consumes: nothing.
- Produces: the corrected CLAUDE.md text later tasks' commit messages may cite.

**Why this shape:** The offline requirement is the *reason* the app is client-first:
a screen that must work with no signal (the Phase 4 write queue, the persisted
read cache in `src/lib/offline/persist.ts`) cannot depend on a server render it
may not be able to reach. The rule as written invites two regressions: "fixing"
pages toward SSR, or resurrecting the dead caller. Both must become impossible to
do innocently.

- [ ] **Step 1: Verify the module is still dead**

Run: `grep -rn "lib/trpc/server" src e2e --include='*.ts' --include='*.tsx'`
Expected: no output (the module imports itself into nothing). If any importer
appeared since 2026-08-29, stop and reassess this task.

- [ ] **Step 2: Delete the dead module and commit**

```bash
git rm src/lib/trpc/server.ts
bun run typecheck   # proves nothing referenced it
git commit -m "chore(ui): delete the server-side tRPC caller nothing ever called

src/lib/trpc/server.ts was the physical embodiment of CLAUDE.md's 'Server
Components fetch' rule, and it had zero importers: the dashboard went
client-first when Phase 4 made offline a requirement, and the caller was
left behind as a fossil. Keeping it invites someone to 'fix' a page toward
SSR without revisiting the offline design. The rule itself is rewritten in
the next commit."
```

- [ ] **Step 3: Rewrite the Architecture bullet in CLAUDE.md**

Replace this line in `CLAUDE.md`:

```markdown
- **Server Components fetch; Client Components interact.** `"use client"` is an
  explicit boundary, not a default.
```

with:

```markdown
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
```

- [ ] **Step 4: Correct the image-seam sentence**

In CLAUDE.md's Security Constraints, replace:

```markdown
  Re-encoding goes through
  `src/server/services/image.ts`, which is the one seam that touches image
  bytes.
```

with:

```markdown
  Re-encoding goes through
  `src/server/services/image.ts`, the one seam that *transforms* image bytes;
  the upload procedure itself (`receipt.ts`) validates magic bytes and writes
  the re-encoded file, and nothing else touches them.
```

- [ ] **Step 5: Verify and commit**

Run: `bun run verify:local` (docs-only change; the cheap tier is the honest gate here — nothing renders).

```bash
git add CLAUDE.md
git commit -m "docs: the rendering rule describes the app that exists

27 of 32 pages are client components fetching through TanStack Query, and
have been since Phase 4 made offline a requirement — 'Server Components
fetch' described an architecture the project deliberately walked away from,
in the file every agent context loads. The 2026-08-29 review found the dead
server caller as the fossil record. Also sanctions Server Actions as the
no-JS side door (they exist and were undocumented) and narrows the image.ts
'one seam' claim to what is true: it transforms bytes; the upload procedure
validates and writes them."
```

---

### Task 2: The receipt router adopts the codebase's lookup convention (D3)

**Files:**
- Modify: `src/server/trpc/routers/receipt.ts` (getStatus `:229-253`, parseReceipt `:284-300`, matchItems `:328-344`, getReceiptWithItems `:367-391`, confirmItem `:433-452`, confirmAll `:515-531`, applyReceipt `:621-645`, getAppliedSummary `:721-762`)
- Modify: `src/__tests__/integration/receipt.router.test.ts` (~13 FORBIDDEN assertions and the header comment at `:32`)
- Modify: `src/__tests__/integration/capabilities.refusals.test.ts:570-573` (comment only)

**Interfaces:**
- Consumes: nothing from other tasks (do this first — Tasks 3–6 edit the same procedures and assume this shape).
- Produces: every receipt lookup is `findFirst({ where: { id, householdId } })` (or, for items, `findFirst({ where: { id, receipt: { householdId } } })`), throwing `TRPCError { code: "NOT_FOUND" }`. No procedure in this router throws FORBIDDEN itself any more (the tier middlewares still do).

**Why:** Every other router refuses cross-household ids with NOT_FOUND so an
outsider cannot confirm an id exists; `assertOwnProduct` in this very file
documents that reasoning (`receipt.ts:78-81`) while the receipt lookups two
screens up contradict it. Trade-off to record in the commit: the `securityEvents`
middleware logs FORBIDDEN and not NOT_FOUND, so cross-household probes on
receipts stop appearing in the security log — which is already true of every
other router, and uniformity is the point.

- [ ] **Step 1: Flip the test expectations first (red)**

In `src/__tests__/integration/receipt.router.test.ts`, change every assertion
that expects `"FORBIDDEN"` for *another household's* receipt/line (lines 359,
471, 495, 562, 622, 727, 738, 780, 961, 985, 994, 998 as of `d10be8c`) to expect
`"NOT_FOUND"`, and rename the `it(...)` titles accordingly (e.g.
`"is FORBIDDEN for another household's receipt"` → `"is NOT_FOUND for another
household's receipt, so the id's existence is not confirmed"`). Update the file
header comment at `:32` to say `→ NOT_FOUND, and nothing read`. Leave the
kitchen-tier FORBIDDEN tests in `capabilities.refusals.test.ts` untouched —
those come from `writeProcedure` and stay FORBIDDEN.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/__tests__/integration/receipt.router.test.ts`
Expected: the edited tests FAIL (code still returns FORBIDDEN).

- [ ] **Step 3: Convert the lookups**

For each receipt-loading procedure, replace the pair
`findUnique({ where: { id } })` + `if (receipt.householdId !== ctx.householdId) throw FORBIDDEN`
with a single scoped lookup. Pattern (shown for `getStatus`; apply identically
to the other seven, preserving each one's `include`/`select`):

```ts
const receipt = await prisma.receipt.findFirst({
  where: { id: input.receiptId, householdId: ctx.householdId },
  include: {
    items: { select: { id: true, matchStatus: true } },
  },
});

if (!receipt) {
  // NOT_FOUND for "not yours" as well as "not there", like every other
  // router: confirming an id exists is information (see assertOwnProduct
  // above).
  throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
}
```

For `confirmItem`, the lookup is on the item and scopes through the relation:

```ts
const item = await prisma.receiptItem.findFirst({
  where: { id: input.receiptItemId, receipt: { householdId: ctx.householdId } },
  include: { receipt: true },
});

if (!item) {
  throw new TRPCError({ code: "NOT_FOUND", message: "Receipt item not found" });
}
```

Delete the now-dead `FORBIDDEN` blocks. (This file still uses the module-level
`prisma` until Task 3 — keep it for now so this commit stays one change.)

- [ ] **Step 4: Update the stale comment in capabilities.refusals.test.ts**

At `:570-573`, the comment says the fixtures keep "receipt.ts's 'Access denied'
— also FORBIDDEN — out of the way". Reword to: `// All three receipts belong to
the kitchen account's own household, so the refusal being asserted can only
come from the tier middleware.`

- [ ] **Step 5: Run the suites**

Run: `bun test src/__tests__/integration/receipt.router.test.ts src/__tests__/integration/capabilities.refusals.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate and commit**

Run: `bun run verify:ci` (re-run once on a TEST-5 signature).

```bash
git add src/server/trpc/routers/receipt.ts src/__tests__/integration/receipt.router.test.ts src/__tests__/integration/capabilities.refusals.test.ts
git commit -m "fix(receipts): refuse cross-household ids as NOT_FOUND, like every other router

The receipt router was the only one answering a foreign id with FORBIDDEN
after a findUnique — confirming to an outsider that the id exists, which is
the exact leak assertOwnProduct's docblock in the same file argues against.
Every lookup is now findFirst scoped by householdId. Known trade, chosen for
uniformity: securityEvents logs FORBIDDEN and not NOT_FOUND, so these probes
leave the security log — as they already don't appear for any other router."
```

---

### Task 3: The receipt router takes the database from the context (D4, receipt half)

**Files:**
- Modify: `src/server/trpc/routers/receipt.ts` (all procedures; `assertOwnStore:52`, `assertOwnProduct:82`; `processReceiptAsync:858` keeps `prisma`)

**Interfaces:**
- Consumes: Task 2's lookup shape.
- Produces: every resolver statement reads `ctx.db`; helpers take a `db` first parameter: `assertOwnStore(db: PrismaClient, storeId: string | undefined, householdId: string)`, `assertOwnProduct(db: PrismaClient, productId: string, householdId: string)` (productId stays optional until Task 5 tightens it — pass through unchanged here). Task 4's rollback test is only expressible after this.

- [ ] **Step 1: Change the helper signatures**

```ts
import type { PrismaClient, Prisma } from "@prisma/client";

async function assertOwnStore(
  db: PrismaClient | Prisma.TransactionClient,
  storeId: string | undefined,
  householdId: string,
): Promise<void> {
  if (!storeId) return;
  const store = await db.store.findFirst({
    where: { id: storeId, householdId },
    select: { id: true },
  });
  if (!store) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }
}
```

(Same mechanical change for `assertOwnProduct`.) Keep the existing docblocks.

- [ ] **Step 2: Replace `prisma.` with `ctx.db.` inside every procedure body**

Mechanical, but by hand, not sed — `processReceiptAsync` (`:858-882`) must keep
the module-level `prisma` and gains this comment above it:

```ts
// The one deliberate use of the module import in this file: this runs after
// the upload's response, with no request context to carry a db. Everything
// inside a procedure takes ctx.db (trpc.ts:24-38 explains why).
```

Update the two helper call sites (`:144`, `:456`, `:561`) to pass `ctx.db`.

- [ ] **Step 3: Typecheck and run the receipt suites**

Run: `bun run typecheck && bun test src/__tests__/integration/receipt.router.test.ts src/__tests__/integration/receipt.upload.test.ts`
Expected: PASS (behavior unchanged; `ctx.db` defaults to the same singleton).

- [ ] **Step 4: Gate and commit**

Run: `bun run verify:ci`

```bash
git add src/server/trpc/routers/receipt.ts
git commit -m "refactor(receipts): take the database from the context, as trpc.ts requires

trpc.ts:24-38 calls reaching for the module import inside a resolver 'the
worst failure mode of the replay design' — a write that escapes the
transaction meant to contain it — and this router did it in every procedure.
ctx.db throughout; processReceiptAsync alone keeps the import, commented,
because it runs outside any request. Prerequisite for making applyReceipt's
transaction testable: an injected client whose second write throws is the
only way to assert a rollback."
```

---

### Task 4: `applyReceipt` becomes the transaction its docstring already claims (D5, D6-half)

**Files:**
- Modify: `src/server/trpc/routers/receipt.ts:616-707` (`applyReceipt`)
- Test: `src/__tests__/integration/receipt.router.test.ts` (two new tests in the existing `applyReceipt` describe block)

**Interfaces:**
- Consumes: Task 3 (`ctx.db`).
- Produces: `applyReceipt` returns the same shape as before — `{ success: true, stockEntriesCreated: number, priceRecordsCreated: number }` — so no client change. The CONFIRMED→APPLIED flip is an atomic claim: `updateMany({ where: { id, status: CONFIRMED } })` inside the transaction, refusing with BAD_REQUEST when `count === 0`.

- [ ] **Step 1: Write the two failing tests**

Add to the `applyReceipt` describe block in `receipt.router.test.ts`, reusing
the file's existing fixture helpers (read its `beforeAll`/receipt-factory — the
suite already creates CONFIRMED receipts with matched items for the happy-path
test; follow that pattern for setup, and its `expectCode` helper for refusals):

```ts
it("applies exactly once under two concurrent calls", async () => {
  const receiptId = await makeConfirmedReceipt(); // the suite's existing factory pattern
  const itemCount = await prisma.receiptItem.count({
    where: { receiptId, matchedProductId: { not: null } },
  });

  const results = await Promise.allSettled([
    caller.receipt.applyReceipt({ receiptId }),
    caller.receipt.applyReceipt({ receiptId }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  expect(fulfilled.length).toBe(1);

  // The second call must have refused on the claim, not double-written.
  const entries = await prisma.stockEntry.count({
    where: { receiptItem: { receiptId } },
  });
  expect(entries).toBe(itemCount);
});

it("rolls the status back when a write inside fails, so a retry is safe", async () => {
  const receiptId = await makeConfirmedReceipt();

  // A client whose priceRecord.create throws: the transaction must take the
  // stock entries and the status flip down with it.
  const failing = new Proxy(prisma, {
    get(target, prop) {
      if (prop === "$transaction") {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          prisma.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(txTarget, txProp) {
                  if (txProp === "priceRecord") {
                    return {
                      create: () => {
                        throw new Error("injected failure");
                      },
                    };
                  }
                  return Reflect.get(txTarget, txProp);
                },
              }),
            ),
          );
      }
      return Reflect.get(target, prop);
    },
  }) as typeof prisma;

  const failingCaller = await makeCaller({ db: failing }); // same session/household as `caller`

  await expect(
    failingCaller.receipt.applyReceipt({ receiptId }),
  ).rejects.toThrow();

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  expect(receipt?.status).toBe("CONFIRMED"); // not APPLIED, not half-applied
  expect(
    await prisma.stockEntry.count({ where: { receiptItem: { receiptId } } }),
  ).toBe(0);
});
```

Adapt `makeConfirmedReceipt`/`makeCaller` to whatever the file's existing
fixtures are named — the point is: a CONFIRMED receipt whose items carry
`matchedProductId` and `parsedPrice`, and a caller whose context was built with
`createTRPCContext({ session, db })`. The receipt must have a `storeId` so the
price-record branch runs.

- [ ] **Step 2: Run to verify both fail**

Run: `bun test src/__tests__/integration/receipt.router.test.ts -t "applies exactly once"`
Expected: FAIL — both calls fulfill today (no claim), and entries double.
Run: `bun test src/__tests__/integration/receipt.router.test.ts -t "rolls the status back"`
Expected: FAIL — stock entries survive the injected failure (no transaction).

- [ ] **Step 3: Rewrite the mutation body**

```ts
.mutation(async ({ ctx, input }) => {
  const user = ctx.session.user;

  const receipt = await ctx.db.receipt.findFirst({
    where: { id: input.receiptId, householdId: ctx.householdId },
    select: { id: true, storeId: true, status: true },
  });

  if (!receipt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
  }

  if (receipt.status !== ReceiptStatus.CONFIRMED) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Receipt must be confirmed before applying",
    });
  }

  const applied = await ctx.db.$transaction(async (tx) => {
    // The claim is the guard. An UPDATE filtered on CONFIRMED flips the
    // status and takes the row lock in one statement, so of two concurrent
    // applies exactly one matches; the loser sees count 0 and refuses. The
    // check above is a courtesy for a fast error message — this is the one
    // that holds. Same shape as withReplay's claim-row-as-lock.
    const claimed = await tx.receipt.updateMany({
      where: { id: receipt.id, status: ReceiptStatus.CONFIRMED },
      data: { status: ReceiptStatus.APPLIED },
    });

    if (claimed.count === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Receipt must be confirmed before applying",
      });
    }

    // Read the lines inside the transaction, after the claim: a confirmItem
    // racing this call lands before or after the whole apply, never between
    // the read and the writes.
    const items = await tx.receiptItem.findMany({
      where: { receiptId: receipt.id },
      include: { matchedProduct: true },
    });

    let stockEntriesCreated = 0;
    let priceRecordsCreated = 0;

    for (const item of items) {
      if (!item.matchedProductId || item.matchStatus === MatchStatus.SKIPPED) {
        continue;
      }

      await tx.stockEntry.create({
        data: {
          productId: item.matchedProductId,
          quantity: item.parsedQuantity ?? 1,
          unit: item.matchedProduct?.defaultUnit || "unit",
          operationType: StockOperation.PURCHASE,
          receiptItemId: item.id,
          createdBy: user.id,
          locationId: null,
        },
      });
      stockEntriesCreated += 1;

      if (item.parsedPrice && receipt.storeId) {
        await tx.priceRecord.create({
          data: {
            productId: item.matchedProductId,
            storeId: receipt.storeId,
            price: item.parsedPrice,
            currency: "EUR",
            unit: item.matchedProduct?.defaultUnit || "unit",
            quantity: item.parsedQuantity ?? 1,
            receiptId: receipt.id,
          },
        });
        priceRecordsCreated += 1;
      }
    }

    return { stockEntriesCreated, priceRecordsCreated };
  });

  return { success: true, ...applied };
}),
```

Also update the procedure docblock: after "in one transaction", append "— which
this docstring claimed for months before it was true; the 2026-08-29 review is
what made it true".

- [ ] **Step 4: Run to verify both pass, then break it deliberately**

Run: `bun test src/__tests__/integration/receipt.router.test.ts`
Expected: PASS.
Then temporarily change `$transaction(async (tx) => {...})` to run against
`ctx.db` directly (no tx) and re-run: the rollback test must go red. Restore.

- [ ] **Step 5: Gate and commit**

Run: `bun run verify:ci`

```bash
git add src/server/trpc/routers/receipt.ts src/__tests__/integration/receipt.router.test.ts
git commit -m "fix(receipts): applyReceipt is the transaction its docstring claimed

The docblock said 'in one transaction'; the body was sequential unwrapped
writes on the global client — two concurrent applies both passed the
CONFIRMED check and double-booked every line, and a crash mid-loop left
partial stock behind a receipt still marked CONFIRMED, where the natural
retry double-booked the rest. The status flip is now an atomic claim
(updateMany filtered on CONFIRMED) inside the transaction, same shape as
withReplay's claim-row-as-lock; the lines are read after the claim. Both
failure modes are pinned: a concurrency test (deterministic — the loser of
the claim refuses regardless of interleaving) and an injected-failure
rollback test, expressible only since the router reads ctx.db."
```

---

### Task 5: Review decisions become a discriminated union; the CREATE injection closes; review has edges (D6, D7)

**Files:**
- Modify: `src/lib/validations/receipt.ts` (`receiptItemMatchSchema`)
- Modify: `src/server/trpc/routers/receipt.ts` (`confirmItem`, `confirmAll`, `assertOwnProduct`)
- Modify: `src/app/(dashboard)/receipts/[id]/review/page.tsx:131-137, 233-240`
- Test: `src/__tests__/integration/receipt.router.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3 (lookup shape, `ctx.db`, helper signatures).
- Produces: shared schema the router now actually imports:

```ts
export const receiptItemMatchSchema = z.discriminatedUnion("action", [
  z.object({
    receiptItemId: z.string(),
    action: z.literal("MATCH"),
    productId: z.string().min(1),
  }),
  z.object({
    receiptItemId: z.string(),
    action: z.literal("CREATE"),
    customName: z.string().trim().min(1),
  }),
  z.object({
    receiptItemId: z.string(),
    action: z.literal("SKIP"),
  }),
]);
```

  `assertOwnProduct(db, productId: string, householdId)` — productId now
  **required**; the `if (!productId) return` escape hatch is deleted (it was the
  injection's accomplice). `confirmItem` input is `receiptItemMatchSchema`
  itself; `confirmAll` input is `z.object({ receiptId: z.string(), items: z.array(receiptItemMatchSchema) })`.

- [ ] **Step 1: Write the failing tests**

```ts
it("CREATE cannot smuggle a foreign productId (the SEC-1 shape)", async () => {
  // otherProduct belongs to the second household fixture.
  const { itemId } = await makeReviewReceipt(); // NEEDS_REVIEW, one PENDING line
  await expectCode(
    () =>
      caller.receipt.confirmItem({
        receiptItemId: itemId,
        action: "CREATE",
        // A discriminated union has no productId field on CREATE: this input
        // must be refused at validation, never read.
        productId: otherHouseholdProductId,
      } as never),
    "BAD_REQUEST",
  );
  const line = await prisma.receiptItem.findUnique({ where: { id: itemId } });
  expect(line?.matchedProductId).toBeNull();
});

it("MATCH without a productId is refused, not silently half-confirmed", async () => {
  const { itemId } = await makeReviewReceipt();
  await expectCode(
    () =>
      caller.receipt.confirmItem({ receiptItemId: itemId, action: "MATCH" } as never),
    "BAD_REQUEST",
  );
});

it("an APPLIED receipt is closed for review, so it cannot be re-applied", async () => {
  const receiptId = await makeConfirmedReceipt();
  await caller.receipt.applyReceipt({ receiptId });

  const item = await prisma.receiptItem.findFirst({ where: { receiptId } });
  await expectCode(
    () =>
      caller.receipt.confirmItem({
        receiptItemId: item!.id,
        action: "SKIP",
      }),
    "BAD_REQUEST",
  );
  await expectCode(
    () =>
      caller.receipt.confirmAll({
        receiptId,
        items: [{ receiptItemId: item!.id, action: "SKIP" }],
      }),
    "BAD_REQUEST",
  );

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  expect(receipt?.status).toBe("APPLIED"); // confirmAll did not drag it back
});
```

(`as never` because the TypeScript input type will — correctly — refuse these
shapes once the schema lands; the runtime test proves the server refuses a
caller that bypasses TypeScript.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/__tests__/integration/receipt.router.test.ts -t "CREATE cannot smuggle"`
Expected: FAIL — today the foreign id is written into `matchedProductId`.
(The APPLIED-edge test also fails: confirmAll flips it back to CONFIRMED.)

- [ ] **Step 3: Tighten the shared schema** (code in Interfaces above). Update
the `ReceiptItemMatchInput` inferred type export — it stays, now a union. Check
`receiptConfirmSchema` still composes; leave it otherwise untouched.

- [ ] **Step 4: Rewrite `confirmItem` and `confirmAll` on the shared schema**

`confirmItem` (imports `receiptItemMatchSchema` from `@/lib/validations/receipt`):

```ts
confirmItem: writeProcedure
  .input(receiptItemMatchSchema)
  .mutation(async ({ ctx, input }) => {
    const item = await ctx.db.receiptItem.findFirst({
      where: { id: input.receiptItemId, receipt: { householdId: ctx.householdId } },
      include: { receipt: true },
    });

    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Receipt item not found" });
    }

    // The review edges: a line may be settled while the receipt is under
    // review, and re-settled while it is CONFIRMED but not yet applied —
    // going back is part of reviewing. APPLIED is the point of no return;
    // the earlier states have no lines to settle.
    if (
      item.receipt.status !== ReceiptStatus.NEEDS_REVIEW &&
      item.receipt.status !== ReceiptStatus.CONFIRMED
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Receipt is not open for review",
      });
    }

    let productId: string | null = null;
    if (input.action === "MATCH") {
      await assertOwnProduct(ctx.db, input.productId, ctx.householdId);
      productId = input.productId;
    }
    if (input.action === "CREATE") {
      const newProduct = await ctx.db.product.create({
        data: {
          name: input.customName,
          householdId: ctx.householdId,
          defaultUnit: "unit",
        },
      });
      productId = newProduct.id;
    }

    await ctx.db.receiptItem.update({
      where: { id: input.receiptItemId },
      data: {
        matchedProductId: productId,
        matchStatus:
          input.action === "SKIP"
            ? MatchStatus.SKIPPED
            : input.action === "CREATE"
              ? MatchStatus.USER_CREATED
              : MatchStatus.USER_CONFIRMED,
        matchConfidence: input.action === "MATCH" ? 1.0 : null,
      },
    });

    return { success: true };
  }),
```

`confirmAll`: same edge guard after its (Task 2-shaped) receipt lookup; keep the
one-query line-ownership check (`:541-557`) as is; replace the per-item loop
body with the same `action`-narrowed logic as `confirmItem` (MATCH →
`assertOwnProduct` then use `input.productId`; CREATE → create from
`customName`; SKIP → null), and keep the final status write to CONFIRMED —
which the edge guard now makes safe, because an APPLIED receipt can no longer
reach it.

- [ ] **Step 5: Fix the two client call sites**

`review/page.tsx:131-137`:

```ts
const handleConfirmAll = (): void => {
  const itemsToConfirm = receipt.items.map((item) =>
    item.matchedProductId
      ? {
          receiptItemId: item.id,
          action: "MATCH" as const,
          productId: item.matchedProductId,
        }
      : { receiptItemId: item.id, action: "SKIP" as const },
  );

  confirmAllMutation.mutate({ receiptId, items: itemsToConfirm });
};
```

`review/page.tsx:233-240` (the ReviewCard callback — construct per action so the
union type-checks; the guards mirror what ReviewCard already ensures):

```ts
onConfirm={(action, productId, customName) => {
  if (action === "MATCH" && productId) {
    confirmItemMutation.mutate({ receiptItemId: item.id, action, productId });
  } else if (action === "CREATE" && customName) {
    confirmItemMutation.mutate({ receiptItemId: item.id, action, customName });
  } else if (action === "SKIP") {
    confirmItemMutation.mutate({ receiptItemId: item.id, action });
  }
}}
```

- [ ] **Step 6: Run tests, typecheck, then the browser suite**

Run: `bun run typecheck && bun test src/__tests__/integration/receipt.router.test.ts`
Expected: PASS, including Step 1's three tests.
Run: `bunx playwright test` (the review screen changed — the receipt journey specs must stay green).

- [ ] **Step 7: Break it deliberately** — comment out the `assertOwnProduct`
call in `confirmItem`, run the smuggle test… it must still pass (the union
already strips `productId` from CREATE), then also change the union's MATCH
branch `productId` to `.optional()` and confirm the MATCH-without-product test
goes red. Restore both. This proves the schema, not the handler, is the wall.

- [ ] **Step 8: Gate and commit**

Run: `bun run verify:ci`

```bash
git add src/lib/validations/receipt.ts src/server/trpc/routers/receipt.ts "src/app/(dashboard)/receipts/[id]/review/page.tsx" src/__tests__/integration/receipt.router.test.ts
git commit -m "fix(receipts): a review decision is a discriminated union, and review has edges

Two defects, one cause: the flat {action, productId?, customName?} shape.
CREATE with a foreign productId and no customName skipped both the ownership
check (MATCH-only) and the create branch (customName-guarded), writing the
unchecked foreign id into matchedProductId — SEC-1's shape, booking stock
and prices against another household's product on apply. And confirmAll
accepted a receipt in any state, so an APPLIED receipt could be dragged back
to CONFIRMED and re-applied for double stock. The shared schema in
lib/validations — which the router had inlined a loose copy of instead of
importing — is now a discriminated union (CREATE has no productId field to
smuggle; MATCH requires one), and both confirm procedures refuse any status
outside NEEDS_REVIEW/CONFIRMED. assertOwnProduct loses its if-absent-return
escape hatch, which was the accomplice."
```

---

### Task 6: The dead pipeline procedures go; re-parsing becomes idempotent (D8)

**Files:**
- Modify: `src/server/trpc/routers/receipt.ts` (delete `parseReceipt:272-313`, `matchItems:315-354`; update the router header docblock `:21-42`)
- Modify: `src/server/services/receiptParser.ts` (`saveParsedItems`)
- Modify: `src/__tests__/unit/capabilities.test.ts:107-108` (remove the two matrix rows)
- Modify: `src/__tests__/integration/capabilities.refusals.test.ts` (remove the `"refuses a kitchen account the pipeline steps"` test, `:570-580`)
- Modify: `src/__tests__/integration/receipt.router.test.ts` (delete the parseReceipt/matchItems procedure tests, `:956-998` region)
- Modify: `src/__tests__/integration/ROUTER_TEST_COVERAGE.md` (remove their rows if listed)
- Test: `src/__tests__/integration/receiptParser.comprehensive.test.ts` (new idempotency test)

**Why deletion, not guarding:** No client calls either procedure — the pipeline
runs through `processReceiptAsync` after upload. A public write surface nothing
uses is attack surface plus a false claim in the state-machine header. The
capability (re-running parse/match) survives inside `processReceiptAsync`;
re-exposing it later is a deliberate feature with a UI, not a leftover.

- [ ] **Step 1: Write the failing idempotency test**

In `receiptParser.comprehensive.test.ts`, following its existing setup:

```ts
it("saveParsedItems replaces the lines, so running twice is running once", async () => {
  const receiptId = await makeProcessedReceipt(); // fixture with rawOcrText
  const parsed = parseReceiptText(SAMPLE_RECEIPT_TEXT);

  await saveParsedItems(receiptId, parsed);
  await saveParsedItems(receiptId, parsed);

  const count = await prisma.receiptItem.count({ where: { receiptId } });
  expect(count).toBe(parsed.items.length); // not doubled
});
```

Run: `bun test src/__tests__/integration/receiptParser.comprehensive.test.ts -t "replaces the lines"`
Expected: FAIL — count is doubled today.

- [ ] **Step 2: Make `saveParsedItems` replace-not-append**

In `receiptParser.ts`, wrap its writes so existing lines go first, atomically
(adapt to the function's current body — it creates items and updates the
receipt's store/status):

```ts
await prisma.$transaction(async (tx) => {
  // Replace, never append: this ran once per upload until the 2026-08-29
  // review asked what a second run does — it doubled every line, and a
  // doubled line double-books stock on apply.
  await tx.receiptItem.deleteMany({ where: { receiptId } });
  // ...existing item-creation and receipt-update writes, on `tx`...
});
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Delete the two procedures and their references**

Remove `parseReceipt` and `matchItems` from the router; remove the matrix rows
in `capabilities.test.ts:107-108`; remove the kitchen-refusal test that called
them; delete their FORBIDDEN/NOT_FOUND tests in `receipt.router.test.ts`;
update `ROUTER_TEST_COVERAGE.md`. In the router header (`:26-28`), the sentence
"Each procedure below acts on one edge and refuses if the receipt is not on it"
is finally true — leave it, but change "the transitions" framing if any listed
procedure names the deleted two.

- [ ] **Step 4: Full gate and commit**

Run: `bun run verify:ci && bunx playwright test`
Expected: green (no client called either procedure, so the browser suite is the
proof of that claim).

```bash
git add src/server/trpc/routers/receipt.ts src/server/services/receiptParser.ts src/__tests__/unit/capabilities.test.ts src/__tests__/integration/capabilities.refusals.test.ts src/__tests__/integration/receipt.router.test.ts src/__tests__/integration/ROUTER_TEST_COVERAGE.md src/__tests__/integration/receiptParser.comprehensive.test.ts
git commit -m "fix(receipts): delete the two pipeline procedures nothing calls; a re-parse replaces

parseReceipt and matchItems were exposed write procedures with zero client
callers — the pipeline runs through processReceiptAsync — and parseReceipt
appended: every invocation doubled every line, and a doubled line
double-books stock on apply. The procedures go (a dead public write surface
is attack surface plus a false line in the state-machine header), and
saveParsedItems now deletes-then-creates in one transaction, pinned by a
run-twice test. The capability survives inside processReceiptAsync;
re-exposing it is a feature with a UI, not a leftover."
```

---

### Task 7: The remaining six routers take the database from the context (D4, rest)

**Files:**
- Modify: `src/server/trpc/routers/auth.ts`, `location.ts`, `product.ts`, `price.ts`, `household.ts`, `store.ts`

**Interfaces:**
- Consumes: nothing (independent of Tasks 2–6; Task 3 already did receipt.ts).
- Produces: no router imports `prisma` from `@/lib/prisma` except where a
  module-level helper genuinely runs outside a request (none expected in these
  six — if one is found, comment it the way Task 3 commented `processReceiptAsync`).

- [ ] **Step 1: Convert one router at a time**

For each file: change every `prisma.` inside procedure bodies to `ctx.db.`;
change module-level helper functions to take a `db: PrismaClient | Prisma.TransactionClient`
first parameter (as Task 3 did for the receipt helpers); delete the
`import { prisma } from "@/lib/prisma"` line once nothing uses it. Raw-SQL
sites (`product.ts` searchByName) use `ctx.db.$queryRaw` — the tagged-template
form is unchanged. **Do not touch** `src/lib/auth.ts` or anything outside
`src/server/trpc/routers/` — Auth.js's `authorize` runs outside tRPC and is out
of scope.

- [ ] **Step 2: Typecheck after each file, full suites after all six**

Run: `bun run typecheck` (per file), then `bun run verify:ci`
Expected: PASS — `ctx.db` defaults to the same singleton, so behavior is
identical; the integration suites (household, product, price, store, location,
auth flows) are the regression net.

- [ ] **Step 3: Prove the seam works** — pick one converted procedure with a
multi-write body (`household.create` — household + membership in one
transaction) and confirm its existing transactional test still passes; that
test is only meaningful because the resolver reads the injected client.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/auth.ts src/server/trpc/routers/location.ts src/server/trpc/routers/product.ts src/server/trpc/routers/price.ts src/server/trpc/routers/household.ts src/server/trpc/routers/store.ts
git commit -m "refactor(db): the last six routers take the database from the context

trpc.ts:24-38 states the rule and names the failure mode — a resolver
reaching for the module import is how a write escapes the transaction meant
to contain it — and seven of ten routers did exactly that. receipt.ts was
converted with its transaction work; these six close the set. Mechanical:
ctx.db defaults to the same singleton, so nothing behaves differently until
a test or a transaction injects a client, which is the point."
```

---

### Task 8: ExpiringItems speaks both languages (D12)

**Files:**
- Modify: `src/components/inventory/ExpiringItems.tsx`
- Modify: `messages/es.json`, `messages/en.json` (new `inventory.expiring` block)
- Test: `src/__tests__/components/ExpiringItems.test.tsx` (create if absent; if a
  test for this component already exists, extend it)

**Scope guard:** i18n and nothing else. The component's *shape* (hand-rolled
rows, tinted cards) is deliberately parked — the `target-floor.test.ts`
allowlist entry says "kept while that screen's shape is decided" — so do not
convert it to ItemRow here; that is a design conversation, not this task.

- [ ] **Step 1: Add the catalogue keys**

Inside the existing top-level `"inventory"` object of `messages/es.json`:

```json
"expiring": {
  "title": "Productos próximos a caducar",
  "allClear": "No hay productos caducados ni próximos a caducar",
  "expiredHeading": "Productos caducados ({count})",
  "expiringHeading": "Caducan en los próximos {days} días ({count})",
  "inLocation": "en {location}",
  "daysAgo": "{days, plural, one {Hace # día} other {Hace # días}}",
  "until": "{days, plural, =0 {Hoy} =1 {Mañana} other {En # días}}",
  "more": "Y {count} más…"
}
```

And in `messages/en.json`:

```json
"expiring": {
  "title": "Products expiring soon",
  "allClear": "Nothing has expired or is about to",
  "expiredHeading": "Expired products ({count})",
  "expiringHeading": "Expiring in the next {days} days ({count})",
  "inLocation": "in {location}",
  "daysAgo": "{days, plural, one {# day ago} other {# days ago}}",
  "until": "{days, plural, =0 {Today} =1 {Tomorrow} other {In # days}}",
  "more": "And {count} more…"
}
```

Run: `bun test src/__tests__/unit/messages.test.ts` — parity and
no-byte-identical checks must pass.

- [ ] **Step 2: Write the failing component test**

Follow the mock pattern the other tRPC-consuming component tests use
(`mock.module` on `@/lib/trpc/client`, render inside `NextIntlClientProvider`
with the English catalogue — copy the harness from an existing test such as the
inventory ones):

```tsx
it("renders in the catalogue's language, not hardcoded Spanish", async () => {
  // api.inventory.getExpiringItems / getExpiredItems mocked to return one
  // expired item (daysExpired: 3) and one expiring (daysUntilExpiry: 0).
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ExpiringItems />
    </NextIntlClientProvider>,
  );
  expect(await screen.findByText(/Expired products \(1\)/)).toBeTruthy();
  expect(screen.getByText("3 days ago")).toBeTruthy();
  expect(screen.getByText("Today")).toBeTruthy();
  expect(screen.queryByText(/Hace/)).toBeNull();
});
```

Run: `bun test src/__tests__/components/ExpiringItems.test.tsx`
Expected: FAIL — the Spanish literals render regardless of locale.

- [ ] **Step 3: Replace every literal in the component**

`const t = useTranslations("inventory.expiring");` then, mapping old → new:
- `:30` loading header and `:145-147` heading → `t("title")` / `t("expiringHeading", { days, count: expiringItems?.length ?? 0 })`
- `:63` → `t("allClear")`
- `:93-95` → `t("expiredHeading", { count: expiredItems?.length ?? 0 })`
- `:109`, `:169-171` → `t("inLocation", { location: item.location.name })`
- `:114` → `t("daysAgo", { days: item.daysExpired })`
- `:181-185` ternary → `t("until", { days: item.daysUntilExpiry })`
- `:121`, `:192` → `t("more", { count: expiredItems.length - maxItems })` (resp. expiring)

The three inline `<svg>`s: remove their `<title>` elements and add
`aria-hidden="true"` — each sits beside a heading that says the same thing in
words, so the icon is decoration; a Spanish `<title>` was the last untranslated
string and an unneeded accessible name.

- [ ] **Step 4: Run the test (PASS), then the guards**

Run: `bun test src/__tests__/components/ExpiringItems.test.tsx src/__tests__/unit/messages.test.ts src/__tests__/unit/message-usage.test.ts src/__tests__/unit/target-floor.test.ts`
Expected: all PASS (the allowlist entry is per-file and survives the edit).

- [ ] **Step 5: Gate and commit**

Run: `bun run verify:ci && bunx playwright test` (renders on `/inventory`).

```bash
git add src/components/inventory/ExpiringItems.tsx messages/es.json messages/en.json src/__tests__/components/ExpiringItems.test.tsx
git commit -m "fix(i18n): ExpiringItems was the last hardcoded-Spanish component

Live at the top of /inventory while ISSUES.md marks every I18N entry
resolved — the catalogue tests could not see it because its strings never
reached a catalogue (the I18N-5 blind spot, demonstrated). ICU plurals
replace the hand-rolled Hoy/Mañana/'Hace N días' ternaries; the decorative
SVGs lose their Spanish <title>s for aria-hidden. Shape deliberately
untouched: the target-floor allowlist parks that decision and this commit
does not pre-empt it."
```

---

### Task 9: The receipts list stops calling the upload date a purchase date (D13)

**Files:**
- Modify: `src/app/(dashboard)/receipts/page.tsx:114-118`
- Modify: `messages/es.json`, `messages/en.json` (`receipts.uploadedAt`)

- [ ] **Step 1: Add the key** — es: `"uploadedAt": "Subido"`, en:
`"uploadedAt": "Uploaded"`, inside each catalogue's `"receipts"` object.

- [ ] **Step 2: Use the date that matches the label**

Replace the first meta entry:

```tsx
// The label follows the data: purchaseDate is optional at upload, and for
// months this row showed createdAt under "Fecha de compra" — a receipt
// scanned a week late lied about when the shopping happened.
receipt.purchaseDate
  ? {
      label: t("purchaseDate"),
      value: dateFormat.format(receipt.purchaseDate),
    }
  : {
      label: t("uploadedAt"),
      value: dateFormat.format(receipt.createdAt),
    },
```

- [ ] **Step 3: Verify and commit**

Run: `bun run verify:ci && bunx playwright test`

```bash
git add "src/app/(dashboard)/receipts/page.tsx" messages/es.json messages/en.json
git commit -m "fix(receipts): the list dated every receipt by upload under a purchase-date label

purchaseDate was fetched and never read; createdAt rendered under 'Fecha de
compra'. The label now follows the data: the purchase date when the uploader
gave one, otherwise honestly 'Subido' with the upload date."
```

---

### Task 10: The design system stops depending on a feature slice (D14)

**Files:**
- Move: `src/components/offline/queue-context.ts` → `src/lib/offline/queue-context.ts` (content unchanged, including its docblock — the mock.module rationale still holds at the new path)
- Modify: every importer of `@/components/offline/queue-context` — as of `d10be8c`: `src/components/ui/snackbar.tsx:16`, `src/components/offline/WriteQueueProvider.tsx`, `src/components/offline/SyncStatus.tsx`, `src/components/offline/ReconcileDialog.tsx`, `src/components/shopping/ShoppingItem.tsx`, `src/components/session/use-end-session.ts`, plus any test that `mock.module`s the old path.

- [ ] **Step 1: Find every reference (imports AND mocks)**

Run: `grep -rln "components/offline/queue-context" src e2e`
Record the list — component tests that `mock.module("@/components/offline/queue-context", …)` must move to the new path too, or they will silently mock a module nothing imports (the inverse of the bug the docblock describes).

- [ ] **Step 2: Move and update**

```bash
git mv src/components/offline/queue-context.ts src/lib/offline/queue-context.ts
```

Change every `from "@/components/offline/queue-context"` (and every
`mock.module("@/components/offline/queue-context"`) to
`"@/lib/offline/queue-context"`. Append one line to the file's docblock:
`Lives in lib/ rather than components/offline/ because ui/ primitives (the
snackbar's undo) consume it, and a design-system primitive must not depend on a
feature slice — lib is the layer both may stand on.`

- [ ] **Step 3: Verify the inversion is gone**

Run: `grep -rn "components/offline" src/components/ui/`
Expected: no output.
Run: `bun run typecheck && bun run test:components && bun run test:unit`
Expected: PASS — a failing snackbar/SyncStatus suite here means a missed mock path.

- [ ] **Step 4: Gate and commit**

Run: `bun run verify:ci && bunx playwright test` (the snackbar undo path is
exercised by the browser suite).

```bash
git add -A src/lib/offline/queue-context.ts src/components src/__tests__
git status   # confirm ONLY the move and import-path edits are staged; unstage anything else
git commit -m "refactor(ui): the queue context moves to lib, ending ui/'s dependency on a feature slice

ui/snackbar.tsx imported useWriteQueue from components/offline — a
design-system primitive depending on a feature slice, the one layering
inversion in the codebase and a hole no rule guards. The context is the
queue-as-the-interface-sees-it seam, which is lib-shaped; the snackbar
already imports its types from lib/offline/queue. Mock paths in the
component tests moved with it, or they would have mocked a module nothing
imports — the exact failure the context's own docblock records."
```

*(Note: `git add -A <paths>` above is path-scoped to pick up the `git mv` pair —
verify with `git status` before committing, per the staging rule.)*

---

### Task 11: The comment sweep — prose inside code that describes a previous app (D10, D11)

**Files:**
- Modify: `src/server/trpc/routers/receipt.ts:103,109` and the `// F8:`/`// F11:`/`// F12:` spec-residue comments
- Modify: `src/server/trpc/throttle.ts:17`
- Modify: `src/lib/rate-limit.ts:116`
- Modify: `src/server/trpc/routers/shopping.ts:30-36`, `:281` region, `:~611`

- [ ] **Step 1: Sharp → Bun.Image (four sites)**

- `receipt.ts:103`: "a re-encode through Sharp" → "a re-encode through `Bun.Image` (`src/server/services/image.ts`)"
- `receipt.ts:109`: "a Sharp re-encode" → "a `Bun.Image` re-encode"
- `throttle.ts:17`: "re-encodes it through Sharp" → "re-encodes it through `Bun.Image`"
- `rate-limit.ts:116`: "re-encoded through Sharp" → "re-encoded through `Bun.Image`"

Run: `grep -rni "sharp" src/server src/lib --include='*.ts' | grep -v __tests__ | grep -vi "no-sharp"`
Expected: no remaining prose claims (type-only or test references excepted).

- [ ] **Step 2: Delete the generator residue** — remove the `// F8: Get receipt
processing status`-style spec-ID comment lines in `receipt.ts` (each sits
directly above a docblock that says it better) and the trailing whitespace after
`.mutation(async ({ ctx, input }) => {` lines.

- [ ] **Step 3: Reconcile the shopping docblock**

Replace `shopping.ts:30-36`'s self-contradicting paragraph with:

```ts
 * An item always references a `Product` (D103, 2026-08-22). Free text read
 * like the obvious kindness and cost more than it gave: an item naming
 * nothing the household knows cannot be priced, counted against stock,
 * matched to a receipt line, or suppressed when it is already covered. The
 * kindness moved to the add form, which creates the product inline — the
 * schema (`src/lib/validations/shopping.ts`) is where the rule is enforced,
 * and an item with neither field once reached the phone screen as a tickable
 * empty row (SHOP-1).
```

- [ ] **Step 4: Unwrap the dead conditional at `:281`**

`addShoppingItemSchema` requires `productId` (`validations/shopping.ts:39`,
`z.string().min(1)`), so `if (input.productId) { … }` is always true. Unwrap the
block, keep the ownership check unconditional, and change its lead comment from
"If productId is provided, verify it belongs to household" to "The product must
be the household's own — the store two checks up had the same rule and lacked
it once (see the router docblock)". In `getBuyList` (`:~611`), change "Null when
the item is free text or the product has no minimum" to "Null when the product
has no minimum: the screen shows a bar only where there is a notch to show it
against."

- [ ] **Step 5: Verify and commit**

Run: `bun run verify:ci`

```bash
git add src/server/trpc/routers/receipt.ts src/server/trpc/throttle.ts src/lib/rate-limit.ts src/server/trpc/routers/shopping.ts
git commit -m "docs: sweep the comments the Bun migration and D103 left describing a previous app

Four comments still routed the upload through Sharp two days after the
runtime moved to Bun.Image; shopping.ts's docblock asserted 'always a
Product' and 'free text is what a list is for' in one paragraph — two eras
merged by an edit that added without deleting — above a dead
if(input.productId) the required schema makes always-true. In a codebase
that leans on prose-as-specification, a false comment is a defect: the
2026-08-29 review's three worst findings were all prose/code disagreements."
```

---

### Task 12: The dev origin comes from the environment, not a hostname in the repo (D15)

**Files:**
- Modify: `next.config.ts` (the currently-uncommitted diff)
- Modify: `.env.example`

- [ ] **Step 1: Replace the hardcoded string**

The uncommitted tree change reads `allowedDevOrigins: "pop-os.fold-vibe.ts.net"`
— a personal Tailscale hostname, as a bare string where Next documents
`string[]`. Replace with:

```ts
// Dev-only: lets a phone or tablet on the tailnet open the dev server
// without Next refusing the cross-origin request. Env-derived because a
// developer's hostname does not belong in the repository.
...(process.env.DEV_ALLOWED_ORIGIN
  ? { allowedDevOrigins: [process.env.DEV_ALLOWED_ORIGIN] }
  : {}),
```

Also restore the two blank lines the working-tree diff removed around
`partialPrefetching`/`output` (keep the committed formatting; this commit's diff
should be the origin block and nothing cosmetic).

- [ ] **Step 2: Document it**

Add to `.env.example`, beside the other optional dev entries:

```
# Optional, dev only: an extra origin allowed to reach `bun run dev`
# (e.g. this machine's Tailscale hostname, for testing from a phone).
# DEV_ALLOWED_ORIGIN=my-machine.my-tailnet.ts.net
```

- [ ] **Step 3: Prove it still serves** — `DEV_ALLOWED_ORIGIN=localhost bun run dev`
must boot without a config validation error (port 3001 on this machine; stop it
after the ready line).

- [ ] **Step 4: Verify and commit**

Run: `bun run verify:ci` (the unit tier includes `upload-body-limit.test.ts`,
which reads this file).

```bash
git add next.config.ts .env.example
git commit -m "build: the dev origin is env-derived, not a developer's hostname in the repo

The working tree carried allowedDevOrigins: 'pop-os.fold-vibe.ts.net' — one
machine's Tailscale name, as a bare string where Next documents an array.
Committed as an optional DEV_ALLOWED_ORIGIN read, documented in
.env.example, so the convenience survives without publishing anyone's
hostname."
```

---

### Task 13: STATUS.md and ISSUES.md are re-measured, not recalled (D9)

**Files:**
- Modify: `docs/STATUS.md:476-482` (procedure count + narrative), `:515` (token count), `:533-535` ("all 59")
- Modify: `ISSUES.md` (summary table + one new resolved entry)

**Ordering:** last, so the numbers written are the numbers the finished tree
measures.

- [ ] **Step 1: Measure**

```bash
grep -cE '\.(query|mutation)\(' src/server/trpc/routers/*.ts | awk -F: '{s+=$2} END {print s}'
awk '/@theme inline/,/^\}/' src/app/globals.css | grep -c -- '--'
```

Record both numbers. (Expected: procedures = 62 after Task 6 — 64 at review
time minus the two deleted; tokens = 37, agreeing with STATUS.md's own line
`:39`. Whatever the commands print wins.)

- [ ] **Step 2: Correct STATUS.md**

- `:478`: "**59 procedures** — a count that has moved four times (44 → 45 → 55 → 59)" →
  "**<measured> procedures** — a count that has moved six times
  (44 → 45 → 55 → 59 → 64 → <measured>: it reached 64 unrecorded while this
  file said 59, which is the drift this sentence exists to prevent, and fell to
  <measured> when the two dead pipeline procedures were deleted)". Keep the
  existing clause about `capabilities.test.ts` asserting it structurally.
- `:534`: "all 59 procedures assigned" → "all <measured> procedures assigned".
- `:515`: "26 tokens under `@theme`" → "37 tokens under `@theme` — this line
  said 26 while line 39 of this same file said 37; measured by
  `awk '/@theme inline/,/^}/' src/app/globals.css | grep -c -- '--'`".

- [ ] **Step 3: File the review entry in ISSUES.md**

Add to the summary table:

```markdown
| REV-1 | 2026-08-29 review: receipt pipeline discordances (apply untransacted, review edge-less, CREATE injection, append-on-reparse) | ✅ Resolved (this plan's commits) |
```

And a short entry in the body:

```markdown
### ✅ REV-1: The receipt router's prose promised what its code did not do

**Files:** `src/server/trpc/routers/receipt.ts`, `src/lib/validations/receipt.ts`,
`src/server/services/receiptParser.ts`
**Severity:** HIGH (the CREATE injection was cross-household; the rest
double-booked stock)
**Status:** RESOLVED — the discordance-closure plan
(`docs/superpowers/plans/2026-08-29-discordance-closure.md`)

A full-codebase review found the receipt router a generation behind the
codebase's own conventions: `applyReceipt` claimed "in one transaction" over
sequential unwrapped writes; the state machine was enforced on one edge of
six, so `confirmAll` could drag APPLIED back to CONFIRMED for a double
apply; `action: "CREATE"` with a foreign `productId` and no `customName`
bypassed both the ownership check and the create branch (SEC-1's shape, a
third time); `saveParsedItems` appended, doubling lines on any re-parse; and
its lookups answered foreign ids with FORBIDDEN, confirming they exist. Each
is closed by a commit that made the prose true rather than deleting the
promise, except `parseReceipt`/`matchItems`, which were dead public surface
and are gone. The pattern worth keeping: every one of these hid in the one
router whose comments were written before the conventions were, and the
review found them by diffing prose against code — a false docblock is a
defect here, not a nuisance.
```

- [ ] **Step 4: Verify and commit**

Run: `bun run verify:local`

```bash
git add docs/STATUS.md ISSUES.md
git commit -m "docs: STATUS.md counts re-measured, and the 2026-08-29 review filed as REV-1

59 procedures had been 64 for weeks (and is 62 now the dead pair is gone);
'26 tokens' contradicted the 37 this same file measured at line 39. Both
numbers now carry the command that produced them, because a drift note is
only worth the check behind it — a lesson this file has already written
down twice."
```

---

## Out of scope (deliberately — these are correctness/UX backlog, not discordance)

Filed here so they are not lost, but each is its own decision and none belongs
in these commits: price comparison unnormalized by quantity/unit (the review's
highest-value product fix — wants its own plan), `Float` money → `Decimal`,
`adjustStock`'s missing lock, `transferStock` dropping expiry dates, unit
reconciliation across entries, expiry timezone (UTC-midnight dates), RouteState
adoption on the five hold-out routes, the three chevron-less `<details>`,
`/products/scan` + `/receipts/[id]/review` joining the a11y audit route lists,
registration email enumeration, the OFF barcode `^\d+$` constraint, and moving
build tooling to devDependencies.

## Self-review notes

- Every finding D1–D15 maps to a task (D1/D2→1, D3→2, D4→3+7, D5→4, D6→4+5,
  D7→5, D8→6, D9→13, D10/D11→11, D12→8, D13→9, D14→10, D15→12).
- Type consistency: `assertOwnProduct(db, productId, householdId)` — Task 3
  keeps `productId` optional, Task 5 tightens it to required; Task 5's code is
  the final signature and says so. `receiptItemMatchSchema` name is stable
  across Task 5's schema/router/client. `applyReceipt`'s return shape is
  unchanged, stated in Task 4's Interfaces.
- Task-order dependencies: 2 → 3 → 4 → 5 → 6 (same file, sequential); 1, 7–12
  independent; 13 last.
