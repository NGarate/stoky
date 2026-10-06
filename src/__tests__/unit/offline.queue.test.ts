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

describe("what a drain reports", () => {
  it("says how many changes it sent", async () => {
    // The provider refetches only when this is above zero. It used to compare
    // the pending length before and after, which cannot see one change sent
    // while another was queued meanwhile.
    const queue = open(async () => {});
    queue.enqueue(tick());
    queue.enqueue(tick());

    expect(await queue.drain()).toBe(2);
  });

  it("says zero when it sent nothing", async () => {
    const queue = open(async () => {
      throw dropped();
    });
    queue.enqueue(tick());

    expect(await queue.drain()).toBe(0);
    expect(await open(async () => {}).drain()).toBe(0);
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

describe("an offline scan of an unknown barcode", () => {
  it("is kept for review, and the drain moves past it", async () => {
    // T7: OFF cannot name the barcode → NOT_FOUND. Not a failure; a question.
    // The scan lands in `failed` as needs-review and the change behind it
    // still sends, so one unnameable scan does not block a shop.
    const sent: string[] = [];
    const queue = open(async (op) => {
      if (op.path === "product.resolveScan") throw refusal(404);
      sent.push(String(op.input.id));
    });

    queue.enqueue({
      path: "product.resolveScan",
      input: { barcode: "8410000999999" },
      label: { key: "offline.scannedBarcode", values: { barcode: "8410000999999" } },
    });
    queue.enqueue({ ...tick(), input: { id: "after" } });
    await queue.drain();

    expect(queue.getState().failed[0]?.reason).toBe("needs-review");
    expect(sent).toEqual(["after"]);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("does not treat a NOT_FOUND on anything else as reviewable", async () => {
    const queue = open(async () => {
      throw refusal(404);
    });

    queue.enqueue(tick("shopping.removeItem"));
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

  it("sends a change composed before any household was known into the first one", async () => {
    // Stamped "" by a session whose token had no household while the
    // account created its first. Refusing it as wrong-household — which it
    // was, for ever, once the next sign-in carried the real one — discarded
    // a change that could only ever have been meant for this household.
    const send = mock(async () => {});
    const queue = open(send, { householdId: "" });

    queue.enqueue(tick());
    queue.setHousehold(HOUSEHOLD);
    await queue.drain();

    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.getState().failed).toHaveLength(0);
  });

  it("keeps it bound to that first household after the account moves on", async () => {
    // "" is not a wildcard. Once the client has known a household, a change
    // composed before it belongs to that one; the server derives the
    // household from the session at send time, so letting it through after a
    // move would write it into a household it was never composed in.
    const send = mock(async () => {});
    const queue = open(send, { householdId: "" });

    queue.enqueue(tick());
    queue.setHousehold(HOUSEHOLD);
    queue.setHousehold("clsomeoneelsesomeoneelses");
    await queue.drain();

    expect(send).not.toHaveBeenCalled();
    expect(queue.getState().failed[0]?.reason).toBe("wrong-household");
  });

  it("binds a restored change to the household the queue opened with", async () => {
    const storage = createMemoryStorage();
    const earlier = open(async () => {}, { householdId: "", storage });
    earlier.enqueue(tick());

    const queue = open(async () => {}, { storage });
    queue.hydrate();

    expect(queue.getState().pending[0]?.householdId).toBe(HOUSEHOLD);
    // Persisted, so the next session restores it bound rather than blank.
    expect(storage.read(USER)).toMatchObject({ pending: [{ householdId: HOUSEHOLD }] });
  });

  it("stamps changes with the household it was told about since opening", () => {
    const queue = open(async () => {}, { householdId: "" });

    queue.setHousehold(HOUSEHOLD);
    queue.enqueue(tick());

    expect(queue.getState().pending[0]?.householdId).toBe(HOUSEHOLD);
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

describe("an unread queue is not an empty one", () => {
  /**
   * The store starts empty and `hydrate()` fills it from the device, in an
   * effect. So for one paint "three changes are waiting" and "nothing is
   * waiting" are the same object, and everything downstream reports the second
   * — which is not an early answer but a wrong one.
   *
   * `hydrated` is what tells them apart. It is deliberately *not* "the queue
   * has something in it": a queue that was read and found empty is a different
   * claim from one that has not been read, and only the first licenses saying
   * everything is saved.
   */
  it("starts unhydrated, and says so", () => {
    const queue = open(async () => {}, { storage: createMemoryStorage() });

    expect(queue.getState().hydrated).toBe(false);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("is hydrated after reading a device that had nothing on it", () => {
    const queue = open(async () => {}, { storage: createMemoryStorage() });
    queue.hydrate();

    // Empty both before and after, which is the whole point: the flag is the
    // only thing that moved, and it is the only thing that could have.
    expect(queue.getState().pending).toHaveLength(0);
    expect(queue.getState().hydrated).toBe(true);
  });

  it("is hydrated after restoring changes, without dropping them", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue(tick());

    const second = open(async () => {}, { storage });
    expect(second.getState().hydrated).toBe(false);
    second.hydrate();

    expect(second.getState().hydrated).toBe(true);
    expect(second.getState().pending).toHaveLength(1);
  });

  it("is hydrated by an enqueue that reads the device on the way", () => {
    // `enqueue` hydrates first so the first write cannot overwrite the stored
    // queue. The flag has to follow that path too, or a screen that wrote
    // before mounting still reports an unread queue.
    const queue = open(async () => {}, { storage: createMemoryStorage() });
    queue.enqueue(tick());

    expect(queue.getState().hydrated).toBe(true);
  });
});

describe("what survives a reload", () => {
  it("comes back with the same changes and the same keys", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue(tick());
    const before = first.getState().pending[0] as QueuedOp;

    const second = open(async () => {}, { storage });
    // Empty until asked. Reading storage while the store is being built makes
    // the server's queue and the client's disagree, and React discards the
    // tree — a hydration mismatch only a browser finds.
    expect(second.getState().pending).toHaveLength(0);
    second.hydrate();

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
    second.hydrate();
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
    theirs.hydrate();

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

describe("taking a change back", () => {
  it("removes it, so nothing was ever recorded", () => {
    const queue = open(async () => {});
    const added = queue.enqueue(tick());

    // Undo for a stock movement. A compensating write would record that the
    // household acquired something it never did — a fabricated event that
    // everything downstream would read as real.
    expect(added.ok && queue.cancel(added.id)).toBe(true);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("refuses once the change has been sent", async () => {
    const queue = open(async () => {});
    const added = queue.enqueue(tick());
    await queue.drain();

    expect(added.ok && queue.cancel(added.id)).toBe(false);
  });

  it("refuses the one being sent right now", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cancelledMidFlight: boolean | undefined;

    const queue = open(async () => {
      // Called while this very operation is in flight.
      cancelledMidFlight = queue.cancel(queue.getState().pending[0]?.id ?? "");
      await gate;
    });
    queue.enqueue(tick());

    const draining = queue.drain();
    release();
    await draining;

    // Taking it back after it left would leave the server's copy and lose
    // ours, which is the one outcome worse than not offering undo at all.
    expect(cancelledMidFlight ?? true).toBe(false);
  });

  it("says no to a change it does not have", () => {
    const queue = open(async () => {});

    expect(queue.cancel("never-existed")).toBe(false);
  });
});

describe("a change made with a hold", () => {
  /**
   * The undo window. D57 made undo "cancel the queued change", which is only
   * an affordance while the change is *in* the queue — and online, an
   * immediate drain empties the queue in one round-trip, so the button lived
   * for a single render. The hold is what makes §4's ten-second undo true:
   * the change is not eligible to send until the window closes, so pressing
   * Deshacer inside it always works.
   */
  const start = new Date("2026-08-20T10:00:00.000Z");

  function openHeld(send: (op: QueuedOp) => Promise<unknown>) {
    let clock = start;
    return {
      queue: open(send, { now: () => clock }),
      advance(ms: number) {
        clock = new Date(clock.getTime() + ms);
      },
    };
  }

  it("is not sent while its window is open, and can still be taken back", async () => {
    const send = mock(async () => {});
    const { queue } = openHeld(send);
    const added = queue.enqueue({ ...tick(), holdMs: 10_000 });

    await queue.drain();

    expect(send).not.toHaveBeenCalled();
    expect(added.ok && queue.cancel(added.id)).toBe(true);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("is sent once the window has closed", async () => {
    const send = mock(async () => {});
    const { queue, advance } = openHeld(send);
    queue.enqueue({ ...tick(), holdMs: 10_000 });

    advance(10_000);
    await queue.drain();

    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.getState().pending).toHaveLength(0);
  });

  it("says how long it can still be taken back, not just when to wake", () => {
    // `nextDelayMs` answers the drain timer's question and only ever looks at
    // the head. An undo affordance asks about *its own* change, which may be
    // second in the queue and is undoable all the same.
    const { queue, advance } = openHeld(async () => {});
    const first = queue.enqueue({ ...tick(), holdMs: 10_000 });
    const second = queue.enqueue({ ...tick(), holdMs: 10_000 });

    expect(first.ok && queue.holdRemainingMs(first.id)).toBe(10_000);
    expect(second.ok && queue.holdRemainingMs(second.id)).toBe(10_000);

    advance(4_000);

    expect(first.ok && queue.holdRemainingMs(first.id)).toBe(6_000);
    expect(second.ok && queue.holdRemainingMs(second.id)).toBe(6_000);
  });

  it("reports zero for everything that cannot be taken back", async () => {
    // One number, four reasons, so the caller needs no second question: a
    // positive answer means `cancel` works now and for that long.
    const { queue, advance } = openHeld(async () => {});

    const noHold = queue.enqueue(tick());
    expect(noHold.ok && queue.holdRemainingMs(noHold.id)).toBe(0);

    expect(queue.holdRemainingMs("never-existed")).toBe(0);

    const expiring = queue.enqueue({ ...tick(), holdMs: 10_000 });
    advance(10_000);
    expect(expiring.ok && queue.holdRemainingMs(expiring.id)).toBe(0);

    await queue.drain();
    // Sent, so gone from pending, so zero — the same answer `cancel` gives.
    expect(expiring.ok && queue.holdRemainingMs(expiring.id)).toBe(0);
    expect(expiring.ok && queue.cancel(expiring.id)).toBe(false);
  });

  it("reports zero while the change is in flight, whatever the clock says", async () => {
    // The window can still be open by the clock and the change already gone.
    // `cancel` refuses it, so this must too — an undo button that does
    // nothing is worse than no undo button.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldMidFlight: number | null = null;

    const { queue } = openHeld(async () => {
      heldMidFlight = queue.holdRemainingMs(queue.getState().pending[0]?.id ?? "");
      await gate;
    });
    // No hold, so it is eligible immediately and reaches the sender; the
    // question is what the queue says about it while it is there.
    queue.enqueue(tick());

    const draining = queue.drain();
    release();
    await draining;

    // `?? -1` for the same reason the cancel test above uses `?? true`: the
    // assignment happens inside the sender, which the compiler cannot see.
    expect(heldMidFlight ?? -1).toBe(0);
  });

  it("holds the changes behind it, because order is correctness", async () => {
    // consumeStock refuses when the quantity exceeds what is available, and
    // what is available depends on the queued writes in front of it. A held
    // head therefore blocks the queue rather than being overtaken.
    const send = mock(async () => {});
    const { queue } = openHeld(send);
    queue.enqueue({ ...tick(), holdMs: 10_000 });
    queue.enqueue(tick());

    await queue.drain();

    expect(send).not.toHaveBeenCalled();
    expect(queue.getState().pending).toHaveLength(2);
  });

  it("tells the timer how long is left, so the drain fires when it closes", () => {
    const { queue, advance } = openHeld(async () => {});
    queue.enqueue({ ...tick(), holdMs: 10_000 });

    expect(queue.nextDelayMs()).toBe(10_000);
    advance(4_000);
    expect(queue.nextDelayMs()).toBe(6_000);
  });

  it("does not delay a change that asked for no hold", async () => {
    const send = mock(async () => {});
    const { queue } = openHeld(send);
    queue.enqueue(tick());

    await queue.drain();

    expect(send).toHaveBeenCalledTimes(1);
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

describe("hydrating", () => {
  it("keeps a change made before storage was read", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue({ ...tick(), input: { id: "saved" } });

    const second = open(async () => {}, { storage });
    // A fast tap on a slow phone: the change is made between mount and the
    // effect that loads storage. Replacing rather than merging would lose it.
    second.enqueue({ ...tick(), input: { id: "just-now" } });
    second.hydrate();

    expect(second.getState().pending.map((op) => op.input.id)).toEqual([
      "saved",
      "just-now",
    ]);
  });

  it("only reads storage once, however often it is called", () => {
    const storage = createMemoryStorage();
    const first = open(async () => {}, { storage });
    first.enqueue(tick());

    const second = open(async () => {}, { storage });
    second.hydrate();
    second.hydrate();

    expect(second.getState().pending).toHaveLength(1);
  });
});

describe("subscribers", () => {
  it("hear about a change without asking", () => {
    const queue = open(async () => {});
    const heard: number[] = [];
    queue.subscribe((state) => heard.push(state.pending.length));

    queue.enqueue(tick());
    queue.enqueue(tick());

    // Three notifications for two changes. The first is the hydration the
    // first `enqueue` performs on its way in: it leaves the queue still empty
    // but no longer *unread*, and that is a state change subscribers must hear
    // — `SyncStatus` renders a different thing on either side of it.
    expect(heard).toEqual([0, 1, 2]);
  });

  it("hear the moment the queue stops being unread", () => {
    const queue = open(async () => {});
    const heard: boolean[] = [];
    queue.subscribe((state) => heard.push(state.hydrated));

    queue.hydrate();
    queue.hydrate();

    // Once, not twice: hydration is idempotent, and a second notification
    // would re-render every consumer for nothing.
    expect(heard).toEqual([true]);
  });
});
