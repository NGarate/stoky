import { describe, expect, it } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import SuperJSON from "@/lib/superjson";

/**
 * Every boundary that serialises — the tRPC links, the offline queue's
 * storage, the persisted read cache — goes through this instance. Without the
 * registration a Decimal crosses as its internal digits and arrives as a
 * plain object with no `.toNumber()`.
 */
describe("SuperJSON with Decimal", () => {
  it("brings a Decimal back as a Decimal of the same value", () => {
    const back = SuperJSON.parse<{ quantity: Decimal }>(
      SuperJSON.stringify({ quantity: new Decimal("0.3") }),
    );

    expect(back.quantity).toBeInstanceOf(Decimal);
    expect(back.quantity.toString()).toBe("0.3");
  });

  it("sends the decimal string, so nothing is lost on the way", () => {
    const sent = SuperJSON.serialize({ price: new Decimal("1234567.891") });

    expect(sent.json).toEqual({ price: "1234567.891" });
  });
});
