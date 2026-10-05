import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";

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
