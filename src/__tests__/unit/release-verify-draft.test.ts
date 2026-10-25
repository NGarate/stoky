import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `scripts/release-verify-draft.sh` is the check a draft passes before the
 * owner publishes it. These run it against a release built here from the
 * repository's own deploy/ files, with gh, docker and curl replaced by stubs
 * that each break one thing on request. install.sh is the repository's own,
 * and runs for real.
 */

const root = join(import.meta.dir, "../../..");
const TAG = "v1.2.0-rc.2";
const PREVIOUS = "v1.2.0-rc.1";
const REPO = "Owner-X/Stoky";
const IMAGE = "ghcr.io/owner-x/stoky";
const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;
const ASSETS = ["docker-compose.yml", "example.env", "traefik.yml", "install.sh", "SHA256SUMS"];
const CHECKS = [
  "release assets",
  "checksums",
  ...ASSETS.map((asset) => `attestation ${asset}`),
  "attestation can fail",
  "compose vs tagged source",
  "image digest",
  "image provenance",
  "anonymous pull",
  "fresh install",
  "compose images",
];
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

type Options = {
  draft?: boolean;
  /** Changes a released file after its checksum line was written. */
  tamper?: boolean;
  /** Files GitHub holds no attestation for. */
  unattested?: string[];
  /** The attestation check accepts any source ref. */
  anyRef?: boolean;
  /** A line in the released Compose file that the tagged source does not have. */
  extraComposeLine?: boolean;
  resolvedDigest?: string;
  provenanceFails?: boolean;
  pullFails?: boolean;
  /** The released install.sh installs another version by default. */
  installVersion?: string;
  /**
   * The released install.sh is someone else's: it only leaves this file
   * behind, and SHA256SUMS agrees with it, as a tampered draft's would.
   */
  hostileInstall?: string;
  /** An image Compose resolves that the released file does not name. */
  extraImage?: string;
};

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

function setup(options: Options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-release-verify-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "deploy", "bin", "release"]) mkdirSync(join(fixture, directory), { recursive: true });
  copyFileSync(join(root, "scripts/release-verify-draft.sh"), join(fixture, "scripts/release-verify-draft.sh"));
  // The repository's Compose file, as a repository with this test's name has it.
  const source = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8").replaceAll("ghcr.io/ngarate/stoky", IMAGE);
  expect(source).toContain(`"${IMAGE}:\${STOKY_VERSION`);
  writeFileSync(join(fixture, "deploy/docker-compose.yml"), source);

  // The tagged source: an older stable tag, the previous candidate, this one.
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, env: gitEnv });
  git("init", "-q", "-b", "master");
  git("add", "deploy/docker-compose.yml");
  git("commit", "-q", "--no-gpg-sign", "-m", "the release");
  for (const tag of ["v1.1.0", PREVIOUS, TAG]) git("tag", tag);

  // The release, as scripts/release-assets.sh packages it.
  const release = join(fixture, "release");
  const relink = (text: string) => text.replaceAll("/blob/master/", `/blob/${TAG}/`);
  let compose = relink(source).replace(
    /^(\s*image:\s*"?[^"\s@]+:\$\{STOKY_VERSION(?::\?[^}]*)?\})("?\s*)$/m,
    `$1@${DIGEST}$2`,
  );
  expect(compose).toContain(`}@${DIGEST}`);
  if (options.extraComposeLine) compose = compose.replace("services:", "# An unreviewed change.\nservices:");
  const files: Record<string, string> = {
    "docker-compose.yml": compose,
    "example.env": relink(readFileSync(join(root, "deploy/example.env"), "utf8")).replace(/^STOKY_VERSION=.*$/m, `STOKY_VERSION=${TAG}`),
    "traefik.yml": relink(readFileSync(join(root, "deploy/traefik.yml"), "utf8")),
    "install.sh": options.hostileInstall
      ? `#!/bin/bash\ntouch "${options.hostileInstall}"\n`
      : relink(readFileSync(join(root, "deploy/install.sh"), "utf8")).replace(
          /^DEFAULT_VERSION=.*$/m,
          `DEFAULT_VERSION=${options.installVersion ?? TAG}`,
        ),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(release, name), text, { mode: 0o755 });
  writeFileSync(join(release, "SHA256SUMS"), Object.entries(files).map(([name, text]) => `${sha256(text)}  ${name}\n`).join(""));
  if (options.tamper) appendFileSync(join(release, "traefik.yml"), "# replaced\n");

  const calls = join(fixture, "calls");
  writeFileSync(calls, "");
  const unattested = (options.unattested ?? []).join(" ");
  // gh: the release's state, its files, and attestations that verify only for
  // this repository's ci.yml and, unless told otherwise, this tag's ref.
  writeFileSync(
    join(fixture, "bin/gh"),
    `#!/bin/bash
echo "gh $*" >> "${calls}"
case "$1 $2" in
  "release view") echo ${options.draft === false ? "false" : "true"}; exit 0 ;;
  "release download")
    while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
    cp "${release}"/* "$dir"; exit 0 ;;
  "attestation verify")
    subject="$3"; shift 3
    while [ $# -gt 0 ]; do
      case "$1" in
        --repo) repo="$2" ;; --signer-workflow) workflow="$2" ;; --source-ref) ref="$2" ;;
      esac
      shift
    done
    [ "$repo" = "${REPO}" ] && [ "$workflow" = "${REPO}/.github/workflows/ci.yml" ] || exit 1
    case "$subject" in
      oci://*) ${options.provenanceFails ? "exit 1" : ""}
        [ "$subject" = "oci://${IMAGE}:${TAG}" ] || exit 1 ;;
      *) for name in ${unattested}; do [ "$(basename "$subject")" = "$name" ] && exit 1; done ;;
    esac
    ${options.anyRef ? "exit 0" : ""}
    [ "$ref" = "refs/tags/${TAG}" ] || { echo "expected SourceRepositoryRef to be $ref" >&2; exit 1; }
    exit 0 ;;
esac
exit 99
`,
    { mode: 0o755 },
  );
  // docker: the tag's digest, a pull, and a Compose that resolves the image
  // lines of ./docker-compose.yml from ./.env and requires DOMAIN, as the
  // real one does. Each call records how many entries its DOCKER_CONFIG has (nothing
  // when it has none set).
  writeFileSync(
    join(fixture, "bin/docker"),
    `#!/bin/bash
echo "docker $* config=\${DOCKER_CONFIG:+$(ls -A "$DOCKER_CONFIG" | wc -l)}" >> "${calls}"
case "$1 $2" in
  "buildx imagetools")
    [ "$4" = "${IMAGE}:${TAG}" ] || exit 1
    echo "${options.resolvedDigest ?? DIGEST}"; exit 0 ;;
  "pull --quiet") ${options.pullFails ? "exit 1" : `[ "$3" = "${IMAGE}@${DIGEST}" ] || exit 1; exit 0`} ;;
  "compose config")
    version="$(sed -n 's/^STOKY_VERSION=//p' .env)"
    grep -q '^DOMAIN=.' .env || { echo "required variable DOMAIN is missing a value" >&2; exit 15; }
    grep -E '^[[:space:]]*image:' docker-compose.yml \\
      | sed -E 's/^[[:space:]]*image:[[:space:]]*"?//; s/"?[[:space:]]*$//; s/\\$\\{STOKY_VERSION[^}]*\\}/'"$version"'/'
    ${options.extraImage ? `echo "${options.extraImage}"` : ""}
    exit 0 ;;
esac
exit 99
`,
    { mode: 0o755 },
  );
  // curl serves file:// URLs, as install-script.test.ts's does: what is under
  // test is the scripts, and the test image has no curl.
  writeFileSync(
    join(fixture, "bin/curl"),
    `#!/bin/bash
while [ $# -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift ;;
    file://*) source="\${1#file://}" ;;
  esac
  shift
done
[ -f "$source" ] || exit 37
cp "$source" "$output"
`,
    { mode: 0o755 },
  );

  const summary = join(fixture, "summary.md");
  const run = (...args: string[]) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GITHUB_STEP_SUMMARY: summary,
    };
    delete env.GH_REPO;
    const result = Bun.spawnSync(["bash", "scripts/release-verify-draft.sh", ...args], { cwd: fixture, env });
    const stdout = result.stdout.toString();
    const rows = new Map<string, { result: string; detail: string }>();
    for (const line of stdout.split("\n")) {
      const match = line.match(/^(ok|FAIL)\s+(\S+(?: \S+)*)\s{2,}(.*)$/);
      if (match) rows.set(match[2], { result: match[1], detail: match[3] });
    }
    return { exitCode: result.exitCode, stdout, stderr: result.stderr.toString(), rows };
  };
  return {
    run: (...args: string[]) => run(TAG, "--repo", REPO, ...args),
    runRaw: run,
    calls: () => readFileSync(calls, "utf8").split("\n").filter(Boolean),
    summary: () => readFileSync(summary, "utf8"),
  };
}

/** Every check is reported, and exactly `failing` failed. */
function expectFailures(result: ReturnType<ReturnType<typeof setup>["run"]>, failing: string[]) {
  expect([...result.rows.keys()]).toEqual(CHECKS);
  const failed = [...result.rows].filter(([, row]) => row.result === "FAIL").map(([name]) => name);
  // The script's own account of what failed, when the test is about to say so.
  if (failed.join() !== failing.join()) console.error(result.stdout, result.stderr);
  expect(failed).toEqual(failing);
  expect(result.exitCode).toBe(failing.length ? 1 : 0);
}

describe("verifying a release draft", () => {
  it("passes a draft that is what its tag built, and says so per check", () => {
    const fixture = setup();
    const result = fixture.run();
    expectFailures(result, []);
    expect(result.rows.get("image digest")?.detail).toBe(`${IMAGE}:${TAG} is ${DIGEST}`);
    // The negative check is made against the previous version tag.
    expect(result.rows.get("attestation can fail")?.detail).toContain(`refs/tags/${PREVIOUS}`);
    const negative = `/SHA256SUMS --repo ${REPO} --signer-workflow ${REPO}/.github/workflows/ci.yml --source-ref refs/tags/${PREVIOUS}`;
    expect(fixture.calls().filter((call) => call.startsWith("gh attestation verify /") && call.endsWith(negative))).toHaveLength(1);
    const summary = fixture.summary();
    expect(summary).toContain(`### Release verification: ${TAG} (draft)`);
    for (const check of CHECKS) expect(summary).toContain(`| ok | ${check} |`);
  });

  it("pulls and resolves Compose with no saved credentials", () => {
    const fixture = setup();
    expect(fixture.run().exitCode).toBe(0);
    const pull = fixture.calls().find((call) => call.startsWith("docker pull"));
    expect(pull).toBe(`docker pull --quiet ${IMAGE}@${DIGEST} config=0`);
    const config = fixture.calls().find((call) => call.startsWith("docker compose config"));
    expect(config).toBe("docker compose config --images config=0");
  });

  it("fails a file that does not match its checksum, and the install that checks it", () => {
    expectFailures(setup({ tamper: true }).run(), ["checksums", "fresh install", "compose images"]);
  });

  it("fails a file with no attestation for this tag", () => {
    const result = setup({ unattested: ["traefik.yml"] }).run();
    expectFailures(result, ["attestation traefik.yml"]);
  });

  it("never runs an install.sh with no attestation, however its checksum agrees", () => {
    const ran = join(mkdtempSync(join(tmpdir(), "stoky-release-verify-ran-")), "ran");
    fixtures.push(dirname(ran));
    const result = setup({ unattested: ["install.sh"], hostileInstall: ran }).run();
    expectFailures(result, ["attestation install.sh", "fresh install", "compose images"]);
    expect(result.rows.get("checksums")?.result).toBe("ok");
    expect(result.rows.get("fresh install")?.detail).toBe(`install.sh is not attested for refs/tags/${TAG}; not run`);
    expect(existsSync(ran)).toBe(false);
  });

  it("fails when the attestation check would pass for another tag too", () => {
    expectFailures(setup({ anyRef: true }).run(), ["attestation can fail"]);
  });

  it("fails a Compose file that differs from the tagged source by more than link and digest", () => {
    const result = setup({ extraComposeLine: true }).run();
    expectFailures(result, ["compose vs tagged source"]);
    expect(result.stdout).toContain("+# An unreviewed change.");
  });

  it("fails when the version tag resolves to another digest than the Compose file names", () => {
    const result = setup({ resolvedDigest: OTHER_DIGEST }).run();
    expectFailures(result, ["image digest"]);
    expect(result.rows.get("image digest")?.detail).toContain(OTHER_DIGEST);
  });

  it("fails an image with no provenance for this tag", () => {
    expectFailures(setup({ provenanceFails: true }).run(), ["image provenance"]);
  });

  it("fails an image that does not pull anonymously", () => {
    expectFailures(setup({ pullFails: true }).run(), ["anonymous pull"]);
  });

  it("fails an install.sh that does not install its own release", () => {
    expectFailures(setup({ installVersion: PREVIOUS }).run(), ["fresh install", "compose images"]);
  });

  it("fails when Compose resolves an image the released file does not name", () => {
    const result = setup({ extraImage: "example.invalid/intruder:1" }).run();
    expectFailures(result, ["compose images"]);
    expect(result.stdout).toContain("+example.invalid/intruder:1");
  });

  it("refuses a published release unless asked to verify it again", () => {
    const fixture = setup({ draft: false });
    const refused = fixture.run();
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("already published");
    expect(fixture.calls().some((call) => call.startsWith("gh release download"))).toBe(false);
    const again = fixture.run("--published");
    expectFailures(again, []);
    expect(fixture.summary()).toContain(`(published)`);
  });

  it("refuses a tag that is not a version before asking anything", () => {
    const fixture = setup();
    const result = fixture.runRaw("v1.2.0/../../x", "--repo", REPO);
    expect(result.exitCode).toBe(2);
    expect(fixture.calls()).toEqual([]);
  });
});
