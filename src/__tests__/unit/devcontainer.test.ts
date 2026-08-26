import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The devcontainer points at something that exists.
 *
 * `devcontainer.json` names a compose file and a service inside it, and
 * nothing in this repository's gates opens that file — the editor discovers
 * the mistake, on somebody's machine, when they try to start work. Renaming
 * the `app` service or moving the compose file would leave a configuration
 * that reads fine and resolves to nothing.
 *
 * Parsed as JSONC, because `devcontainer.json` allows comments and this one
 * uses them: stripping them here is cheaper than giving up the explanation of
 * why `overrideCommand` and `shutdownAction` are set the way they are.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** Enough of JSONC for this file: line comments, and nothing inside strings. */
function parseJsonc(source: string): Record<string, unknown> {
  const stripped = source
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

  return JSON.parse(stripped) as Record<string, unknown>;
}

const config = parseJsonc(
  readFileSync(join(ROOT, ".devcontainer", "devcontainer.json"), "utf8"),
);

describe("the devcontainer", () => {
  it("names a compose file that is there", () => {
    const files = config.dockerComposeFile as string[];
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(existsSync(join(ROOT, ".devcontainer", file))).toBe(true);
    }
  });

  it("names a service that compose defines", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");

    // Matched at the indentation compose services sit at, so a `service:`
    // key nested inside something else cannot satisfy this by accident.
    expect(compose).toContain(`\n  ${config.service as string}:`);
  });

  it("works in the directory the image puts the source in", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

    expect(config.workspaceFolder).toBe("/app");
    expect(dockerfile).toContain("WORKDIR /app");
  });
});
