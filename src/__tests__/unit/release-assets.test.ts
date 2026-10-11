import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const fixtures: string[] = [];
const tag = "v0.1.0-alpha.1";
const guide = (ref: string) => `https://github.com/NGarate/stoky/blob/${ref}/docs/INSTALL.md`;

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function setup(
  options: { packageVersion?: string; envVersion?: string; installVersion?: string; notes?: boolean; guideVersion?: string } = {},
) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-release-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "deploy", "docs/releases", "bin"]) {
    mkdirSync(join(fixture, directory), { recursive: true });
  }
  copyFileSync(join(root, "scripts/release-assets.sh"), join(fixture, "scripts/release-assets.sh"));
  // Project-owned release tooling must also work on a host with only Bun.
  writeFileSync(join(fixture, "bin/node"), "#!/bin/sh\necho 'Node must not be used' >&2\nexit 99\n", { mode: 0o755 });
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ version: options.packageVersion ?? "0.1.0-alpha.1" }));
  writeFileSync(join(fixture, "deploy/example.env"), `# ${guide("master")}\nSTOKY_VERSION=${options.envVersion ?? tag}\nNEXTAUTH_SECRET=\n`);
  writeFileSync(join(fixture, "deploy/docker-compose.yml"), `# ${guide("master")}\nservices:\n  app:\n    image: ghcr.io/example/stoky:\${STOKY_VERSION:?}\n`);
  writeFileSync(
    join(fixture, "deploy/install.sh"),
    `#!/bin/bash\n# ${guide("master")}\nDEFAULT_VERSION=${options.installVersion ?? tag}\n`,
  );
  writeFileSync(join(fixture, "deploy/traefik.yml"), "http:\n  services:\n    stoky:\n      loadBalancer:\n        servers:\n          - url: http://app:3000\n");
  // An operator's local credentials must never become a release attachment.
  writeFileSync(join(fixture, "deploy/.env"), "NEXTAUTH_SECRET=private-local-value\n");
  const guideVersion = options.guideVersion ?? tag;
  writeFileSync(join(fixture, "docs/INSTALL.md"), `This guide is for **${guideVersion}**.\n\ngh release download ${guideVersion}\n`);
  writeFileSync(join(fixture, "README.md"), `Status: ${tag}. See [notes](docs/releases/${tag}.md).\n`);
  if (options.notes !== false) writeFileSync(join(fixture, `docs/releases/${tag}.md`), "First alpha.\n");
  const output = join(fixture, "download");
  return {
    fixture,
    output,
    run: (releaseTag = tag) => Bun.spawnSync(["bash", "scripts/release-assets.sh", releaseTag, output], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    }),
  };
}

describe("release installation assets", () => {
  it("copies the versioned templates and creates verifiable checksums", () => {
    const { fixture, output, run } = setup();
    const result = run();
    expect(result.exitCode).toBe(0);
    for (const name of ["docker-compose.yml", "example.env", "traefik.yml", "install.sh"]) {
      const source = readFileSync(join(fixture, "deploy", name), "utf8");
      expect(readFileSync(join(output, name), "utf8")).toBe(source.replaceAll(guide("master"), guide(tag)));
    }
    expect(existsSync(join(output, ".env"))).toBe(false);
    const verify = () => Bun.spawnSync(["sha256sum", "-c", "SHA256SUMS"], { cwd: output });
    expect(verify().exitCode).toBe(0);
    writeFileSync(join(output, "docker-compose.yml"), "corrupted download\n");
    expect(verify().exitCode).not.toBe(0);
  });

  it("attaches the install script, executable and covered by the checksums", () => {
    const { output, run } = setup();
    expect(run().exitCode).toBe(0);
    expect(statSync(join(output, "install.sh")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toMatch(/^[0-9a-f]{64} {2}install\.sh$/m);
  });

  it("rejects an install script that would download another release", () => {
    const { output, run } = setup({ installVersion: "v0.0.9" });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(`DEFAULT_VERSION=${tag}`);
    expect(existsSync(output)).toBe(false);
  });

  it("points a download at the guide for its own release, not master's", () => {
    const { output, run } = setup();
    expect(run().exitCode).toBe(0);
    for (const name of ["docker-compose.yml", "example.env", "install.sh"]) {
      const asset = readFileSync(join(output, name), "utf8");
      expect(asset).toContain(guide(tag));
      expect(asset).not.toContain("/blob/master/");
    }
  });

  it("rejects a tag that labels a different application version", () => {
    const { output, run } = setup({ packageVersion: "1.0.0" });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("does not match package.json");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects installation files that would pull a different image", () => {
    const { output, run } = setup({ envVersion: "latest" });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(`STOKY_VERSION=${tag}`);
    expect(existsSync(output)).toBe(false);
  });

  it("rejects an installation guide whose commands download another release", () => {
    const { output, run } = setup({ guideVersion: "v0.0.9" });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("docs/INSTALL.md names a version other than");
    expect(result.stderr.toString()).toContain("v0.0.9");
    expect(existsSync(output)).toBe(false);
  });

  it("requires release notes before assembling a download", () => {
    const { output, run } = setup({ notes: false });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("missing or empty");
    expect(existsSync(output)).toBe(false);
  });

  for (const releaseTag of ["latest", "v1/../../secret", "v0.1.0+build.1"]) {
    it(`rejects unsupported tag ${releaseTag}`, () => {
      const { output, run } = setup();
      const result = run(releaseTag);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("expected a version tag");
      expect(existsSync(output)).toBe(false);
    });
  }
});
