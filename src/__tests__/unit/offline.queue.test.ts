import { describe, it, expect, mock } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { MAX_PENDING, openWriteQueue, type QueuedOp } from "@/lib/offline/queue";
import { createMemoryStorage } from "@/lib/offline/storage";

/**
 * The queue's state machine, with no DOM and no renderer.
 *
 * It is a `zustand/vanilla` store precisely so this is possible: the whole
 * machine runs here in milliseconds, and the React binding is one `useStore`
 * call in a provider. Testing it through a component would be slower, harder to
 * read, and would prove less.
 *
 * Every case below is a way a real shop is lost.
 */

const USER = "clttttttttttttttttttttttt";
const HOUSEHOLD = "clhhhhhhhhhhhhhhhhhhhhhhh";

function refusal(httpStatus: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", { value: { httpStatus } });
  return error;
}

/** A dropped connection: no status, because nothing answered. */
const dropped = () => new TypeError("Failed to fetch");

function tick(path: QueuedOp["path"] = "shopping.updateItem") {
  return {
    path,
    input: { id: "item-1", isChecked: true },
    label: { key: "offline.tickedOff", values: { name: "Leche entera" } },
  };
}

function open(
  send: (op: QueuedOp) => Promise<unknown>,
  overrides: Partial<Parameters<typeof openWriteQueue>[0]> = {},
) {
  return openWriteQueue({
    userId: USER,
    householdId: HOUSEHOLD,
    send,
    storage: createMemoryStorage(),
    random: () => 0.5,
    ...overrides,
  });
}

describe("sending what is waiting", () => {
  it("sends in the order the changes were made, one at a time", async () => {
    const seen: string[] = [];
    let inFlight = 0;
    const queue = open(async (op) => {
      inFlight += 1;
      // Order is correctness here, not tidiness: consumeStock refuses when the
      // quantity exceeds what is available, and that depends on the writes in
      // front of it.
      expect(inFlight).toBe(1);
      seen.push(String(op.input.id));
      inFlight -= 1;
    });

    queue.enqueue({ ...tick(), input: { id: "a" } });
    queue.enqueue({ ...tick(), input: { id: "b" } });
    queue.enqueue({ ...tick(), input: { id: "c" } });
    await queue.drain();

    expect(seen).toEqual(["a", "b", "c"]);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("keeps the same key across attempts", async () => {
    const keys: string[] = [];
    let calls = 0;
    const queue = open(async (op) => {
      keys.push(op.id);
      calls += 1;
      if (calls === 1) throw refusal(503);
    });

    queue.enqueue(tick());
    await queue.drain();
    await queue.drain();

    // A second key for the same change is a double-apply the server cannot
    // catch, because the two carry different keys.
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1] as string);
  });
});

describe("a change the server will never accept", () => {
  it("does not block the changes behind it", async () => {
    const sent: string[] = [];
    const queue = open(async (op) => {
      if (op.input.id === "poison") throw refusal(404);
      sent.push(String(op.input.id));
    });

    queue.enqueue({ ...tick(), input: { id: "poison" } });
    queue.enqueue({ ...tick(), input: { id: "good" } });
    await queue.drain();

    expect(sent).toEqual(["good"]);
    expect(queue.getState().pending).toHaveLength(0);
    expect(queue.getState().failed).toHaveLength(1);
  });

  it("is named rather than dropped", async () => {
    const queue = open(async () => {
      throw refusal(403);
    });

    queue.enqueue(tick());
    await queue.drain();

    const [failed] = queue.getState().failed;
    // The person made this change and deserves to know it did not stick.
    expect(failed?.reason).toBe("refused");
    expect(failed?.label.values?.name).toBe("Leche entera");
  });
});

describe("a refused consumption", () => {
  it("is kept for reconciliation, not reported as a failure", async () => {
    const queue = open(async () => {
      throw refusal(409);
    });

    queue.enqueue({
      path: "inventory.consumeStock",
      input: { productId: "p1", quantity: 1, unit: "L" },
      label: { key: "offline.usedUp", values: { name: "Leche entera" } },
    });
    await queue.drain();

    // They did take the milk. Only a person who can see the shelf knows what
    // is actually there — REDESIGN_PLAN §5.5.3.
    expect(queue.getState().failed[0]?.reason).toBe("needs-reconciliation");
  });

  it("does not treat a conflict on anything else that way", async () => {
    const queue = open(async () => {
      throw refusal(409);
    });

    queue.enqueue(tick("shopping.updateItem"));
    await queue.drain();

    expect(queue.getState().failed[0]?.reason).toBe("refused");
  });
});

describe("a session that ended while the phone was in a pocket", () => {
  it("stops sending and keeps everything", async () => {
    const send = mock(async () => {
      throw refusal(401);
    });
    const queue = open(send);

    queue.enqueue({ ...tick(), input: { id: "a" } });
    queue.enqueue({ ...tick(), input: { id: "b" } });
    await queue.drain();

    expect(queue.getState().status).toBe("needs-signin");
    expect(queue.getState().pending).toHaveLength(2);
    expect(queue.getState().failed).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not start again until the session is dealt with", async () => {
    const send = mock(async () => {
      throw refusal(401);
    });
    const queue = open(send);

    queue.enqueue(tick());
    await queue.drain();
    await queue.drain();

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("counting attempts", () => {
  it("gives up after eight answers from a server", async () => {
    const queue = open(async () => {
      throw refusal(500);
    });

    queue.enqueue(tick());
    for (let i = 0; i < 9; i += 1) await queue.drain();

    expect(queue.getState().failed[0]?.reason).toBe("exhausted");
  });

  it("never gives up on a request that did not arrive", async () => {
    const queue = open(async () => {
      throw dropped();
    });

    queue.enqueue(tick());
    for (let i = 0; i < 20; i += 1) await queue.drain();

    // Two minutes of bad supermarket wifi must not exhaust a real shop.
    expect(queue.getState().failed).toHaveLength(0);
    expect(queue.getState().pending[0]?.attempts).toBe(0);
  });
});

describe("a queue composed in another household", () => {
  it("is refused rather than written into the wrong one", async () => {
    const send = mock(async () => {});
    const queue = open(send);

    queue.enqueue(tick());
    const stored = queue.getState().pending[0] as QueuedOp;
    queue.store.setState(
      {
        ...queue.getState(),
        pending: [{ ...stored, householdId: "clsomeoneelsesomeoneelses" }],
      },
      true,
    );

    await queue.drain();

    expect(send).not.toHaveBeenCalled();
    expect(queue.getState().failed[0]?.reason).toBe("wrong-household");
  });
});

describe("room", () => {
  it("refuses the newest change rather than evicting the oldest", () => {
    const queue = open(async () => {});

    for (let i = 0; i < MAX_PENDING; i += 1) queue.enqueue(tick());
    const result = queue.enqueue(tick());

    // The oldest is the one that has been waiting. Dropping it silently is the
    // failure the queue exists to prevent.
    expect(result).toEqual({ ok: false, reason: "full" });
    expect(queue.getState().pending).toHaveLength(MAX_PENDING);
    expect(queue.getState().full).toBe(true);
  });

  it("never evicts from the failed list to make room", async () => {
    const queue = open(async () => {
      throw refusal(403);
    });

    for (let i = 0; i < 5; i += 1) queue.enqueue(tick());
    await queue.drain();

    expect(queue.getState().failed).toHaveLength(5);
  });
});

describe("what survives a reload", () => {
  it("comes back with the same changes and the same keys", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue(tick());
    const before = first.getState().pending[0] as QueuedOp;

    const second = open(async () => {}, { storage });

    expect(second.getState().pending).toHaveLength(1);
    expect(second.getState().pending[0]?.id).toBe(before.id);
  });

  it("brings a Date back as a Date", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue({
      path: "inventory.addStock",
      input: { productId: "p1", expirationDate: new Date("2026-12-01") },
      label: { key: "offline.added" },
    });

    const second = open(async () => {}, { storage });
    const input = second.getState().pending[0]?.input as {
      expirationDate: unknown;
    };

    // Plain JSON turns this into a string, which the server's `z.date()`
    // refuses — a 400 manufactured by our own storage layer, visible only for
    // products with an expiry and only after a reload.
    expect(input.expirationDate).toBeInstanceOf(Date);
  });

  it("does not let one account see another's changes", () => {
    const storage = createMemoryStorage();
    const mine = open(async () => {}, { storage });
    mine.enqueue(tick());

    const theirs = openWriteQueue({
      userId: "clsomeoneelsesomeoneelses",
      householdId: HOUSEHOLD,
      send: async () => {},
      storage,
    });

    expect(theirs.getState().pending).toHaveLength(0);
    expect(mine.getState().pending).toHaveLength(1);
  });

  it("survives storage that refuses to write", () => {
    const failing = {
      read: () => null,
      write: () => false,
      clear: () => {},
    };
    const queue = open(async () => {}, { storage: failing });

    // Degrading to an in-memory queue loses work on reload. Throwing inside a
    // click handler loses it immediately and looks like a broken app.
    expect(() => queue.enqueue(tick())).not.toThrow();
    expect(queue.getState().pending).toHaveLength(1);
  });
});

describe("dealing with what failed", () => {
  it("puts a retried change back at the tail with its strikes cleared", async () => {
    let fail = true;
    const queue = open(async () => {
      if (fail) throw refusal(500);
    });

    queue.enqueue(tick());
    for (let i = 0; i < 9; i += 1) await queue.drain();
    const failedId = queue.getState().failed[0]?.id as string;

    fail = false;
    queue.retry(failedId);

    expect(queue.getState().failed).toHaveLength(0);
    expect(queue.getState().pending[0]?.attempts).toBe(0);
    // The same key, so a change the server did apply is recognised rather than
    // applied a second time.
    expect(queue.getState().pending[0]?.id).toBe(failedId);
  });

  it("forgets a discarded change", async () => {
    const queue = open(async () => {
      throw refusal(403);
    });

    queue.enqueue(tick());
    await queue.drain();
    queue.discard(queue.getState().failed[0]?.id as string);

    expect(queue.getState().failed).toHaveLength(0);
  });

  it("takes the whole queue off the device on sign-out", () => {
    const storage = createMemoryStorage();
    const queue = open(async () => {}, { storage });
    queue.enqueue(tick());

    queue.purgeAll();

    expect(queue.getState().pending).toHaveLength(0);
    expect(storage.read(USER)).toBeNull();
  });
});

describe("subscribers", () => {
  it("hear about a change without asking", () => {
    const queue = open(async () => {});
    const heard: number[] = [];
    queue.subscribe((state) => heard.push(state.pending.length));

    queue.enqueue(tick());
    queue.enqueue(tick());

    expect(heard).toEqual([1, 2]);
  });
});
