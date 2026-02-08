import { describe, it, expect } from "bun:test";
import {
  householdSchema,
  updateHouseholdSchema,
  householdMemberSchema,
  type HouseholdInput,
  type UpdateHouseholdInput,
  type HouseholdMemberInput,
} from "@/lib/validations/household";

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
  });

  describe("updateHouseholdSchema", () => {
    it("should accept valid update data", () => {
      const validInput: UpdateHouseholdInput = {
        id: "household-id-123",
        name: "Updated Name",
      };

      const result = updateHouseholdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept partial update with only id", () => {
      const partialInput = {
        id: "household-id-123",
      };

      const result = updateHouseholdSchema.safeParse(partialInput);
      expect(result.success).toBe(true);
    });

    it("should accept partial update with only name", () => {
      const partialInput = {
        id: "household-id-123",
        name: "New Name",
      };

      const result = updateHouseholdSchema.safeParse(partialInput);
      expect(result.success).toBe(true);
    });

    it("should require id for update", () => {
      const invalidInput = {
        name: "New Name",
      };

      const result = updateHouseholdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject empty id", () => {
      const invalidInput = {
        id: "",
        name: "New Name",
      };

      const result = updateHouseholdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe("householdMemberSchema", () => {
    it("should accept valid member data", () => {
      const validInput: HouseholdMemberInput = {
        userId: "user-id-123",
        role: "ADMIN",
      };

      const result = householdMemberSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept all valid roles", () => {
      const roles: Array<"OWNER" | "ADMIN" | "MEMBER"> = ["OWNER", "ADMIN", "MEMBER"];

      for (const role of roles) {
        const result = householdMemberSchema.safeParse({
          userId: "user-id-123",
          role,
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid role", () => {
      const invalidInput = {
        userId: "user-id-123",
        role: "GUEST",
      };

      const result = householdMemberSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject empty userId", () => {
      const invalidInput = {
        userId: "",
        role: "MEMBER",
      };

      const result = householdMemberSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject missing userId", () => {
      const invalidInput = {
        role: "MEMBER",
      };

      const result = householdMemberSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
