import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestHousehold,
  createMockSession,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * Taking a household's data out.
 *
 * The premise of this application is that the data lives on hardware the
 * household controls, and that promise is only worth something if it can leave.
 * `REDESIGN_PLAN.md` §10 listed this as absent rather than deferred, which is
 * the right description of a gap in the product's own premise.
 *
 * The first two describes are the ones that matter. An export that is missing
 * something is a broken promise; an export that contains a password hash is a
 * breach in a file somebody will email to themselves.
 */

const HOUSEHOLD = "Export Household";
const OTHER = "Export Other Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let owner: Caller;
let member: Caller;
let householdId: string;
let productId: string;
const AUTHENTICATOR_SECRET = "$ba$1$secreto-del-autenticador";
const PASSKEY_PUBLIC_KEY = "pQECAyYgASFYIclave-publica-de-la-llave";

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;

  const ownerUser = await createTestUser({
    email: generateTestEmail("export-owner"),
    name: "Export Owner",
    householdId,
    role: "OWNER",
  });
  const memberUser = await createTestUser({
    email: generateTestEmail("export-member"),
    name: "Export Member",
    householdId,
    role: "MEMBER",
  });

  // An authenticator secret, which the export must not carry (D148).
  await prisma.passkey.create({
    data: {
      userId: ownerUser.id,
      credentialID: `${PASSKEY_PUBLIC_KEY}-${crypto.randomUUID()}`,
      publicKey: PASSKEY_PUBLIC_KEY,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
    },
  });
  await prisma.twoFactor.create({
    data: {
      userId: ownerUser.id,
      secret: AUTHENTICATOR_SECRET,
      backupCodes: AUTHENTICATOR_SECRET,
    },
  });
  await prisma.user.update({
    where: { id: ownerUser.id },
    data: { twoFactorEnabled: true },
  });

  owner = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(ownerUser) }),
  );
  member = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(memberUser) }),
  );

  const store = await prisma.store.create({
    data: { name: "Mercadona", householdId },
  });
  const location = await prisma.storageLocation.create({
    data: { name: "Nevera", householdId },
  });
  const product = await prisma.product.create({
    data: { name: "Leche entera", defaultUnit: "L", minStock: 2, householdId },
  });
  productId = product.id;

  const batch = await prisma.stockEntry.create({
    data: {
      productId,
      quantity: 6,
      unit: "L",
      operationType: "PURCHASE",
      locationId: location.id,
      expirationDate: new Date("2026-11-01T00:00:00.000Z"),
      createdBy: ownerUser.id,
    },
  });
  await prisma.stockEntry.create({
    data: {
      productId,
      quantity: -1,
      unit: "L",
      operationType: "CONSUME",
      locationId: location.id,
      batchId: batch.id,
      createdBy: ownerUser.id,
    },
  });
  await prisma.priceRecord.create({
    data: { productId, storeId: store.id, price: 1.19, unit: "L" },
  });
  const receipt = await prisma.receipt.create({
    data: {
      imagePath: `uploads/receipts/${householdId}/abc.jpg`,
      householdId,
      uploadedBy: ownerUser.id,
      storeId: store.id,
      rawOcrText: "TICKET COMPLETO SEGUN EL OCR",
    },
  });
  await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      rawText: "LECHE ENTERA 1,19",
      parsedPrice: 1.19,
    },
  });
  const list = await prisma.shoppingList.create({
    data: { name: "Semana", householdId },
  });
  await prisma.shoppingItem.create({
    data: { shoppingListId: list.id, productId, quantity: 1 },
  });
});

afterAll(async () => {
  const households = await prisma.household.findMany({
    where: { name: { in: [HOUSEHOLD, OTHER] } },
    select: { id: true },
  });
  const ids = households.map((h) => h.id);

  await prisma.receiptItem.deleteMany({
    where: { receipt: { householdId: { in: ids } } },
  });
  await prisma.receipt.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: { in: ids } } },
  });
  await prisma.shoppingList.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.priceRecord.deleteMany({
    where: { product: { householdId: { in: ids } } },
  });
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: { in: ids } } },
  });
  await prisma.product.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.storageLocation.deleteMany({
    where: { householdId: { in: ids } },
  });
  await prisma.store.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.user.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.household.deleteMany({ where: { id: { in: ids } } });
});

/** Every object key anywhere inside `value`, however deep. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object" || value instanceof Date)
    return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    key,
    ...keysOf(inner),
  ]);
}

describe("what must never be in the file", () => {
  it("carries no password hash, anywhere", async () => {
    // The single most important assertion here. An export is a file somebody
    // emails to themselves; a hash in it is a breach with a long tail. The
    // procedure uses explicit `select` clauses rather than `include` precisely
    // so that a new column cannot arrive in this file by default — this is the
    // test that notices if that discipline slips.
    const exported = await owner.data.exportHousehold();
    const dump = JSON.stringify(exported);

    // The hash lives in a related row (the credential Account), so the way it
    // would arrive is a relation selected beside the members' columns. The
    // value check catches it under any key; the key check catches the column
    // even if a hash ever stopped looking like Argon2id. (`notes.passwords`,
    // the sentence saying hashes are never exported, is not one of them.)
    expect(dump).not.toContain("$argon2");
    expect(
      keysOf(exported).filter((key) =>
        /^(password|passwordHash|accounts)$/i.test(key),
      ),
    ).toEqual([]);
  });

  it("carries no authenticator secret or backup codes", async () => {
    // `TwoFactor` is a credential like the password hash: a relation of the
    // member, so it would arrive the same way, selected beside the columns.
    const exported = await owner.data.exportHousehold();

    expect(JSON.stringify(exported)).not.toContain(AUTHENTICATOR_SECRET);
    expect(
      keysOf(exported).filter((key) =>
        /^(twoFactor|secret|backupCodes)$/i.test(key),
      ),
    ).toEqual([]);
  });

  it("carries no passkey", async () => {
    // A credential like the others (D151): public, but the export is the
    // household's data, not how its members sign in.
    const exported = await owner.data.exportHousehold();

    expect(JSON.stringify(exported)).not.toContain(PASSKEY_PUBLIC_KEY);
    expect(
      keysOf(exported).filter((key) =>
        /^(passkeys?|publicKey|credentialID)$/i.test(key),
      ),
    ).toEqual([]);
  });

  it("carries no whole-image OCR dump", async () => {
    // `Receipt.rawOcrText` is a machine's reading of the photograph, kept for
    // reprocessing. It is regenerable from the image and is the largest text in
    // the database, so it is not worth the file size.
    const dump = JSON.stringify(await owner.data.exportHousehold());

    expect(dump).not.toContain("TICKET COMPLETO SEGUN EL OCR");
  });

  it("does keep each line's own text, which is different", async () => {
    // The distinction the first version of this test got wrong, and the note
    // now states: a line's `rawText` is the evidence for how that line was
    // parsed — "this said LECHE ENTERA 1,19 and we read €1.19 from it". Drop
    // it and the parsed numbers in the export have nothing behind them.
    const exported = await owner.data.exportHousehold();

    expect(exported.receipts[0]?.items[0]?.rawText).toBe("LECHE ENTERA 1,19");
  });

  it("says what it left out rather than leaving it to be noticed", async () => {
    const exported = await owner.data.exportHousehold();

    expect(exported.notes.images).toMatch(/uploads/i);
    expect(exported.notes.passwords).toMatch(/never/i);
  });
});

describe("what must be in it", () => {
  it("carries every kind of thing the household owns", async () => {
    // An export missing a table is a broken promise that looks like a working
    // feature, so this asserts presence per collection rather than a total.
    const exported = await owner.data.exportHousehold();

    expect(exported.household?.name).toBe(HOUSEHOLD);
    expect(exported.members.length).toBe(2);
    expect(exported.locations.length).toBe(1);
    expect(exported.stores.length).toBe(1);
    expect(exported.products.length).toBe(1);
    expect(exported.receipts.length).toBe(1);
    expect(exported.shoppingLists.length).toBe(1);
  });

  it("keeps the shape, not just the rows", async () => {
    // The reason it is JSON rather than CSV: a spreadsheet flattens a household
    // into one table and loses which entry belongs to which product.
    const exported = await owner.data.exportHousehold();
    const product = exported.products[0];

    expect(product?.stockEntries).toHaveLength(2);
    expect(product?.priceRecords).toHaveLength(1);
    expect(exported.receipts[0]?.items).toHaveLength(1);
    expect(exported.shoppingLists[0]?.items).toHaveLength(1);
  });

  it("keeps which batch a consumption drew from", async () => {
    // Without it the file holds the sum and not what each batch has left,
    // so the expiry of what remains cannot be read back from it.
    const exported = await owner.data.exportHousehold();
    const entries = exported.products[0]?.stockEntries ?? [];
    const purchase = entries.find((entry) => entry.quantity > 0);
    const consumption = entries.find((entry) => entry.quantity < 0);

    expect(consumption?.batchId).toBe(purchase?.id);
  });

  it("references receipt images by path", async () => {
    // Not embedded: base64ing a year of photographs turns a small file into one
    // most editors will not open. The path is what makes the uploads volume
    // matchable afterwards.
    const exported = await owner.data.exportHousehold();

    expect(exported.receipts[0]?.imagePath).toContain("uploads/receipts/");
  });

  it("says which shape it is, from the first version", async () => {
    // Added now rather than when it first breaks: anything reading these files
    // later needs to know, and adding the field afterwards means the earliest
    // exports are the ones that cannot say.
    const exported = await owner.data.exportHousehold();

    expect(exported.formatVersion).toBe(1);
    expect(exported.exportedAt).toBeInstanceOf(Date);
  });
});

describe("who may take it", () => {
  it("refuses a member", async () => {
    // The whole household in one file, including everybody's name and address.
    // The capability matrix already puts "see account data and emails" behind
    // admin; an export is that, in bulk.
    let thrown: unknown;
    try {
      await member.data.exportHousehold();
    } catch (error) {
      thrown = error;
    }

    expect((thrown as TRPCError)?.code).toBe("FORBIDDEN");
  });

  it("gives an admin only their own household", async () => {
    const other = await createTestHousehold({ name: OTHER });
    await prisma.product.create({
      data: {
        name: "Secreto ajeno",
        defaultUnit: "unit",
        householdId: other.id,
      },
    });

    const dump = JSON.stringify(await owner.data.exportHousehold());

    expect(dump).not.toContain("Secreto ajeno");
  });
});
