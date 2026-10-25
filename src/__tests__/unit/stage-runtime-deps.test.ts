import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageRuntimeDependencies } from "../../../scripts/stage-runtime-deps";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stoky-runtime-deps-"));
  fixtures.push(root);
  const project = join(root, "project");
  const output = join(root, "staged", "node_modules");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), "{}");
  function pkg(
    name: string,
    manifest: object = {},
    body = "module.exports = 'present';",
    parent = project,
  ) {
    const path = join(parent, "node_modules", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js", ...manifest }),
    );
    writeFileSync(join(path, "index.js"), body);
    return path;
  }
  return { root, project, output, pkg };
}

describe("staging installed runtime dependencies", () => {
  it("copies locked package files even when Bun treats their name as built-in", () => {
    const { root, project, output, pkg } = fixture();
    pkg("entry", { dependencies: { "node-fetch": "2" } });
    pkg("node-fetch", {}, "module.exports = 'installed node-fetch bytes';");
    stageRuntimeDependencies("entry", output, project);
    rmSync(project, { recursive: true });
    expect(
      createRequire(join(root, "loader.cjs"))(
        join(output, "entry/node_modules/node-fetch"),
      ),
    ).toBe("installed node-fetch bytes");
  });

  it("runs scoped and nested dependencies after the source tree is removed and the output moves", () => {
    const { root, project, output, pkg } = fixture();
    pkg(
      "entry",
      { dependencies: { branch: "1", shared: "1" } },
      "module.exports = [require('shared'), ...require('branch')];",
    );
    const branch = pkg(
      "branch",
      { dependencies: { shared: "2", "@example/leaf": "1" } },
      "module.exports = [require('shared'), require('@example/leaf/public')];",
    );
    pkg("shared", {}, "module.exports = 'root version';");
    pkg(
      "shared",
      { version: "2.0.0" },
      "module.exports = 'nested version';",
      branch,
    );
    pkg(
      "@example/leaf",
      { exports: { "./public": "./index.js" } },
      "module.exports = 'scoped';",
    );

    stageRuntimeDependencies("entry", output, project);
    rmSync(project, { recursive: true });
    const moved = join(root, "production-node-modules");
    renameSync(output, moved);
    expect(
      createRequire(join(root, "loader.cjs"))(join(moved, "entry")),
    ).toEqual(["root version", "nested version", "scoped"]);
  });

  it("closes dependency cycles with relative links that still resolve at runtime", () => {
    const { root, project, output, pkg } = fixture();
    pkg(
      "entry",
      { dependencies: { child: "1" } },
      "exports.value = 'entry'; exports.fromChild = require('child').value;",
    );
    pkg(
      "child",
      { dependencies: { entry: "1" } },
      "exports.value = require('entry').value;",
    );

    stageRuntimeDependencies("entry", output, project);
    const backEdge = join(
      output,
      "entry/node_modules/child/node_modules/entry",
    );
    expect(readlinkSync(backEdge).startsWith("/")).toBe(false);
    rmSync(project, { recursive: true });
    expect(
      createRequire(join(root, "loader.cjs"))(join(output, "entry")).fromChild,
    ).toBe("entry");
  });

  it("includes present optional dependencies and omits absent optional, development and unrelated installed packages", () => {
    const { root, project, output, pkg } = fixture();
    const entry = pkg(
      "entry",
      {
        optionalDependencies: { installed: "1", unavailable: "1" },
        devDependencies: { development: "1" },
      },
      "module.exports = require('installed');",
    );
    pkg("installed", {}, "module.exports = 'optional runtime';");
    pkg("development", {}, undefined, entry);
    pkg("unrelated", {}, undefined, entry);

    stageRuntimeDependencies("entry", output, project);
    rmSync(project, { recursive: true });
    expect(createRequire(join(root, "loader.cjs"))(join(output, "entry"))).toBe(
      "optional runtime",
    );
    for (const name of ["unavailable", "development", "unrelated"]) {
      expect(existsSync(join(output, "entry/node_modules", name))).toBe(false);
    }
  });

  it("fails the build when an installed package is missing a required dependency", () => {
    const { project, output, pkg } = fixture();
    pkg("entry", { dependencies: { missing: "1" } });
    expect(() => stageRuntimeDependencies("entry", output, project)).toThrow(
      "Missing runtime dependency missing",
    );
  });
});
