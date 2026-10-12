/**
 * How many procedure calls one tRPC request may carry: 100.
 *
 * **The server refuses a longer batch; the client never sends one.** tRPC
 * batches by default and, with no `maxBatchSize`, accepts as many calls as
 * fit in the URL — about 850 `household.current` in one 15 KB GET, run
 * concurrently, each refused call writing its own `access.denied` line. One
 * request was therefore as many calls as the caller cared to name, and every
 * per-call cost — a database query, a 64 MiB Argon2id hash in
 * `household.addMember`, a security-log line — was multiplied by it before any
 * limit counted anything. `src/server/http/trpc-handler.ts` passes this as
 * `maxBatchSize`, which tRPC checks against the path list before it reads a
 * single input: a longer batch is a 400 and runs nothing. The browser client
 * (`src/lib/trpc/client.tsx`) passes it as `maxItems`, so the link splits a
 * long batch into several requests instead of tripping the refusal.
 *
 * **Why 100 and not fewer.** The widest batch a screen sends today is
 * `/prices`: up to 50 rows (`getProductPrices`, `limit: 50`), each with its
 * own `price.getLatestPrices` query in `BestPriceIndicator`. A refetch of
 * everything mounted — focus, reconnect, `RouteState`'s retry — sends those
 * 50, the list and the write queue's query together: 52 calls. A client of
 * the current build splits at this same number and is unaffected by any
 * value, but a tab still running the build from before this limit existed
 * has no `maxItems`, and a ceiling of 50 would answer its next refetch of
 * that screen with a 400 for every call in it. 100 leaves that tab working
 * and still turns ~850 calls per request into at most 100.
 *
 * Shared, so the two ends cannot drift apart: a client that batched more than
 * the server accepts would lose whole screens to a 400.
 */
export const MAX_TRPC_BATCH_SIZE = 100;
