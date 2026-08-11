import { describe, it, expect } from "bun:test";
import {
  MAX_AGE_MS,
  PERSISTED_QUERIES,
  persistKey,
  persistOptions,
  queryPathOf,
  shouldPersist,
} from "@/lib/offline/persist";
import type { Query } from "@tanstack/react-query";

/**
 * What is kept between visits, and — more importantly — what is not.
 *
 * A read cache is a copy of household data sitting on a device, so the
 * interesting assertions here are the exclusions: mutations, which would give
 * every offline write a second uncontrolled path to the server, and everything
 * outside the small list a screen genuinely needs before it can show anything.
 */

function query(key: readonly unknown[]): Query {
  return { queryKey: key } as unknown as Query;
}

describe("which queries are kept", () => {
  it("reads the tRPC path out of a query key", () => {
    // tRPC keys are `[["shopping","getBuyList"], {…}]`.
    expect(queryPathOf([["shopping", "getBuyList"], { type: "query" }])).toBe(
      "shopping.getBuyList",
    );
  });

  it("ignores a key that is not tRPC's shape", () => {
    expect(queryPathOf(["something", "else"])).toBeNull();
    expect(queryPathOf([[1, 2]])).toBeNull();
    expect(queryPathOf([])).toBeNull();
  });

  it("keeps what a screen needs before it can show anything", () => {
    for (const path of PERSISTED_QUERIES) {
      expect(shouldPersist(query([path.split(".")]))).toBe(true);
    }
  });

  it("keeps nothing else", () => {
    // Receipts and prices are not what somebody opens the app in a shop or a
    // kitchen to see, and every extra entry is more household data at rest.
    for (const path of [
      "receipt.list",
      "price.getHistory",
      "household.members",
      "auth.me",
    ]) {
      expect(shouldPersist(query([path.split(".")]))).toBe(false);
    }
  });
});

describe("what the options say", () => {
  const options = persistOptions("clttttttttttttttttttttttt", { storage: null });

  it("never persists a mutation", () => {
    // query-core's default is `isPaused`, and `networkMode` is "online" — so a
    // write made with no signal is paused, not failed. Persisting one means
    // `resumePausedMutations` replays it on the next visit, racing the queue's
    // drain with a second path nothing on screen knows about.
    expect(options.dehydrateOptions.shouldDehydrateMutation()).toBe(false);
  });

  it("selects queries by the allowlist", () => {
    expect(
      options.dehydrateOptions.shouldDehydrateQuery(
        query([["shopping", "getBuyList"]]),
      ),
    ).toBe(true);
    expect(
      options.dehydrateOptions.shouldDehydrateQuery(query([["receipt", "list"]])),
    ).toBe(false);
  });

  it("throws away a cache from another account", () => {
    // The buster carries the account, so a device that changes hands does not
    // restore the previous household under the next person's session.
    const mine = persistOptions("clttttttttttttttttttttttt", { storage: null });
    const theirs = persistOptions("clsomeoneelsesomeoneelses", { storage: null });

    expect(mine.buster).not.toBe(theirs.buster);
  });

  it("stops showing an answer after a day", () => {
    expect(MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("where it is kept", () => {
  it("uses one key per account", () => {
    expect(persistKey("user-a")).not.toBe(persistKey("user-b"));
    expect(persistKey("user-a")).toContain("user-a");
  });

  it("does not collide with the write queue's key", () => {
    // Both live in the same 5 MB origin budget; sharing a key would mean one
    // silently overwriting the other.
    expect(persistKey("user-a")).not.toBe("stoky.queue.v1.user-a");
  });
});
