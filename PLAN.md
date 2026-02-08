
# Grocy ERP: Technical Architecture & Implementation Blueprint

## 1. Executive Summary & Core Requirements

### 1.1 Project Vision

The Grocy ERP project represents a comprehensive reimagining of household resource management, designed from the ground up as a **privacy-first, self-hosted platform** for modern families. At its core, this system addresses five interconnected domains that have historically been fragmented across multiple apps or managed through manual processes: **grocery and household inventory tracking**, **shipping and package management**, **price intelligence and historical analysis**, **chore coordination and assignment**, and **predictive UI adaptation** based on behavioral patterns.

The automation philosophy centers on **three non-negotiable principles**: **barcode-driven data entry** that eliminates manual typing, **intelligent product resolution** that transforms cryptic codes into meaningful information with minimal user intervention, and **adaptive interface optimization** that learns from family usage patterns to progressively reduce cognitive overhead. This approach recognizes that the greatest barrier to sustained tool adoption in family environments is friction—every additional click, every moment of confusion, every instance of outdated information erodes trust and engagement. By investing heavily in automation at the data capture layer and intelligence at the presentation layer, the system aims to achieve a **"set and forget" operational model** where routine tasks require minimal conscious attention while exceptional situations receive prominent, timely notification.

The **self-learning UI component** represents perhaps the most innovative aspect of the system, moving beyond static personalization into **dynamic adaptation based on observed behavioral patterns**. The system captures anonymized interaction telemetry—feature access frequency, navigation sequences, time-of-day usage patterns, and completion times for various workflows—then processes this data through analytical pipelines to generate actionable insights. These insights drive concrete UI modifications: **reordering of action buttons**, **predictive preloading of anticipated screens**, **dashboard widget suggestions**, and even **color scheme adjustments** based on environmental context detected through device sensors.

Security considerations are **architected from the foundational layers**, not retrofitted, reflecting the deeply personal nature of household data. Purchase histories reveal dietary preferences, health conditions, and lifestyle patterns; location data exposes daily routines and travel patterns; chore assignments reflect family dynamics and capacity distributions. This data deserves protection exceeding that of typical commercial applications, implemented through **defense-in-depth strategies** combining network isolation, transport encryption, application-level access controls, field-level encryption, and cryptographic verification of audit trails. The **self-hosting requirement ensures complete data sovereignty**, eliminating dependencies on third-party service continuity, privacy policy changes, or subscription pricing modifications.

### 1.2 Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Single-developer maintainability** | <20 hrs/month ops overhead | Automated monitoring, self-healing deployments |
| **Zero-friction daily usage** | <10 sec for routine tasks | Time-to-completion telemetry |
| **Barcode scan success rate** | >95% in typical household lighting | Automated quality metrics |
| **Cross-device experience** | Equivalent functionality phone/tablet/desktop | Responsive design verification |
| **Data ownership** | 100% self-hosted, exportable, interoperable | No external API dependencies for core features |
| **Uptime** | 99.5% excluding scheduled maintenance | Automated health check monitoring |

The **single-developer maintainability constraint** fundamentally shapes every architectural decision, favoring technologies with **excellent documentation, active communities, and minimal operational complexity**. This eliminates exotic database systems, custom authentication protocols, or esoteric deployment platforms in favor of battle-tested components that can be understood and modified by one person with full-stack JavaScript expertise. The technology stack prioritizes **type safety and automated verification** to catch errors at build time rather than runtime, reducing the debugging burden that would otherwise consume disproportionate developer attention.

**Zero-friction daily usage** manifests in multiple measurable dimensions: the time from barcode scan to completed inventory entry must remain under **three seconds** for typical products, the chore assignment workflow must require fewer interactions than manual coordination, and price lookup must present relevant historical context without explicit request. These performance targets are **enforced through automated testing and continuous monitoring**, with regression detection triggering immediate investigation.

## 2. Technology Stack Decisions

### 2.1 Frontend Core

| Component | Selection | Version | Rationale |
|-----------|-----------|---------|-----------|
| **Framework** | Next.js | 16.x with App Router | Server Components, streaming, nested layouts  |
| **Language** | TypeScript | 5.x strict mode | Compile-time safety, refactoring confidence |
| **Styling (layout)** | Tailwind CSS | 4.x | Utility-first, JIT compiler, design tokens |
| **Styling (components)** | Material UI | 6.x | Accessible, battle-tested component library |
| **Server state** | TanStack Query | v5 | Stale-while-revalidate, optimistic updates  |
| **Client state** | Zustand | v5 | Minimal API, excellent TypeScript inference |
| **i18n** | next-intl | v3.x | ICU format, Spanish/English, extensible |

The selection of **Next.js 16 with App Router** represents a deliberate bet on the future direction of React framework architecture. Version 16, released in October 2025, represents a mature stabilization of the App Router architecture introduced in Next.js 13, incorporating three years of production feedback and performance optimization. The **Turbopack bundler**, now stable and default, delivers **2-5× faster production builds and up to 10× faster Fast Refresh during development**—critical productivity gains for a single-developer team where context switching costs are magnified . The Build Adapters API, though still in alpha, provides future flexibility for custom deployment scenarios without architectural disruption.

The **App Router's component model** fundamentally restructures how React applications handle data fetching and rendering. **Server Components**, executing exclusively on the server, enable direct database access without API layer indirection, automatic code splitting that eliminates unused client-side JavaScript, and streaming HTML generation that improves perceived performance on mobile devices. **Client Components**, explicitly marked with the `"use client"` directive, retain full interactivity for user-facing elements while minimizing their footprint through tree-shaking. This dichotomy requires disciplined boundary placement: data fetching and composition logic belong in Server Components, while event handlers, browser APIs, and React hooks reside in Client Components .

The **hybrid Tailwind CSS 4.x + Material UI 6.x approach** leverages each system's strengths while mitigating weaknesses. Tailwind provides **utility-first rapid iteration** for custom components and layout structures, with its Just-in-Time compiler generating only the CSS actually used. Material UI contributes a **comprehensive, accessible component library** with established design patterns for complex interactions like date picking, data tables, and form validation. The integration requires careful configuration—Tailwind's preflight reset must be scoped to avoid conflicts with MUI's baseline styles—but yields a development experience where standard components assemble quickly while custom visual treatments remain fully expressive.

**State management bifurcation** recognizes the fundamental distinction between server and client state. **TanStack Query v5** handles server state through sophisticated caching, background refetching, and optimistic updates. The query key structure enables **precise invalidation**—updating a single product automatically refreshes related lists, search results, and dashboard summaries without manual coordination . **Zustand v5** manages client state—UI visibility toggles, form draft data, animation states—with minimal boilerplate and excellent TypeScript inference, avoiding the performance pitfalls of Context API for high-frequency updates.

### 2.2 Backend Architecture

| Component | Selection | Version | Deployment |
|-----------|-----------|---------|------------|
| **API Layer** | tRPC | v11 | Type-safe, end-to-end  |
| **Primary Runtime** | Node.js | 20 LTS | Next.js native API routes |
| **Future Runtime** | Bun | 1.3.8+ | Separate backend service (migration path) |
| **Database** | PostgreSQL | 16 | Primary persistence |
| **ORM** | Prisma | 6.x | Type-safe queries, migrations |
| **Analytics DB** | ClickHouse | 24 | Behavioral events, real-time aggregations |
| **Cache/Session** | Valkey | 8 | Redis-compatible, Linux Foundation  |
| **Real-time** | Server-Sent Events | — | Unidirectional updates, simpler than WebSockets |

The **tRPC v11 selection** unifies type definitions between client and server, eliminating the synchronization burden that traditionally consumes substantial development effort in full-stack TypeScript projects. **Superjson serialization** preserves rich JavaScript types—Dates, Maps, Sets—across the network boundary without manual conversion, reducing transformation code and associated error surfaces .

The **runtime decision between Next.js native and Bun 1.3.8** requires careful analysis of current ecosystem maturity. As of February 2026, **Bun's compatibility with Next.js remains incomplete** for certain edge cases, particularly around native module compilation and some streaming scenarios. The conservative approach deploys **Next.js 16's built-in runtime for production API routes**, ensuring maximum compatibility and debugging support, while maintaining a **Bun backend as a parallel development track**. This dual-track strategy enables migration once Bun's Next.js integration reaches production stability, without requiring architectural changes to the tRPC layer. The separated Bun backend option remains viable for specific high-performance operations—barcode image processing, analytics aggregation—where its **superior startup time and memory efficiency** provide measurable benefits.

**PostgreSQL 16** serves as the primary data store, selected for its robustness, feature completeness, and extensive operational tooling. The **JSONB column type** enables flexible schema evolution for rapidly changing requirements without sacrificing query performance through proper indexing. **Full-text search capabilities** eliminate immediate need for separate search infrastructure, while the **range type system** naturally expresses temporal validity periods for price histories and chore assignments. **Prisma ORM 6.x** provides type-safe database access with migration management, though raw SQL escape hatches remain available for performance-critical paths.

**ClickHouse 24** powers the behavioral analytics pipeline, selected for its **exceptional performance on high-volume event ingestion and real-time aggregation**. Its columnar storage format and vectorized query execution enable **sub-second analytical queries across millions of events** on modest hardware—critical for responsive UI adaptation. Materialized views pre-compute common aggregations without query-time computation, with appropriate TTL management for data volume control .

**Server-Sent Events (SSE)** implement real-time updates rather than WebSockets, as the predominantly **server-to-client communication pattern** of inventory updates and chore notifications doesn't justify WebSocket's connection overhead and complexity. SSE's **automatic reconnection, event ID tracking for missed message recovery, and compatibility with standard HTTP infrastructure** reduce operational burden while meeting functional requirements.

### 2.3 Authentication & Security

| Layer | Technology | Implementation |
|-------|-----------|----------------|
| **Framework** | Auth.js v5 (Next-Auth) | Credentials provider, deep Next.js integration |
| **Password Hashing** | Argon2id | 64MB memory, 3 iterations, ~250ms target |
| **Token Strategy** | JWT | 15min access + 7-day sliding refresh, rotation |
| **Field Encryption** | AES-256-GCM | Prices, locations, personal identifiers |
| **Transport** | TLS 1.3 | HSTS preload, Let's Encrypt automation |
| **Internal TLS** | mTLS | Service-to-service where feasible |

**Auth.js v5** establishes the authentication foundation, selected for its deep Next.js integration and extensive provider ecosystem. The **credentials provider** implementation uses **Argon2id** for password hashing—the winner of the Password Hashing Competition with superior resistance to GPU and ASIC attacks. Parameters target **approximately 250ms computation time on production hardware**, sufficient to resist offline attacks while maintaining acceptable login latency.

The **JWT token strategy** implements a split design: **short-lived access tokens (15-minute expiration)** for API authorization, with **longer-lived refresh tokens (7-day sliding expiration)** stored in `httpOnly`, `sameSite=strict` cookies for session continuity. **Refresh token rotation** invalidates previous tokens on each use, preventing replay attacks from stolen tokens. Device fingerprinting—derived from TLS parameters, user-agent characteristics, and IP network—detects and blocks token exfiltration attempts.

**AES-256-GCM encrypts sensitive fields** (prices, locations, personal identifiers) at the application layer before database storage, ensuring that backup files and database dumps remain protected even if storage media is compromised. **PostgreSQL's row-level security (RLS)** enables multi-tenant data isolation with policy definitions that automatically filter queries based on current user context.

### 2.4 Development Tooling

| Tool | Selection | Purpose | Performance Advantage |
|------|-----------|---------|----------------------|
| **Package Manager** | pnpm 9.x | Workspace support, disk efficiency | Content-addressable store |
| **Linter** | oxlint v0.15+ | Correctness, security linting | **50-100× faster than ESLint** |
| **Formatter** | dprint/biome | Consistent code style | Rust-based, ~10-20ms |
| **Test Runner** | Bun test runner v1.3.8 | Unit, integration tests | Native TypeScript, no transpilation |
| **DOM Environment** | Happy DOM | Browser API simulation | Lighter than jsdom |
| **Component Testing** | React Testing Library v16 | User-centric test patterns | Behavior over implementation |
| **API Mocking** | MSW v2 | Network interception | Works in Node and browser |
| **E2E Testing** | Playwright v1.50 | Cross-browser critical paths | Trace recording, visual comparison |

The **oxlint v0.15+ selection** represents a significant departure from ESLint conventions. Written in Rust, oxlint achieves **50-100× faster linting execution** through parallel parsing and rule evaluation. For a single-developer project, this velocity improvement transforms linting from a CI bottleneck to an **instantaneous pre-commit check**, enabling more aggressive linting without developer friction. The rule set focuses on **correctness and security issues** rather than stylistic concerns, with formatting delegated to dprint or biome.

The **testing strategy consolidates around Bun's ecosystem**, accepting some ecosystem immaturity in exchange for execution speed and configuration simplicity. **Bun's native test runner v1.3.8** provides Jest-compatible APIs with **native TypeScript execution without transpilation configuration**. **Happy DOM** enables browser API simulation for component tests without full browser overhead. **React Testing Library v16** promotes testing behavior over implementation, with **user-event simulation** that mirrors actual interaction patterns. **MSW v2** provides type-safe API mocking generated from tRPC router definitions. **Playwright v1.50** handles end-to-end validation with **trace recording for failure diagnosis** and visual comparison for regression detection.

## 3. System Architecture

### 3.1 Deployment Topology

The container orchestration strategy prioritizes **Docker Compose for primary deployment**, with **Kubernetes manifests provided** for organizations with existing cluster infrastructure. This dual-target approach acknowledges that many self-hosting users prefer Compose's simplicity, while enterprise or multi-instance deployments benefit from Kubernetes' operational patterns.

| Service | Technology | Purpose | Resource Profile |
|---------|-----------|---------|------------------|
| `app` | Next.js 16 | Application server, API routes, static assets | 2 CPU, 4GB RAM baseline |
| `db` | PostgreSQL 16 | Primary persistence, automated backups | 1 CPU, 2GB RAM, 50GB storage |
| `redis` | Valkey 8 | Session storage, query caching, rate limiting | 0.5 CPU, 1GB RAM |
| `analytics` | ClickHouse 24 | Behavioral events, real-time aggregations | 1 CPU, 2GB RAM, 100GB storage |
| `proxy` | Traefik v3 | TLS termination, routing, rate limiting | 0.5 CPU, 512MB RAM |

**Traefik v3** serves as reverse proxy and edge router, with **automatic service discovery from Docker labels** and dynamic configuration through Consul or Kubernetes CRDs. TLS termination occurs at Traefik, with **automatic Let's Encrypt certificate management** and OCSP stapling. The middleware chain implements compression, rate limiting, and security headers with configurable per-route overrides.

**Database backup automation** implements the **3-2-1 strategy**: 3 copies of data, on 2 different media types, with 1 offsite. The primary backup uses **PostgreSQL's pg_dump with custom format compression**, executed daily via cron with output to a mounted volume. Secondary backups leverage **restic's deduplicated, encrypted incremental snapshots** to S3-compatible object storage (MinIO for self-hosted, Wasabi or Backblaze B2 for cloud). The encryption passphrase is stored separately from backup data, with recovery procedures documented and periodically tested.

### 3.2 Data Flow Architecture

| Layer | Technology | Pattern | Purpose |
|-------|-----------|---------|---------|
| Client-Server | tRPC over HTTP/2 | Request batching | Reduce connection overhead |
| Database Access | Prisma + PgBouncer | Connection pooling | Handle serverless concurrency |
| Client Cache | React Query | Stale-while-revalidate | Immediate response, background freshness |
| Server Cache | Redis/Valkey | Cache-aside with TTL | Heavy aggregations, API responses |
| Analytics | ClickHouse | Materialized views | Real-time dashboard queries |
| File Storage | Local volume / MinIO | S3-compatible abstraction | Documents, images, exports |

**Client-server communication** uses **tRPC over HTTP/2 with request batching**, reducing connection overhead for pages with multiple data dependencies. Related queries are grouped while independent queries are separated, balancing latency reduction against error isolation. **Response streaming** for large result sets uses tRPC's subscription mechanism with backpressure handling.

**Database access through Prisma** implements **connection pooling with PgBouncer in transaction mode**, essential for serverless deployment patterns where connection count would otherwise scale with request concurrency. **Query logging in development** captures slow queries for optimization, with automatic N+1 detection and suggested include patterns. Raw SQL escape hatches use **tagged template literals with parameterization** to prevent injection vulnerabilities.

The **caching strategy implements multiple tiers** with distinct invalidation semantics. **React Query's stale-while-revalidate pattern** provides immediate cached data with background freshness checks, configurable per-query based on data volatility. **Redis caches expensive aggregations and external API responses** with explicit TTLs, using cache-aside pattern with probabilistic early expiration to prevent thundering herd. **PostgreSQL's query cache and materialized views** handle database-level caching for complex analytical queries.

### 3.3 Security Layers

| Layer | Mechanism | Implementation |
|-------|-----------|----------------|
| **Network** | Docker internal networking | No exposed database ports, service isolation |
| **Transport** | TLS 1.3 + mTLS | Let's Encrypt automation, internal service verification |
| **Application** | CSRF, rate limiting, input validation | Double-submit cookies, exponential backoff, Zod schemas |
| **Authentication** | JWT with rotation | Short-lived access tokens, device fingerprinting |
| **Authorization** | Row-level security | PostgreSQL RLS policies, automatic filtering |
| **Data at Rest** | Field-level encryption | AES-256-GCM for sensitive columns |
| **Audit** | Immutable logs | Hash chain verification, append-only storage |

**Network security** implements **Docker internal networking with explicit port exposure only for Traefik's HTTP/HTTPS endpoints**. Database and cache services have no exposed ports, accessible only through the internal network. **Service-to-service communication uses mTLS where feasible**, with SPIFFE/SPIRE integration for dynamic identity provisioning in Kubernetes deployments.

**Application security** encompasses **CSRF protection through double-submit cookies with SameSite enforcement**, **rate limiting per IP and per user with exponential backoff for violations**, and **comprehensive input validation through Zod schemas** that execute at API boundaries. The Zod schemas derive TypeScript types that propagate through the application, ensuring validation logic remains synchronized with type definitions.

**Data security** implements **field-level encryption for sensitive attributes**—prices, locations, personal identifiers—using AES-256-GCM with key derivation from hardware security modules or HashiCorp Vault in production deployments. **PostgreSQL's row-level security** enables multi-tenant data isolation with policy definitions that automatically filter queries based on current user context. The **audit logging system captures all data modifications with cryptographic verification through hash chains**, enabling tamper detection for compliance scenarios.

## 4. Core Feature Modules

### 4.1 Inventory & Stock Management

| Component | Technology | Capability |
|-----------|-----------|------------|
| **Barcode Scanning** | @thewirv/react-barcode-scanner v3.4 | ZXing-based, 1D/2D (EAN-13, UPC-A, QR, Data Matrix) |
| **Product Resolution** | Open Food Facts API + local cache | Crowdsourced grocery data with 30-day TTL caching |
| **Custom Templates** | User-defined schemas | Household items without standard barcodes |
| **Stock Operations** | Unified transaction model | Purchase/consume/transfer with location tracking |
| **Expiration Management** | Configurable alerts | 7-day warning, 3-day urgent, day-of critical |
| **Automation** | Minimum stock levels | Auto-generated shopping list suggestions |

The **barcode scanning implementation** evaluates multiple JavaScript libraries against requirements for **1D/2D support, performance, and bundle size**. `@thewirv/react-barcode-scanner v3.4`, built on **ZXing ("Zebra Crossing")**, provides excellent detection rates for common grocery barcodes with acceptable performance on mid-range mobile devices. The component implements **camera selection, torch control, and focus management** with graceful degradation when hardware capabilities are unavailable. For scenarios requiring more robust detection—damaged barcodes, unusual lighting—the implementation can fallback to advanced image processing modes.

**Product resolution integrates Open Food Facts as the primary external database**, with **local caching through PostgreSQL** to minimize API dependency and improve response times. The caching strategy implements **TTL-based invalidation with explicit refresh capability** for users who observe stale data. **Custom product templates** enable rapid entry of household items not present in external databases, with user-defined fields extending the standard schema for domain-specific attributes like storage location preferences or consumption rate estimates.

**Stock operations implement a unified transaction model** where purchases, consumptions, and transfers are all recorded as quantity adjustments with associated metadata. The **location tracking system supports hierarchical storage**—building, room, container, shelf—with barcode labels enabling rapid inventory verification through mobile scanning. **Expiration date management integrates with the chore system** to generate inspection tasks, with configurable alert thresholds based on product category and historical waste patterns. **Minimum stock levels trigger automatic shopping list generation** with quantity suggestions based on consumption rate calculations using exponential smoothing to adapt to seasonal variations.

### 4.2 Chore & Task Management

| Feature | Implementation | Details |
|---------|---------------|---------|
| **Assignment Engine** | Multiple algorithms | Round-robin, weighted distribution, skill-based |
| **Scheduling** | rrule library + ICS export | Complex recurrence, calendar integration |
| **Gamification** | Optional modules | Streak tracking, points, rewards (all opt-in) |
| **Fairness Metrics** | Historical tracking | Visual balance indicators, automatic adjustment |

The **assignment engine implements multiple distribution algorithms selectable per chore category**. **Round-robin** ensures equal task distribution over time, appropriate for routine chores like dishwashing or trash removal. **Weighted distribution** accounts for capability, availability, and historical completion rates—with factors for age-appropriate difficulty, time constraints, and demonstrated competence. **Skill-based assignment** matches complex tasks to demonstrated competence, with learning period tracking for new chore introduction.

**Scheduling flexibility** accommodates the irregular patterns of household life through the **rrule library supporting complex recurrence patterns**—"every third Thursday," "the first weekday of each month." The **ICS export enables calendar integration**, with chores appearing as events that can be completed by clicking through from calendar notifications. **Drag-and-drop rescheduling** handles the inevitable disruptions of illness, travel, and changing priorities without breaking recurrence patterns.

**Gamification elements remain optional and configurable**, recognizing that different families respond differently to competitive framing. Implemented features include **streak tracking for consecutive completion periods**, **optional point systems with configurable rewards**, and **visual progress indicators**. All gamification can be disabled for users finding them demotivating, with the system defaulting to straightforward task management without behavioral nudges.

### 4.3 Price Intelligence

| Capability | Implementation | Value |
|-----------|---------------|-------|
| **History Tracking** | PostgreSQL range types + BRIN indexing | Efficient time-series queries |
| **Inflation Adjustment** | Official CPI data integration | Real cost comparison across years |
| **Store Comparison** | Per-location price logging with geolocation | Optimal shopping route planning |
| **Deal Detection** | Threshold alerts + ML pattern recognition | Genuine vs. promotional pricing |

**Price history implements time-series storage with automatic inflation adjustment** using official consumer price index data, enabling meaningful comparison of prices across years. The storage schema uses **PostgreSQL's range types for price validity periods**, with exclusion constraints preventing overlapping validities for the same product-location combination. **Store comparison enables per-location price logging with geolocation tagging**, supporting route optimization for multi-stop shopping trips.

**Deal detection implements threshold-based alerts with machine learning enhancement** for pattern recognition in promotional cycles. User-configurable sensitivity controls notification frequency, with **batching of multiple alerts to prevent notification fatigue**. The ML component learns typical price variation and alerts only on significant deviations—prices below the 10th percentile of historical observations—avoiding false positives from routine promotional pricing.

### 4.4 Shipping & Receiving

| Integration | Carriers | Features |
|-------------|----------|----------|
| **Package Tracking** | UPS, FedEx, USPS, DHL, regional | Auto-detection from tracking number format |
| **Delivery Estimation** | Carrier API + historical accuracy | Confidence intervals, calendar blocking |
| **Notifications** | Web Push, email, SMS fallback | Real-time updates, configurable preferences |

**Package tracking integrates carrier APIs through unified abstraction**, with **automatic carrier detection from tracking number patterns**. The polling strategy balances freshness with API rate limits, with **adaptive frequency that increases as delivery date approaches**. **Delivery estimation correlates carrier predictions with historical accuracy** to generate confidence intervals, integrating with calendar systems for expected arrival blocking.

The **notification system implements multiple channels with user-configurable preferences**. **Web push notifications** provide immediate alerts for delivery status changes, requiring service worker registration and user permission. **Email digests** summarize daily activity for less urgent updates. **SMS fallback** ensures notification reach even without smartphone app installation for family members preferring simpler devices.

## 5. Adaptive UI Engine

### 5.1 Behavioral Analytics Pipeline

| Component | Technology | Function |
|-----------|-----------|----------|
| **Event Collection** | Lightweight client instrumentation | Feature access, navigation, timing (privacy-preserving) |
| **Stream Processing** | ClickHouse 24 | High-volume ingestion, materialized views |
| **Aggregation** | Real-time materialized views | Hourly usage, weekly patterns, retention metrics |
| **Insight Generation** | Multiple analytical techniques | Frequency, sequence, temporal pattern analysis |

The **event collection system implements lightweight client-side instrumentation** that captures interaction patterns without compromising privacy or performance. Events are **structured with explicit schema versioning**, enabling evolution of the analytics model without breaking historical data interpretation. The collection mechanism **batches events locally with periodic flush** to the analytics service, implementing exponential backoff for network failures and local storage overflow protection. **Explicit exclusion of sensitive data**—product names, prices, locations—ensures that analytics data could be publicly shared without privacy compromise.

**ClickHouse 24 powers the behavioral analytics pipeline**, selected for its **exceptional performance on high-volume event ingestion and real-time aggregation**. **Materialized views enable real-time aggregation of event streams without query-time computation**, with appropriate TTL management for data volume control. The aggregation granularity balances storage efficiency against analytical flexibility, with raw events retained for shorter periods than derived metrics.

**Insight generation applies multiple analytical techniques** to the collected data: **frequency analysis** identifies most-used features for prominence optimization; **sequence analysis** discovers common navigation paths for predictive preloading; **temporal pattern recognition** enables time-of-day UI adaptation; **cohort analysis** tracks feature adoption and abandonment over user lifecycle. These analyses execute on configurable schedules, with results cached for dashboard generation and ML model training.

### 5.2 UI Adaptation Mechanisms

| Mechanism | Implementation | User Control |
|-----------|---------------|------------|
| **Dynamic Reordering** | Recency-weighted frequency scoring | Pin items to prevent unwanted changes |
| **Predictive Preloading** | Markov model with confidence threshold | Respects data usage preferences |
| **Personalized Dashboards** | Drag-drop + ML-suggested layouts | Explicit opt-in for suggestions |
| **A/B Testing** | Built-in framework with statistical validation | Automatic rollback on negative metrics |

**Dynamic reordering of interface elements** implements a scoring system where element positions reflect **predicted relevance based on current context**. The prediction model incorporates **time of day, recent activity, day of week, and seasonal patterns** with configurable weighting. Changes apply gradually with animation to prevent disorienting jumps, and **explicit user override capability** ensures the system doesn't trap users in suboptimal configurations.

**Predictive preloading anticipates likely next screens** based on current context, fetching data and code bundles before explicit navigation. The prediction **confidence threshold prevents wasteful prefetching**, with learned per-user accuracy enabling personalization of aggressiveness. The implementation **respects data usage preferences**, with explicit controls for users on metered connections.

**Personalized dashboards implement widget system with drag-drop configuration and ML-suggested layouts** based on similar user profiles. The suggestion algorithm uses **collaborative filtering with differential privacy protections**, ensuring individual behavior patterns aren't exposed through recommendations. Users retain full control, with suggestions presented as starting points rather than imposed configurations.

The **A/B testing framework enables validation of UI changes with automatic cohort assignment and statistical significance calculation**. For a single-developer project, this provides confidence that modifications improve rather than degrade user experience, with **automatic rollback when metrics indicate negative impact**.

### 5.3 Reporting & Visualization

| Tool | Use Case | Integration |
|------|----------|-------------|
| **Tremor v3** | Standard dashboard components | Built-in Tailwind theming |
| **Recharts v2** | Custom visualizations | Granular control, composable |
| **React-PDF / Puppeteer** | PDF report generation | Server-side for complex layouts |
| **CSV/Excel export** | Data portability | User-configurable fields |

The **embedded analytics implementation evaluates multiple React charting libraries for suitability**. **Tremor v3** provides pre-built dashboard components with built-in Tailwind theming, accelerating development of standard reporting interfaces. **Recharts v2** offers higher-level dashboard components with consistent styling, or granular control for custom visualizations through its composable component model.

**Export functionality implements PDF generation through React-PDF or server-side Puppeteer** depending on complexity requirements, with **CSV and Excel formats for data portability**. **Scheduled reports use node-cron or similar with webhook delivery**, enabling integration with external notification systems.

## 6. Testing Strategy

### 6.1 Frontend Testing

| Level | Tool | Focus | Target |
|-------|------|-------|--------|
| **Unit** | Bun test runner | Business logic, utilities | 80%+ coverage |
| **Component** | React Testing Library v16 | User behavior, accessibility | Behavior over implementation |
| **Integration** | MSW v2 | API boundaries, data flow | Type-safe mocking |
| **Visual** | Chromatic/Loki | MUI component consistency | Regression detection |

The **unit testing strategy targets 80%+ coverage with Bun test runner**, focusing on business logic and state management rather than component rendering details. The coverage threshold is **enforced in CI with failure on regression**, but intelligent exclusion of generated code and type definitions prevents gaming through artificial inflation.

**Component testing with React Testing Library v16 emphasizes user-centric test patterns**—querying by role and text rather than implementation details—with user-event simulation for realistic interaction patterns. The testing philosophy **prioritizes confidence in refactoring over specification verification**, with tests that fail only when user-visible behavior changes.

**Integration testing at API boundaries uses MSW v2 with handlers generated from tRPC router types**, ensuring mock responses remain synchronized with actual API contracts. The handler definitions serve as documentation of expected behaviors and edge cases.

### 6.2 Backend Testing

| Level | Tool | Method |
|-------|------|--------|
| **API Contract** | tRPC + TypeScript | Compile-time verification, runtime round-trips |
| **Database** | Prisma test utilities | Transactional rollback, test factories |
| **Security** | OWASP ZAP | Automated vulnerability scanning in CI |

**API contract testing verifies tRPC router type safety through compilation**, with runtime verification of serialization round-trips. **Database tests use Prisma's test utilities with transactional rollback**, ensuring test isolation without database reset overhead. **Test factories generate realistic data with proper relationship handling**, enabling complex scenario construction without manual fixture maintenance.

**Security testing integrates OWASP ZAP automation in CI**, with baseline scans on every build and full scans on release candidates. The ZAP configuration targets the running application container, with appropriate authentication handling for protected routes.

### 6.3 E2E & Behavior Testing

| Tool | Scope | Features |
|------|-------|----------|
| **Playwright v1.50** | Critical user paths | Cross-browser, trace recording, visual comparison |
| **axe-core** | Accessibility | WCAG 2.1 AA automated verification |
| **Lighthouse CI** | Performance | Core Web Vitals budgets, regression detection |

**Playwright implements critical path testing for the complete purchase→consume→report workflow**, with **trace capture on failure for debugging assistance**. The test matrix covers **Chromium, Firefox, and WebKit with mobile viewport simulation**, ensuring cross-browser compatibility without manual verification burden.

**Accessibility testing integrates axe-core for automated WCAG 2.1 AA violation detection**, with failure on new violations preventing regression. The integration runs in both unit tests for component-level checks and E2E for full-page validation.

**Performance testing implements Lighthouse CI with budgets for Core Web Vitals metrics**, failing builds that regress performance thresholds. The budget configuration distinguishes between initial load and subsequent navigation, with appropriate relaxation for data-heavy dashboard routes.

## 7. Development & Deployment Workflow

### 7.1 Local Development

| Component | Technology | Benefit |
|-----------|-----------|---------|
| **Dev Container** | VS Code + Docker Compose | Reproducible environment, minutes to productive |
| **Hot Reload** | Turbopack | Sub-100ms updates, state preservation |
| **Database Seeding** | Realistic fixtures | Meaningful testing without production data |

The **dev container configuration provides VS Code unified environment with all services running through Docker Compose**, eliminating "works on my machine" discrepancies. The container definition includes **Node.js, Bun, pnpm, and development tools** with volume mounts for live code editing. Database and cache services run in companion containers with initialized test data.

**Hot reload implementation uses Turbopack for sub-100ms update propagation**, with Fast Refresh preserving component state through edits. The development server runs with **explicit error overlay and source map support** for rapid debugging.

### 7.2 CI/CD Pipeline

| Stage | Tool | Purpose |
|-------|------|---------|
| **Lint** | oxlint | Fast correctness verification |
| **Type Check** | TypeScript 5.x strict | Compile-time error detection |
| **Test** | Bun test runner + RTL | Unit, integration, component |
| **Build** | Next.js 16 | Production optimization |
| **Security Scan** | Trivy + ZAP | Vulnerability detection |
| **Deploy** | Blue-green with health checks | Zero-downtime updates |

**GitHub Actions implements the continuous integration pipeline with job parallelism for optimal wall-clock time**. The sequence runs lint, type check, and test in parallel, with build and security scan proceeding only after success. **Container image builds use layer caching for incremental acceleration**, with vulnerability scanning through Trivy before registry push.

The **container registry uses GHCR with OIDC authentication**, eliminating long-lived credential storage. Images are tagged with **commit SHA and semantic version**, enabling precise deployment correlation and rollback capability.

**Deployment implements blue-green updates with health check validation**. The new version deploys to inactive environment, receives traffic gradually through weighted routing, with **automatic rollback on error rate or latency degradation**.

### 7.3 Production Operations

| Area | Tool | Implementation |
|------|------|----------------|
| **Monitoring** | OpenTelemetry + Grafana | Distributed traces, metrics, logs with correlation IDs |
| **Logging** | Structured JSON | Loki aggregation, sensitive field redaction |
| **Backup** | restic + pgBackRest | Encrypted, deduplicated, point-in-time recovery |
| **Verification** | Automated restore testing | Monthly drills, documented procedures |

**Monitoring through OpenTelemetry collects distributed traces, metrics, and logs with consistent correlation IDs across service boundaries**. The Grafana stack provides visualization with alerting on error rate thresholds and latency SLO violations.

**Structured JSON logging with correlation IDs propagating through request handling** enables complete trace reconstruction from any log entry. **Sensitive field redaction ensures production logs contain no passwords, tokens, or personal data.**

**Backup automation implements PostgreSQL continuous archiving with restic encryption to external storage**, with **automated restore testing on schedule to verify recoverability**. The backup configuration includes both full backups for rapid recovery and incremental archives for point-in-time restoration.

## 8. Agentic Development Practices

### 8.1 Code Organization

| Principle | Implementation | Benefit |
|-----------|---------------|---------|
| **Feature Slices** | Domain-driven modules (inventory, chores, analytics) | Clear boundaries, reduced navigation |
| **API-First** | tRPC schemas as source of truth | Type synchronization, documentation |
| **Documentation** | Inline JSDoc, automated OpenAPI | IDE integration, external consumers |

**Feature slice architecture organizes code by domain rather than technical layer**, with inventory, chores, analytics, and other domains each containing their components, hooks, API definitions, and tests. This **colocation reduces navigation overhead during feature development** and enables clearer ownership boundaries.

**API-first development uses tRPC schemas as the source of truth**, with client and server implementations derived from shared type definitions. The schema definitions include **documentation comments that propagate to generated OpenAPI specifications** for external integration.

### 8.2 AI-Assisted Workflows

| Application | Method | Output |
|-------------|--------|--------|
| **Code Generation** | Structured prompt context | Existing patterns, test examples, constraints |
| **PR Review** | AI-powered summaries | Change highlights, security concerns, test coverage |
| **Test Generation** | fast-check property-based | Edge case discovery, invariant verification |

**Prompt engineering for code generation provides structured context including existing patterns, test examples, and architectural constraints**. The generated code undergoes **automated verification through compilation and test execution before human review**, with rejection feedback improving subsequent generation.

**AI-powered review automation summarizes pull request changes**, highlighting security-relevant modifications and test coverage impact. The summary generation uses **repository-specific conventions learned from historical PRs**.

**Property-based testing with fast-check generates test cases from specifications** rather than manual example selection, discovering edge cases human testers might overlook. The shrinking process produces **minimal failing cases for efficient debugging**.

### 8.3 Maintainability Guardrails

| Tool | Function | Configuration |
|------|----------|---------------|
| **Renovate** | Dependency updates | Auto-merge patches, group related packages |
| **ADRs** | Decision documentation | Context, decision, consequences, supersession links |
| **Runbooks** | Operational procedures | Incident response, recovery, common tasks |

**Dependency management through Renovate implements automated update proposals with auto-merge for patch versions passing CI**. The configuration includes **grouping rules for related packages and explicit exclusion of known-problematic versions**.

**Architecture Decision Records document significant choices with context, decision, and consequences sections**, enabling future developers to understand rationale and identify when assumptions have changed. The **ADR index provides rapid discovery of relevant decisions for proposed changes**.

**Runbooks document incident response procedures and common operations**: database recovery, certificate renewal, performance troubleshooting, security incident response. **Regular drills verify procedure currency and team readiness.**

## 9. Migration & Extensibility

### 9.1 Data Import

| Source | Method | Features |
|--------|--------|----------|
| **Grocy (existing)** | SQLite-to-PostgreSQL ETL | Schema mapping, data transformation, validation |
| **Generic** | CSV/Excel templates | Column mapping, preview, duplicate detection |

**Grocy migration implements SQLite-to-PostgreSQL ETL with schema mapping and data transformation for incompatible representations**. The migration script runs **idempotently with progress logging and rollback capability**, enabling iterative testing on production data copies.

**Generic import provides CSV and Excel templates with validation feedback**, enabling bulk entry from spreadsheet-based existing systems. The import process includes **duplicate detection and merge conflict resolution with explicit user confirmation**.

### 9.2 Plugin Architecture

| Extension Point | Mechanism | Use Case |
|-----------------|-----------|----------|
| **Webhooks** | Outbound HTTP with HMAC | External integrations, notifications |
| **Custom Fields** | User-defined typed attributes | Domain-specific product/chore data |
| **API Extensions** | tRPC procedure composition | Custom business logic |

The **webhook system enables outbound notifications for external integrations**, with configurable triggers and payload templates. **Authentication uses HMAC signatures with shared secrets**, enabling verification by receiving systems.

**Custom fields implement user-defined attributes on all core entities with type validation and indexing configuration**. The field definitions propagate through the API layer with automatic form generation and validation.

**API extensions through tRPC procedure composition enable custom logic without core modification**: a family might implement specialized chore assignment algorithms, custom price comparison rules, or integration with regional services. The extension interface **maintains type safety and upgrade compatibility**.

### 9.3 Mobile Strategy

| Layer | Technology | Capability |
|-------|-----------|------------|
| **PWA Core** | Service Worker + Web App Manifest | Offline functionality, install prompts, background sync |
| **Native Wrapper** | Capacitor v6 | App store distribution, native API access |
| **Hardware Integration** | WebHID API | Bluetooth barcode scanners, dedicated devices |

**Progressive Web App implementation provides service worker with offline capability for core read operations and queued write synchronization**. The **Add to Home Screen experience achieves near-native feel** on supported platforms, with platform-specific icons and splash screens.

**Native wrapper through Capacitor v6 enables app store distribution with minimal native code**, leveraging the web codebase with plugin access to native capabilities. The barcode scanning integration uses **Capacitor's camera plugin with optimized preview handling**.

**Bluetooth scanner support implements WebHID protocol for compatible hardware**, with fallback to keyboard emulation mode for broader device compatibility. The integration enables **rapid inventory operations without manual camera positioning**—particularly valuable for high-volume scanning scenarios like monthly bulk inventory sessions.
