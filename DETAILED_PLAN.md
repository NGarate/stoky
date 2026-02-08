# Stoky MVP - Comprehensive Implementation Plan

## Context

Stoky is a privacy-first, self-hosted household inventory management platform. The full technical blueprint exists in `PLAN.md` covering inventory tracking, shipping management, price intelligence, chore coordination, and adaptive UI. This MVP plan focuses on the **core value loop** (inventory + receipt scanning + price tracking + shopping lists) while deferring advanced features (chores, shipping, adaptive UI, ML, ClickHouse). The user has requested adding **purchase receipt scanning** as a core MVP feature to simplify stock and price tracking. The plan is designed with **three parallel implementation streams** to maximize development speed.

### User Preferences

- **Primary language:** Spanish (es), secondary: English (en)
- **Default currency:** EUR
- **Development mode:** AI-assisted solo (one developer using Claude Code to implement streams in rapid succession)

---

## 1. MVP Architecture (Simplified from Full Plan)

### Services (Docker Compose)

| Service | Technology | Purpose |
|---------|-----------|---------|
| `app` | Next.js 16 (App Router) | Application server, API routes, SSR |
| `db` | PostgreSQL 16 | Primary persistence (replaces ClickHouse for MVP) |
| `cache` | Valkey 8 | Sessions, query caching, rate limiting |
| `proxy` | Traefik v3 | TLS termination, routing (production only) |

**What's removed from full plan for MVP:** ClickHouse (use PostgreSQL for all analytics), PgBouncer (not needed at MVP scale), mTLS (use Docker internal networking instead).

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, TypeScript 5.x strict, Tailwind CSS 4.x + MUI 6.x, TanStack Query v5, Zustand v5, next-intl v4.x |
| **Backend** | tRPC v11, Node.js 24 LTS, Prisma 7.x |
| **Auth** | Auth.js v5, Argon2id, JWT (15min access + 7d refresh) |
| **OCR** | Tesseract.js (server-side in Worker thread) |
| **Image Processing** | Sharp (re-encoding, stripping metadata) |
| **Dev Tooling** | pnpm 10.x, oxlint, Bun test runner, Playwright |

### Project Structure (Feature Slices)

```
src/
  app/                          # Next.js App Router pages
    (auth)/                     # Auth group (login, register)
    (dashboard)/                # Authenticated layout
      inventory/                # Inventory pages
      products/                 # Product catalog pages
      receipts/                 # Receipt scanning pages
      shopping/                 # Shopping list pages
      prices/                   # Price tracking pages
      settings/                 # User/household settings
    api/trpc/[trpc]/route.ts    # tRPC HTTP handler
  server/
    trpc/
      router.ts                 # Root tRPC router
      trpc.ts                   # tRPC init (context, middleware)
      routers/
        auth.ts                 # Auth procedures
        product.ts              # Product CRUD + barcode lookup
        inventory.ts            # Stock operations
        receipt.ts              # Receipt upload, OCR, matching
        store.ts                # Store CRUD
        price.ts                # Price history queries
        shopping.ts             # Shopping list CRUD + auto-gen
        household.ts            # Household management
    services/
      ocr.ts                    # Tesseract.js OCR service
      receiptParser.ts          # Receipt text -> structured data
      productMatcher.ts         # Fuzzy matching via pg_trgm
      openFoodFacts.ts          # External product API client
  lib/
    validations/                # Shared Zod schemas
    auth/                       # Auth.js configuration
  components/
    ui/                         # Shared UI components
    barcode/                    # Barcode scanner component
    receipt/                    # Receipt review UI
    inventory/                  # Inventory-specific components
    dashboard/                  # Dashboard widgets
prisma/
  schema.prisma                 # Database schema
  migrations/                   # Migration files
  seed.ts                       # Demo data seeder
```

---

## 2. Database Schema (Core Entities)

### Key Models

```prisma
model User {
  id            String     @id @default(cuid())
  email         String     @unique
  name          String
  passwordHash  String
  locale        String     @default("es")
  household     Household? @relation(fields: [householdId], references: [id])
  householdId   String?
  role          HouseholdRole @default(MEMBER)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
}

model Household {
  id        String    @id @default(cuid())
  name      String
  members   User[]
  products  Product[]
  stores    Store[]
  receipts  Receipt[]
  locations StorageLocation[]
  shoppingLists ShoppingList[]
  createdAt DateTime  @default(now())
}

model Product {
  id            String    @id @default(cuid())
  name          String
  barcode       String?
  brand         String?
  category      String?
  imageUrl      String?
  defaultUnit   String    @default("unit")
  minStock      Float?                           // Auto-shopping threshold
  openFoodFactsData Json?                        // Cached OFF API response
  householdId   String
  household     Household @relation(fields: [householdId], references: [id])
  stockEntries  StockEntry[]
  priceRecords  PriceRecord[]
  receiptItems  ReceiptItem[]
  shoppingItems ShoppingItem[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([barcode, householdId])
  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin) // Fuzzy search
}

model StockEntry {
  id            String    @id @default(cuid())
  productId     String
  product       Product   @relation(fields: [productId], references: [id])
  quantity      Float
  unit          String
  expirationDate DateTime?
  locationId    String?
  location      StorageLocation? @relation(fields: [locationId], references: [id])
  operationType StockOperation                   // PURCHASE, CONSUME, ADJUST, TRANSFER
  note          String?
  receiptItemId String?                          // Link to receipt if from scan
  createdBy     String
  createdAt     DateTime  @default(now())
}

model StorageLocation {
  id           String    @id @default(cuid())
  name         String
  parentId     String?                           // Hierarchical: Kitchen > Fridge > Top Shelf
  parent       StorageLocation? @relation("LocationHierarchy", fields: [parentId], references: [id])
  children     StorageLocation[] @relation("LocationHierarchy")
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  stockEntries StockEntry[]
}

model Store {
  id           String    @id @default(cuid())
  name         String
  address      String?
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  priceRecords PriceRecord[]
  receipts     Receipt[]
}

model PriceRecord {
  id          String    @id @default(cuid())
  productId   String
  product     Product   @relation(fields: [productId], references: [id])
  storeId     String
  store       Store     @relation(fields: [storeId], references: [id])
  price       Float
  currency    String    @default("EUR")
  unit        String
  quantity    Float     @default(1)
  recordedAt  DateTime  @default(now())
  receiptId   String?                            // Link to source receipt
}

model Receipt {
  id            String        @id @default(cuid())
  imagePath     String                           // UUID-based path
  status        ReceiptStatus @default(UPLOADING)
  storeId       String?
  store         Store?        @relation(fields: [storeId], references: [id])
  purchaseDate  DateTime?
  totalAmount   Float?
  rawOcrText    String?                          // Full OCR output
  items         ReceiptItem[]
  householdId   String
  household     Household     @relation(fields: [householdId], references: [id])
  uploadedBy    String
  createdAt     DateTime      @default(now())
  processedAt   DateTime?
}

model ReceiptItem {
  id              String      @id @default(cuid())
  receiptId       String
  receipt         Receipt     @relation(fields: [receiptId], references: [id])
  rawText         String                         // Original OCR text for this line
  parsedName      String?                        // Cleaned product name
  parsedPrice     Float?
  parsedQuantity  Float?
  matchedProductId String?                       // Auto or user-confirmed match
  matchedProduct  Product?    @relation(fields: [matchedProductId], references: [id])
  matchConfidence Float?                         // 0-1 confidence score
  matchStatus     MatchStatus @default(PENDING)  // PENDING, AUTO_MATCHED, USER_CONFIRMED, USER_CREATED, SKIPPED
}

model ShoppingList {
  id          String    @id @default(cuid())
  name        String
  isAutoGenerated Boolean @default(false)
  householdId String
  household   Household @relation(fields: [householdId], references: [id])
  items       ShoppingItem[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model ShoppingItem {
  id             String    @id @default(cuid())
  shoppingListId String
  shoppingList   ShoppingList @relation(fields: [shoppingListId], references: [id])
  productId      String?
  product        Product?  @relation(fields: [productId], references: [id])
  customName     String?                         // For items not in catalog
  quantity       Float     @default(1)
  unit           String?
  isChecked      Boolean   @default(false)
  checkedAt      DateTime?
}

enum ReceiptStatus {
  UPLOADING
  PROCESSING
  PARSED
  NEEDS_REVIEW
  CONFIRMED
  APPLIED
  FAILED
}

enum MatchStatus {
  PENDING
  AUTO_MATCHED
  USER_CONFIRMED
  USER_CREATED
  SKIPPED
}

enum StockOperation {
  PURCHASE
  CONSUME
  ADJUST
  TRANSFER
}

enum HouseholdRole {
  OWNER
  ADMIN
  MEMBER
}
```

**Required PostgreSQL extensions:** `pg_trgm` (fuzzy text matching), `uuid-ossp`.

---

## 3. Receipt Scanning Pipeline

### Architecture

```
[User photographs receipt]
        |
        v
[Upload to /api/trpc/receipt.upload]
  - Validate: MIME type, magic bytes, size (max 10MB)
  - Re-encode with Sharp (strip EXIF/metadata, normalize format)
  - Store as: uploads/receipts/{householdId}/{receiptId}.jpg
  - Create Receipt record (status: UPLOADING -> PROCESSING)
        |
        v
[OCR Service (server-side Tesseract.js in Worker thread)]
  - Process image -> raw text
  - Store rawOcrText on Receipt
  - Status: PROCESSING -> PARSED
        |
        v
[Receipt Parser Service]
  - Regex patterns to extract: store name, date, line items
  - Each line item: product name, quantity, price
  - Create ReceiptItem records with parsedName/parsedPrice/parsedQuantity
        |
        v
[Product Matcher Service]
  - For each ReceiptItem, query PostgreSQL pg_trgm similarity:
    SELECT id, name, similarity(name, $parsedName) AS sim
    FROM products WHERE household_id = $hid AND similarity(name, $parsedName) > 0.3
    ORDER BY sim DESC LIMIT 5
  - If top match sim > 0.7: AUTO_MATCHED (set matchedProductId, matchConfidence)
  - If matches exist but sim <= 0.7: PENDING (store top 5 candidates)
  - If no matches: PENDING (user must create or skip)
  - Status: PARSED -> NEEDS_REVIEW (if any items need review) or CONFIRMED
        |
        v
[Receipt Review UI]
  - Show each item with: OCR text, parsed name/price, match status
  - AUTO_MATCHED items: show as confirmed, allow correction
  - PENDING items: show top candidates, allow selection or "Create new product"
  - SKIPPED items: allow skip for non-product lines (tax, total, etc.)
  - User confirms -> Status: NEEDS_REVIEW -> CONFIRMED
        |
        v
[Receipt Application]
  - For each confirmed item:
    - Create StockEntry (PURCHASE operation)
    - Create/update PriceRecord
  - Status: CONFIRMED -> APPLIED
```

### Key Design Decisions

1. **Server-side OCR** (not client-side): Better accuracy (more memory), simpler error handling, re-processable
2. **Asynchronous pipeline**: User uploads and can come back later to review matches
3. **pg_trgm for matching**: Battle-tested, index-backed, handles household-scale product catalogs trivially
4. **State machine**: `ReceiptStatus` enum with strict phase progression makes workflow debuggable and resumable

---

## 4. Feature Breakdown & Effort Estimates

### Tier 0 -- Foundation (must complete before parallel work begins)

| # | Feature | Effort (days) | Description |
|---|---------|---------------|-------------|
| F1 | Project scaffolding | 2 | Next.js 16 + Prisma + tRPC + Docker Compose + CI skeleton |
| F2 | Authentication | 3 | Auth.js v5, register/login/logout, JWT, session management |
| F3 | Household management | 1 | Create household, invite members, role management |

### Tier 1 -- Core Product (parallelizable after Tier 0)

| # | Feature | Effort (days) | Dependencies |
|---|---------|---------------|--------------|
| F4 | Product catalog CRUD + search | 2 | F3 |
| F5 | Barcode scanning + Open Food Facts | 3 | F4 |
| F6 | Inventory management (stock operations) | 3 | F4 |
| F7 | Storage locations (hierarchical) | 2 | F6 |

### Tier 2 -- Core Value (parallelizable)

| # | Feature | Effort (days) | Dependencies |
|---|---------|---------------|--------------|
| F8 | Receipt image upload + OCR pipeline | 4 | F4 |
| F9 | Receipt parser (structured extraction) | 3 | F8 |
| F10 | Product matching (exact + fuzzy) | 3 | F9 |
| F11 | Receipt review UI (confirmation, creation) | 3 | F10 |
| F12 | Receipt application (stock + price updates) | 2 | F11 |
| F13 | Store management (CRUD) | 1 | F3 |
| F14 | Price history tracking | 2 | F4, F13 |
| F15 | Price comparison views | 2 | F14 |
| F16 | Shopping lists (manual CRUD) | 3 | F4 |
| F17 | Auto-generated shopping lists (from low stock) | 1 | F6, F16 |

### Tier 3 -- Polish & Experience

| # | Feature | Effort (days) | Dependencies |
|---|---------|---------------|--------------|
| F18 | Dashboard with overview widgets | 3 | F6, F14 |
| F19 | Expiration tracking + alerts | 2 | F6 |
| F20 | i18n (Spanish primary / English secondary) | 2 | F1 |
| F21 | PWA basics (manifest, SW, offline read) | 2 | F1 |
| F22 | Responsive design pass (mobile-first) | 3 | All UI features |
| F23 | Data export (CSV) | 1 | F4, F14 |
| F24 | Seed data + onboarding flow | 2 | F2, F4 |

**Total: ~50 developer-days.** With AI-assisted solo development (Claude Code implementing each stream), the 3 streams can be tackled in rapid succession within each week, effectively compressing the timeline closer to the parallel estimate (~5-6 weeks).

---

## 5. Parallelization Strategy

### Dependency Graph

```
F1 (Scaffolding)
  |
  +---> F2 (Auth) ---> F3 (Household)
                          |
            +-------------+-------------+-------------------+
            |             |             |                   |
            F4 (Products) F13 (Stores)  F16 (Shopping)     F20 (i18n)
            |  \    \                                       F21 (PWA)
            |   \    F8 (Receipt OCR)
            |    \        |
            |     \       F9 (Parser)
            |      \           |
            F5      \     F10 (Matching)    F14 (Prices)
            (Barcode)\         |                |
            |         \   F11 (Review UI)  F15 (Price Views)
            F6         \       |
            (Inventory)  F12 (Apply)
            |    |
            F7   F19 (Expiry)
            (Locations)
                 F17 (Auto Shopping)
                      |
                 F18 (Dashboard) <--- convergence point
```

### Three Parallel Streams

After F1 + F2 + F3 (shared foundation, ~1.5 weeks), work splits:

#### Stream A: Inventory Core

```text
Week 3: F4 (Products) + F5 (Barcode scanning)
Week 4: F6 (Inventory management) + F7 (Locations)
Week 5: F19 (Expiration tracking)
Week 6: F18 (Dashboard) -- convergence
```

#### Stream B: Receipt Scanning Pipeline

```text
Week 2: Prototype OCR in isolation (no DB needed yet)
Week 3: F8 (Receipt upload + OCR) -- needs F4 Product model
Week 4: F9 (Receipt parser) + F10 (Product matching)
Week 5: F11 (Receipt review UI)
Week 6: F12 (Receipt apply to inventory + prices)
```

#### Stream C: Prices, Shopping & Polish

```text
Week 2: F20 (i18n setup) + F21 (PWA manifest/SW)
Week 3: F13 (Stores) + F16 (Shopping lists)
Week 4: F14 (Price history) + F16 continued
Week 5: F15 (Price comparison) + F17 (Auto shopping)
Week 6: F22 (Responsive polish) + F23 (Export) + F24 (Onboarding)
```

### Timeline

| Week | Stream A (Inventory) | Stream B (Receipts) | Stream C (Prices/Polish) | Shared |
|------|---------------------|--------------------|-----------------------|--------|
| **1** | - | - | - | F1: Scaffolding + DB schema + Docker |
| **2** | - | OCR prototype | F20: i18n + F21: PWA | F2: Auth + F3: Household |
| **3** | F4: Products + F5: Barcode | F8: Receipt OCR pipeline | F13: Stores + F16: Shopping lists | |
| **4** | F6: Inventory + F7: Locations | F9: Parser + F10: Matcher | F14: Price history | |
| **5** | F19: Expiration alerts | F11: Receipt review UI | F15: Price comparison + F17: Auto shopping | |
| **6** | F18: Dashboard | F12: Receipt apply | F22: Responsive + F23: Export + F24: Onboarding | |
| **7** | | | | Integration testing, E2E, bug fixes, security audit |

**Critical path:** F1 -> F2 -> F3 -> F4 -> F8 -> F9 -> F10 -> F11 -> F12 (receipt scanning pipeline is longest chain).

**Risk mitigation:** Start OCR prototyping in Week 2 to validate Tesseract.js accuracy on real receipts before it blocks the chain.

---

## 6. Security Review

### Authentication (MVP)

- Auth.js v5 with credentials provider
- Argon2id: 64MB memory, 3 iterations, ~250ms target
- JWT access tokens (15min) in memory, refresh tokens (7d sliding) in `httpOnly; secure; sameSite=strict` cookies
- Refresh token rotation on each use
- Rate limiting: 5 login attempts/15min per IP, 3 registrations/hour per IP
- CSRF: double-submit cookie pattern (Auth.js handles this)

### Input Validation (Zod everywhere)

- Every tRPC procedure requires a Zod input schema
- Key rules: `barcode: z.string().regex(/^[0-9]{8,14}$/)`, `price: z.number().nonnegative().finite().max(9999999)`, `quantity: z.number().positive().finite().max(999999)`
- Schemas shared between client and server in `src/lib/validations/`
- Pagination always bounded: `limit: z.number().int().min(1).max(100)`

### Receipt Image Security

- Accept only `image/jpeg`, `image/png`, `image/webp` (validate magic bytes server-side)
- Max 10MB file size, max 5000x5000 pixels
- Re-encode with Sharp on upload (strips embedded payloads, EXIF data)
- Store in isolated Docker volume, outside web root
- Serve only through authenticated tRPC query (no direct URL access)
- UUID-based filenames (never use original filename)

### MVP Encryption Scope

- Passwords: Argon2id (one-way)
- Session tokens: httpOnly + secure + sameSite cookies
- All traffic: TLS 1.3 via Traefik
- DB connection: SSL required
- **Deferred to Phase 2:** Field-level AES-256-GCM encryption, audit hash chains, backup encryption

### HTTP Security Headers

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:;
  script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(), microphone=()
```

### Docker Network Isolation

- Only Traefik exposes ports 80/443 to host
- PostgreSQL and Valkey have **no exposed ports** (Docker internal network only)

---

## 7. Infrastructure Plan

### Development Docker Compose (`docker-compose.yml`)

- `app`: Next.js 16 dev server with volume mounts for live reload, port 3000
- `db`: PostgreSQL 16 Alpine, healthcheck, **no exposed ports** (internal only)
- `cache`: Valkey 8 Alpine, healthcheck, **no exposed ports**
- Volumes: `postgres_data`, `valkey_data`, `./uploads` for receipt images

### Production Docker Compose (`docker-compose.prod.yml`)

- Adds Traefik v3 proxy with Let's Encrypt auto-cert, HTTP->HTTPS redirect
- App served via Traefik labels (no direct port exposure)
- Multi-stage Dockerfile: deps -> development -> builder -> production (~150MB final image)
- `standalone` output mode for Next.js production build

### Database Migrations

- Prisma Migrate for schema evolution
- `prisma/migrations/` committed to git
- Initial migration includes: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- Production: `prisma migrate deploy` in container entrypoint before server start

### CI/CD (GitHub Actions)

- **quality** job (parallel): `pnpm lint` (oxlint) + `pnpm typecheck` (tsc --noEmit)
- **test** job (parallel): PostgreSQL service container + `bun test`
- **build** job (depends on quality + test): Docker multi-stage build, tag with commit SHA
- Future: Trivy vulnerability scan, Playwright E2E

### Dev Environment Quick Start

```bash
git clone <repo> && cd stoky
cp .env.example .env
pnpm install
docker compose up -d db cache
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev
```

---

## 8. Post-MVP Roadmap

### Phase 2: Enhanced Analytics & Household (Months 3-4)

- Chore management (assignment engine, scheduling, gamification)
- Field-level encryption (AES-256-GCM for prices, locations, personal data)
- Audit logging with hash chain verification
- Advanced price analytics (CPI inflation adjustment, spending trends)
- Receipt OCR improvements (store-specific templates for higher accuracy)
- Notification system (web push for expiration/low stock alerts)
- Backup automation (restic + pg_dump encrypted offsite)
- Data import (CSV/Excel, Grocy SQLite migration)

### Phase 3: Intelligence & Native (Months 5-7)

- ClickHouse integration for behavioral analytics
- Adaptive UI engine (dynamic reordering, predictive preloading)
- ML price prediction and deal detection
- Shipping/receiving with carrier API integration
- Capacitor native app (iOS/Android)
- Enhanced receipt OCR (Tesseract + local LLM pipeline for better extraction)
- Bluetooth barcode scanner support (WebHID)

### Phase 4: Platform (Months 8+)

- Plugin/webhook system for extensibility
- Kubernetes deployment option
- OpenAPI spec from tRPC routers
- PDF report generation, scheduled email reports
- mTLS for service-to-service communication
- OWASP ZAP automated security scanning in CI

### Receipt Scanning Evolution

1. **MVP:** Tesseract.js + regex parsing + pg_trgm matching (~70-80% line item extraction, ~50-60% auto-match)
2. **Phase 2:** Store-specific receipt templates (learn format from repeated scans)
3. **Phase 3:** Tesseract + local LLM pipeline for structured extraction from messy OCR output
4. **Phase 4:** Custom Tesseract training data from anonymized receipts (opt-in)

---

## 9. Key Technical Recommendations

1. **Prototype OCR early** (Week 2): Collect 10-20 real receipt photos, test Tesseract.js accuracy. This is the highest-risk component.
2. **Use PostgreSQL `pg_trgm`** for product matching -- battle-tested, index-backed, handles household-scale trivially.
3. **Receipt scanning is a state machine**: The `ReceiptStatus` enum with strict phase progression makes the async workflow predictable and resumable.
4. **Server-side OCR only for MVP**: More memory, better accuracy, simpler error handling, re-processable without re-upload.
5. **Shared Zod schemas** are the type safety foundation: define once in `src/lib/validations/`, import everywhere.
6. **Stabilize the Product model early** (Week 3): It's the integration point for all three streams.
7. **PWA and i18n are low-risk** parallel work for Weeks 1-2 while streams are blocked on scaffolding.

---

## 10. Verification Plan

### End-to-End Test Scenarios (Playwright)

1. **Registration flow**: Register -> create household -> invite member
2. **Barcode scan flow**: Open scanner -> scan barcode -> product resolved from OFF -> add to inventory
3. **Manual product flow**: Create product -> add stock -> consume stock -> verify quantity
4. **Receipt scan flow**: Upload receipt photo -> wait for OCR -> review matches -> confirm -> verify stock + price entries created
5. **Shopping list flow**: Set min stock on product -> consume below threshold -> verify auto-generated shopping list item
6. **Price history flow**: Add prices from different stores -> view comparison chart

### Manual Testing

- Test barcode scanning on multiple devices (phone, tablet) in various lighting
- Test receipt scanning with 10+ real receipts from different stores
- Verify responsive design on mobile viewports
- Verify i18n defaults to Spanish, switching to English works correctly
- Test PWA install prompt and offline read functionality

### Security Verification

- Run `pnpm lint` (oxlint) for security rules
- Verify all tRPC procedures have Zod validation
- Verify receipt upload rejects non-image files and oversized files
- Verify auth rate limiting works (5 failed logins -> blocked)
- Verify Docker services have no unnecessary exposed ports

---

## 11. Agent Delegation & Parallelization Management

### Agent Roles

Each implementation task is assigned to a specific **agent type** based on the nature of the work. When using Claude Code, you can run multiple agents in parallel by launching them as background tasks. Here are the agent assignments:

### Phase 0: Foundation (Sequential -- All agents blocked until complete)

These must be done **in order** by a single agent because each depends on the previous.

#### AGENT: Scaffolding Agent

**Scope:** F1 (Project Scaffolding)
**Type:** Bash + Write (infrastructure setup)
**Tasks:**

1. Initialize git repository
2. Run `pnpm init` and install all dependencies:
   - Next.js 16, React, TypeScript 5.x
   - Tailwind CSS 4.x, @mui/material 6.x, @emotion/react, @emotion/styled
   - @trpc/server, @trpc/client, @trpc/tanstack-react-query, @tanstack/react-query
   - @prisma/client, prisma (dev)
   - next-auth (Auth.js v5), @auth/prisma-adapter
   - zustand, zod, superjson, sharp, tesseract.js
   - next-intl
   - oxlint, @biomejs/biome (dev), playwright (dev)
3. Create `tsconfig.json` with strict mode
4. Create `prisma/schema.prisma` with full schema from Section 2
5. Create `docker-compose.yml` (dev) and `docker-compose.prod.yml`
6. Create `Dockerfile` (multi-stage)
7. Create `.env.example` with all required env vars
8. Create `.github/workflows/ci.yml`
9. Set up project structure (all directories from Section 1)
10. Create tRPC init files (`src/server/trpc/trpc.ts`, `src/server/trpc/router.ts`)
11. Create `src/app/api/trpc/[trpc]/route.ts`
12. Create base layout (`src/app/layout.tsx`) with providers
13. Run `docker compose up -d db cache` and `pnpm prisma migrate dev`
14. Verify: `pnpm dev` starts successfully, `pnpm typecheck` passes

**Output:** Working skeleton that compiles, runs, and connects to DB.

#### AGENT: Auth Agent

**Scope:** F2 (Authentication) + F3 (Household Management)
**Type:** Backend + Frontend
**Depends on:** Scaffolding Agent complete
**Tasks:**

1. Configure Auth.js v5 in `src/lib/auth/` (credentials provider, Argon2id, JWT strategy)
2. Create `src/server/trpc/routers/auth.ts` (register, login, logout, me)
3. Create `src/lib/validations/auth.ts` (Zod schemas for email, password, etc.)
4. Create `src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx`
5. Create auth middleware for protected routes
6. Create `src/server/trpc/routers/household.ts` (create, invite, manage members)
7. Create `src/app/(dashboard)/settings/page.tsx` (household management UI)
8. Create `src/app/(dashboard)/layout.tsx` (authenticated layout with nav)
9. Set up rate limiting middleware (login: 5/15min, register: 3/hr)
10. Verify: Can register, login, create household, see protected dashboard

**Output:** Working auth flow + household management + protected layout.

---

### Phase 1: Three Parallel Streams (Launch simultaneously after Phase 0)

Once Phase 0 is complete, launch ALL THREE agents in parallel:

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  STREAM A AGENT  │  │  STREAM B AGENT  │  │  STREAM C AGENT  │
│  Inventory Core  │  │  Receipt Pipeline│  │  Prices/Shopping  │
│                  │  │                  │  │                  │
│  F4: Products    │  │  F8: OCR Upload  │  │  F13: Stores     │
│  F5: Barcode     │  │  F9: Parser      │  │  F14: Prices     │
│  F6: Inventory   │  │  F10: Matcher    │  │  F15: Price Views│
│  F7: Locations   │  │  F11: Review UI  │  │  F16: Shopping   │
│  F19: Expiry     │  │  F12: Apply      │  │  F17: Auto Shop  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
         │                     │                      │
         └─────────────────────┼──────────────────────┘
                               │
                    ┌──────────────────┐
                    │  CONVERGENCE     │
                    │  F18: Dashboard  │
                    │  F22: Responsive │
                    │  F23: Export     │
                    │  F24: Onboarding │
                    └──────────────────┘
```

#### STREAM A AGENT: Inventory Core

**Scope:** F4, F5, F6, F7, F19
**Type:** Full-stack (backend services + tRPC routers + UI pages)
**Files to create/modify:**

- `src/server/trpc/routers/product.ts` -- Product CRUD, search, barcode lookup
- `src/server/trpc/routers/inventory.ts` -- Stock operations (purchase, consume, adjust, transfer)
- `src/server/services/openFoodFacts.ts` -- OFF API client with PostgreSQL caching
- `src/lib/validations/product.ts` -- Product Zod schemas
- `src/lib/validations/inventory.ts` -- Stock operation Zod schemas
- `src/components/barcode/Scanner.tsx` -- Camera barcode scanner (@thewirv/react-barcode-scanner)
- `src/app/(dashboard)/products/page.tsx` -- Product list with search
- `src/app/(dashboard)/products/[id]/page.tsx` -- Product detail
- `src/app/(dashboard)/products/new/page.tsx` -- Add product (manual + barcode)
- `src/app/(dashboard)/inventory/page.tsx` -- Stock overview with current quantities
- `src/app/(dashboard)/inventory/add/page.tsx` -- Add stock (scan or manual)
- `src/app/(dashboard)/inventory/consume/page.tsx` -- Consume stock
- `src/components/inventory/StockTable.tsx` -- Sortable/filterable stock table
- `src/components/inventory/LocationPicker.tsx` -- Hierarchical location selector
- `src/app/(dashboard)/settings/locations/page.tsx` -- Location management CRUD

**Detailed task sequence:**

1. **F4 (Products):** Create product router with CRUD + pg_trgm search. Create product list page, detail page, creation form. Include barcode field but scanner comes in F5.
2. **F5 (Barcode):** Install @thewirv/react-barcode-scanner. Create Scanner component with camera selection, torch control. Integrate with OFF API (fetch product by barcode, cache in DB). Wire into product creation flow (scan -> auto-fill form).
3. **F6 (Inventory):** Create inventory router with stock operations. Build unified transaction model (all ops are quantity adjustments with metadata). Create stock overview page showing current quantity per product (aggregated from StockEntry). Add purchase and consume flows.
4. **F7 (Locations):** Create location management UI (tree structure). Add location picker to stock operations. Show location in stock overview.
5. **F19 (Expiry):** Add expiration date field to stock entry UI. Create expiration alert logic (7d warning, 3d urgent, day-of critical). Show expiring items on inventory page.

**Verify:** Can scan barcode -> product auto-created from OFF -> add stock with location + expiration -> consume stock -> see updated quantities.

#### STREAM B AGENT: Receipt Scanning Pipeline

**Scope:** F8, F9, F10, F11, F12
**Type:** Full-stack (heavy backend services + specialized UI)
**Files to create/modify:**

- `src/server/services/ocr.ts` -- Tesseract.js Worker thread service
- `src/server/services/receiptParser.ts` -- Regex-based structured data extraction
- `src/server/services/productMatcher.ts` -- pg_trgm fuzzy matching
- `src/server/trpc/routers/receipt.ts` -- Receipt upload, status, review, confirm, apply
- `src/lib/validations/receipt.ts` -- Receipt Zod schemas
- `src/components/receipt/UploadZone.tsx` -- Drag-drop / camera capture upload
- `src/components/receipt/ReceiptStatus.tsx` -- Processing status indicator
- `src/components/receipt/ReviewCard.tsx` -- Single receipt item review card
- `src/components/receipt/MatchSelector.tsx` -- Product match selection with fuzzy results
- `src/components/receipt/CreateProductInline.tsx` -- Quick product creation from receipt
- `src/app/(dashboard)/receipts/page.tsx` -- Receipt history list
- `src/app/(dashboard)/receipts/upload/page.tsx` -- Upload new receipt
- `src/app/(dashboard)/receipts/[id]/review/page.tsx` -- Review & confirm matches

**Detailed task sequence:**

1. **F8 (OCR Pipeline):** Create `ocr.ts` service using Tesseract.js with Worker thread. Create receipt upload endpoint: validate MIME + magic bytes, re-encode with Sharp, store to `uploads/receipts/{householdId}/{receiptId}.jpg`, create Receipt DB record, trigger OCR processing. Create upload UI with drag-drop and camera capture. Show processing status.
2. **F9 (Parser):** Create `receiptParser.ts` that takes raw OCR text and extracts: store name (top of receipt), date, line items (product name, quantity, price using regex patterns for common receipt formats). Create ReceiptItem records. Handle common edge cases: multi-line items, discount lines, tax lines.
3. **F10 (Matcher):** Create `productMatcher.ts` that queries pg_trgm similarity for each parsed item. Implement thresholds: >0.7 auto-match, 0.3-0.7 show candidates, <0.3 no match. Store top 5 candidates as JSON on ReceiptItem.
4. **F11 (Review UI):** Create receipt review page showing each item as a card. AUTO_MATCHED items shown green with product details. PENDING items show candidate list with similarity scores. Allow: confirm match, pick different candidate, create new product inline, skip item. "Confirm All" button when user is done.
5. **F12 (Apply):** When receipt is confirmed, create StockEntry (PURCHASE) and PriceRecord for each confirmed item. Update Receipt status to APPLIED. Show summary of what was added.

**Verify:** Upload receipt photo -> OCR processes -> items parsed -> matches shown -> confirm -> stock entries + price records created.

#### STREAM C AGENT: Prices, Shopping & Polish

**Scope:** F13, F14, F15, F16, F17, F20, F21
**Type:** Full-stack (CRUD + charts + i18n/PWA infrastructure)
**Files to create/modify:**

- `src/server/trpc/routers/store.ts` -- Store CRUD
- `src/server/trpc/routers/price.ts` -- Price history queries, comparison
- `src/server/trpc/routers/shopping.ts` -- Shopping list CRUD, auto-generation
- `src/lib/validations/store.ts` -- Store Zod schemas
- `src/lib/validations/price.ts` -- Price Zod schemas
- `src/lib/validations/shopping.ts` -- Shopping Zod schemas
- `src/app/(dashboard)/prices/page.tsx` -- Price overview with charts
- `src/app/(dashboard)/prices/[productId]/page.tsx` -- Product price history
- `src/app/(dashboard)/shopping/page.tsx` -- Shopping lists
- `src/app/(dashboard)/shopping/[id]/page.tsx` -- Single list with checkoff
- `src/components/price/PriceChart.tsx` -- Price history chart (Recharts)
- `src/components/price/StoreComparison.tsx` -- Price comparison table
- `src/components/shopping/ShoppingItem.tsx` -- Checkable shopping item
- `messages/es.json` -- Spanish translations (PRIMARY)
- `messages/en.json` -- English translations
- `src/i18n.ts` -- next-intl configuration
- `public/manifest.json` -- PWA web app manifest
- `public/sw.js` -- Service worker for offline read

**Detailed task sequence:**

1. **F20 (i18n):** Configure next-intl with Spanish as default locale. Create `messages/es.json` and `messages/en.json` with all UI strings. Set up middleware for locale detection. All UI text from this point uses translation keys.
2. **F21 (PWA):** Create `public/manifest.json` with app name, icons, theme color. Create basic service worker for offline caching of static assets. Add `<link rel="manifest">` to layout.
3. **F13 (Stores):** Create store router (CRUD). Simple store management page in settings. Store selector component for use in receipts and manual price entry.
4. **F16 (Shopping Lists):** Create shopping list router (CRUD for lists and items). Shopping list page with create/edit/delete lists. Individual list page with checkable items. Add "Add to shopping list" button to product pages.
5. **F14 (Price History):** Create price router (record price, query history by product, by store). Wire into receipt application flow (auto-create price records). Price history page showing chart over time per product.
6. **F15 (Price Comparison):** Price comparison view: select product, see prices across stores. Table + chart showing which store has best price. "Best price" indicator on product detail page.
7. **F17 (Auto Shopping):** When stock quantity drops below `minStock`, auto-add item to designated shopping list. Run check on every CONSUME stock operation. Highlight auto-generated items differently.

**Verify:** Can manage stores, track prices over time, see price charts, create shopping lists, auto-generate shopping items from low stock, all in Spanish with English switch.

---

### Phase 2: Convergence (After all 3 streams complete)

#### AGENT: Dashboard & Polish Agent

**Scope:** F18, F22, F23, F24
**Type:** Frontend-focused (UI composition + responsive design)
**Depends on:** All three stream agents complete
**Files to create/modify:**

- `src/app/(dashboard)/page.tsx` -- Main dashboard
- `src/components/dashboard/StockOverview.tsx` -- Current stock summary widget
- `src/components/dashboard/ExpiringItems.tsx` -- Items expiring soon
- `src/components/dashboard/RecentActivity.tsx` -- Recent stock operations
- `src/components/dashboard/PriceAlerts.tsx` -- Notable price changes
- `src/components/dashboard/ShoppingListPreview.tsx` -- Active shopping list
- `prisma/seed.ts` -- Demo data with products, stock, prices, receipts
- All existing pages (responsive adjustments)

**Tasks:**

1. **F18 (Dashboard):** Build dashboard page with widget grid. Stock summary (total items, low stock count, expiring soon). Expiring items list. Recent activity feed. Price alerts. Shopping list preview. All widgets use data from streams A, B, C.
2. **F22 (Responsive):** Mobile-first pass across all pages. Ensure barcode scanner works on mobile. Receipt upload works with phone camera. Navigation adapts to mobile (bottom nav or hamburger).
3. **F23 (Export):** CSV export for products, stock, prices. Download button on relevant pages.
4. **F24 (Onboarding):** Seed data script with 30 common products, sample locations, demo stores. First-login onboarding flow: create household -> tour key features.

#### AGENT: Integration Testing Agent

**Scope:** E2E tests + security verification
**Type:** Testing (Playwright + manual checks)
**Depends on:** Dashboard & Polish Agent complete
**Tasks:**

1. Write Playwright E2E tests for all 6 scenarios from Section 10
2. Run full test suite (`bun test` + Playwright)
3. Security verification: test rate limiting, file upload validation, Zod validation
4. Verify Docker network isolation (db/cache not exposed)
5. Run `pnpm lint` + `pnpm typecheck` clean
6. Build production Docker image and verify it starts

---

### Agent Execution Playbook

**How to orchestrate with Claude Code:**

```text
WEEK 1-2: Sequential
  1. Start Scaffolding Agent
  2. When done, start Auth Agent
  3. When done, proceed to parallel phase

WEEK 3-5: Parallel (launch all 3 simultaneously)
  4a. Launch Stream A Agent (Inventory Core)      ─┐
  4b. Launch Stream B Agent (Receipt Pipeline)     ├─ Run in parallel
  4c. Launch Stream C Agent (Prices/Shopping)      ─┘
  5. Monitor progress, resolve any cross-stream conflicts

WEEK 6: Sequential
  6. Launch Dashboard & Polish Agent (needs all 3 streams done)
  7. Launch Integration Testing Agent

WEEK 7: Buffer
  8. Fix bugs found in testing
  9. Performance optimization if needed
```

**Conflict resolution between parallel agents:**

- **Shared files:** `prisma/schema.prisma` is defined in Phase 0 and should NOT be modified by stream agents. If schema changes are needed, pause and coordinate.
- **Root router:** `src/server/trpc/router.ts` -- each stream agent adds their sub-routers. The file structure (separate router files merged into root) prevents conflicts.
- **Shared components:** `src/components/ui/` -- if two agents need the same component, the first to create it wins. The second agent should import, not recreate.
- **Zod schemas:** Each stream owns their domain's validation files. No cross-stream schema conflicts expected.

---

## Critical Files to Modify/Create

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Entire database schema -- foundation for all streams |
| `src/server/trpc/router.ts` | Root tRPC router merging all sub-routers |
| `src/server/services/ocr.ts` | Tesseract.js OCR service -- highest-risk component |
| `src/server/services/receiptParser.ts` | Receipt text -> structured data extraction |
| `src/server/services/productMatcher.ts` | Fuzzy matching via pg_trgm |
| `src/server/services/openFoodFacts.ts` | External product API with caching |
| `src/lib/validations/*.ts` | Shared Zod schemas (client + server) |
| `src/app/(auth)/*` | Login/register pages |
| `src/app/(dashboard)/receipts/*` | Receipt upload + review UI |
| `src/components/barcode/Scanner.tsx` | Camera barcode scanner component |
| `docker-compose.yml` | Development services |
| `docker-compose.prod.yml` | Production services + Traefik |
| `Dockerfile` | Multi-stage build (dev, builder, production) |
| `.github/workflows/ci.yml` | CI pipeline (lint, typecheck, test, build) |
