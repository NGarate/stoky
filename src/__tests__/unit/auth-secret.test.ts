import { describe, it, expect } from "bun:test";
import {
  MIN_SECRET_LENGTH,
  PLACEHOLDER_SECRET,
  assertUsableSecret,
  secretProblem,
} from "@/lib/auth/secret";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The signing key, and refusing to start without a real one.
 *
 * `NEXTAUTH_SECRET` signs the session JWT. Auth.js reads it from the
 * environment itself and never inspects it, so until this nothing in the
 * application had ever looked at what it was — while `.env.example` ships a
 * placeholder that is published in this repository. An instance deployed with
 * that value signs sessions with a key anybody can read, and nothing about it
 * looks wrong from outside.
 */

const REAL = "kPqR7vN2xL9mT4wY6zA8bC1dE3fG5hJ0kL2mN4pQ6rS=";

describe("in production", () => {
  it("refuses the example value, which is in this repository", () => {
    // The assertion this file exists for.
    expect(secretProblem(PLACEHOLDER_SECRET, "production")).toMatch(
      /published in this repository/i,
    );
  });

  it("refuses a missing secret", () => {
    expect(secretProblem(undefined, "production")).toMatch(/not set/i);
    expect(secretProblem("", "production")).toMatch(/not set/i);
    expect(secretProblem("   ", "production")).toMatch(/not set/i);
  });

  it("refuses something short enough to guess", () => {
    expect(secretProblem("hunter2", "production")).toMatch(/at least/i);
  });

  it("accepts what the documented command produces", () => {
    // `.env.example` tells an operator to run `openssl rand -base64 32`, which
    // gives 44 characters. A rule that refused its own instructions would be
    // worse than no rule.
    expect(secretProblem(REAL, "production")).toBeNull();
    expect(REAL.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  });

  it("says which file and which command, not just 'invalid'", () => {
    // The person reading this is looking at a container that will not start.
    for (const value of [undefined, PLACEHOLDER_SECRET, "short"]) {
      expect(secretProblem(value, "production")).toContain("openssl rand -base64 32");
    }
  });
});

describe("everywhere else", () => {
  it("allows anything in development", () => {
    // Refusing here would trade a risk nobody faces for an obstacle everybody
    // does. The suites and `bun run dev` use whatever is to hand.
    expect(secretProblem(PLACEHOLDER_SECRET, "development")).toBeNull();
    expect(secretProblem(undefined, "test")).toBeNull();
    expect(secretProblem("x", undefined)).toBeNull();
  });
});

describe("how it refuses", () => {
  it("throws, rather than warning", () => {
    // A container that will not start is fixed in the first minute. A running
    // instance signing sessions with a public key is found when it is used.
    expect(() => assertUsableSecret(PLACEHOLDER_SECRET, "production")).toThrow(
      /refusing to start/i,
    );
  });

  it("stays out of the way when the secret is real", () => {
    expect(() => assertUsableSecret(REAL, "production")).not.toThrow();
  });
});

describe("the placeholder it checks for", () => {
  it("is the one actually in .env.example", () => {
    // If somebody rewords the template, this guard silently stops matching and
    // the hole reopens with every test still green.
    const template = readFileSync(join(import.meta.dir, "../../../.env.example"), "utf8");

    expect(template).toContain(PLACEHOLDER_SECRET);
  });
});
