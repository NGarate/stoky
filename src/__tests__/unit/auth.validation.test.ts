import { describe, it, expect } from "bun:test";
import {
  loginSchema,
  registerSchema,
  createHouseholdSchema,
  inviteMemberSchema,
  type LoginInput,
  type RegisterInput,
  type CreateHouseholdInput,
  type InviteMemberInput,
} from "@/lib/validations/auth";

describe("Authentication Validation Schemas", () => {
  describe("loginSchema", () => {
    it("should accept valid email and password", () => {
      const validInput: LoginInput = {
        email: "user@example.com",
        password: "password123",
      };

      const result = loginSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject invalid email format", () => {
      const invalidInput = {
        email: "invalid-email",
        password: "password123",
      };

      const result = loginSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("accepts a password shorter than the current policy", () => {
      // Deliberate, and the opposite of what this test used to assert. The
      // policy governs a password being *set*; refusing one at sign-in because
      // the rule changed locks people out of their own household. See
      // `validations/password.ts` and ISSUES.md DEBT-1.
      const result = loginSchema.safeParse({
        email: "user@example.com",
        password: "short",
      });

      expect(result.success).toBe(true);
    });

    it("still refuses a password long enough to be an attack", () => {
      // The one bound that is not about the person: Argon2id here is 64 MB per
      // call, on an endpoint reachable without an account.
      const result = loginSchema.safeParse({
        email: "user@example.com",
        password: "a".repeat(129),
      });

      expect(result.success).toBe(false);
    });

    it("should reject empty email", () => {
      const invalidInput = {
        email: "",
        password: "password123",
      };

      const result = loginSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject empty password", () => {
      const invalidInput = {
        email: "user@example.com",
        password: "",
      };

      const result = loginSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should accept complex email addresses", () => {
      const validEmails = [
        "user+tag@example.com",
        "user.name@example.co.uk",
        "user123@test-domain.com",
      ];

      for (const email of validEmails) {
        const result = loginSchema.safeParse({
          email,
          password: "password123",
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("registerSchema", () => {
    it("should accept valid registration data", () => {
      const validInput: RegisterInput = {
        email: "newuser@example.com",
        name: "John Doe",
        password: "securepass123",
      };

      const result = registerSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept registration with optional household name", () => {
      const validInput: RegisterInput = {
        email: "newuser@example.com",
        name: "John Doe",
        password: "securepass123",
        householdName: "My Home",
      };

      const result = registerSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject empty name", () => {
      const invalidInput = {
        email: "user@example.com",
        name: "",
        password: "password123",
      };

      const result = registerSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject missing name field", () => {
      const invalidInput = {
        email: "user@example.com",
        password: "password123",
      };

      const result = registerSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should accept minimal valid input", () => {
      const minimalInput: RegisterInput = {
        email: "a@b.co",
        name: "A",
        // Twelve characters, no composition rules — DEBT-1 answered against
        // NIST SP 800-63B §5.1.1.2 rather than against its own suggestion.
        password: "nevera cocina",
      };

      const result = registerSchema.safeParse(minimalInput);
      expect(result.success).toBe(true);
    });

    it("stores an address in the one spelling sign-in looks up", () => {
      // Registration kept the case as typed and sign-in compared exactly, so
      // "Noel@Example.com" could register and then never sign in as
      // "noel@example.com" — or register a second account under it.
      const registered = registerSchema.parse({
        email: "  Noel@Example.COM ",
        name: "Noel",
        password: "nevera cocina despensa",
      });
      const signingIn = loginSchema.parse({
        email: "NOEL@example.com",
        password: "nevera cocina despensa",
      });

      expect(registered.email).toBe("noel@example.com");
      expect(signingIn.email).toBe(registered.email);
    });

    it("refuses a password that is only long enough for the old rule", () => {
      const result = registerSchema.safeParse({
        email: "a@b.co",
        name: "A",
        password: "12345678",
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("Household Validation Schemas", () => {
  describe("createHouseholdSchema", () => {
    it("should accept valid household name", () => {
      const validInput: CreateHouseholdInput = {
        name: "My Household",
      };

      const result = createHouseholdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject empty household name", () => {
      const invalidInput = {
        name: "",
      };

      const result = createHouseholdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only name", () => {
      const invalidInput = {
        name: "   ",
      };

      const result = createHouseholdSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should accept single character name", () => {
      const validInput: CreateHouseholdInput = {
        name: "H",
      };

      const result = createHouseholdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept long household names", () => {
      const validInput: CreateHouseholdInput = {
        name: "A".repeat(100),
      };

      const result = createHouseholdSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe("inviteMemberSchema", () => {
    it("should accept valid member invitation", () => {
      const validInput: InviteMemberInput = {
        email: "member@example.com",
        role: "MEMBER",
      };

      const result = inviteMemberSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept invitation with default role", () => {
      const validInput = {
        email: "member@example.com",
      };

      const result = inviteMemberSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe("MEMBER");
      }
    });

    it("should accept all valid role types", () => {
      const roles = ["OWNER", "ADMIN", "MEMBER"] as const;

      for (const role of roles) {
        const result = inviteMemberSchema.safeParse({
          email: "member@example.com",
          role,
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid role", () => {
      const invalidInput = {
        email: "member@example.com",
        role: "SUPERADMIN",
      };

      const result = inviteMemberSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject invalid email", () => {
      const invalidInput = {
        email: "not-an-email",
        role: "MEMBER",
      };

      const result = inviteMemberSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
