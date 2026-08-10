import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  storageLocationSchema,
  updateStorageLocationSchema,
} from "@/lib/validations/inventory";

export const locationRouter = createTRPCRouter({
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
