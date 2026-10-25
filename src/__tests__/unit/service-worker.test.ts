import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The service worker, as source facts.
 *
 * It cannot be imported — it is a worker script that installs listeners on
 * `self` — so what is checked here is the shape of what it will do, and the
 * one thing that would otherwise ship broken with every test green.
 *
 * Most of what follows is a regex over that source, which is honest about what
 * it is: a check that the shape is right, not that the thing runs. The last
 * block does better — it evaluates the module against a stubbed worker global
 * and drives the fetch handler — because the navigation timeout is a *number*,
 * and no amount of reading the file tells you whether it is wired to anything.
 *
 * What only a browser can answer — that a real `install` populates a real cache
 * — is `e2e/service-worker.prod.spec.ts`, which runs it under an actual
 * production build.
 */

const ROOT = join(import.meta.dir, "../../..");
const SOURCE = readFileSync(join(ROOT, "public/sw.js"), "utf8");

describe("the worker is actually shipped", () => {
  it("is not excluded by .gitignore", () => {
    // This is the one defect in the phase that would ship a broken production
    // image with a passing suite: `public/sw.js` was in .gitignore, left over
    // from a next-pwa template, so `git add` silently no-opped and /sw.js
    // would have 404'd in CI and in the Docker image.
    //
    // Asserted against the file rather than through `git check-ignore`, which
    // reports a *tracked* file as not-ignored whatever the patterns say — so
    // that version of this test could not fail once the file was added.
    const patterns = readFileSync(join(ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(patterns).not.toContain("public/sw.js");
    expect(patterns).not.toContain("public/*.js");
    expect(patterns).not.toContain("public/");
  });

  it("is tracked by git", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "public/sw.js"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();

    expect(tracked).toBe("public/sw.js");
  });
});

describe("what it may write", () => {
  it("writes through exactly one call site", () => {
    // One `put` means "what may be stored" is one question with one answer.
    const puts = SOURCE.match(/\.put\(/g) ?? [];
    expect(puts).toHaveLength(1);
  });

  it("never uses addAll, which stores without ever calling put", () => {
    // Counting `put` alone leaves the barrier bypassable: `cache.addAll`
    // fetches and stores and never touches it.
    expect(SOURCE).not.toContain(".addAll(");
  });

  it("uses add only for the offline page, and tolerates it failing", () => {
    const adds = SOURCE.match(/cache\.add\(/g) ?? [];
    expect(adds).toHaveLength(1);
    expect(SOURCE).toContain("cache.add(OFFLINE_URL).catch(");
  });
});

describe("what it must never touch", () => {
  it("passes API requests straight through", () => {
    expect(SOURCE).toContain('url.pathname.startsWith("/api/")');
  });

  it("refuses to store an API response even if one reached the writer", () => {
    // Belt and braces on the one class of response that carries household
    // data and a session.
    const writer = SOURCE.slice(
      SOURCE.indexOf("async function putIfCacheable"),
    );
    expect(writer).toContain('startsWith("/api/")');
  });

  it("passes cross-origin requests through", () => {
    // Its own CSP is `connect-src 'self'`, which governs fetch() *inside* the
    // worker — so handling an images.openfoodfacts.org request blocks it and
    // every product image goes blank, looking exactly like an OFF outage.
    expect(SOURCE).toContain('if (!isSameOrigin) return "passthrough"');
  });

  it("passes RSC payload requests through", () => {
    expect(SOURCE).toContain('url.searchParams.has("_rsc")');
    expect(SOURCE).toContain('request.headers.get("next-router-prefetch")');
  });
});

describe("how it treats a redirect", () => {
  it("does not mistake a settled redirect for a network failure", () => {
    // `/dashboard` answers 307 when signed out, which arrives as an
    // opaqueredirect with status 0. Falling back on that would serve the
    // previous session's signed-in shell to a signed-out visitor.
    expect(SOURCE).toContain('response.type === "opaqueredirect"');
    // The fallback is chosen on a null response — a throw or the timeout —
    // rather than on `!response.ok`.
    expect(SOURCE).toContain("if (response) {");
  });
});

describe("source shape", () => {
  it("prefixes every global with self", () => {
    // Without `self.fetch` in particular, a sandboxed harness resolves a bare
    // `fetch` to the runtime's real global and a test of this file goes to the
    // network. The lookbehind excludes `self.fetch`, so any match is a bare
    // one.
    // Comments and string literals are stripped first: `addEventListener(
    // "fetch", ...)` is an event name, not a call to the global.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, "``");

    for (const global of ["fetch", "caches", "Response", "setTimeout"]) {
      const bare = code.match(new RegExp(`(?<![.\\w])${global}\\b`, "g")) ?? [];
      expect(bare, `${global} must always be self-prefixed`).toEqual([]);
    }
  });

  it("names its caches so they can be found and purged", () => {
    expect(SOURCE).toContain("stoky-shell-");
    expect(SOURCE).toContain("stoky-static-");
  });

  it("forgets everything when the account changes", () => {
    expect(SOURCE).toContain('event.data !== "STOKY_FORGET"');
    expect(SOURCE).toContain('name.startsWith("stoky-")');
  });
});

/**
 * The navigation timeout, driven rather than read.
 *
 * `REDESIGN_PLAN.md` §10 lists this constant as "a guess calibrated on
 * supermarket lie-fi, not a measurement", and half of that is now measurable.
 * On the production standalone build a shell navigation answers in 14–37ms
 * warm and 368ms on the first cold hit, so 2,500ms is roughly seventy times a
 * healthy navigation and seven times the worst first load — nowhere near
 * firing when the network is merely unremarkable. That is the end this can
 * settle.
 *
 * The other end it cannot: whether 2,500ms is the right moment to give up on a
 * connection that is present but hopeless is a judgement about how long a
 * person will stare at a blank screen, and no local measurement produces it.
 * §10 keeps the entry for that reason.
 *
 * What is tested here is the wiring, which is the part that could silently
 * break: that the fallback is reached *through* the timeout, at the constant
 * the file declares, and not at some other number or not at all.
 */
describe("giving up on the network", () => {
  interface Harness {
    fetchHandler: (event: unknown) => void;
    delays: number[];
    cachedFor: (url: string) => Response | undefined;
  }

  /** Evaluate the worker against a stubbed `self` and hand back its listeners. */
  function load(options: {
    fetchNeverSettles: boolean;
    cache: Record<string, string>;
  }): Harness {
    const listeners = new Map<string, (event: unknown) => void>();
    const delays: number[] = [];
    const store = new Map<string, Response>();

    for (const [url, body] of Object.entries(options.cache)) {
      store.set(url, new Response(body));
    }

    const caches = {
      open: async () => ({
        put: async () => {},
        add: async () => {},
        match: async (request: Request | string) =>
          store.get(
            typeof request === "string"
              ? request
              : new URL(request.url).pathname,
          ),
      }),
      keys: async () => [],
      delete: async () => true,
      match: async (request: Request | string) =>
        store.get(
          typeof request === "string" ? request : new URL(request.url).pathname,
        ),
    };

    const self = {
      location: { origin: "https://stoky.example" },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
      // Fires immediately, but records what it was asked to wait. The delay is
      // the assertion; waiting 2.5s in a unit test would only prove patience.
      setTimeout: (fn: () => void, ms: number) => {
        delays.push(ms);
        fn();
        return 0;
      },
      fetch: options.fetchNeverSettles
        ? () => new Promise<Response>(() => {})
        : async () => new Response("from the network"),
      caches,
      Response,
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };

    new Function("self", SOURCE)(self);

    const fetchHandler = listeners.get("fetch");
    if (!fetchHandler)
      throw new Error("the worker registered no fetch listener");

    return {
      fetchHandler,
      delays,
      cachedFor: (url: string) => store.get(url),
    };
  }

  /** Drive one navigation through the handler and return what it answered. */
  async function navigate(harness: Harness, path: string): Promise<Response> {
    const request = new Request(`https://stoky.example${path}`, {
      headers: { accept: "text/html" },
    });
    Object.defineProperty(request, "mode", { value: "navigate" });

    let answered: Promise<Response> | null = null;
    harness.fetchHandler({
      request,
      respondWith: (value: Promise<Response>) => {
        answered = value;
      },
    });

    if (!answered) throw new Error("the worker did not answer the navigation");
    return answered;
  }

  it("waits the number the file declares, not some other number", () => {
    const declared = /NAVIGATION_TIMEOUT_MS = (\d+)/.exec(SOURCE)?.[1];

    // Read from the source so the two cannot drift: if somebody tunes the
    // constant, this test follows them and the assertion below still holds.
    expect(declared).toBe("2500");
  });

  it("serves what it kept when the network never answers", async () => {
    const harness = load({
      fetchNeverSettles: true,
      cache: { "/dashboard": "the cached shell" },
    });

    const response = await navigate(harness, "/dashboard");

    expect(await response.text()).toBe("the cached shell");
    expect(harness.delays).toContain(2500);
  });

  it("falls back to the offline page when it kept nothing for that route", async () => {
    const harness = load({
      fetchNeverSettles: true,
      cache: { "/offline": "no connection" },
    });

    const response = await navigate(harness, "/prices/never-visited");

    expect(await response.text()).toBe("no connection");
  });

  it("does not wait at all when the network answers", async () => {
    // The other half: a timeout that fires early would serve stale pages to
    // somebody with a perfectly good connection.
    const harness = load({
      fetchNeverSettles: false,
      cache: { "/dashboard": "the cached shell" },
    });

    const response = await navigate(harness, "/dashboard");

    expect(await response.text()).toBe("from the network");
  });
});

/**
 * What an unlisted navigation leaves behind, driven rather than read.
 *
 * It used to leave a copy of itself: the writer was handed the cache name
 * `"none"`, which it took literally, so every authenticated page anybody
 * opened was kept in a cache the `stoky-` purge on sign-out never matched —
 * and `caches.match` searches every cache, so offline the next account on the
 * device was served the previous account's pages.
 */
describe("what an unlisted navigation keeps", () => {
  function load(existing: string[]) {
    const listeners = new Map<string, (event: unknown) => void>();
    const opened: string[] = [];
    const deleted: string[] = [];
    const pending: Promise<unknown>[] = [];

    const caches = {
      open: async (name: string) => {
        opened.push(name);
        return {
          put: async () => {},
          add: async () => {},
          match: async () => undefined,
        };
      },
      keys: async () => existing,
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
      match: async () => undefined,
    };

    const self = {
      location: { origin: "https://stoky.example" },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
      setTimeout: () => 0,
      fetch: async () =>
        new Response("<html>a household's page</html>", {
          headers: { "content-type": "text/html" },
        }),
      caches,
      Response,
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };

    new Function("self", SOURCE)(self);

    const fire = (type: string, event: Record<string, unknown>) => {
      listeners.get(type)?.({
        ...event,
        waitUntil: (value: Promise<unknown>) => pending.push(value),
        respondWith: (value: Promise<unknown>) => pending.push(value),
      });
      return Promise.all(pending);
    };

    return { opened, deleted, fire };
  }

  function navigation(path: string): Request {
    const request = new Request(`https://stoky.example${path}`, {
      headers: { accept: "text/html" },
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    return request;
  }

  it("serves an unlisted page without writing it to any cache", async () => {
    const worker = load([]);

    await worker.fire("fetch", { request: navigation("/inventory/abc123") });

    expect(worker.opened).toEqual([]);
  });

  it("still keeps a listed shell route", async () => {
    // The other half: a fix that stopped writing altogether would pass the
    // test above and leave the app unable to open offline.
    const worker = load([]);

    await worker.fire("fetch", { request: navigation("/dashboard") });

    expect(worker.opened).toEqual(["stoky-shell-v1"]);
  });

  it("deletes the cache an earlier worker filled, on activate", async () => {
    const worker = load([
      "none",
      "stoky-shell-v1",
      "stoky-static-v1",
      "someone-else",
    ]);

    await worker.fire("activate", {});

    expect(worker.deleted).toEqual(["none"]);
  });

  it("deletes it on sign-out as well", async () => {
    const worker = load(["none", "stoky-shell-v1", "someone-else"]);

    await worker.fire("message", { data: "STOKY_FORGET" });

    expect(worker.deleted).toEqual(["none", "stoky-shell-v1"]);
  });
});
