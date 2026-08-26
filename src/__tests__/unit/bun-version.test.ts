import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One Bun version, in two files that cannot see each other.
 *
 * `.bun-version` is what CI installs — three jobs read it through
 * `oven-sh/setup-bun`. The Dockerfile pins its own, because a `FROM` cannot
 * read a file. So the number exists twice, and the two drifting apart means
 * CI proves the suites pass on a runtime nobody deploys.
 *
 * That is not hypothetical: it happened the moment the image was pinned to
 * 1.4.0 while this file still said 1.3.14, and it survived a green pipeline
 * because nothing compared them. Development moving into the image is the
 * whole point of that work; a CI job testing a different Bun would have
 * hollowed it out quietly.
 *
 * Asserted here rather than solved with a build argument. An `ARG` would move
 * the number into the build command, which is one more place to pass it and
 * forget — this fails instead, on every run, for free.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");

describe("the Bun version is pinned once", () => {
  it("has the Dockerfile agree with .bun-version", () => {
    const pinned = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

    const from = /FROM\s+oven\/bun:([0-9]+\.[0-9]+\.[0-9]+)-alpine/.exec(
      dockerfile,
    );

    // If this is null the Dockerfile stopped pinning a version — a floating
    // tag can change the test runner underneath a green suite, which is the
    // reason it is pinned at all.
    expect(from?.[1]).toBe(pinned);
  });

  it("pins a version rather than a moving tag", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

    expect(dockerfile).not.toContain("oven/bun:1-alpine");
    expect(dockerfile).not.toContain("oven/bun:latest");
  });
});
