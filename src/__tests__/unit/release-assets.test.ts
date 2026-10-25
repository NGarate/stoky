import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const fixtures: string[] = [];
const tag = "v0.1.0-alpha.1";
const previous = "v0.0.8";
const gitIdentity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const digest = `sha256:${"0123456789abcdef".repeat(4)}`;
const guide = (ref: string) =>
  `https://github.com/NGarate/stoky/blob/${ref}/docs/INSTALL.md`;
// The shape of deploy/docker-compose.yml's application line: quoted, with the
// required-variable message.
const appImage = `    image: "ghcr.io/example/stoky:\${STOKY_VERSION:?Define STOKY_VERSION en .env}"`;
const compose = (appLines: string[] = [appImage]) =>
  [
    `# ${guide("master")}`,
    "services:",
    "  db:",
    "    image: postgres:16-alpine",
    "  app:",
    ...appLines,
    "",
  ].join("\n");

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function setup(
  options: {
    packageVersion?: string;
    envVersion?: string;
    installVersion?: string;
    notes?: boolean;
    guideVersion?: string;
    appLines?: string[];
    /** Notes with no generated change list. */
    unlisted?: boolean;
    /** A NEXT.md left beside the version's notes. */
    next?: boolean;
  } = {},
) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-release-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "deploy", "docs/releases", "bin"]) {
    mkdirSync(join(fixture, directory), { recursive: true });
  }
  copyFileSync(
    join(root, "scripts/release-assets.sh"),
    join(fixture, "scripts/release-assets.sh"),
  );
  copyFileSync(
    join(root, "scripts/release-notes.ts"),
    join(fixture, "scripts/release-notes.ts"),
  );
  // A history for the change list: a previous release, then one change.
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, ...gitIdentity },
    });
  git("init", "-q", "-b", "master");
  git("commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "chore: start");
  git("tag", previous);
  git(
    "commit",
    "-q",
    "--allow-empty",
    "--no-gpg-sign",
    "-m",
    "feat(inventory): the first alpha",
  );
  // Project-owned release tooling must also work on a host with only Bun.
  writeFileSync(
    join(fixture, "bin/node"),
    "#!/bin/sh\necho 'Node must not be used' >&2\nexit 99\n",
    { mode: 0o755 },
  );
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ version: options.packageVersion ?? "0.1.0-alpha.1" }),
  );
  writeFileSync(
    join(fixture, "deploy/example.env"),
    `# ${guide("master")}\nSTOKY_VERSION=${options.envVersion ?? tag}\nSTOKY_SECRET=\n`,
  );
  writeFileSync(
    join(fixture, "deploy/docker-compose.yml"),
    compose(options.appLines),
  );
  writeFileSync(
    join(fixture, "deploy/install.sh"),
    `#!/bin/bash\n# ${guide("master")}\nDEFAULT_VERSION=${options.installVersion ?? tag}\n`,
  );
  writeFileSync(
    join(fixture, "deploy/traefik.yml"),
    "http:\n  services:\n    stoky:\n      loadBalancer:\n        servers:\n          - url: http://app:3000\n",
  );
  // An operator's local credentials must never become a release attachment.
  writeFileSync(
    join(fixture, "deploy/.env"),
    "STOKY_SECRET=private-local-value\n",
  );
  const guideVersion = options.guideVersion ?? tag;
  writeFileSync(
    join(fixture, "docs/INSTALL.md"),
    `This guide is for **${guideVersion}**.\n\ngh release download ${guideVersion}\n`,
  );
  writeFileSync(
    join(fixture, "README.md"),
    `Status: ${tag}. See [notes](docs/releases/${tag}.md).\n`,
  );
  if (options.notes !== false) {
    const list = options.unlisted
      ? ""
      : execFileSync(
          "bun",
          [join(fixture, "scripts/release-notes.ts"), previous, tag],
          { cwd: fixture, encoding: "utf8" },
        );
    writeFileSync(
      join(fixture, `docs/releases/${tag}.md`),
      `First alpha.\n\n## Qué ha cambiado\n\n${list}`,
    );
  }
  if (options.next)
    writeFileSync(join(fixture, "docs/releases/NEXT.md"), "The next one.\n");
  const output = join(fixture, "download");
  return {
    fixture,
    output,
    run: (releaseTag = tag, imageDigest: string | null = digest) =>
      Bun.spawnSync(
        [
          "bash",
          "scripts/release-assets.sh",
          releaseTag,
          output,
          ...(imageDigest === null ? [] : [imageDigest]),
        ],
        {
          cwd: fixture,
          env: {
            ...process.env,
            PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
          },
        },
      ),
  };
}

describe("release installation assets", () => {
  it("copies the versioned templates and creates verifiable checksums", () => {
    const { fixture, output, run } = setup();
    const result = run();
    expect(result.exitCode).toBe(0);
    for (const name of ["example.env", "traefik.yml", "install.sh"]) {
      const source = readFileSync(join(fixture, "deploy", name), "utf8");
      expect(readFileSync(join(output, name), "utf8")).toBe(
        source.replaceAll(guide("master"), guide(tag)),
      );
    }
    // The Compose file differs from its template by the guide link and the
    // digest on the application's image line, and by nothing else.
    const pinned = appImage.replace(/\}"$/, `}@${digest}"`);
    expect(readFileSync(join(output, "docker-compose.yml"), "utf8")).toBe(
      compose([pinned]).replaceAll(guide("master"), guide(tag)),
    );
    expect(existsSync(join(output, ".env"))).toBe(false);
    const verify = () =>
      Bun.spawnSync(["sha256sum", "-c", "SHA256SUMS"], { cwd: output });
    expect(verify().exitCode).toBe(0);
    writeFileSync(join(output, "docker-compose.yml"), "corrupted download\n");
    expect(verify().exitCode).not.toBe(0);
  });

  it("names the application image by the promoted digest, covered by the checksums", () => {
    const { fixture, output, run } = setup();
    expect(run().exitCode).toBe(0);
    const packaged = readFileSync(join(output, "docker-compose.yml"), "utf8");
    expect(packaged.split(digest)).toHaveLength(2);
    expect(packaged).toContain(
      `stoky:\${STOKY_VERSION:?Define STOKY_VERSION en .env}@${digest}"`,
    );
    expect(packaged).toContain("image: postgres:16-alpine\n");
    // The checksum is of the pinned file, so replacing the digest is detected.
    const sums = readFileSync(join(output, "SHA256SUMS"), "utf8");
    const listed = sums.match(/^([0-9a-f]{64}) {2}docker-compose\.yml$/m)?.[1];
    expect(listed).toBe(
      new Bun.CryptoHasher("sha256").update(packaged).digest("hex"),
    );
    // The checkout's template keeps no digest: a source build overrides it.
    expect(
      readFileSync(join(fixture, "deploy/docker-compose.yml"), "utf8"),
    ).not.toContain("@sha256:");
  });

  for (const [label, imageDigest] of [
    ["a missing digest", null],
    ["an empty digest", ""],
    ["a digest without its algorithm", "0123456789abcdef".repeat(4)],
    ["a short digest", `sha256:${"0".repeat(63)}`],
    ["an uppercase digest", `sha256:${"0123456789ABCDEF".repeat(4)}`],
    ["another algorithm", `sha512:${"0".repeat(64)}`],
    ["a digest with trailing text", `${digest}\nimage: evil`],
  ] as const) {
    it(`refuses ${label}`, () => {
      const { output, run } = setup();
      const result = run(tag, imageDigest);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toMatch(
        /sha256:DIGEST|expected an image digest/,
      );
      expect(existsSync(output)).toBe(false);
    });
  }

  for (const [label, appLines] of [
    ["no application image line", ["    image: ghcr.io/example/stoky:latest"]],
    ["two application image lines", [appImage, appImage]],
    [
      "an image line that already names a digest",
      [appImage.replace(/\}"$/, `}@${digest}"`)],
    ],
  ] as const) {
    it(`refuses a Compose template with ${label}`, () => {
      const { output, run } = setup({ appLines: [...appLines] });
      const result = run();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("exactly one image: line");
      expect(existsSync(output)).toBe(false);
    });
  }

  it("attaches the install script, executable and covered by the checksums", () => {
    const { output, run } = setup();
    expect(run().exitCode).toBe(0);
    expect(statSync(join(output, "install.sh")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toMatch(
      /^[0-9a-f]{64} {2}install\.sh$/m,
    );
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
    expect(result.stderr.toString()).toContain(
      "docs/INSTALL.md names a version other than",
    );
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

  it("refuses while NEXT.md has not become the version's notes", () => {
    const { output, run } = setup({ next: true });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      `git mv docs/releases/NEXT.md docs/releases/${tag}.md`,
    );
    expect(existsSync(output)).toBe(false);
  });

  it("refuses notes that carry no change list", () => {
    const { output, run } = setup({ unlisted: true });
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "does not carry its release's change list",
    );
    expect(existsSync(output)).toBe(false);
  });

  it("refuses a change list that misses a commit the release ships", () => {
    const { fixture, output, run } = setup();
    execFileSync(
      "git",
      [
        "commit",
        "-q",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "fix(receipts): a late fix",
      ],
      {
        cwd: fixture,
        env: { ...process.env, ...gitIdentity },
      },
    );
    const result = run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      `bun scripts/release-notes.ts ${previous} ${tag}`,
    );
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

// The two CI steps that call the script, run as CI runs them: their `run` and
// their `env`, with the expressions GitHub would substitute. A step that drops
// the digest fails here rather than on the next release tag.
describe("the CI workflow's packaging", () => {
  type Step = { name?: string; run?: string; env?: Record<string, string> };
  const ci = Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const published = `sha256:${"fedcba9876543210".repeat(4)}`;
  const expressions: Record<string, string> = {
    "github.ref_name": tag,
    "needs.image-publish.outputs.digest": published,
  };
  const substitute = (value: string) =>
    value.replace(/\$\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
      if (!(name in expressions))
        throw new Error(`unexpected expression ${name}`);
      return expressions[name];
    });
  const packaging = (job: string) => {
    const steps = ci.jobs[job]?.steps ?? [];
    const at = steps.findIndex((s) =>
      s.run?.includes("scripts/release-assets.sh"),
    );
    if (at < 0) throw new Error(`${job} does not run release-assets.sh`);
    return { steps, at, step: steps[at] };
  };
  const runStep = (step: Step) => {
    const { fixture } = setup();
    const runnerTemp = join(fixture, "runner-temp");
    mkdirSync(runnerTemp);
    const env = Object.fromEntries(
      Object.entries(step.env ?? {}).map(([k, v]) => [
        k,
        substitute(String(v)),
      ]),
    );
    const result = Bun.spawnSync(["bash", "-e", "-c", String(step.run)], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        ...env,
      },
    });
    expect(result.stderr.toString()).not.toContain("Error");
    expect(result.exitCode).toBe(0);
    return readFileSync(join(runnerTemp, "release/docker-compose.yml"), "utf8");
  };

  // The change-list check reads the commits back to the previous release's
  // tag; at depth 1 it would fail every tag, or worse, be loosened to pass.
  it.each(["quality", "release-draft"])(
    "checks out the full history where it packages: %s",
    (job) => {
      const checkout = (ci.jobs[job]?.steps ?? []).find(
        (s) =>
          typeof (s as { uses?: string }).uses === "string" &&
          (s as { uses: string }).uses.startsWith("actions/checkout@"),
      ) as { with?: Record<string, unknown> } | undefined;
      expect(checkout).toBeDefined();
      expect(String(checkout?.with?.["fetch-depth"])).toBe("0");
    },
  );

  it("validates a tag with a digest-shaped placeholder, before any image exists", () => {
    const packaged = runStep(packaging("quality").step);
    expect(packaged).toMatch(/\}@sha256:[0-9a-f]{64}"$/m);
    expect(packaged).not.toContain(published);
  });

  it("packages the release with the digest it promoted, then checks what Compose pulls", () => {
    const { steps, at, step } = packaging("release-draft");
    expect(runStep(step)).toContain(`}@${published}"`);
    const promoteAt = steps.findIndex((s) =>
      s.run?.includes("imagetools create"),
    );
    expect(promoteAt).toBeGreaterThanOrEqual(0);
    expect(promoteAt).toBeLessThan(at);
    const checkAt = steps.findIndex((s) => s.run?.includes("config --images"));
    expect(checkAt).toBeGreaterThan(at);
    const check = steps[checkAt];
    expect(check.run).toContain(
      '--file "$RUNNER_TEMP/release/docker-compose.yml"',
    );
    expect(check.run).toContain(':$RELEASE_TAG@$EXPECTED_DIGEST"');
    expect(check.run).toMatch(/pull app$/m);
    expect(substitute(String(check.env?.EXPECTED_DIGEST))).toBe(published);
    expect(substitute(String(check.env?.STOKY_VERSION))).toBe(tag);
  });
});
