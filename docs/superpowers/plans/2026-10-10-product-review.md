# Product review: missing features, ease of use, and Grocy — 2026-10-10

Status: **input for the owner, not a decision.** `REDESIGN_PLAN.md` owns what
comes next. Nothing here is scheduled until it is moved there.

How this was produced: three read-only passes over the code, by Haiku
subagents, covering features, UX journeys and a Grocy comparison, followed by a
spot-check of the claims this document repeats. **✔** marks a claim re-read in
the code while writing this. Everything else is from the static pass and should
be re-read before it is acted on. Nothing was run in a browser for this review.
Two claims from the passes were checked and **dropped as wrong**:

- *"Consumption ignores best-before."* Moves already allocate
  soonest-expiry-first (`allocateFefo`, `src/lib/inventory/batches.ts`), and
  leaving consumption unattributed is deliberate: "Expiry order is never
  evidence of what was used" (same file).
- *"The invite form silently does nothing on a short password."* The input
  carries `minLength={8}` and the form is not `noValidate`, so the browser
  blocks the submit and says why.

---

## 1. Promises the interface makes that the code does not keep

These are the cheapest and most urgent, because the product is currently
telling people something untrue.

| # | The promise | Why it is false | Fix |
|---|---|---|---|
| P1 ✔ | "podrás cambiarle el nombre más adelante" (`household.noHouseholdBody`) | `household.ts` has no rename procedure | Add `household.rename` (OWNER/ADMIN), or drop the clause |
| P2 ✔ | "La persona podrá cambiarla más adelante" (`household.addPasswordHint`) | No change-password procedure or page exists, and no admin reset either | Add change-own-password in Settings. Until then, reword. *Done 2026-10-12: `auth.changePassword`, on `/settings`; no admin reset yet* |
| P3 | `products.detail.deleteBlockedHistory` says the product is "archivado" | Nothing in the UI shows an archived state | Reword, or build the state |
| P4 | `/settings` carries strings for notifications, household and profile | `settings/page.tsx:36-41` says itself that no procedure backs them | Remove until built |

## 2. Ease of use — the top friction, ranked

| # | Friction | Evidence | Fix | Effort |
|---|---|---|---|---|
| U1 ✔ | From a product's page, "Añadir stock" makes you **pick the product again** | `products/[id]/page.tsx:512` links `/inventory/add` with no id. `inventory/add` and `inventory/consume` never read search params. `products.detail.actionsHint` admits it | `?productId=` on add/consume, preselected. The same from the "product created" dialog | S |
| U2 ✔ | `/products` **cannot be searched and stops at 100** | `products/page.tsx:80` `limit: 100`; `:117` only reports truncation | The inventory's search, plus "Cargar más" on `nextCursor` | M |
| U3 | An **unknown barcode takes ~9 steps** to become stock | `products/scan/page.tsx:122` → create → dialog → `/inventory/add` → pick again | Offer "Añadir stock ahora" carrying the new id (falls out of U1) | S |
| U4 | **Scanning in the shop does not tick the list item** | `scan/page.tsx:114` goes to the product page even with `?from=shopping` | With `from=shopping`, match open list items and offer "Marcar como comprado" with undo | M |
| U5 ✔ | **Every auto-matched receipt line needs its own tap** | `receipt.confirmAll` exists; the only call is the finish handler (`review/page.tsx:154`) | "Confirmar todas las coincidencias automáticas" for `AUTO_MATCHED` only | M |
| U6 | **Applying a receipt is unconfirmed and irreversible** | `review/page.tsx` "Añadir al inventario"; no revert procedure | A confirmation that states counts. A revert is a larger, separate change | S |
| U7 | A KITCHEN account sees write buttons it cannot use, and the refusal reads "Revisa los datos" | `inventory/page.tsx`, `products/page.tsx` have no role check; FORBIDDEN maps to `errorGeneric` | Hide by role, per the capability matrix (`REDESIGN_PLAN.md` §5.2), plus a FORBIDDEN message | S |
| U8 | Add/consume end in a **blocking dialog**, while the stepper and kitchen use undo | `inventory/add/page.tsx` success dialog | Snackbar with undo, the pattern used elsewhere | M |
| U9 | **"unit" shows in English** in the Spanish unit field | `products/new/page.tsx:96,243`; `DESIGN_AUDIT.md` §10 lists it open | Display through the quantity formatter and keep the stored token | S |
| U10 | **One concept, several names** — Compra / Lista de la compra / Listas de la compra; Queda poco / Se está acabando / Por reponer | `messages/es.json` navigation and shopping keys | A glossary in `messages/`, then align | M |
| U11 | The picker's "crea antes el producto" has **no link** to create it | `inventory.picker.noProducts`; `ProductPicker.tsx` | Link to `/products/new?name=<search>` | S |
| U12 | **Deleting a list** has no undo, while removing a row has one | `shopping.deleteConfirmBody` "No se puede deshacer" | The 10-second undo the rest use | S |
| U13 | **Kitchen dead end**: an unconfirmed quantity disables "He usado 1" and says nothing about who can fix it | `kitchen/page.tsx` ~313–321 | Say who can confirm it, as the offline reconcile copy already does | S |

What already works well: kitchen "He usado 1" (one tap with undo), the
offline queue's visible state, field error summaries with focus, specific
copy for an unreadable receipt photo, and full es/en catalogue parity (913
keys).

## 3. Missing features

High household value first. Items in §1 are not repeated here.

| Feature | State | Value | Effort |
|---|---|---|---|
| **Expiry digest** (in-app badge or email; push stays deferred) | Expiry is shown, never pushed. `EXPIRING_SOON_DAYS = 3` is hard-coded | High | M |
| **Password reset** without an admin | No mailer and no reset flow. On a self-hosted box, an admin reset (P2) is the realistic first step | High | S–M |
| **Recipes / meal plan with stock check** | Absent (no model) | High, and the main reason people pick Grocy or Mealie | L |
| **Mass/volume unit conversion** (g↔kg, ml↔L) | `lib/inventory/units.ts` converts counts only | Medium | M |
| **Opened date** ("abierto hace 3 días") and frozen state | No field on `StockEntry` | Medium | M |
| **Waste reason** (caducado / tirado) | `StockOperation` has no WASTE, only a free-text note | Medium, and it feeds "how much we throw away" | S–M |
| **Delete a receipt**, including its stored image | No procedure. Images are never removed | Medium, and a privacy matter | S |
| **Import / restore** to match the JSON export | Export only | Medium. `STATUS.md` names a backup story as absent | M |
| **Edit or delete a price record** | No procedure | Low–medium | S |
| **Invite link** instead of the admin typing a password | `addMember` creates the account directly | Medium | M |
| CSV export, list share or print, product merge, custom product photo, category filter, household rename | Absent | Low | S each |

## 4. Against Grocy and its neighbours

Sources: grocy.info and github.com/grocy/grocy, fetched 2026-10-10. Items not
on those pages were left unverified rather than assumed. KitchenOwl, HomeBox
and Mealie came only from secondary sources.

**Where Stoky is ahead.** These are worth protecting and stating in the
README:

- **Receipt OCR into stock and prices.** Grocy has no receipt pipeline. This is
  Stoky's differentiator.
- **Price history per store** with unit prices.
- **Offline-first shopping** with an idempotent replay queue.
- **Privacy posture**: no telemetry, Argon2id, per-account rate limits, CSP with
  nonces. One outbound call (Open Food Facts).
- **Spanish-first and EUR**, plus a touch-first kitchen screen.

**Where Grocy is ahead, and worth closing:** recipes with a stock-fulfilment
check (§3), unit conversions (§3), opened/frozen tracking (§3), a public REST
API with OpenAPI, and label/QR printing for freezers.

**Grocy features not worth copying:** chores, batteries, tasks, equipment
manuals, calendar/iCal, and user-defined fields. They are home maintenance, not
stock, and user-defined fields would undo "`prisma/schema.prisma` is the single
source of truth".

**On a public API:** a REST/OpenAPI surface would contradict nothing in
`CLAUDE.md`, but it is a second contract to keep secure. The planned iOS
client's device tokens (stoky-ios Phase 0) are the natural first consumer, so
decide the two together.

## Suggested order

1. **§1 in full**: the false promises (S each, about one day).
2. **U1 + U3, then U2**: the product → stock path, the most-repeated journey.
3. **U5 + U6**: receipts, the differentiator, should be the smoothest flow, and
   today it is the most tap-heavy.
4. **Expiry digest, waste reason, receipt deletion**: the household-value and
   privacy features.
5. Then decide between recipes and unit conversion, which are the two large
   items.
