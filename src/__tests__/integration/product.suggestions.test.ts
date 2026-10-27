import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { createMockSession, generateTestEmail } from "../utils/test-helpers";

/**
 * What the product forms suggest for brand, category and unit.
 *
 * Two claims. The values are this household's and no other's — a brand list
 * is a list of what somebody buys. And the most used come first, because the
 * field shows the start of the list until the person types.
 */

const PREFIX = "Suggestions ";

type Caller = ReturnType<typeof appRouter.createCaller>;

let caller: Caller;
const households: string[] = [];

async function household(label: string, role: "OWNER" | "KITCHEN") {
  const row = await prisma.household.create({
    data: { name: `${PREFIX}${label}` },
  });
  households.push(row.id);
  const user = await prisma.user.create({
    data: {
      email: generateTestEmail(`suggestions-${label}`),
      name: `${PREFIX}${label}`,
      householdId: row.id,
      role,
    },
  });
  return { household: row, user };
}

beforeAll(async () => {
  const mine = await household("mine", "KITCHEN");
  const theirs = await household("theirs", "OWNER");

  const rows = [
    { name: "Leche", brand: "Pascual", category: "Lácteos", defaultUnit: "L" },
    {
      name: "Yogur",
      brand: "Pascual",
      category: "Lácteos",
      defaultUnit: "unit",
    },
    {
      name: "Atún",
      brand: "Hacendado",
      category: "Conservas",
      defaultUnit: "unit",
    },
    { name: "Arroz", brand: "Hacendado", category: null, defaultUnit: "kg" },
    {
      name: "Café",
      brand: "Hacendado",
      category: "Lácteos",
      defaultUnit: "unit",
    },
    { name: "Pan", brand: null, category: null, defaultUnit: "unit" },
    // Counts that never tie: how a tie sorts is the database's collation,
    // which is not what this file is about.
    { name: "Azúcar", brand: null, category: null, defaultUnit: "kg" },
  ];
  await prisma.product.createMany({
    data: rows.map((row) => ({ ...row, householdId: mine.household.id })),
  });
  await prisma.product.create({
    data: {
      name: "Secreto",
      brand: "Marca Ajena",
      category: "Categoría Ajena",
      defaultUnit: "unidad ajena",
      householdId: theirs.household.id,
    },
  });

  // KITCHEN on purpose: it reads the catalogue, so it may read these too.
  caller = appRouter.createCaller(
    await createTRPCContext({
      session: createMockSession({ ...mine.user, household: mine.household }),
    }),
  );
});

afterAll(async () => {
  await prisma.product.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
});

describe("product.suggestions", () => {
  it("lists each value once, most used first, without blanks", async () => {
    const suggestions = await caller.product.suggestions();

    expect(suggestions).toEqual({
      brands: ["Hacendado", "Pascual"],
      categories: ["Lácteos", "Conservas"],
      units: ["unit", "kg", "L"],
    });
  });

  it("offers nothing another household typed", async () => {
    const suggestions = await caller.product.suggestions();
    const all = [
      ...suggestions.brands,
      ...suggestions.categories,
      ...suggestions.units,
    ];

    expect(all).not.toContain("Marca Ajena");
    expect(all).not.toContain("Categoría Ajena");
    expect(all).not.toContain("unidad ajena");
  });
});
