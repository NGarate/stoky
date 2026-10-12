# Deferred findings — the 2026-08-29 review and its closure

Updated: 2026-08-30

The 2026-08-29 full-codebase review produced the discordance-closure plan
([`superpowers/plans/2026-08-29-discordance-closure.md`](superpowers/plans/2026-08-29-discordance-closure.md)),
executed over 23 commits (`ba34c07`–`712b14c`, plus this file). Every finding
rated Critical or Important was fixed and re-reviewed; `ISSUES.md` REV-1 records
the defects. **This file is what was found and deliberately *not* fixed** — each
item with why it was deferred and what would close it.

Rules for this file, in the spirit of §10's: an item leaves by being done, by
being promoted to an `ISSUES.md` entry when it becomes real work, or by being
deliberately dropped with the drop written here. Nothing leaves by being
forgotten. None of these items is a green-gate blocker today; every suite passed
with all of them in place (2026-08-30: verify:ci clean, browser suite 150/150).

---

## Receipt pipeline — belt-and-braces

1. ~~**The per-line confirmItem-vs-apply window is open, on purpose.**
   `applyReceipt` reads the lines inside its transaction after the status claim,
   but nothing locks the `ReceiptItem` rows — a `confirmItem` racing an apply on
   an individual line can commit between the read and the entry writes, so the
   entry records the pre-edit line. Stated in `applyReceipt`'s own comment and in
   REV-1. Closing it needs `confirmItem` to re-check status inside its own
   transaction — a design decision, not a patch. The status edge (no double
   apply) holds regardless.~~ **Done 2026-08-31 — the decision was taken.**
   `confirmItem` re-checks the status under `SELECT … FOR UPDATE` on the
   receipt row inside its own transaction (the INV-2 lock shape), so the race
   serialises whichever way it goes: the settlement commits before the apply's
   claim and is read by it, or blocks on it and refuses on APPLIED. Pinned by
   a forced-interleaving test — the confirming client pauses on its stale
   read while a healthy caller applies — verified red twice without the lock.
2. ~~**`confirmAll`'s per-line updates are not in a transaction.** The final
   status write is a claim (refuses a receipt that left the review states), so
   the double-apply edge holds — but a crash or race mid-loop can leave lines
   partially settled with the status unmoved. Honest in the code comment
   (`receipt.ts`, above the claim). Close by wrapping the loop and the claim in
   one transaction if partial settlement ever bites.~~ **Done 2026-08-31** —
   the loop and the claim are one transaction, and a claim refusal now rolls
   the settlements back too. Pinned by "settles nothing when a line update
   fails mid-loop", verified failing first: the first line came back SKIPPED
   under the untransacted code.
3. ~~**`applyReceipt`'s claim filters on `id` + `status` but not `householdId`.**
   The id comes from a household-scoped `findFirst` in the same resolver, so
   this is belt-and-braces only; adding `householdId` to the `updateMany` where
   would make the write self-scoping like the rest of the router. One line.~~
   **Done 2026-08-31**, and `confirmAll`'s claim — the same shape, which this
   entry did not name — got the same filter in the same commit. No test can
   reach the difference (the ids are household-scoped upstream), so none was
   written; the tenant-scope suite still passes both ways, which is the point
   of belt-and-braces.
4. ~~**A long receipt's apply holds the row lock for the whole loop.** The loser
   of two concurrent applies blocks for the winner's duration; under load and
   Prisma's 5s interactive-transaction default, a double-tap could surface as
   P2028 → INTERNAL_SERVER_ERROR instead of the clean BAD_REQUEST the tests
   pin. Never a double-book — the failure mode is an error. `createMany` per
   model would shrink both the winner's duration and the loser's wait.~~
   **Done 2026-08-31** — one `createMany` per model, same rows, same truthy
   price rule (a parsed price of zero still records nothing). The rollback
   injection moved to `createMany` with it and still proves the rollback.
5. ~~**The rollback test asserts `toBeDefined`, not the injected message.** Any
   earlier refusal would leave zero entries and green the assertions without the
   transaction ever opening. Latent, not live — the fixtures preclude it — and
   the retry-succeeds assertion already proves the rollback. Close with
   `toContain("price write failed")`.~~ **Done 2026-08-31.** Proven live by
   the exact scenario the entry described: with the seed status moved to
   NEEDS_REVIEW the old assertion stayed satisfied on the early refusal and
   the new one went red on the message.
6. **`clientThatCannotWritePrices` is duplicated** in
   `receipt.router.test.ts` and `inventory.purchase-atomicity.test.ts`.
   Extract to `src/__tests__/utils/` when a third injection site appears —
   not before. (No longer verbatim since item 4: the receipt copy hooks
   `createMany`, the statement `applyReceipt` now issues, while the atomicity
   copy still hooks the `create` that `addStock` issues.)
7. ~~**`receiptItemId` accepts the empty string** in the review-decision union
   (`validations/receipt.ts`). It falls through to the household-scoped lookup
   and NOT_FOUND, so it is harmless; `.min(1)` would match the treatment
   `productId` received.~~ **Done 2026-08-31.** `.min(1)` on all three
   branches, pinned by `unit/receipt.validation.test.ts` — verified red with
   the constraint reverted.
8. ~~**The review page's `onConfirm` else-if chain silently swallows an
   impossible combination** (MATCH without a product, CREATE without a name).
   `ReviewCard`'s own guards make the branches unreachable today; the silence is
   the failure mode if those guards ever move. A dev-only throw in the final
   else would convert silence to noise.~~ **Done 2026-08-31** — the final else
   throws outside production, naming the action. No test: the branch is
   unreachable by construction, which is the point of the guard.

## Meta-test hardening

9. ~~**`withoutComments()` in `tenant-scoped-ids.test.ts` does not handle `//` or
   `/*` inside string literals.** A URL in an error message would have its tail
   stripped and could swallow following code from the scan. No such literal
   exists in the routers today; documented in the helper's own docblock.~~
   **Done 2026-08-31**, together with 10–12 — one seam. The helper moved to
   `src/__tests__/utils/without-comments.ts` as a string-tracking scanner
   with its own unit tests (4 of 8 go red against the old regexes); its one
   remaining limit — regex literals — is stated in its docblock.
10. ~~**The replayable scan matches `withReplay(` anywhere — including a
    comment.** The inverse fragility of the one it fixed: a comment spelling the
    call syntax would falsely count as a use and break the exact-list assertion.
    The routers' convention (name it indirectly in prose) avoids this; a
    comment-stripping pass like item 9's helper would close it properly.~~
    **Done 2026-08-31.** Both of `replayable.test.ts`'s scans strip comments
    first; proven by planting `// … withReplay(ctx, {` in `price.ts` and
    watching the exact-list assertion stay green.
11. ~~**`replayable.test.ts` (~line 140) quotes the old `receipt.ts` sentence
    verbatim** ("greps the routers for that helper's name") — the receipt.ts
    side was reworded at `712b14c` and the quoting side was not. Cosmetic; the
    assertion logic is unaffected. One-line reword next time someone is in the
    file.~~ **Done 2026-08-31** — the comment was rewritten for the stripped
    scan and no longer quotes anything.
12. ~~**`tenant-scoped-ids.test.ts`'s docstring says "every NOT_FOUND block …
    carries that phrase"** — slightly overbroad; `confirmAll`'s per-line block
    carries a different comment. Illustrative prose in a test file.~~
    **Done 2026-08-31** — now "most of", naming the exception.

## Stale prose and dead code, found in passing

13. ~~**`getBuyList` still defends against a null product** (`product?.name`,
    `product?.minStock`, a `product ? … : null` branch) though D103 made
    `productId` required with an FK — the branches are dead. Removing them is a
    behavior-neutral cleanup that wants its own small commit.~~ **Done
    2026-08-31**, with 14 — the dead branches and the docblocks were one
    read of the same function. `stock` and `unit` narrowed from nullable to
    always-present in the return type, which is the truth D103 created.
14. ~~**A stacked pair of docblocks sits above `getBuyList`** — which block
    belongs to what needs an actual read, not a hotfix.~~ **Done 2026-08-31.**
    They were two drafts of the same explanation, one predating the flat-list
    decision's wording; merged into one that keeps each's unique half (§3's
    question, the null-minStock notch).
15. ~~**`store.ts`'s delete docblock claims "the row is read first now, so the
    two are different answers"** while "not yours" and "not there" produce the
    identical NOT_FOUND. Pre-existing (not introduced by the closure work), and
    the same prose/code discordance class REV-1 chased — the next sweep's first
    stop.~~ **Done 2026-08-31.** The docblock now says what the read-first is
    actually for (the reference counting speaking before the foreign key) and
    that the uniform NOT_FOUND is the id-existence rule, not an oversight.
16. ~~**Dead exports in `validations/receipt.ts`:** `receiptConfirmSchema` (still
    carrying `applyToInventory` from an older design), `ReceiptConfirmInput`
    and `ReceiptItemMatchInput` have zero importers. Delete or re-point when the
    receipt validations are next touched.~~ **Done 2026-08-31**, and the dead
    set was wider than this entry recorded: `receiptStatusSchema`,
    `receiptUploadSchema` (which lacked the upload's actual `fileBase64` and
    `mimeType` fields — dead *and* wrong), `receiptQuerySchema`,
    `ReceiptUploadInput` and `ReceiptQueryInput` also had zero importers and
    went too. What remains is exactly what is imported: the two size
    constants, the type list, and `receiptItemMatchSchema`.

## Cosmetic and observations

17. **`inventory.expiring.expiringHeading` repeats `{days}` in each ICU plural
    branch** — ICU MessageFormat requires it; a wording change must be made in
    both branches, in both languages. Maintenance note, not a defect.
18. **A pre-existing unused-variable lint warning in `security-log.test.ts`**
    is the one warning the gates tolerate; two implementers tripped over it as
    noise.
19. **`processReceiptAsync` prints P2025/ENOENT noise in an OCR-failure test
    path** — pre-existing log noise in the suites, not a failure.
20. ~~**`ExpiringItems`' shape is still the pre-redesign one** — hand-rolled
    rows, tinted cards, a restated `min-h-[48px]` — parked by the
    `target-floor.test.ts` allowlist "while that screen's shape is decided". The
    closure work fixed its i18n only, deliberately. The shape is a design
    conversation (`CLAUDE.md`: a screen that needs a different arrangement needs
    a conversation, not a fourth hand-written `<li>`).~~ **Done 2026-09-01.** The
    conversation happened (D118): follow the design system, and no page of its
    own — expiry is already shown on the pages that need it. Rewritten on
    `ItemRow` + `Badge`, the same grammar the dashboard's expiry section uses:
    each item is a compact plain row with a linked title, a tone-carrying badge
    (danger expired / danger expiring-soon / warn expiring), and a
    quantity + location meta list. The tinted cards, the SVG state icons and the
    restated floor are gone, and the `target-floor.test.ts` allowlist entry with
    them. Verified in the browser on `/inventory`; `/inventory` stays AAA.

## Owner decisions — deferred to a person, not to a later commit

21. ~~**The Tailscale hostname and tailnet IPs stay committed in
    `next.config.ts`.** They predate the review, carry a reasoned comment, and
    were kept as a deliberate owner decision the closure work declined to
    overturn. The review's original position was that a developer's hostname
    does not belong in a repository; the new `DEV_ALLOWED_ORIGIN` env hook makes
    removing them cheap if the owner agrees.~~ **Done 2026-08-31 — the owner
    agreed.** The four entries moved to `DEV_ALLOWED_ORIGIN`, which now takes
    a comma-separated list; `.env.example` documents the shape, and the
    rationale (camera API, `tailscale serve` as the HTTPS door) stayed in the
    config comment where the next tailnet user will look.
22. ~~**Cross-household receipt probes no longer appear in the security log.**
    The router now answers NOT_FOUND (uniform with every other router, and the
    id-existence leak is closed), and `securityEvents` deliberately does not log
    NOT_FOUND. If probe visibility is ever wanted, log scoped-lookup misses at
    the middleware — do not re-split the refusal codes.~~ **Dropped 2026-08-31,
    by the owner:** uniform refusals beat probe telemetry for a self-hosted
    household deployment, so invisibility is the decision, not a gap. The
    reversal path stands as written — middleware-level logging of scoped-lookup
    misses, never a re-split of the refusal codes. **Reversed 2026-10-12** by
    the security hardening review (ASVS V7.2.2): `householdProcedure` now logs
    every household-scoped NOT_FOUND as `access.denied` with `reason:
    "not-found"`, taking exactly that path — the refusal codes stay uniform,
    and the line cannot tell a foreign id from a missing one. `SECURITY.md`
    "Refusals are recorded" has the details.
