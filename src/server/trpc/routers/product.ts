import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { openFoodFacts } from "@/server/services/openFoodFacts";
import {
  productSchema,
  updateProductSchema,
  productSearchSchema,
  productByBarcodeSchema,
  productPaginationSchema,
} from "@/lib/validations/product";

export const productRouter = createTRPCRouter({
  list: protectedProcedure
    .input(productPaginationSchema)
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search } = input;
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const where = {
        householdId: user.householdId,
        ...(search && {
          name: {
            contains: search,
            mode: "insensitive" as const,
          },
        }),
      };

      const products = await prisma.product.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { name: "asc" },
        include: {
          stockEntries: {
            select: {
              quantity: true,
            },
          },
          _count: {
            select: {
              stockEntries: true,
            },
          },
        },
      });

      let nextCursor: typeof cursor = undefined;
      if (products.length > limit) {
        const nextItem = products.pop();
        if (nextItem) {
          nextCursor = nextItem.id;
        }
      }

      const productsWithStock = products.map((product) => {
        const totalStock = product.stockEntries.reduce(
          (sum, entry) => sum + entry.quantity,
          0
        );
        return {
          ...product,
          totalStock,
          stockEntries: undefined,
        };
      });

      return {
        products: productsWithStock,
        nextCursor,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const product = await prisma.product.findFirst({
        where: {
          id: input.id,
          householdId: user.householdId,
        },
        include: {
          stockEntries: {
            orderBy: { createdAt: "desc" },
            include: {
              location: true,
            },
          },
          priceRecords: {
            orderBy: { recordedAt: "desc" },
            take: 5,
            include: {
              store: true,
            },
          },
        },
      });

      if (!product) {
        throw new Error("Product not found");
      }

      const totalStock = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );

      return {
        ...product,
        totalStock,
      };
    }),

  getByBarcode: protectedProcedure
    .input(productByBarcodeSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const product = await prisma.product.findUnique({
        where: {
          barcode_householdId: {
            barcode: input.barcode,
            householdId: user.householdId,
          },
        },
        include: {
          stockEntries: {
            select: {
              quantity: true,
            },
          },
        },
      });

      if (!product) {
        return null;
      }

      const totalStock = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );

      return {
        ...product,
        totalStock,
        stockEntries: undefined,
      };
    }),

  create: protectedProcedure
    .input(productSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const product = await prisma.product.create({
        data: {
          ...input,
          householdId: user.householdId,
        },
      });

      return product;
    }),

  update: protectedProcedure
    .input(updateProductSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, ...data } = input;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const existingProduct = await prisma.product.findFirst({
        where: {
          id,
          householdId: user.householdId,
        },
      });

      if (!existingProduct) {
        throw new Error("Product not found");
      }

      const product = await prisma.product.update({
        where: { id },
        data,
      });

      return product;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      const existingProduct = await prisma.product.findFirst({
        where: {
          id: input.id,
          householdId: user.householdId,
        },
      });

      if (!existingProduct) {
        throw new Error("Product not found");
      }

      // Delete the product
      await prisma.product.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  searchByName: protectedProcedure
    .input(productSearchSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      // Use pg_trgm similarity search
      const products = await prisma.$queryRaw`
        SELECT 
          id, name, barcode, brand, category, "defaultUnit", "minStock",
          similarity(name, ${input.query}) as similarity
        FROM "Product"
        WHERE "householdId" = ${user.householdId}
          AND name % ${input.query}
        ORDER BY similarity(name, ${input.query}) DESC
        LIMIT ${input.limit}
      `;

      return products as Array<{
        id: string;
        name: string;
        barcode: string | null;
        brand: string | null;
        category: string | null;
        defaultUnit: string;
        minStock: number | null;
        similarity: number;
      }>;
    }),

  scanBarcode: protectedProcedure
    .input(productByBarcodeSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not in a household");
      }

      // First, check if product already exists in local database
      const existingProduct = await prisma.product.findUnique({
        where: {
          barcode_householdId: {
            barcode: input.barcode,
            householdId: user.householdId,
          },
        },
        include: {
          stockEntries: {
            select: {
              quantity: true,
            },
          },
        },
      });

      if (existingProduct) {
        const totalStock = existingProduct.stockEntries.reduce(
          (sum, entry) => sum + entry.quantity,
          0
        );
        return {
          product: {
            ...existingProduct,
            totalStock,
            stockEntries: undefined,
          },
          source: "local" as const,
        };
      }

      // Fetch from Open Food Facts
      const offProduct = await openFoodFacts.getProductByBarcode(input.barcode);

      if (!offProduct) {
        return {
          product: null,
          source: "not_found" as const,
        };
      }

      // Extract categories
      const categories = offProduct.categories
        ? offProduct.categories.split(",").map((c) => c.trim())[0]
        : null;

      // Create product from OFF data
      const newProduct = await prisma.product.create({
        data: {
          name: offProduct.product_name || `Product ${input.barcode}`,
          barcode: input.barcode,
          brand: offProduct.brands || null,
          category: categories,
          imageUrl: offProduct.image_url || offProduct.image_front_url || null,
          defaultUnit: openFoodFacts.extractUnit(offProduct.quantity),
          openFoodFactsData: offProduct,
          householdId: user.householdId,
        },
      });

      return {
        product: {
          ...newProduct,
          totalStock: 0,
        },
        source: "open_food_facts" as const,
      };
    }),
});
