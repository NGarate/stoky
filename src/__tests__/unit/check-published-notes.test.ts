import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/check-published-notes.sh` is what notices a published release
 * telling operators something its file no longer says (the v0.1.0-alpha.2
 * recovery steps did for ten days). These run it against a stub `gh` whose
 * releases are written here.
 */

const root = join(import.meta.dir, "../../..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function setup(published: Record<string, string>, files: Record<string, string>, options: { listFails?: boolean } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-notes-check-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "docs/releases", "bin", "published"]) {
    mkdirSync(join(fixture, directory), { recursive: true });
  }
  copyFileSync(join(root, "scripts/check-published-notes.sh"), join(fixture, "scripts/check-published-notes.sh"));
  for (const [tag, body] of Object.entries(published)) writeFileSync(join(fixture, "published", tag), body);
  for (const [tag, body] of Object.entries(files)) writeFileSync(join(fixture, "docs/releases", `${tag}.md`), body);
  const log = join(fixture, "calls");
  writeFileSync(log, "");
  // gh: `release list` prints the published tags; `release view TAG` its body.
  writeFileSync(
    join(fixture, "bin/gh"),
    `#!/bin/bash
echo "$*" >> "${log}"
if [ "$1 $2" = "release list" ]; then
  ${options.listFails ? "exit 1" : `ls "${join(fixture, "published")}"; exit 0`}
fi
if [ "$1 $2" = "release view" ]; then cat "${join(fixture, "published")}/$3"; exit 0; fi
exit 99
`,
    { mode: 0o755 },
  );
  const run = (...args: string[]) =>
    Bun.spawnSync(["bash", "scripts/check-published-notes.sh", ...args], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    });
  return { run, log };
}

describe("checking published release notes against their files", () => {
  it("passes when every published release says what its file says", () => {
    const { run } = setup({ "v0.1.0": "# One\n\nText.", "v0.2.0": "# Two\r\n\r\nText.\r\n" }, { "v0.1.0": "# One\n\nText.\n", "v0.2.0": "# Two\n\nText.\n\n" });
    const result = run();
    expect(result.stdout.toString()).toContain("2 published release(s) compared.");
    expect(result.exitCode).toBe(0);
  });

  it("names the release that differs, and how to publish the file", () => {
    const { run } = setup(
      { "v0.1.0": "Restart and it works.", "v0.2.0": "Same." },
      { "v0.1.0": "Restart, then clear the failed migration.\n", "v0.2.0": "Same.\n" },
    );
    const result = run();
    const out = result.stdout.toString();
    expect(result.exitCode).toBe(1);
    expect(out).toContain("gh release edit v0.1.0 --notes-file docs/releases/v0.1.0.md");
    expect(out).toContain("+Restart and it works.");
    expect(out).toContain("ok     v0.2.0");
  });

  it("fails on a published release with no file", () => {
    const { run } = setup({ "v0.1.0": "Notes." }, {});
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("docs/releases/v0.1.0.md does not exist");
  });

  it("asks only about published releases", () => {
    const { run, log } = setup({ "v0.1.0": "Notes." }, { "v0.1.0": "Notes.\n" });
    expect(run().exitCode).toBe(0);
    const list = readFileSync(log, "utf8").split("\n").find((line) => line.startsWith("release list"));
    expect(list).toContain("--exclude-drafts");
  });

  it("never reads a path from a tag that is not a version", () => {
    const { run } = setup({ "v0.1.0": "Notes.", latest: "Notes." }, { "v0.1.0": "Notes.\n" });
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("'latest' is not a version tag");
  });

  it("says GitHub could not be asked, rather than that nothing differs", () => {
    const { run } = setup({}, {}, { listFails: true });
    expect(run().exitCode).toBe(2);
  });
});
