import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The generated Prisma client lives where three other files expect it.
 *
 * `prisma generate` writes the client to schema.prisma's generator `output`,
 * inside the source tree since the prisma-client generator. Each of these
 * depends on that path and none can see the schema:
 *
 * - `.gitignore`, because the client is generated per checkout;
 * - `.dockerignore`, because each image stage generates its own, and a
 *   host copy in the build context would only be stale;
 * - `scripts/ci-in-image.sh` and docker-compose.yml's `app`, which mount the
 *   checkout over the image's /app and keep the image's client with an
 *   anonymous volume, as they keep node_modules. A CI checkout has no client
 *   (it is ignored), so without the volume every suite run in the image loses
 *   it: measured, in a fresh clone, test:unit failed on the modules that
 *   import it. Developing in the image from such a checkout is the same.
 *
 * Moving the output without them is the failure this catches.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function generatorOutput(): string {
  const generator = /generator client \{([^}]*)\}/.exec(
    read("prisma/schema.prisma"),
  )?.[1];
  const output = /^\s*output\s*=\s*"([^"]+)"/m.exec(generator ?? "")?.[1];
  expect(output, "schema.prisma's generator names no output").toBeDefined();
  // Relative to the schema's directory, as Prisma resolves it.
  return relative(ROOT, resolve(ROOT, "prisma", output!));
}

/** The top directory the output sits in, e.g. src/generated. */
function generatedDir(): string {
  const parts = generatorOutput().split("/");
  return parts.slice(0, 2).join("/");
}

describe("the generated Prisma client", () => {
  it("is written under src/generated", () => {
    expect(generatorOutput()).toBe("src/generated/prisma");
  });

  it("is ignored by git", () => {
    expect(read(".gitignore").split("\n")).toContain(`${generatedDir()}/`);
  });

  it("stays out of the Docker build context", () => {
    expect(read(".dockerignore").split("\n")).toContain(generatedDir());
  });

  it("survives ci-in-image.sh mounting the checkout over the image", () => {
    expect(read("scripts/ci-in-image.sh")).toContain(
      `--volume /app/${generatedDir()} \\`,
    );
  });

  it("survives the development container mounting the checkout", () => {
    expect(read("docker-compose.yml").split("\n")).toContain(
      `      - /app/${generatedDir()}`,
    );
  });
});
