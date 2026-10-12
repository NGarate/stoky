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

    // The version is the tag in front of the `@sha256:` digest. Whether the
    // digest is there is `image-posture.test.ts`'s to assert, not this one's.
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

  it("has a lockfile the pinned Bun wrote, not an older one", () => {
    // The third file that cannot see the other two, and the one the migration
    // off pnpm added. `bun.lock` has a format version, and 1.4.0 writes 2 where
    // 1.3.14 writes 1 — so the number says which Bun produced the tree everyone
    // installs.
    //
    // The asymmetry is what makes this worth asserting. A newer Bun reads an
    // older lockfile fine, so a downgrade goes unnoticed; an *older* Bun
    // reading a newer one prints "Unknown lockfile version", then "Ignoring
    // lockfile", and resolves whatever the registry offers today. Only
    // `--frozen-lockfile` turns that into an error, and a developer running
    // plain `bun install` does not get it — they get a silently unpinned tree
    // and a rewritten lockfile to commit.
    //
    // corepack used to make this impossible by refusing the wrong manager
    // outright. Nothing replaces it, so the check lives here and in
    // `scripts/dev-local.sh`, which compares `bun --version` before installing.
    //
    // Update this number when the pin moves and the format moves with it —
    // that failure is the point, not noise.
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const version = /"lockfileVersion"\s*:\s*(\d+)/.exec(lock);

    expect(version?.[1]).toBe("2");
  });
});
