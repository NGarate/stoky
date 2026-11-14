import { describe, it, expect } from "bun:test";
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
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
        householdName: "My Home",
      };

      const result = registerSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("refuses a registration without the household's name", () => {
      // Whoever registers founds the household and owns it; an account
      // without one had nothing to do but create one (HOUSE-1).
      for (const householdName of [undefined, "", "   "]) {
        const result = registerSchema.safeParse({
          email: "newuser@example.com",
          name: "John Doe",
          password: "securepass123",
          householdName,
        });

        expect(result.success, String(householdName)).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["householdName"]);
      }
    });

    it("should reject empty name", () => {
      const invalidInput = {
        email: "user@example.com",
        name: "",
        password: "password123",
        householdName: "Casa",
      };

      const result = registerSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("should reject missing name field", () => {
      const invalidInput = {
        email: "user@example.com",
        password: "password123",
        householdName: "Casa",
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
        householdName: "Casa",
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
        householdName: "Casa",
      });
      const signingIn = loginSchema.parse({
        email: "NOEL@example.com",
        password: "nevera cocina despensa",
      });

      expect(registered.email).toBe("noel@example.com");
      expect(signingIn.email).toBe(registered.email);
    });

    it("refuses a password built from the person's own address or name", () => {
      // SECURITY.md said this was refused; until the schema applied it, it
      // was not. The full set of cases lives in password.test.ts.
      for (const password of ["johndoe en casa", "john doe en casa"]) {
        const result = registerSchema.safeParse({
          email: "johndoe@example.com",
          name: "John Doe",
          password,
          householdName: "Casa",
        });

        expect(result.success, password).toBe(false);
        expect(result.error?.issues[0]?.path, password).toEqual(["password"]);
      }
    });

    it("refuses a password that is only long enough for the old rule", () => {
      const result = registerSchema.safeParse({
        email: "a@b.co",
        name: "A",
        password: "12345678",
        householdName: "Casa",
      });

      expect(result.success).toBe(false);
    });
  });
});
