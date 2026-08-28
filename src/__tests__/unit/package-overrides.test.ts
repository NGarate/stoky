import { describe, it, expect } from "bun:test";
import { join } from "node:path";

/**
 * The security overrides, and the one way they fail without saying so.
 *
 * These five entries exist because a transitive dependency had an advisory and
 * no parent release to move to — `docs/STATUS.md` § Dependency security has the
 * history, including the deepmerge-ts one that crosses a major because 7.x has
 * no fix.
 *
 * Under pnpm they lived in `pnpm-workspace.yaml` and were **scoped to the one
 * parent that pulls each package**, written `"@prisma/config>effect"`. Bun does
 * not understand that syntax — and, critically, does not reject it. It reads
 * the whole string as a package name, matches nothing, and installs the
 * vulnerable version with no warning and a zero exit code. Copying the file
 * across during the migration would have restored four advisories and left
 * every gate green; `bun audit` was the only thing that noticed.
 *
 * So this file asserts the two halves that a silent no-op breaks:
 *
 * 1. **No key uses the scoped syntax**, because a key that contains `>` is
 *    inert here however right it looks.
 * 2. **Each override actually moved the tree.** An override can also be inert
 *    by being wrong — a typo'd name, a range nothing satisfies — and the only
 *    honest test of "it took" is the version the lockfile resolved. This reads
 *    `bun.lock` rather than `node_modules`, so it answers for the tree everyone
 *    installs rather than the one this machine happens to hold.
 *
 * `bun audit` in CI is the backstop and catches the same class. It is not a
 * replacement: it needs the network, it answers about *published* advisories,
 * and it says "vulnerability" rather than "the override you wrote does nothing".
 */
const ROOT = join(import.meta.dir, "..", "..", "..");

type LockPackages = Record<string, [string, ...unknown[]]>;

// `require`, not `readFileSync` + `JSON.parse`: `bun.lock` is JSONC and strict
// JSON.parse rejects it. Bun's loader handles the format the tool it ships with
// writes.
const lock = require(join(ROOT, "bun.lock")) as {
  lockfileVersion: number;
  overrides?: Record<string, string>;
  trustedDependencies?: string[];
  packages: LockPackages;
};

const manifest = require(join(ROOT, "package.json")) as {
  overrides?: Record<string, string>;
  trustedDependencies?: string[];
};

/** The version `bun.lock` resolved a top-level package to, or null. */
function resolvedVersion(name: string): string | null {
  const entry = lock.packages[name];
  if (entry === undefined) return null;
  const [descriptor] = entry;
  // "effect@3.22.1" — the name may itself contain an `@` when scoped, so the
  // separator is the last one.
  const at = descriptor.lastIndexOf("@");
  return at <= 0 ? null : descriptor.slice(at + 1);
}

/** True when `version` is at or above the floor in a `^x.y.z` range. */
function satisfiesFloor(version: string, range: string): boolean {
  const floor = range.replace(/^[\^~>=]+/, "");
  const asNumbers = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10));
  const [vMajor = 0, vMinor = 0, vPatch = 0] = asNumbers(version);
  const [fMajor = 0, fMinor = 0, fPatch = 0] = asNumbers(floor);
  if (vMajor !== fMajor) return false;
  if (vMinor !== fMinor) return vMinor > fMinor;
  return vPatch >= fPatch;
}

describe("the dependency overrides", () => {
  it("are declared at all", () => {
    // A guard against the migration's other silent failure: the keys simply not
    // being carried across. `pnpm-workspace.yaml` held them until 2026-08-28.
    expect(Object.keys(manifest.overrides ?? {}).length).toBeGreaterThan(0);
  });

  it("use no key pnpm would understand and bun would ignore", () => {
    for (const key of Object.keys(manifest.overrides ?? {})) {
      expect(
        key.includes(">"),
        `"${key}" is pnpm's parent-scoped syntax. Bun does not reject it — it matches nothing, installs the version the override was written to prevent, and exits 0.`,
      ).toBe(false);
    }
  });

  it("reached the lockfile, every one of them", () => {
    for (const [name, range] of Object.entries(manifest.overrides ?? {})) {
      const version = resolvedVersion(name);

      expect(version, `"${name}" is overridden in package.json but absent from bun.lock`).not.toBeNull();
      expect(
        satisfiesFloor(version as string, range),
        `"${name}" resolved to ${version}, below the ${range} the override asks for — the override did not take`,
      ).toBe(true);
    }
  });

  it("still holds the advisory that has no fix below a major", () => {
    // GHSA-ggr8-5vv4-36mx. `@prisma/config` pins `deepmerge-ts` at exactly
    // 7.1.5 and there is no 7.x with the fix, so this is the one entry that
    // crosses a major deliberately. Named here rather than left to the loop
    // above, because it is the one whose removal would look reasonable.
    const version = resolvedVersion("deepmerge-ts");
    expect(version).not.toBeNull();
    expect(Number.parseInt((version as string).split(".")[0], 10)).toBeGreaterThanOrEqual(8);
  });
});

describe("the packages allowed to run install scripts", () => {
  it("are declared, or four native builds are skipped in silence", () => {
    // Bun blocks dependency lifecycle scripts by default, which is the right
    // default. argon2 and @swc/core compile bindings, prisma and @prisma/client
    // generate the client, @parcel/watcher builds from source: without this key
    // each is skipped with no error and fails later at import.
    const declared = manifest.trustedDependencies ?? [];
    for (const required of ["argon2", "prisma", "@prisma/client", "@swc/core", "@parcel/watcher"]) {
      expect(declared, `${required} needs its install script`).toContain(required);
    }
  });

  it("is the list the lockfile recorded", () => {
    // The two are written independently — package.json by hand, bun.lock by the
    // installer — so a divergence means the committed lockfile was produced
    // from a different manifest than the committed one.
    expect([...(lock.trustedDependencies ?? [])].sort()).toEqual(
      [...(manifest.trustedDependencies ?? [])].sort(),
    );
  });
});
