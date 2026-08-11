import { describe, it, expect, beforeEach } from "bun:test";
import {
  MAX_BYTES,
  createQueueStorage,
  queueKey,
} from "@/lib/offline/storage";

/**
 * The half of the queue's storage that needs a browser to exist at all.
 *
 * The state machine is tested at the static tier against an injected
 * `Storage`. What cannot be asked there is whether the *default* binding works
 * — whether `window.localStorage` is found, whether one account's key is
 * separate from another's, and whether a `Storage` that throws is survived.
 *
 * Note what happy-dom does **not** give us: it enforces no quota, so a six
 * megabyte write succeeds there. The browser's own refusal has to be injected
 * rather than summoned, which is why the size guard is checked before writing
 * rather than relying on catching the throw.
 */

const USER = "clttttttttttttttttttttttt";
const OTHER = "clsomeoneelsesomeoneelses";

beforeEach(() => {
  window.localStorage.clear();
});

describe("the browser's own storage", () => {
  it("is found without being handed in", () => {
    const storage = createQueueStorage();

    storage.write(USER, { pending: [{ id: "a" }], failed: [] });

    expect(storage.read(USER)).toEqual({ pending: [{ id: "a" }], failed: [] });
  });

  it("writes under a key naming the account", () => {
    createQueueStorage().write(USER, { pending: [], failed: [] });

    expect(window.localStorage.getItem(queueKey(USER))).not.toBeNull();
  });

  it("keeps one account's changes away from another's", () => {
    const storage = createQueueStorage();

    storage.write(USER, { pending: [{ id: "mine" }], failed: [] });

    // A shared kitchen tablet is the case this is for.
    expect(storage.read(OTHER)).toBeNull();
  });

  it("takes an account's changes off the device when asked", () => {
    const storage = createQueueStorage();
    storage.write(USER, { pending: [{ id: "a" }], failed: [] });

    storage.clear(USER);

    expect(storage.read(USER)).toBeNull();
    expect(window.localStorage.getItem(queueKey(USER))).toBeNull();
  });

  it("brings a Date back as a Date", () => {
    const storage = createQueueStorage();
    storage.write(USER, { pending: [{ at: new Date("2026-12-01") }], failed: [] });

    const read = storage.read(USER) as { pending: { at: unknown }[] };

    expect(read.pending[0]?.at).toBeInstanceOf(Date);
  });

  it("survives a value it cannot make sense of", () => {
    window.localStorage.setItem(queueKey(USER), "not superjson at all");

    // Losing an unreadable queue is better than refusing to start.
    expect(() => createQueueStorage().read(USER)).not.toThrow();
    expect(createQueueStorage().read(USER)).toBeNull();
  });
});

describe("when the browser refuses", () => {
  it("reports the refusal rather than throwing it", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;

    const storage = createQueueStorage(throwing);

    // happy-dom enforces no quota, so the browser's throw is injected. A
    // storage failure inside a click handler must not reach the handler.
    expect(storage.write(USER, { pending: [], failed: [] })).toBe(false);
  });

  it("refuses a write larger than the budget before attempting it", () => {
    const storage = createQueueStorage();
    const enormous = { pending: [{ note: "x".repeat(MAX_BYTES) }], failed: [] };

    // Checked before writing, because the browser's quota error arrives too
    // late to say which change should have been refused.
    expect(storage.write(USER, enormous)).toBe(false);
    expect(storage.read(USER)).toBeNull();
  });

  it("does nothing at all when there is no storage", () => {
    const storage = createQueueStorage(null);

    expect(storage.write(USER, { pending: [], failed: [] })).toBe(false);
    expect(storage.read(USER)).toBeNull();
    expect(() => storage.clear(USER)).not.toThrow();
  });
});
