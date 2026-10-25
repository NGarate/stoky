import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
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

/** -1, 0 or 1, comparing two `x.y.z` versions numerically. */
function compare(a: string, b: string): number {
  const parts = (v: string) =>
    v.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parts(a);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = parts(b);
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Whether `version` satisfies `range`, for the two forms this file may see.
 *
 * The operator is honoured rather than stripped. An earlier version removed a
 * leading `>=` and then still demanded the majors match, so a `>=8.0.0` range
 * satisfied by 9.0.1 would have been reported as "the override did not take" —
 * a red gate describing the opposite of what happened. Nothing here uses `>=`
 * today, which is exactly why it would have gone unnoticed until somebody added
 * one; an unknown operator throws rather than guessing.
 */
function satisfiesFloor(version: string, range: string): boolean {
  const caret = /^\^(.+)$/.exec(range);
  if (caret) {
    const floor = caret[1] as string;
    // A caret range pins the major deliberately — that is what makes the
    // deepmerge-ts entry a decision rather than a drift.
    return (
      version.split(".")[0] === floor.split(".")[0] &&
      compare(version, floor) >= 0
    );
  }

  const atLeast = /^>=\s*(.+)$/.exec(range);
  if (atLeast) return compare(version, atLeast[1] as string) >= 0;

  throw new Error(
    `package-overrides.test.ts cannot read the range "${range}". Teach it that operator rather than loosening the check.`,
  );
}

describe("the dependency overrides", () => {
  it("are exactly the ones docs/STATUS.md explains, by name", () => {
    // `toEqual` on the whole set, not a count and not a loop over whatever
    // happens to be declared.
    //
    // Every other assertion here iterates `manifest.overrides`, so deleting an
    // entry deletes its own check — the most obvious way a security override
    // stops taking effect was the one thing invisible to this file. Naming them
    // makes removing one a decision, the same shape as the capability matrix in
    // `capabilities.test.ts`. Adding one is a decision too: it fails here until
    // `docs/STATUS.md` § Dependency security says why it exists.
    expect(Object.keys(manifest.overrides ?? {}).sort()).toEqual([
      "brace-expansion",
      "deepmerge-ts",
      "defu",
      "effect",
      "fast-uri",
      "nanoid",
    ]);
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

      expect(
        version,
        `"${name}" is overridden in package.json but absent from bun.lock`,
      ).not.toBeNull();
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
    expect(
      Number.parseInt((version as string).split(".")[0], 10),
    ).toBeGreaterThanOrEqual(8);
  });
});

describe("the packages allowed to run install scripts", () => {
  it("are exactly the four whose scripts the install needs", () => {
    // Every entry runs its code at install time, with network access and — on a
    // developer machine — the repository's `.env` in its environment (Bun
    // exports it to lifecycle scripts; `--no-env-file` and bunfig `env = false`
    // do not stop it). So the list is exact, not a floor: an entry added
    // "just in case" is a package trusted with that for nothing.
    //
    // - argon2: `install` is node-gyp-build, which picks the shipped prebuild
    //   (musl and glibc, x64 and arm64) and compiles only if none matches.
    // - @prisma/engines: `postinstall` downloads the query and schema engines.
    // - @prisma/client: `postinstall` writes the stub client `prisma generate`
    //   later replaces.
    // - prisma: `preinstall` only checks the runtime version. Same publisher
    //   and release as the two above, so it trusts no new party.
    //
    // Deliberately absent, and why (measured 2026-10-12): sharp 0.35.5 has no
    // install script; tesseract.js's is a donation banner; @parcel/watcher's
    // builds from source only under npm_config_build_from_source=true;
    // @swc/core's only checks its prebuilt binding and, if that fails, runs
    // `npm install @swc/wasm` from outside the lockfile. The last two are
    // next-intl's, for a message extractor next.config.ts does not enable, yet
    // its plugin imports both whenever the config loads — so every build loads
    // their bindings, which come from optional platform packages with no script.
    //
    // The key must stay, even short: without it Bun falls back to its own
    // curated default allow-list of popular packages (pm/lifecycle.mdx), which
    // this list replaces rather than extends.
    expect([...(manifest.trustedDependencies ?? [])].sort()).toEqual([
      "@prisma/client",
      "@prisma/engines",
      "argon2",
      "prisma",
    ]);
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

describe("the release-age gate", () => {
  // Nothing else depends on this `bunfig.toml` setting, so nothing would
  // notice it gone: installs keep working, every gate stays green, and the
  // next `bun add` or `bun update` locks in whatever the registry published a
  // minute earlier.
  // SECURITY.md § Supply chain has the reasoning.
  const bunfig = require(join(ROOT, "bunfig.toml")) as {
    install?: {
      minimumReleaseAge?: unknown;
      minimumReleaseAgeExcludes?: unknown;
    };
  };
  const THREE_DAYS = 3 * 24 * 60 * 60;

  it("holds back anything published in the last three days", () => {
    const age = bunfig.install?.minimumReleaseAge;
    expect(
      typeof age,
      "bunfig.toml [install] minimumReleaseAge is missing",
    ).toBe("number");
    expect(age as number).toBeGreaterThanOrEqual(THREE_DAYS);
  });

  it("exempts no package", () => {
    // An exclusion is permanent where the gate's own bypasses are not: a fix
    // too young for the gate goes in through `bun audit fix` or a one-off
    // `--minimum-release-age 0`, and the gate stays whole for the next update.
    const excludes = bunfig.install?.minimumReleaseAgeExcludes;
    expect(
      excludes === undefined ||
        (Array.isArray(excludes) && excludes.length === 0),
    ).toBe(true);
  });

  it("is no longer than Dependabot's cooldown for the lockfile", () => {
    // Dependabot proposes a version once it is `default-days` old and rewrites
    // bun.lock with its own Bun in a checkout of this repository, where Bun
    // reads bunfig.toml. Not yet observed (no Dependabot pull request has run
    // here), but if it does, a gate longer than that wait refuses the version
    // the pull request exists to add.
    const dependabot = Bun.YAML.parse(
      readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8"),
    ) as {
      updates: {
        "package-ecosystem": string;
        cooldown?: { "default-days"?: number };
      }[];
    };
    const bun = dependabot.updates.find(
      (update) => update["package-ecosystem"] === "bun",
    );
    const cooldownDays = bun?.cooldown?.["default-days"];

    expect(
      typeof cooldownDays,
      "the bun entry in .github/dependabot.yml has no cooldown",
    ).toBe("number");
    expect(bunfig.install?.minimumReleaseAge as number).toBeLessThanOrEqual(
      (cooldownDays as number) * 24 * 60 * 60,
    );
  });
});
