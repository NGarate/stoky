import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_ID_LENGTH } from "@/lib/validations/bounds";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
import type { Prisma } from "@prisma/client";
import { drawnParents } from "@/lib/inventory/location-tree";
import {
  storageLocationSchema,
  updateStorageLocationSchema,
} from "@/lib/validations/inventory";

/**
 * Where things are kept: fridge, pantry, garage shelf.
 *
 * **A hierarchy**, through `StorageLocation.parentId` pointing at the same
 * table — "fridge" can contain "freezer drawer". That self-reference is the
 * only recursive structure in the schema and the reason `getTree` exists at
 * all; `delete` also has to think about it.
 *
 * **`adminProcedure` for every write.** Locations are household configuration
 * rather than household data: moving stock between them is an everyday act, but
 * inventing or removing one changes what everybody else's forms offer
 * (REDESIGN_PLAN §5.2).
 */
/**
 * A location with its own sub-locations hanging off it, as `getTree` returns
 * them.
 *
 * Exported because the settings screen and the stock picker both walk it, and
 * a shape two callers re-declare is a shape that will eventually disagree with
 * itself. Recursive by necessity: the hierarchy has no fixed depth.
 */
export interface LocationTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  householdId: string;
  _count: { stockEntries: number };
  children: LocationTreeNode[];
}

export const locationRouter = createTRPCRouter({
  /** Every location, flat and alphabetical. What a picker needs. */
  list: householdProcedure.query(async ({ ctx }) => {
    const locations = await ctx.db.storageLocation.findMany({
      where: {
        householdId: ctx.householdId,
      },
      orderBy: {
        name: "asc",
      },
      include: {
        parent: true,
        children: {
          orderBy: {
            name: "asc",
          },
        },
        _count: {
          select: {
            stockEntries: true,
          },
        },
      },
    });

    return locations;
  }),

  /**
   * The same locations, nested, each with a count of what is in it.
   *
   * Assembled here rather than by the database, because PostgreSQL has no cheap
   * answer for an arbitrarily deep tree and a household has a few dozen
   * locations at most. Two passes: build a map, then attach each child to its
   * parent.
   *
   * The return type is written out rather than inferred, and that is the point
   * of `LocationTreeNode`. The map was a bare `new Map()` and the accumulator
   * was typed `typeof allLocations` — a flat row with no `children` — so the
   * one thing this procedure exists to add was the one thing its type did not
   * say. Every caller therefore had to cast, and a cast is where a wrong shape
   * stops being a compiler error and becomes an empty list on a screen.
   */
  getTree: householdProcedure.query(async ({ ctx }): Promise<LocationTreeNode[]> => {
    const allLocations = await ctx.db.storageLocation.findMany({
      where: {
        householdId: ctx.householdId,
      },
      orderBy: {
        name: "asc",
      },
      include: {
        _count: {
          select: {
            stockEntries: true,
          },
        },
      },
    });

    const locationMap = new Map<string, LocationTreeNode>();
    const roots: LocationTreeNode[] = [];

    // First pass: create map
    for (const location of allLocations) {
      locationMap.set(location.id, {
        ...location,
        children: [],
      });
    }

    // Second pass: build hierarchy. Attached by reachability rather than by
    // "has a parent": an orphan, or a loop of locations inside each other
    // (ISSUES.md LOC-1, which `update` could once be raced into making), is
    // drawn at the root. Attaching every row whose parent was in the map made
    // a loop's members vanish — nobody was a root — and with them everything
    // stored inside, beyond the reach of `delete`, which refuses a location
    // with sub-locations. `parentId` itself is returned unchanged, so a
    // screen can still say which location a looped row claims to be inside.
    const drawn = drawnParents(allLocations);
    for (const location of allLocations) {
      const node = locationMap.get(location.id);
      if (!node) continue;

      const parentId = drawn.get(location.id) ?? null;
      const parent = parentId ? locationMap.get(parentId) : undefined;

      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }),

  /** Adds a location, optionally inside another. */
  create: adminProcedure
    .input(storageLocationSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify parent exists if provided
      if (input.parentId) {
        const parent = await ctx.db.storageLocation.findFirst({
          where: {
            id: input.parentId,
            householdId: ctx.householdId,
          },
        });

        if (!parent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parent location not found",
          });
        }
      }

      const location = await ctx.db.storageLocation.create({
        data: {
          name: input.name,
          parentId: input.parentId,
          householdId: ctx.householdId,
        },
        include: {
          parent: true,
          children: true,
        },
      });

      return location;
    }),

  /**
   * Renames a location or moves it under a different parent.
   *
   * **One move at a time per household.** The check that a move does not put
   * a location inside its own subtree reads the tree; the write changes it.
   * Run apart, two moves sent together — A into B and B into A, which one
   * batched request is enough for, since a batch runs its calls concurrently
   * — each checked the tree as it was before either wrote, both passed, and
   * left A and B inside each other (ISSUES.md LOC-1). So the check and the
   * write share a transaction that starts by locking the household's own
   * row. The second move waits for the first to commit and then reads the
   * tree the first one left, so it is refused rather than raced.
   *
   * `FOR NO KEY UPDATE`, not `FOR UPDATE`: the lock only has to exclude
   * another move, which takes the same lock. `FOR UPDATE` also conflicts with
   * the `FOR KEY SHARE` that every foreign-key check on the household takes,
   * so creating a product or a location anywhere in the household would queue
   * behind a rename for as long as it ran — measured: under `FOR UPDATE` an
   * insert into `StorageLocation` hit a 1 s `lock_timeout` on exactly that
   * check, and under `FOR NO KEY UPDATE` it went straight through.
   */
  update: adminProcedure
    .input(updateStorageLocationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const householdId = ctx.householdId;

      return ctx.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "Household"
            WHERE id = ${householdId}
            FOR NO KEY UPDATE
          `;

          // Read after the lock, so it is the tree the previous move left.
          const existingLocation = await tx.storageLocation.findFirst({
            where: { id, householdId },
          });

          if (!existingLocation) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Location not found",
            });
          }

          if (data.parentId) {
            if (data.parentId === id) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "A location cannot be its own parent",
              });
            }

            const parent = await tx.storageLocation.findFirst({
              where: { id: data.parentId, householdId },
            });

            if (!parent) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Parent location not found",
              });
            }

            const refusal = await moveRefusal(tx, householdId, id, data.parentId);
            if (refusal) {
              throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
            }
          }

          return tx.storageLocation.update({
            where: { id, householdId },
            data,
            include: {
              parent: true,
              children: true,
            },
          });
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    }),

  /**
   * Removes a location, if nothing depends on it.
   *
   * Refuses with CONFLICT when it has sub-locations or any stock entry, and
   * says which — the shape `product.delete` should have and does not (ISSUES.md
   * PROD-1), where the same situation surfaces as a foreign-key error about
   * something that does not exist.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().max(MAX_ID_LENGTH) }))
    .mutation(async ({ ctx, input }) => {
      const location = await ctx.db.storageLocation.findFirst({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
        include: {
          children: true,
          stockEntries: {
            take: 1,
          },
        },
      });

      if (!location) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Location not found",
        });
      }

      if (location.children.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot delete location with sub-locations",
        });
      }

      if (location.stockEntries.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot delete location with stock entries",
        });
      }

      await ctx.db.storageLocation.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});

/**
 * How many ancestors a move's walk will read before it gives up and refuses.
 *
 * A household has a few dozen locations, nested two or three deep. The cap is
 * not a limit on how deep a tree may be in practice — nothing reaches it — but
 * the bound that makes the walk below finish whatever the data says. It counts
 * reads, not distinct rows, so it ends a loop on its own too: it does not rely
 * on the visited set to be the only thing that can.
 */
const MAX_ANCESTORS = 64;

/**
 * Why moving `id` under `parentId` must be refused, or null if it may go.
 *
 * Walks up from the new parent, one row at a time, inside the household.
 * Reaching `id` means the new parent is inside the location being moved, and
 * the move would close a loop. Coming back to a row already seen means the
 * chain above the new parent is *already* a loop — data written before
 * `update` took its lock (ISSUES.md LOC-1) — and moving anything into it would
 * hide it along with the loop. The walk this replaced recursed with neither a
 * visited set nor a depth limit, so a move into an existing loop issued one
 * query per step for as long as the process lived: the review measured 2 600
 * queries in three seconds, still going. Inside the transaction such a walk
 * would now be cut off by its timeout, but only after holding the household's
 * lock for ten seconds; the two bounds here end it within a few reads.
 *
 * The household filter changes no answer today — `parentId` is a foreign key
 * and the router only ever writes one from the same household — but it is the
 * rule every other read in this file follows, and it costs nothing.
 */
async function moveRefusal(
  db: Prisma.TransactionClient,
  householdId: string,
  id: string,
  parentId: string,
): Promise<string | null> {
  const seen = new Set<string>();
  let current: string | null = parentId;

  for (let reads = 0; current !== null; reads++) {
    if (current === id) return "Cannot move a location to its own descendant";
    if (seen.has(current)) {
      return "The destination is inside a loop of locations; move one of them out first";
    }
    if (reads >= MAX_ANCESTORS) {
      return `Locations cannot be nested more than ${MAX_ANCESTORS} deep`;
    }
    seen.add(current);

    const row: { parentId: string | null } | null =
      await db.storageLocation.findFirst({
        where: { id: current, householdId },
        select: { parentId: true },
      });
    current = row?.parentId ?? null;
  }

  return null;
}
