import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/scan-bundle-images.sh` is the gate a release's service images pass
 * (ci.yml, release-images) and the check run before a tag. These tests run it
 * against a stub `docker` that answers `compose config` from a fixture and,
 * for `run`, executes the script's in-container program under `sh` with a stub
 * `trivy`, the way install-script.test stubs curl: what is under test is which
 * images reach the scanner and with which rule, not Trivy.
 */

const root = join(import.meta.dir, "../../..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

const POSTGRES = "postgres:16.15-alpine@sha256:" + "1".repeat(64);
const VALKEY = "valkey/valkey:8.1.10-alpine@sha256:" + "2".repeat(64);
const TRAEFIK = "traefik:v3.7.16@sha256:" + "3".repeat(64);
const APP = "ghcr.io/ngarate/stoky:v0.0.0";

const bundle = {
  services: {
    db: { image: POSTGRES },
    cache: { image: VALKEY },
    app: { image: APP },
    traefik: { image: TRAEFIK },
  },
};

function setup(options: { services?: Record<string, { image?: string }>; red?: string[]; broken?: string[] } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-scan-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "deploy", "bin", "trivy-bin"]) mkdirSync(join(fixture, directory));
  copyFileSync(join(root, "scripts/scan-bundle-images.sh"), join(fixture, "scripts/scan-bundle-images.sh"));
  writeFileSync(join(fixture, "deploy/docker-compose.yml"), "# read through the stub\n");
  writeFileSync(join(fixture, "compose.json"), JSON.stringify({ services: options.services ?? bundle.services }));
  writeFileSync(join(fixture, "red"), (options.red ?? []).map((image) => `${image}\n`).join(""));
  writeFileSync(join(fixture, "broken"), (options.broken ?? []).map((image) => `${image}\n`).join(""));
  const log = join(fixture, "calls");
  writeFileSync(log, "");

  // docker: `compose ... config --format json` prints the fixture; `run ...
  // IMAGE -c PROGRAM NAME ARGS...` runs PROGRAM under sh, with the stub trivy
  // first on PATH, as the Trivy image's entrypoint override would.
  writeFileSync(
    join(fixture, "bin/docker"),
    `#!/bin/bash
printf 'docker' >> "${log}"; printf ' [%s]' "$@" >> "${log}"; echo >> "${log}"
if [ "$1" = compose ]; then cat "${join(fixture, "compose.json")}"; exit 0; fi
if [ "$1" = run ]; then
  while [ "$#" -gt 0 ] && [ "$1" != -c ]; do shift; done
  shift
  PATH="${join(fixture, "trivy-bin")}:$PATH" exec sh -c "$@"
fi
exit 99
`,
    { mode: 0o755 },
  );
  // trivy: records its arguments; red for an image listed in the fixture.
  writeFileSync(
    join(fixture, "trivy-bin/trivy"),
    `#!/bin/sh
printf 'trivy' >> "${log}"; printf ' [%s]' "$@" >> "${log}"; echo >> "${log}"
for last; do :; done
# Trivy's own convention: the --exit-code value on a finding, 1 on its errors.
if grep -Fxq "$last" "${join(fixture, "broken")}"; then exit 1; fi
if grep -Fxq "$last" "${join(fixture, "red")}"; then exit 3; fi
exit 0
`,
    { mode: 0o755 },
  );

  const run = (...images: string[]) =>
    Bun.spawnSync(["bash", "scripts/scan-bundle-images.sh", ...images], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    });
  const calls = (tool: string) =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(`${tool} `))
      .map((line) => [...line.matchAll(/\[([^\]]*)\]/g)].map(([, arg]) => arg));
  /** The image each trivy call scanned: its last argument. */
  const scanned = () => calls("trivy").map((args) => args.at(-1));
  return { run, calls, scanned };
}

describe("scanning the release bundle's service images", () => {
  it("scans every service image the Compose file names, leaving out the application", () => {
    const { run, scanned } = setup();
    const result = run();
    expect(result.exitCode).toBe(0);
    expect(scanned().toSorted()).toEqual([POSTGRES, TRAEFIK, VALKEY].toSorted());
  });

  it("applies the release gate's rule to every image", () => {
    const { run, calls } = setup();
    expect(run().exitCode).toBe(0);
    for (const args of calls("trivy")) {
      expect(args[0]).toBe("image");
      expect(args.join(" ")).toContain("--severity CRITICAL,HIGH");
      expect(args).toContain("--ignore-unfixed");
      // 3, not 1: Trivy exits 1 on its own errors, which are not findings.
      expect(args.join(" ")).toContain("--exit-code 3");
      expect(args.join(" ")).toContain("--image-src remote");
    }
  });

  // One file, measured unreachable (RELEASING.md); a wider skip is a new
  // decision, and no other image gets it.
  it("leaves out postgres's gosu, and only postgres's", () => {
    const { run, calls } = setup();
    expect(run().exitCode).toBe(0);
    for (const args of calls("trivy")) {
      const skip = args.indexOf("--skip-files");
      if (args.at(-1) === POSTGRES) {
        expect(args[skip + 1]).toBe("usr/local/bin/gosu");
        expect(args.filter((arg) => arg === "--skip-files")).toHaveLength(1);
      } else {
        expect(skip).toBe(-1);
      }
      expect(args).not.toContain("--skip-dirs");
      expect(args).not.toContain("--ignorefile");
    }
  });

  it("fails when one image has a finding, after scanning every other one", () => {
    const { run, scanned } = setup({ red: [VALKEY] });
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(scanned()).toHaveLength(3);
    expect(result.stderr.toString()).toContain("would be refused");
  });

  // A scanner that did not finish has not vouched for the image, and must not
  // be reported as a finding: on 2026-10-23 a 404 fetching Trivy's database
  // read as a vulnerability in every image.
  it("tells a scanner failure from a finding, and lets neither pass", () => {
    const broken = setup({ broken: [TRAEFIK] });
    const failed = broken.run();
    expect(failed.exitCode).toBe(2);
    expect(failed.stderr.toString()).toContain("did not finish");
    expect(failed.stderr.toString()).not.toContain("would be refused");
    expect(broken.scanned()).toHaveLength(3);
    // A failure on one image outranks a finding on another.
    expect(setup({ red: [VALKEY], broken: [TRAEFIK] }).run().exitCode).toBe(2);
    expect(setup({ red: [VALKEY] }).run().exitCode).toBe(1);
  });

  it("scans the images it is given instead of the Compose file's", () => {
    const { run, calls, scanned } = setup();
    const candidate = "traefik:v3.7.17";
    expect(run(candidate).exitCode).toBe(0);
    expect(scanned()).toEqual([candidate]);
    expect(calls("docker").some((args) => args[0] === "compose")).toBe(false);
  });

  it("refuses a service with no image rather than scanning less", () => {
    const { run, calls } = setup({ services: { ...bundle.services, cache: {} } });
    expect(run().exitCode).toBe(2);
    expect(calls("trivy")).toHaveLength(0);
  });

  // The scanner is pinned by digest and runs with nothing of the host's: no
  // cache directory a previous run could have planted a database in, and no
  // Docker socket. `--image-src remote` reads the registry instead.
  it("runs a pinned Trivy, with no volume and no Docker socket", () => {
    const { run, calls } = setup();
    expect(run().exitCode).toBe(0);
    const runs = calls("docker").filter((args) => args[0] === "run");
    expect(runs).toHaveLength(1);
    const [args] = runs;
    const image = args.find((arg) => arg.startsWith("aquasec/trivy:"));
    expect(image).toMatch(/^aquasec\/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    for (const flag of ["-v", "--volume", "--mount", "--privileged"]) expect(args).not.toContain(flag);
    expect(args.join(" ")).not.toContain("docker.sock");
  });

  it("uses the Trivy version ci.yml's release gate and rescan.yml use", () => {
    const script = readFileSync(join(root, "scripts/scan-bundle-images.sh"), "utf8");
    const version = script.match(/^TRIVY_VERSION="([\d.]+)"$/m)?.[1];
    const pinned = script.match(/^TRIVY_IMAGE="aquasec\/trivy:\$\{TRIVY_VERSION\}@sha256:[0-9a-f]{64}"$/m);
    expect(pinned).not.toBeNull();
    if (version === undefined) throw new Error("scan-bundle-images.sh sets no TRIVY_VERSION");
    for (const workflow of ["ci.yml", "rescan.yml"]) {
      const source = readFileSync(join(root, ".github/workflows", workflow), "utf8");
      const versions = [...source.matchAll(/^\s+version: v([\d.]+)$/gm)].map(([, v]) => v);
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) expect(v).toBe(version);
    }
  });
});
