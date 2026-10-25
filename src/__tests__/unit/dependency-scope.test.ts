import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `dependencies` lists what the application runs; everything else is a
 * devDependency.
 *
 * The production image never reads the split. Its builder installs both
 * sections, and what ships is Next's traced standalone output plus the two
 * trees `scripts/stage-runtime-deps.ts` copies, neither of which consults the
 * root manifest's sections. So a compiler filed under `dependencies` costs
 * nothing in the image, and nothing in the build goes red for it.
 *
 * What does read the split is everything that reasons about the repository
 * from `package.json`: GitHub's dependency graph, the scope Dependabot gives an
 * alert ("runtime" or "development"), and any SBOM made from the manifest
 * rather than the image. TypeScript, the three `@types/*` packages, Tailwind
 * and PostCSS sat in `dependencies` until the 2026-10 security review, so an
 * advisory against any of them would have been triaged as a production
 * exposure of an application that does not contain them. (PostCSS keeps a
 * runtime path regardless: `next` declares its own pinned copy as a dependency,
 * which no entry here can change.) The release SBOM is generated from the image
 * by BuildKit and was never affected.
 *
 * The rule this holds is checkable rather than a list of names: every entry in
 * `dependencies` is imported by code that ships, or is named below with the
 * reason it runs without being imported. Written that way it also found
 * `server-only`, a scaffolding entry nothing imported (Next aliases the name
 * to its own compiled copy in any case), which was removed rather than
 * excused.
 */

const ROOT = join(import.meta.dir, "..", "..", "..");

const manifest = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const dependencies = Object.keys(manifest.dependencies ?? {});

/** Runtime packages that shipped code reaches without an import of its own. */
const RUNTIME_WITHOUT_IMPORT: Record<string, string> = {
  prisma: "the image runs `prisma migrate deploy` from /opt/prisma on start",
  "react-dom":
    "Next renders with it; it is a peer of next, not an import of ours",
};

/** Source files that end up in what ships: `src/` outside the test suite, and the Next config. */
function shippedFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "__tests__") continue;
    if (statSync(path).isDirectory()) shippedFiles(path, found);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) found.push(path);
  }
  return found;
}

const sources = [
  ...shippedFiles(join(ROOT, "src")),
  join(ROOT, "next.config.ts"),
].map((path) => readFileSync(path, "utf8"));

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An import of `name` or a subpath of it: `from`, dynamic `import()`, `require()`, or a bare side-effect `import`. */
function importOf(name: string): RegExp {
  return new RegExp(
    String.raw`(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']` +
      escape(name) +
      String.raw`(?:["']|/)`,
  );
}

function isImported(name: string): boolean {
  const pattern = importOf(name);
  return sources.some((source) => pattern.test(source));
}

describe("dependencies holds only what the application runs", () => {
  it("scans something, so the checks below are not vacuous", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(dependencies.length).toBeGreaterThan(20);
    expect(isImported("next-intl")).toBe(true);
    expect(isImported("not-a-package-anyone-imports")).toBe(false);
  });

  it("recognises each way an import is written, and only the package named", () => {
    const pkg = importOf("pkg");
    for (const line of [
      `import { a } from "pkg";`,
      `import type { A } from 'pkg/sub';`,
      `await import("pkg")`,
      `require( 'pkg' )`,
      `import "pkg";`,
    ]) {
      expect(pkg.test(line)).toBe(true);
    }
    for (const line of [
      `from "pkg-other"`,
      `from "@scope/pkg"`,
      `// pkg is not imported`,
    ]) {
      expect(pkg.test(line)).toBe(false);
    }
  });

  it("finds every runtime dependency imported by shipped code, or named with its reason", () => {
    const unexplained = dependencies.filter(
      (name) => !(name in RUNTIME_WITHOUT_IMPORT) && !isImported(name),
    );
    expect(unexplained).toEqual([]);
  });

  it("names no package in the exceptions that is not a runtime dependency", () => {
    // A stale exception is a hole: a package listed here passes the check
    // above however it got into `dependencies`.
    for (const name of Object.keys(RUNTIME_WITHOUT_IMPORT)) {
      expect(dependencies).toContain(name);
      expect(isImported(name)).toBe(false);
    }
  });

  it("files type packages as devDependencies, since types never run", () => {
    expect(dependencies.filter((name) => name.startsWith("@types/"))).toEqual(
      [],
    );
    expect(manifest.devDependencies?.["@types/node"]).toBeDefined();
  });
});
