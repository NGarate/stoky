import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
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
export const locationRouter = createTRPCRouter({
  /** Every location, flat and alphabetical. What a picker needs. */
  list: householdProcedure.query(async ({ ctx }) => {
    const locations = await prisma.storageLocation.findMany({
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
   */
  getTree: householdProcedure.query(async ({ ctx }) => {
    // Get all locations
    const allLocations = await prisma.storageLocation.findMany({
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

    // Build tree structure
    const locationMap = new Map();
    const roots: typeof allLocations = [];

    // First pass: create map
    for (const location of allLocations) {
      locationMap.set(location.id, {
        ...location,
        children: [],
      });
    }

    // Second pass: build hierarchy
    for (const location of allLocations) {
      const node = locationMap.get(location.id);
      if (location.parentId) {
        const parent = locationMap.get(location.parentId);
        if (parent) {
          parent.children.push(node);
        }
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
        const parent = await prisma.storageLocation.findFirst({
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

      const location = await prisma.storageLocation.create({
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

  /** Renames a location or moves it under a different parent. */
  update: adminProcedure
    .input(updateStorageLocationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existingLocation = await prisma.storageLocation.findFirst({
        where: {
          id,
          householdId: ctx.householdId,
        },
      });

      if (!existingLocation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Location not found",
        });
      }

      // Prevent circular reference
      if (data.parentId) {
        if (data.parentId === id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A location cannot be its own parent",
          });
        }

        const parent = await prisma.storageLocation.findFirst({
          where: {
            id: data.parentId,
            householdId: ctx.householdId,
          },
        });

        if (!parent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parent location not found",
          });
        }

        // Check if parent is a descendant of this location (would create cycle)
        const isDescendant = await checkIsDescendant(id, data.parentId);
        if (isDescendant) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot move a location to its own descendant",
          });
        }
      }

      const location = await prisma.storageLocation.update({
        where: { id },
        data,
        include: {
          parent: true,
          children: true,
        },
      });

      return location;
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
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const location = await prisma.storageLocation.findFirst({
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

      await prisma.storageLocation.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});

async function checkIsDescendant(
  ancestorId: string,
  potentialDescendantId: string
): Promise<boolean> {
  const descendant = await prisma.storageLocation.findUnique({
    where: { id: potentialDescendantId },
    select: { parentId: true },
  });

  if (!descendant) return false;
  if (descendant.parentId === ancestorId) return true;
  if (!descendant.parentId) return false;

  return checkIsDescendant(ancestorId, descendant.parentId);
}
