import { describe, it, expect } from "bun:test";
import { Prisma } from "@/generated/prisma/client";
import { describeError } from "@/server/log-error";

/**
 * What `describeError` keeps of each kind of Prisma error, and what it drops.
 *
 * The messages are Prisma 6.19.3's own, measured against the real client:
 * they are the shapes the server log would otherwise receive verbatim.
 * `trpc-error-shape.test.ts` checks the same thing end to end, through the
 * `errorFormatter`, for the validation error.
 */

const CLIENT = { clientVersion: "6.19.3" };

function described(error: unknown): string {
  const result = describeError(error);
  expect(typeof result).toBe("string");
  return result as string;
}

describe("describeError", () => {
  it("drops a validation error's argument tree, from the message and the stack", () => {
    const error = new Prisma.PrismaClientValidationError(
      [
        "",
        "Invalid `prisma.user.findMany()` invocation:",
        "",
        "{",
        "  where: {",
        '    role: "MARKERROLE"',
        "          ~~~~~~~~~~~~",
        "  }",
        "}",
        "",
        "Invalid value for argument `role`. Expected HouseholdRole.",
      ].join("\n"),
      CLIENT,
    );

    const line = described(error);

    expect(line).not.toContain("MARKERROLE");
    expect(line).toContain("PrismaClientValidationError (Prisma 6.19.3)");
    expect(line).toContain("Invalid `prisma.user.findMany()` invocation");
    expect(line).toContain(
      "Invalid value for argument `role`. Expected HouseholdRole.",
    );
    // The frames survive; a 500 nobody can place is a 500 nobody can fix.
    expect(line).toMatch(/\n\s+at /);
  });

  it("keeps where Prisma says the call was made", () => {
    const error = new Prisma.PrismaClientValidationError(
      [
        "",
        "Invalid `db.user.create()` invocation in",
        "/app/src/server/trpc/routers/auth.ts:91:24",
        "",
        "  90 const user = await tx.user.create({",
        '→ 91   data: { email: "MARKER@example.com" }',
        "",
        "Argument `name` is missing.",
      ].join("\n"),
      CLIENT,
    );

    const line = described(error);

    expect(line).not.toContain("MARKER@example.com");
    expect(line).toContain(
      "Invalid `db.user.create()` invocation in /app/src/server/trpc/routers/auth.ts:91:24",
    );
    expect(line).toContain("Argument `name` is missing.");
  });

  it("drops a request error's text and meta values, keeping the code and SQLSTATE", () => {
    // A raw query whose input Postgres refused: its message quotes the input,
    // in the error's text and again in `meta`.
    const postgres = 'ERROR: invalid input syntax for type uuid: "MARKERRAW"';
    const error = new Prisma.PrismaClientKnownRequestError(
      [
        "",
        "Invalid `prisma.$queryRaw()` invocation:",
        "",
        "",
        `Raw query failed. Code: \`22P02\`. Message: \`${postgres}\``,
      ].join("\n"),
      { ...CLIENT, code: "P2010", meta: { code: "22P02", message: postgres } },
    );

    const line = described(error);

    expect(line).not.toContain("MARKERRAW");
    expect(line).toContain("PrismaClientKnownRequestError P2010");
    expect(line).toContain("Invalid `prisma.$queryRaw()` invocation");
    expect(line).toContain("meta keys: code, message");
    expect(line).toContain("SQLSTATE 22P02");
  });

  it("does not take a line of the message for a stack frame", () => {
    // A raw query's input with a newline and "    at " in it, quoted back by
    // Postgres — and so in the message the stack starts with. Measured with
    // the real client: `SELECT ${"x\n    at MARKER"}::uuid`.
    const postgres =
      'ERROR: invalid input syntax for type uuid: "x\n    at MARKERINJECT (evil)"';
    const error = new Prisma.PrismaClientKnownRequestError(
      [
        "",
        "Invalid `prisma.$queryRaw()` invocation:",
        "",
        "",
        `Raw query failed. Code: \`22P02\`. Message: \`${postgres}\``,
      ].join("\n"),
      { ...CLIENT, code: "P2010", meta: { code: "22P02", message: postgres } },
    );

    const line = described(error);

    expect(line).not.toContain("MARKERINJECT");
    expect(line).toMatch(/\n\s+at /);
  });

  it("drops an unknown request error's engine dump", () => {
    const error = new Prisma.PrismaClientUnknownRequestError(
      [
        "",
        "Invalid `prisma.user.findMany()` invocation:",
        "",
        "",
        "Error occurred during query execution:",
        'ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "22P02", message: "invalid input syntax: \\"MARKERDUMP\\"" }) })',
      ].join("\n"),
      CLIENT,
    );

    const line = described(error);

    expect(line).not.toContain("MARKERDUMP");
    expect(line).toContain("PrismaClientUnknownRequestError (Prisma 6.19.3)");
    expect(line).toContain("Invalid `prisma.user.findMany()` invocation");
  });

  it("keeps an initialisation error's message, which is the database-down signal", () => {
    const error = new Prisma.PrismaClientInitializationError(
      [
        "",
        "Invalid `prisma.user.findMany()` invocation:",
        "",
        "",
        "Can't reach database server at `db:5432`",
        "",
        "Please make sure your database server is running at `db:5432`.",
      ].join("\n"),
      "6.19.3",
      "P1001",
    );

    const line = described(error);

    expect(line).toContain("PrismaClientInitializationError P1001");
    expect(line).toContain("Can't reach database server at `db:5432`");
  });

  it("returns anything that is not a Prisma error as it is", () => {
    const error = new Error("the OCR service answered 502");

    expect(describeError(error)).toBe(error);
    expect(describeError("a string")).toBe("a string");
  });
});
