import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/release-publish.sh` makes a draft public, which cannot be undone.
 * These run it with gh, the verification and the notes check all replaced by
 * stubs that record their calls in one log, in order, so a test can see what
 * was published, with which flags, and what ran after.
 */

const root = join(import.meta.dir, "../../..");
const REPO = "Owner-X/Stoky";
const RUN_URL = `https://github.com/${REPO}/actions/runs/123456`;
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

type Options = {
  /** Tags of the releases already published. */
  published?: string[];
  verifyExit?: number;
  notesExit?: number;
  dispatchFails?: boolean;
  /** `gh workflow run` prints the run's URL, as recent gh does. */
  dispatchPrintsUrl?: boolean;
  /** `gh run list` lists the run only from this attempt on (1-based). */
  listedFromAttempt?: number;
};

function setup(options: Options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-release-publish-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "bin"]) mkdirSync(join(fixture, directory), { recursive: true });
  copyFileSync(join(root, "scripts/release-publish.sh"), join(fixture, "scripts/release-publish.sh"));
  const calls = join(fixture, "calls");
  const listed = join(fixture, "run-list-attempts");
  writeFileSync(calls, "");
  writeFileSync(listed, "0");
  writeFileSync(join(fixture, "scripts/release-verify-draft.sh"), `echo "verify $*" >> "${calls}"\nexit ${options.verifyExit ?? 0}\n`);
  writeFileSync(join(fixture, "scripts/check-published-notes.sh"), `echo "notes $*" >> "${calls}"\nexit ${options.notesExit ?? 0}\n`);
  writeFileSync(
    join(fixture, "bin/gh"),
    `#!/bin/bash
echo "gh $*" >> "${calls}"
case "$1 $2" in
  "release list") printf '%s\\n' ${(options.published ?? []).map((tag) => `"${tag}"`).join(" ")}; exit 0 ;;
  "release edit") exit 0 ;;
  "release view") echo "https://github.com/${REPO}/releases/tag/$3"; exit 0 ;;
  "workflow run")
    ${options.dispatchFails ? 'echo "HTTP 403" >&2; exit 1' : ""}
    echo "✓ Created workflow_dispatch event for rescan.yml at master"
    ${options.dispatchPrintsUrl ? `echo "${RUN_URL}"` : ""}
    exit 0 ;;
  "run list")
    n=$(( $(cat "${listed}") + 1 )); echo "$n" > "${listed}"
    [ "$n" -ge ${options.listedFromAttempt ?? 1} ] && echo "${RUN_URL}"
    exit 0 ;;
esac
exit 99
`,
    { mode: 0o755 },
  );
  const run = (...args: string[]) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      STOKY_PUBLISH_POLL_INTERVAL: "0",
      STOKY_PUBLISH_POLL_ATTEMPTS: "3",
    };
    delete env.GH_REPO;
    const result = Bun.spawnSync(["bash", "scripts/release-publish.sh", ...args], { cwd: fixture, env });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  return {
    publish: (tag: string) => run(tag, "--repo", REPO),
    run,
    calls: () => readFileSync(calls, "utf8").split("\n").filter(Boolean),
  };
}

const edit = (calls: string[]) => calls.filter((call) => call.startsWith("gh release edit"));

describe("publishing a release draft", () => {
  it.each([
    // tag, already published, prerelease, latest
    ["v0.1.0-alpha.5", ["v0.1.0-alpha.4"], true, false],
    ["v1.0.0-rc.1", [], true, false],
    ["v1.0.0", ["v0.9.0", "v1.0.0-rc.1"], false, true],
    ["v2.0.0", [], false, true],
    // A patch to an older line is not the newest release.
    ["v1.0.5", ["v1.0.4", "v1.1.0"], false, false],
    // Versions, not strings: v1.10.0 is above v1.9.0.
    ["v1.10.0", ["v1.9.0", "v1.2.0"], false, true],
    // A published prerelease of a later version does not hold latest back.
    ["v1.1.0", ["v1.0.0", "v1.2.0-beta.1"], false, true],
  ] as const)("publishes %s over %j as prerelease=%p, latest=%p", (tag, published, prerelease, latest) => {
    const fixture = setup({ published: [...published] });
    const result = fixture.publish(tag);
    expect(result.exitCode).toBe(0);
    expect(edit(fixture.calls())).toEqual([
      `gh release edit ${tag} --repo ${REPO} --draft=false --prerelease=${prerelease} --latest=${latest}`,
    ]);
    expect(result.stdout).toContain(`Published ${tag} (prerelease=${prerelease}, latest=${latest})`);
  });

  it("verifies, publishes, checks the notes and dispatches the rescan, in that order", () => {
    const fixture = setup({ dispatchPrintsUrl: true });
    const result = fixture.publish("v0.1.0-alpha.5");
    expect(result.exitCode).toBe(0);
    const steps = fixture.calls().filter((call) => !call.startsWith("gh release view"));
    expect(steps).toEqual([
      `verify v0.1.0-alpha.5 --repo ${REPO}`,
      `gh release edit v0.1.0-alpha.5 --repo ${REPO} --draft=false --prerelease=true --latest=false`,
      `notes --repo ${REPO}`,
      `gh workflow run rescan.yml --repo ${REPO} --ref master`,
    ]);
    expect(result.stdout).toContain(`rescan   ${RUN_URL}`);
    expect(result.stdout).toContain(`release  https://github.com/${REPO}/releases/tag/v0.1.0-alpha.5`);
  });

  it("finds the rescan run when gh does not print it", () => {
    const fixture = setup({ listedFromAttempt: 2 });
    const result = fixture.publish("v0.1.0-alpha.5");
    expect(result.exitCode).toBe(0);
    expect(fixture.calls().filter((call) => call.startsWith("gh run list"))).toHaveLength(2);
    expect(result.stdout).toContain(`rescan   ${RUN_URL}`);
  });

  it.each([1, 2])("publishes nothing when verification exits %p", (code) => {
    const fixture = setup({ verifyExit: code });
    const result = fixture.publish("v0.1.0-alpha.5");
    expect(result.exitCode).toBe(code);
    expect(result.stderr).toContain("Nothing was published.");
    expect(fixture.calls()).toEqual([`verify v0.1.0-alpha.5 --repo ${REPO}`]);
  });

  it("reports a notes mismatch after publishing, and still dispatches the rescan", () => {
    const fixture = setup({ notesExit: 1, dispatchPrintsUrl: true });
    const result = fixture.publish("v0.1.0-alpha.5");
    expect(result.exitCode).toBe(1);
    expect(edit(fixture.calls())).toHaveLength(1);
    expect(fixture.calls()).toContain(`gh workflow run rescan.yml --repo ${REPO} --ref master`);
    expect(result.stdout).toContain("notes    FAIL");
  });

  it("reports a rescan that could not be dispatched", () => {
    const fixture = setup({ dispatchFails: true });
    const result = fixture.publish("v0.1.0-alpha.5");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("rescan   FAIL");
  });

  it("refuses a tag that is not a version before calling anything", () => {
    const fixture = setup();
    expect(fixture.run("latest", "--repo", REPO).exitCode).toBe(2);
    expect(fixture.calls()).toEqual([]);
  });
});
