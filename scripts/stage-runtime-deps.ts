import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Copy the installed runtime graph, preserving nested versions and cycles. */
export function stageRuntimeDependencies(entry: string, output: string, projectRoot = process.cwd()): void {
  const destination = resolve(output);
  const copied = new Map<string, string>();

  function locate(name: string, parent: string): string | undefined {
    // Inspect installed manifests rather than loading package code or using
    // require.resolve: Bun treats node-fetch as built-in and returns no lookup
    // paths for it, but the deployed OCR worker still needs its installed files.
    let directory = parent;
    while (true) {
      if (basename(directory) !== "node_modules") {
        const candidate = join(directory, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
      }
      const ancestor = dirname(directory);
      if (ancestor === directory) break;
      directory = ancestor;
    }
    return undefined;
  }

  function copy(name: string, parent: string, target: string, optional = false): void {
    const source = locate(name, parent);
    if (!source) {
      if (optional) return;
      throw new Error(`Missing runtime dependency ${name} required by ${parent}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    const previous = copied.get(source);
    if (previous) {
      // Relative links survive COPY into the final image. They also close
      // cycles without duplicating the same package or recursing forever.
      symlinkSync(relative(dirname(target), previous), target, "dir");
      return;
    }
    copied.set(source, target);
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) => path !== join(source, "node_modules"),
    });
    const manifest: PackageManifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const optionalDependencies = manifest.optionalDependencies ?? {};
    for (const dependency of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(optionalDependencies),
    ])) {
      copy(dependency, source, join(target, "node_modules", dependency), dependency in optionalDependencies);
    }
  }

  copy(entry, resolve(projectRoot), join(destination, entry));
}

if (import.meta.main) {
  const [entry, output] = process.argv.slice(2);
  if (!entry || !output) throw new Error("Usage: bun scripts/stage-runtime-deps.ts PACKAGE OUTPUT_DIRECTORY");
  stageRuntimeDependencies(entry, output);
}
