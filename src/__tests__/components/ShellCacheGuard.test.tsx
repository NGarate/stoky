import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClientSave } from "@tanstack/react-query-persist-client";
import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";
import { persistKey, persistOptions } from "@/lib/offline/persist";
import { queueKey } from "@/lib/offline/storage";

/**
 * The guard against one account's reads reaching the next, in memory.
 *
 * The query client lives in the root provider and survives every soft
 * navigation. An expired session lands on `/login` with the previous account's
 * inventory still in it, and the next person to sign in from there was shown
 * it before their own arrived — and their persister saved it under their key.
 */

const KEY = [["inventory", "getStockOverview"], { type: "query" }];
const PREVIOUS = "clpreviouspreviousprevious";
const NEXT = "clnextnextnextnextnextnext";

let client: QueryClient;

function mount(userId: string | null): void {
  render(
    <QueryClientProvider client={client}>
      <ShellCacheGuard userId={userId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  client = new QueryClient();
  client.setQueryData(KEY, { items: ["the previous account's milk"] });
});

afterEach(cleanup);

describe("on reaching /login", () => {
  it("empties the queries the previous account left behind", () => {
    window.localStorage.setItem("stoky.shell.user", PREVIOUS);

    mount(null);

    expect(client.getQueryData<unknown>(KEY)).toBeUndefined();
  });

  it("empties them even when it cannot tell who was here", () => {
    // Blocked or cleared storage must not turn into "nobody was here, keep
    // everything" — /login reads no household data, so there is nothing to
    // lose by emptying it.
    mount(null);

    expect(client.getQueryData<unknown>(KEY)).toBeUndefined();
  });
});

describe("inside the dashboard", () => {
  it("drops the previous account's answers when a different one arrives", () => {
    window.localStorage.setItem("stoky.shell.user", PREVIOUS);

    mount(NEXT);

    expect(client.getQueryData<unknown>(KEY)).toBeUndefined();
  });

  it("keeps the same account's answers across a reload", () => {
    // The other half: resetting on every visit would throw away the restored
    // offline reads the moment they arrived.
    window.localStorage.setItem("stoky.shell.user", NEXT);

    mount(NEXT);

    expect(client.getQueryData<unknown>(KEY)).toEqual({
      items: ["the previous account's milk"],
    });
  });
});

/**
 * The guard against one account's reads outliving its session, on disk.
 *
 * `ReadCache` keeps the allowlisted reads in `localStorage` under the account's
 * key, and TanStack removes them only when that same account restores them past
 * their age. A session that ends by expiry or by being ended from another device
 * never passes through sign-out, so before this its inventory and shopping lists
 * stayed readable on the device until — if ever — it signed in here again.
 */
describe("the previous account's saved reads", () => {
  const SAVED = '{"the previous account":"milk"}';
  const UNSENT = '{"pending":["two litres of milk"]}';

  function seed(previous: string): void {
    window.localStorage.setItem("stoky.shell.user", previous);
    window.localStorage.setItem(persistKey(PREVIOUS), SAVED);
    window.localStorage.setItem(queueKey(PREVIOUS), UNSENT);
  }

  it("are forgotten on reaching /login", () => {
    seed(PREVIOUS);

    mount(null);

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBeNull();
  });

  it("are forgotten when a different account arrives", () => {
    seed(PREVIOUS);
    window.localStorage.setItem(persistKey(NEXT), "the next account's own");

    mount(NEXT);

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBeNull();
    // Only the account that left: the one arriving keeps what it saved.
    expect(window.localStorage.getItem(persistKey(NEXT))).toBe(
      "the next account's own",
    );
  });

  it("keep their unsent changes either way", () => {
    // An expired session is told to sign in again, and the queue is what it
    // signs in to send. Forgetting reads must not become forgetting writes.
    seed(PREVIOUS);
    mount(null);
    cleanup();
    seed(PREVIOUS);
    mount(NEXT);

    expect(window.localStorage.getItem(queueKey(PREVIOUS))).toBe(UNSENT);
  });

  it("are forgotten even when the save is still on its way", async () => {
    // A soft navigation to /login unmounts the dashboard's persister with a
    // throttled save already on a timer. The key does not exist yet when the
    // guard runs, so only naming the account keeps that save from landing.
    window.localStorage.setItem("stoky.shell.user", PREVIOUS);
    await persistQueryClientSave({
      queryClient: client,
      ...persistOptions(PREVIOUS, { throttleTime: 0 }),
    });

    mount(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBeNull();
  });

  it("are forgotten when nobody recorded whose they were", () => {
    // A device updated after a copy was orphaned: before 2026-10-12 /login
    // forgot the account's name and kept its reads, so the key is there and
    // `stoky.shell.user` no longer says whose it is.
    // Two of them, adjacent: removing while walking the keys skips one.
    window.localStorage.setItem(persistKey(PREVIOUS), SAVED);
    window.localStorage.setItem(persistKey(NEXT), SAVED);
    window.localStorage.setItem(queueKey(PREVIOUS), UNSENT);

    mount(null);

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBeNull();
    expect(window.localStorage.getItem(persistKey(NEXT))).toBeNull();
    expect(window.localStorage.getItem(queueKey(PREVIOUS))).toBe(UNSENT);
  });

  it("are forgotten inside the dashboard too, except the account's own", () => {
    // The same orphan on a device that never passes through /login again.
    window.localStorage.setItem("stoky.shell.user", NEXT);
    window.localStorage.setItem(persistKey(PREVIOUS), SAVED);
    window.localStorage.setItem(persistKey(NEXT), "the next account's own");

    mount(NEXT);

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBeNull();
    expect(window.localStorage.getItem(persistKey(NEXT))).toBe(
      "the next account's own",
    );
  });

  it("are kept when the same account comes back", () => {
    // A reload of the dashboard is the offline open this cache exists for.
    seed(PREVIOUS);

    mount(PREVIOUS);

    expect(window.localStorage.getItem(persistKey(PREVIOUS))).toBe(SAVED);
  });
});
