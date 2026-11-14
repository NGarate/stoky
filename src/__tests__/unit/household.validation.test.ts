import { describe, it, expect } from "bun:test";
import {
  householdSchema,
  addMemberSchema,
  type HouseholdInput,
} from "@/lib/validations/household";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";

describe("Household Validation Schemas", () => {
  describe("householdSchema", () => {
    it("should accept valid household data", () => {
      const validInput: HouseholdInput = {
        name: "My Household",
      };

      const result = householdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject empty name", () => {
      const invalidInput = {
        name: "",
      };

      const result = householdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject missing name", () => {
      const invalidInput = {};

      const result = householdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should accept household name with special characters", () => {
      const validInput: HouseholdInput = {
        name: "My Home & Garden!",
      };

      const result = householdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it.each(["tabName", "appName"])(
      "trims %s, stores an empty one as null and leaves a missing one alone",
      (field) => {
        const parse = (value?: string) =>
          householdSchema.parse({ name: "Casa", [field]: value })[
            field as "tabName" | "appName"
          ];

        expect(parse("  Casa García  ")).toBe("Casa García");
        // Null is the default: the tab says Stoky, the app the household's name.
        expect(parse("")).toBeNull();
        expect(parse("   ")).toBeNull();
        // Absent is "not this time", which Prisma leaves untouched.
        expect(parse(undefined)).toBeUndefined();
      },
    );

    it.each(["tabName", "appName"])("bounds %s like the name", (field) => {
      // Both are served without a session, in HTML and in JSON.
      expect(
        householdSchema.safeParse({
          name: "Casa",
          [field]: "x".repeat(MAX_NAME_LENGTH),
        }).success,
      ).toBe(true);
      expect(
        householdSchema.safeParse({
          name: "Casa",
          [field]: "x".repeat(MAX_NAME_LENGTH + 1),
        }).success,
      ).toBe(false);
    });
  });

  describe("addMemberSchema", () => {
    // The admin sets this password for somebody else, which makes the
    // person's own name the first thing a hurried admin reaches for.
    const member = {
      name: "Lucía",
      email: "lucia.m@example.com",
      role: "KITCHEN" as const,
    };

    it("accepts a password unrelated to the person", () => {
      expect(
        addMemberSchema.safeParse({
          ...member,
          password: "tablet despensa nevera",
        }).success,
      ).toBe(true);
    });

    it("refuses one containing their name", () => {
      const result = addMemberSchema.safeParse({
        ...member,
        password: "lucía de la cocina",
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["password"]);
    });

    it("refuses one containing their address's local part", () => {
      expect(
        addMemberSchema.safeParse({
          ...member,
          password: "lucia.m-2026-tablet",
        }).success,
      ).toBe(false);
    });
  });
});
