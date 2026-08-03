# Stoky Smoke Journeys

Updated: 2026-03-23

These are the minimum user-visible journeys that should be proven before
closing Stoky product work.

## Canonical nouns

- product: the household item record shown under `/products`
- SKU or barcode: the machine-readable product identifier when present
- stock movement: an add, consume, adjust, or transfer event affecting quantity
- location: the storage node where stock lives
- receipt: the uploaded purchase artifact processed through OCR
- price history: the time-series record shown under `/prices/[productId]`
- shopping list: the list of items to buy, including auto-generated low-stock
  suggestions

## Journey 1. Inventory overview and stock movement

Trigger:
Open `/inventory` after at least one product and one stock entry exist.

Visible outcome:

- the inventory table renders product, category, total stock, and status
- low-stock rows are visually distinct
- expiring items are visible when present

Proof required:

- before: product exists with zero or low stock
- action: add or consume stock through the inventory flow
- after: `/inventory` reflects the new quantity and status badge

## Journey 2. Shopping list generation from low stock

Trigger:
Open `/shopping` and generate a list from low stock.

Visible outcome:

- the auto-list preview appears
- a shopping list card shows item count and progress
- auto-generated lists are visually labeled

Proof required:

- before: at least one product is below its expected threshold
- action: run the "generate from low stock" flow
- after: a shopping list exists and the low-stock product appears on it

## Journey 3. Receipt upload to review

Trigger:
Open `/receipts/upload` and upload a receipt image.

Visible outcome:

- upload state is visible
- the receipt status badge transitions through processing states
- successful processing routes to the review flow
- failed processing offers a retry path

Proof required:

- before: a valid test receipt file is available
- action: upload the file and wait for processing
- after: either the review screen opens or the failure state is explicit and recoverable

## Journey 4. Price history drill-down

Trigger:
Open `/prices` and drill into `/prices/[productId]`.

Visible outcome:

- product-level price history renders
- comparisons or trends are visible
- empty state is explicit when no prices exist

Proof required:

- before: at least one product has price records
- action: open the detail route
- after: the chart or comparison module renders product-specific data

## Closure rule

A Stoky slice is only done when it names which journey it changes and which
before/after evidence proves the new state.
