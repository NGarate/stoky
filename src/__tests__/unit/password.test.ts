import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_CONTAINS_IDENTITY_MESSAGE,
  existingPasswordSchema,
  isPasswordIdentityRefusal,
  newPasswordSchema,
  passwordProblems,
  withIdentityRule,
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

/**
 * The identity rule at the level a request meets it.
 *
 * Every case above calls `passwordProblems` directly with an identity, and
 * they all passed for months while no schema ever passed one: registration and
 * add-a-member accepted `noelgarate2026` for `noelgarate@example.com`
 * (security review, 2026-10-12). These go through the schemas themselves.
 */
describe("the identity rule, where a password is set", () => {
  const schemas = {
    registration: (fields: { email: string; name: string; password: string }) =>
      registerSchema.safeParse(fields),
    "an account an admin creates": (fields: {
      email: string;
      name: string;
      password: string;
    }) => addMemberSchema.safeParse({ ...fields, role: "MEMBER" }),
  };

  for (const [where, parse] of Object.entries(schemas)) {
    describe(where, () => {
      it("refuses the address's local part inside the password", () => {
        const attempt = parse({
          email: "noelgarate@example.com",
          name: "Noel Garate",
          password: "noelgarate2026",
        });

        expect(attempt.success).toBe(false);
        expect(attempt.error?.issues).toContainEqual(
          expect.objectContaining({
            path: ["password"],
            message: PASSWORD_CONTAINS_IDENTITY_MESSAGE,
          }),
        );
      });

      it("refuses the whole address as the password", () => {
        const attempt = parse({
          email: "noelgarate@example.com",
          name: "Noel Garate",
          password: "noelgarate@example.com",
        });

        expect(attempt.success).toBe(false);
      });

      it("refuses the person's name inside the password", () => {
        const attempt = parse({
          email: "c.ruiz@example.com",
          name: "Carmen",
          password: "carmen la cocinera",
        });

        expect(attempt.error?.issues.map((issue) => issue.message)).toEqual([
          PASSWORD_CONTAINS_IDENTITY_MESSAGE,
        ]);
      });

      it("compares the address as stored, not as typed", () => {
        // The email field lowercases before the rule sees it, and the rule
        // lowercases the password: the case a person types changes neither.
        const attempt = parse({
          email: "  NoelGarate@Example.COM ",
          name: "Noel Garate",
          password: "NOELGARATE en la cocina",
        });

        expect(attempt.success).toBe(false);
      });

      it("accepts a passphrase that is not built from either", () => {
        // The control: without it, every refusal above could be the schema
        // refusing everything.
        const attempt = parse({
          email: "noelgarate@example.com",
          name: "Noel Garate",
          password: GOOD,
        });

        expect(attempt.success).toBe(true);
      });

      it("reports the identity alongside a length problem, not instead of it", () => {
        // An object refinement in Zod 3 still runs when a field is only
        // dirty, so a short password built from the name says both at once.
        const attempt = parse({
          email: "noel@example.com",
          name: "Noel",
          password: "noel1",
        });
        const messages = attempt.error?.issues.map((issue) => issue.message) ?? [];

        expect(messages).toContain(PASSWORD_CONTAINS_IDENTITY_MESSAGE);
        expect(messages.length).toBeGreaterThan(1);
      });
    });
  }

  it("attaches the issue to the password whatever the schema is", () => {
    const schema = withIdentityRule(
      z.object({ email: z.string(), name: z.string(), password: z.string() }),
    );

    expect(
      schema.safeParse({ email: "ana@example.com", name: "Ana", password: "ana" })
        .error?.issues,
    ).toEqual([
      expect.objectContaining({
        code: "custom",
        path: ["password"],
        message: PASSWORD_CONTAINS_IDENTITY_MESSAGE,
      }),
    ]);
  });

  it("is recognisable inside the JSON tRPC sends as the message", () => {
    // tRPC's BAD_REQUEST for a failed input carries the ZodError's own
    // message, which is its issues as JSON. That is what a screen receives.
    const refused = registerSchema.safeParse({
      email: "noel@example.com",
      name: "Noel",
      password: "noel en la cocina",
    });

    expect(isPasswordIdentityRefusal(refused.error?.message)).toBe(true);
    expect(isPasswordIdentityRefusal(undefined)).toBe(false);
    expect(
      isPasswordIdentityRefusal(
        registerSchema.safeParse({ email: "x@y.es", name: "X", password: "short" })
          .error?.message,
      ),
    ).toBe(false);
  });
});

describe("the numbers themselves", () => {
  it("is twelve and one-two-eight", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});
