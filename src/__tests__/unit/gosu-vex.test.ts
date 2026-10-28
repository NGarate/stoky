import { afterEach, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/gosu-vex.sh` turns govulncheck's verdict on the postgres image's
 * gosu into a VEX document Trivy applies to the weekly report (rescan.yml).
 * These run it against a stub `docker` whose `run` prints a govulncheck-shaped
 * document, so what is under test is the rewrite Trivy depends on and the
 * container cleanup, not govulncheck.
 */

const root = join(import.meta.dir, "../../..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

const IMAGE = "postgres:16.15-alpine@sha256:" + "1".repeat(64);

/** govulncheck -format openvex, as v1.9.0 writes it. */
const statement = (name: string, purl: string, status: string) => ({
  vulnerability: { name, aliases: [`CVE-${name}`] },
  products: [{ "@id": "Unknown Product", subcomponents: [{ "@id": purl }] }],
  status,
  ...(status === "not_affected" && {
    justification: "vulnerable_code_not_present",
  }),
});
const GOVULNCHECK = {
  "@context": "https://openvex.dev/ns/v0.2.0",
  author: "Unknown Author",
  statements: [
    statement("GO-2025-4006", "pkg:golang/stdlib@v1.24.6", "not_affected"),
    statement(
      "GO-2026-6686",
      "pkg:golang/github.com%2Fmoby%2Fsys%2Fuser@v0.1.0",
      "affected",
    ),
  ],
};

function setup(options: { govulncheck?: unknown; cpFails?: boolean } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-gosu-vex-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "bin"])
    mkdirSync(join(fixture, directory));
  copyFileSync(
    join(root, "scripts/gosu-vex.sh"),
    join(fixture, "scripts/gosu-vex.sh"),
  );
  writeFileSync(
    join(fixture, "govulncheck.json"),
    JSON.stringify(options.govulncheck ?? GOVULNCHECK),
  );
  const log = join(fixture, "calls");
  writeFileSync(log, "");
  writeFileSync(
    join(fixture, "bin/docker"),
    `#!/bin/sh
printf 'docker' >> "${log}"; printf ' [%s]' "$@" >> "${log}"; echo >> "${log}"
case "$1" in
  create) echo stub-container ;;
  cp) ${options.cpFails ? "exit 1" : `: > "$3"`} ;;
  rm) ;;
  run) cat "${join(fixture, "govulncheck.json")}" ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  );

  const out = join(fixture, "gosu.openvex.json");
  const run = () =>
    Bun.spawnSync(["sh", "scripts/gosu-vex.sh", IMAGE, out], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      },
    });
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [...line.matchAll(/\[([^\]]*)\]/g)].map(([, a]) => a));
  const written = () => JSON.parse(readFileSync(out, "utf8"));
  return { run, calls, written, out };
}

describe("gosu's VEX document", () => {
  it("names each package by the purl Trivy gives it, not as a subcomponent of nothing", () => {
    const { run, written } = setup();
    expect(run().exitCode).toBe(0);

    const products = written().statements.map(
      (s: { products: unknown }) => s.products,
    );
    expect(products).toEqual([
      [{ "@id": "pkg:golang/stdlib@v1.24.6" }],
      [{ "@id": "pkg:golang/github.com/moby/sys/user@v0.1.0" }],
    ]);
  });

  it("keeps govulncheck's verdicts, so a reachable advisory stays in the report", () => {
    const { run, written } = setup();
    expect(run().exitCode).toBe(0);

    expect(
      written().statements.map((s: { status: string }) => s.status),
    ).toEqual(["not_affected", "affected"]);
    expect(written().statements[0].justification).toBe(
      "vulnerable_code_not_present",
    );
  });

  it("scans the binary from the image it was given, with the pinned govulncheck", () => {
    const { run, calls } = setup();
    expect(run().exitCode).toBe(0);

    const call = (command: string) =>
      calls().find(([first]) => first === command) ?? [];
    expect(call("create")).toEqual(["create", IMAGE]);
    expect(call("cp")[1]).toBe("stub-container:/usr/local/bin/gosu");
    const scan = call("run").join(" ");
    expect(scan).toMatch(/golang:[\d.]+-alpine@sha256:[0-9a-f]{64}/);
    expect(scan).toContain("govulncheck@v");
    expect(scan).toContain("-mode=binary -format openvex");
    expect(calls().at(-1)).toEqual(["rm", "stub-container"]);
  });

  it("refuses a document with no statement rather than vouching for nothing", () => {
    const { run, out } = setup({ govulncheck: { statements: [] } });
    const result = run();

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("no statement");
    expect(existsSync(out) ? readFileSync(out, "utf8") : "").toBe("");
  });

  it("removes the container it created, even when the copy fails", () => {
    const { run, calls } = setup({ cpFails: true });

    expect(run().exitCode).not.toBe(0);
    expect(calls()).toContainEqual(["rm", "stub-container"]);
  });
});
