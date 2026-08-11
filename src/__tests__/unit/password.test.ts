import { describe, it, expect } from "bun:test";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  existingPasswordSchema,
  newPasswordSchema,
  passwordProblems,
} from "@/lib/validations/password";
import { loginSchema, registerSchema } from "@/lib/validations/auth";
import { addMemberSchema } from "@/lib/validations/household";

/**
 * ISSUES.md DEBT-1, answered against NIST SP 800-63B rather than against the
 * entry's own suggestion.
 *
 * DEBT-1 proposed four composition regexes. §5.1.1.2 advises against them:
 * they push people toward `Password1!` and are the reason passwords get
 * written down. This project already cites SP 800-63B for rate limiting, so
 * applying it here and ignoring it there would be choosing the easy half.
 */

const GOOD = "cocina despensa nevera";

describe("length", () => {
  it("asks for twelve characters, not eight", () => {
    expect(passwordProblems("Short1!x")).toContain("tooShort");
    expect(passwordProblems(GOOD)).toEqual([]);
  });

  it("accepts a long passphrase without asking for a symbol", () => {
    // The whole point of preferring length: this is stronger than `Password1!`
    // and easier to remember, and composition rules would have refused it.
    expect(newPasswordSchema.safeParse("la nevera de la cocina").success).toBe(
      true,
    );
  });

  it("caps the length, which is not a usability rule", () => {
    // Argon2id here is 64 MB per call, on two endpoints reachable without an
    // account. Unbounded input turns registration into a memory amplifier; the
    // rate limiter bounds how often, not how much.
    const enormous = "a".repeat(MAX_PASSWORD_LENGTH + 1);

    expect(passwordProblems(enormous)).toContain("tooLong");
    expect(newPasswordSchema.safeParse(enormous).success).toBe(false);
  });

  it("accepts well past what SP 800-63B asks a verifier to allow", () => {
    expect(MAX_PASSWORD_LENGTH).toBeGreaterThanOrEqual(64);
    expect(newPasswordSchema.safeParse("x".repeat(64)).success).toBe(true);
  });
});

describe("what everybody picks", () => {
  it("refuses a password from the top of every leak", () => {
    for (const attempt of ["password1234", "123456789012", "contrasena12"]) {
      expect(passwordProblems(attempt), attempt).toContain("common");
    }
  });

  it("does not care about case when it checks", () => {
    expect(passwordProblems("PassWord1234")).toContain("common");
  });
});

describe("the account's own name", () => {
  it("refuses a password containing the address it belongs to", () => {
    expect(
      passwordProblems("noelgarate2026", { email: "noelgarate@example.com" }),
    ).toContain("containsIdentity");
  });

  it("refuses a password containing the person's name", () => {
    expect(passwordProblems("carmen la cocinera", { name: "Carmen" })).toContain(
      "containsIdentity",
    );
  });

  it("does not trip on a two-letter name that appears everywhere", () => {
    // "Al" inside "personal" is a coincidence, not a weak password.
    expect(passwordProblems("la despensa personal", { name: "Al" })).toEqual([]);
  });

  it("says nothing about identity when none was given", () => {
    expect(passwordProblems(GOOD)).toEqual([]);
  });
});

describe("reporting", () => {
  it("names every problem at once, not the first one", () => {
    // A form that reports one rule at a time makes somebody guess their way
    // through them, which is §7 rule 4 from the other direction.
    const problems = passwordProblems("noel", { email: "noel@example.com" });

    expect(problems).toContain("tooShort");
    expect(problems).toContain("containsIdentity");
  });
});

describe("where the policy applies", () => {
  it("governs registration", () => {
    const attempt = registerSchema.safeParse({
      email: "someone@example.com",
      name: "Someone",
      password: "short",
    });
    expect(attempt.success).toBe(false);
  });

  it("governs an account an admin creates", () => {
    // A weaker rule here would be the way round the rule there.
    expect(
      addMemberSchema.safeParse({
        name: "Tablet",
        email: "tablet@example.com",
        password: "short",
        role: "KITCHEN",
      }).success,
    ).toBe(false);
  });

  it("does not lock out an account created before it existed", () => {
    // A verifier that refuses a stored password because the policy changed
    // locks people out of their own household.
    expect(
      loginSchema.safeParse({
        email: "someone@example.com",
        password: "Demo1234!",
      }).success,
    ).toBe(true);
  });

  it("still caps what sign-in will hash", () => {
    expect(
      existingPasswordSchema.safeParse("a".repeat(MAX_PASSWORD_LENGTH + 1))
        .success,
    ).toBe(false);
  });
});

describe("the numbers themselves", () => {
  it("is twelve and one-two-eight", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});
