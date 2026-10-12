import { describe, it, expect } from "bun:test";
import { drawnParents, type LocationLink } from "@/lib/inventory/location-tree";

/**
 * Every location is drawn, whatever its `parentId` says (ISSUES.md LOC-1).
 *
 * The rule both location trees now share: a row keeps its parent when its
 * chain of parents reaches the top level, and is drawn at the top level when it
 * does not — an orphan, or a member of a loop.
 */

function drawn(rows: LocationLink[]): Record<string, string | null> {
  return Object.fromEntries(drawnParents(rows));
}

describe("drawnParents", () => {
  it("leaves a sound tree exactly as it is", () => {
    expect(
      drawn([
        { id: "kitchen", parentId: null },
        { id: "fridge", parentId: "kitchen" },
        { id: "freezer", parentId: "fridge" },
      ]),
    ).toEqual({ kitchen: null, fridge: "kitchen", freezer: "fridge" });
  });

  it("lifts a loop's members to the top level and leaves what hangs below it in place", () => {
    // The order matters: the first row decided is the one *below* the loop,
    // so the walk has to discover the loop from outside it.
    expect(
      drawn([
        { id: "shelf", parentId: "a" },
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" },
        { id: "pantry", parentId: null },
      ]),
    ).toEqual({ shelf: "a", a: null, b: null, pantry: null });
  });

  it("lifts a location that is its own parent", () => {
    expect(drawn([{ id: "a", parentId: "a" }])).toEqual({ a: null });
  });

  it("lifts an orphan whose parent is not in the list", () => {
    expect(drawn([{ id: "a", parentId: "gone" }])).toEqual({ a: null });
  });

  it("leaves a forest: following drawn parents from any row reaches the top", () => {
    const rows: LocationLink[] = [
      { id: "c", parentId: "a" },
      { id: "a", parentId: "b" },
      { id: "b", parentId: "c" },
      { id: "d", parentId: "b" },
      { id: "e", parentId: "d" },
    ];
    const parents = drawnParents(rows);
    for (const row of rows) {
      const seen = new Set<string>();
      let current: string | null = row.id;
      while (current !== null) {
        expect(seen.has(current)).toBe(false);
        seen.add(current);
        current = parents.get(current) ?? null;
      }
    }
    expect(parents.get("e")).toBe("d");
    expect(parents.get("d")).toBe("b");
  });
});
