import { describe, it, expect, beforeEach } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import {
  forgetPersistedReads,
  persistKey,
  persistOptions,
  restoreThenRefresh,
} from "@/lib/offline/persist";

/**
 * The half of persistence that needs a browser: the real `localStorage`
 * binding, and a real round trip through the real persister.
 *
 * The allowlist and the options are static-tier facts. What cannot be asked
 * there is whether a cache written on one visit comes back on the next, and
 * whether a `Date` survives the journey — which is the bug plain `JSON` would
 * introduce, invisibly, only for the screens that show expiry dates.
 */

const USER = "clttttttttttttttttttttttt";
const OTHER = "clsomeoneelsesomeoneelses";

const EXPIRY = new Date("2026-12-01T00:00:00.000Z");

/**
 * Let the persister's throttle fire.
 *
 * `createSyncStoragePersister` batches writes through a `setTimeout`, so even
 * at `throttleTime: 0` the write lands on the next macrotask — awaiting the
 * save's own promise is not enough. Bounded and immediate, rather than a sleep
 * long enough to "probably" work.
 */
function flushWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clientWith(data: unknown): QueryClient {
  const client = new QueryClient();
  client.setQueryData(
    [["inventory", "getExpiringItems"], { type: "query" }],
    data,
  );
  return client;
}

/**
 * Persist, then read back through a fresh client, as a reload would.
 *
 * Save and restore explicitly rather than through `persistQueryClient`: that
 * one subscribes and writes on the *next* cache change, so a test that
 * unsubscribes straight after restoring writes nothing and proves nothing.
 */
async function roundTrip(userId: string, data: unknown): Promise<unknown> {
  const writing = clientWith(data);
  await persistQueryClientSave({
    queryClient: writing,
    ...persistOptions(userId, { throttleTime: 0 }),
  });
  await flushWrites();

  const reading = new QueryClient();
  await persistQueryClientRestore({
    queryClient: reading,
    ...persistOptions(userId, { throttleTime: 0 }),
  });

  return reading.getQueryData([
    ["inventory", "getExpiringItems"],
    { type: "query" },
  ]);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("what comes back on the next visit", () => {
  it("restores what a screen last showed", async () => {
    const restored = await roundTrip(USER, [
      { id: "b1", name: "Leche entera" },
    ]);

    expect(restored).toEqual([{ id: "b1", name: "Leche entera" }]);
  });

  it("brings a Date back as a Date", async () => {
    const restored = (await roundTrip(USER, [
      { id: "b1", expiresAt: EXPIRY },
    ])) as { expiresAt: unknown }[];

    // Plain JSON turns this into a string, and the kitchen screen calls
    // `.getTime()` on it — a crash that appears only after a reload and only
    // for products with an expiry.
    // Read out first, so an empty array fails the assertion below rather than
    // throwing a TypeError from `.toISOString()` on `undefined` — which reports
    // as a crash in the test rather than as the cache having restored nothing.
    const expiresAt = restored[0]?.expiresAt;

    expect(expiresAt).toBeInstanceOf(Date);
    expect((expiresAt as Date).toISOString()).toBe(EXPIRY.toISOString());
  });

  it("writes under a key naming the account", async () => {
    await roundTrip(USER, [{ id: "b1" }]);

    expect(window.localStorage.getItem(persistKey(USER))).not.toBeNull();
  });

  it("does not restore one account's data under another", async () => {
    await roundTrip(USER, [{ id: "mine" }]);

    const theirs = new QueryClient();
    await persistQueryClientRestore({
      queryClient: theirs,
      ...persistOptions(OTHER, { throttleTime: 0 }),
    });

    // The shared kitchen tablet.
    expect(
      theirs.getQueryData([
        ["inventory", "getExpiringItems"],
        { type: "query" },
      ]),
    ).toBeUndefined();
  });
});

describe("a restored answer is shown, never trusted", () => {
  const KEY = [["inventory", "getExpiringItems"], { type: "query" }];

  /**
   * The restore carries the original `dataUpdatedAt`, so a copy written
   * seconds ago comes back inside `staleTime` and TanStack Query correctly
   * declines to refetch it. Correct, and wrong here: this cache is a fallback
   * for having no signal, not a reason to stop asking when there is some.
   *
   * The defect it produced looked nothing like a cache — two items added to a
   * shopping list, the queue drained, the database holding both, and a reload
   * rendering "Lista vacía" from a copy of the server taken before the adds.
   */
  it("refetches what it restored, even inside staleTime", async () => {
    const writing = new QueryClient();
    writing.setQueryData(KEY, [{ id: "b1", name: "Leche entera" }]);
    await persistQueryClientSave({
      queryClient: writing,
      ...persistOptions(USER, { throttleTime: 0 }),
    });
    await flushWrites();

    // A client that would treat anything under half a minute old as fresh —
    // which the copy just written is.
    const reading = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    const [unsubscribe, ready] = restoreThenRefresh(
      reading,
      persistOptions(USER, { throttleTime: 0 }),
    );
    await ready;
    unsubscribe();

    // Restored, so a screen with no signal still has something to show...
    expect(reading.getQueryData(KEY) as unknown[]).toEqual([
      { id: "b1", name: "Leche entera" },
    ]);
    // ...and marked for asking again, so a screen with signal is corrected.
    expect(reading.getQueryState(KEY)?.isInvalidated).toBe(true);
  });
});

describe("what is not written", () => {
  it("leaves a query outside the allowlist out of the cache", async () => {
    const writing = new QueryClient();
    writing.setQueryData(
      [["receipt", "list"], { type: "query" }],
      [{ id: "r1" }],
    );
    await persistQueryClientSave({
      queryClient: writing,
      ...persistOptions(USER, { throttleTime: 0 }),
    });
    await flushWrites();

    const stored = window.localStorage.getItem(persistKey(USER)) ?? "";
    expect(stored).not.toContain("receipt");
  });
});

describe("forgetting", () => {
  it("takes the account's cached reads off the device", async () => {
    await roundTrip(USER, [{ id: "b1" }]);
    expect(window.localStorage.getItem(persistKey(USER))).not.toBeNull();

    forgetPersistedReads(USER);

    // Sign-out has to remove this as well as the queue and the shell — it is
    // the third copy of household data a device holds.
    expect(window.localStorage.getItem(persistKey(USER))).toBeNull();
  });

  it("does not throw when there is nothing to forget", () => {
    expect(() => forgetPersistedReads("nobody")).not.toThrow();
  });
});

describe("forgetting, against a write already on its way", () => {
  it("does not put the reads back when a throttled save lands after sign-out", async () => {
    // The persister batches writes on a timer, and unsubscribing stops new
    // saves, not the one already queued. Sign-out forgot the key, and the save
    // queued a moment earlier wrote it straight back.
    await persistQueryClientSave({
      queryClient: clientWith([{ id: "b1" }]),
      ...persistOptions(USER, { throttleTime: 0 }),
    });

    forgetPersistedReads(USER);
    await flushWrites();

    expect(window.localStorage.getItem(persistKey(USER))).toBeNull();
  });

  it("writes again once the account signs back in", async () => {
    // The other half: a key forgotten for good would leave that account with
    // no offline reads for the rest of the page's life.
    forgetPersistedReads(USER);

    expect(await roundTrip(USER, [{ id: "b1" }])).toEqual([{ id: "b1" }]);
  });
});
