/**
 * Hashes passwords at Argon2id's minimum cost in every `bun test` process,
 * the same cost `createTestUser` stores (`src/__tests__/utils/test-helpers.ts`).
 *
 * The integration suite hashed about a hundred times at the production cost
 * (64 MiB, three passes, four lanes): the accounts the application hashes
 * itself, and Better Auth's hash for a sign-in to an address with no account.
 * Each is about 60 ms of four busy cores that nothing there asserts — six
 * seconds of the suite, measured 2026-11-20 — and on a four-core runner it is
 * what contention stretches to seconds (ISSUES TEST-12).
 * The tests that do assert the cost — `unit/password-hash.test.ts` and the
 * sign-in timing in `integration/auth.flow.test.ts` — put it back for
 * themselves with `replacePasswordHashCost()`.
 *
 * Loaded through `bunfig.toml` `[test] preload`, so a single file run alone
 * gets it too. Nothing outside `bun test` loads this file.
 */
import { replacePasswordHashCost } from "@/lib/auth/password-hash";

replacePasswordHashCost({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
