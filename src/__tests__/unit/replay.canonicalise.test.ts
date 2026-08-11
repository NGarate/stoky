import { describe, it, expect } from "bun:test";
import { canonicalise, requestHash } from "@/server/trpc/replay";

/**
 * The fingerprint that binds an idempotency key to the request it was minted
 * for.
 *
 * Its job is to answer one question: is this the same call arriving again, or a
 * different call reusing a key? Get it wrong in either direction and the whole
 * mechanism becomes decoration — too strict and every retry looks like a new
 * request, too loose and a key can be pointed at a different body.
 *
 * Pure string and object work, so it is tested here in milliseconds. The
 * integration suite is left to prove the transaction.
 */

describe("canonicalise", () => {
  it("removes the key itself, so the binding is not vacuous", () => {
    // The trap this test exists for. Hash the key in and every request is
    // unique by construction: "same key, different body" becomes undetectable
    // and the replay check silently stops checking anything.
    const a = { productId: "p1", quantity: 2, idempotencyKey: "key-one" };
    const b = { productId: "p1", quantity: 2, idempotencyKey: "key-two" };

    expect(canonicalise(a)).toEqual(canonicalise(b));
  });

  it("removes the composer, which is delivery and not content", () => {
    const a = { productId: "p1", composedByUserId: "user-a" };
    const b = { productId: "p1", composedByUserId: "user-b" };

    expect(canonicalise(a)).toEqual(canonicalise(b));
  });

  it("does not care what order the fields arrived in", () => {
    const a = { productId: "p1", quantity: 2, unit: "L" };
    const b = { unit: "L", productId: "p1", quantity: 2 };

    expect(JSON.stringify(canonicalise(a))).toBe(JSON.stringify(canonicalise(b)));
  });

  it("treats an omitted field and an undefined one as the same request", () => {
    const a = { productId: "p1", note: undefined };
    const b = { productId: "p1" };

    expect(JSON.stringify(canonicalise(a))).toBe(JSON.stringify(canonicalise(b)));
  });

  it("keeps a date as an instant, not as whatever the clock printed", () => {
    const a = { expirationDate: new Date("2026-09-01T00:00:00.000Z") };
    const b = { expirationDate: new Date(Date.UTC(2026, 8, 1)) };

    expect(canonicalise(a)).toEqual(canonicalise(b));
  });

  it("does not let a date collide with a string of the same characters", () => {
    const asDate = { at: new Date("2026-09-01T00:00:00.000Z") };
    const asText = { at: "2026-09-01T00:00:00.000Z" };

    expect(JSON.stringify(canonicalise(asDate))).not.toBe(
      JSON.stringify(canonicalise(asText)),
    );
  });

  it("sorts nested objects too", () => {
    const a = { where: { b: 1, a: 2 } };
    const b = { where: { a: 2, b: 1 } };

    expect(JSON.stringify(canonicalise(a))).toBe(JSON.stringify(canonicalise(b)));
  });

  it("keeps array order, because order is content", () => {
    expect(JSON.stringify(canonicalise({ ids: ["a", "b"] }))).not.toBe(
      JSON.stringify(canonicalise({ ids: ["b", "a"] })),
    );
  });

  it("leaves an envelope key alone when it is nested inside the body", () => {
    // Only the top level is delivery. A field of that name deeper in is data.
    const canonical = canonicalise({
      idempotencyKey: "stripped",
      meta: { idempotencyKey: "kept" },
    }) as Record<string, unknown>;

    expect(canonical.idempotencyKey).toBeUndefined();
    expect(canonical.meta).toEqual({ idempotencyKey: "kept" });
  });
});

describe("requestHash", () => {
  const body = { productId: "p1", quantity: 1, unit: "L" };

  it("is the same for the same call arriving twice under different keys", () => {
    expect(
      requestHash("inventory.consumeStock", { ...body, idempotencyKey: "one" }),
    ).toBe(
      requestHash("inventory.consumeStock", { ...body, idempotencyKey: "two" }),
    );
  });

  it("changes when the quantity changes", () => {
    expect(requestHash("inventory.consumeStock", body)).not.toBe(
      requestHash("inventory.consumeStock", { ...body, quantity: 2 }),
    );
  });

  it("changes when the procedure changes", () => {
    // Otherwise one key could be pointed at a different procedure with the
    // same shaped body — adding stock instead of consuming it.
    expect(requestHash("inventory.consumeStock", body)).not.toBe(
      requestHash("inventory.addStock", body),
    );
  });

  it("changes when a date moves by a day", () => {
    const first = { expirationDate: new Date("2026-09-01T00:00:00.000Z") };
    const next = { expirationDate: new Date("2026-09-02T00:00:00.000Z") };

    expect(requestHash("inventory.addStock", first)).not.toBe(
      requestHash("inventory.addStock", next),
    );
  });

  it("is a hex digest of fixed length, so it fits a column", () => {
    expect(requestHash("inventory.addStock", body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
