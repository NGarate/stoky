import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every commit the ledger cites can still be found.
 *
 * `docs/PROGRESS.md` exists so somebody can find a change later, and a sha is
 * the whole of that promise. A seven-character hex string looks equally
 * plausible whether or not it resolves, `check:links` validates links rather
 * than shas, and nothing else looks — so a wrong one is invisible until the
 * moment it is needed, which is the worst possible moment.
 *
 * This is not hypothetical. D113: a row cited `382bf9a`, which is a real git
 * object on no branch. The sha was read from `HEAD`, written into the file, and
 * the commit was then amended to include that file — producing a different
 * commit and orphaning the one the row named. Garbage collection will delete
 * it, and the ledger would have gone on pointing at it.
 *
 * Reachability, not existence. `git cat-file -t` says `382bf9a` is a commit,
 * because it is: an orphan in the reflog is still an object. The question worth
 * asking is whether it is on a branch, because that is what survives a clone.
 *
 * **Skipped on a shallow clone, and that is not a cop-out.** CI checks out at
 * depth 1 — only the `changes` job asks for full history — so `git log --all`
 * there sees exactly one commit and every one of the 310 shas would report as
 * dangling. A guard that fails for a reason unrelated to what it guards is a
 * guard people learn to ignore. This one earns its keep locally, in
 * `verify:local`, which is before the push rather than after it, and that is
 * where a bad sha is written in the first place.
 *
 * **Branch commits, marked as such.** A review buffer branch is squash-merged
 * (CLAUDE.md), so its commits never reach `master`; after the merge they
 * resolve only from the pull request. A record that names them on purpose
 * wraps them in `<!-- branch-commits <branch> since <base> -->` …
 * `<!-- /branch-commits -->`. Inside, while the branch exists, the check is
 * stricter than the one outside: every sha must be one of `<base>..<branch>`,
 * not merely somewhere in the repository. Once the branch is gone they are
 * left out and the run says so, as the shallow clone is.
 */

const ROOT = join(import.meta.dir, "..", "..", "..");
const LEDGERS = [
  "docs/PROGRESS.md",
  "docs/STATUS.md",
  "docs/SECURITY_REVIEW.md",
  "docs/SMOKE_JOURNEYS.md",
];

/**
 * Shas cited deliberately *because* they do not resolve, with the reason.
 *
 * There is exactly one, and it names itself in the entry that explains it. Any
 * second one is almost certainly a mistake rather than a second exception.
 */
const ALLOWED: Record<string, string> = {
  "382bf9a":
    "D113 quotes it as the example of an orphaned sha; the entry is about it not resolving",
};

/** Every seven-hex-digit token in backticks, which is how this repo writes a sha. */
function shasIn(text: string): string[] {
  return [...text.matchAll(/`([0-9a-f]{7})`/g)].map((match) => match[1] as string);
}

const REGION =
  /<!-- branch-commits (\S+) since ([0-9a-f]{7,40}) -->([\s\S]*?)<!-- \/branch-commits -->/g;

interface BranchRegion {
  file: string;
  branch: string;
  base: string;
  shas: string[];
}

/** A ledger split into its marked branch-commit regions and everything else. */
function parse(file: string): { outside: string[]; regions: BranchRegion[] } {
  const source = readFileSync(join(ROOT, file), "utf8");
  const regions = [...source.matchAll(REGION)].map((match) => ({
    file,
    branch: match[1] as string,
    base: match[2] as string,
    shas: shasIn(match[3] as string),
  }));
  return { outside: shasIn(source.replace(REGION, "")), regions };
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** The branch's ref, local or remote-tracking, or null once it is gone. */
function refOf(branch: string): string | null {
  const refs = git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])
    .split("\n")
    .filter(Boolean);
  return (
    refs.find((ref) => ref === `refs/heads/${branch}`) ??
    refs.find((ref) => ref.endsWith(`/${branch}`) && ref.startsWith("refs/remotes/")) ??
    null
  );
}

describe("the shas the documents cite", () => {
  const parsed = LEDGERS.map(parse);
  const cited = [...new Set(parsed.flatMap((ledger) => ledger.outside))].sort();
  const regions = parsed.flatMap((ledger) => ledger.regions);

  it("finds plenty, so the check below is not vacuous", () => {
    // A regex that quietly matches nothing passes every assertion after it and
    // proves the opposite of what it claims.
    expect(cited.length).toBeGreaterThan(200);
  });

  it("all resolve to a commit on a branch", () => {
    // A depth-1 checkout has one commit and no way to answer this. Asserting
    // anything there would be asserting the clone depth.
    const shallow =
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim() === "true";

    if (shallow) {
      // Said out loud rather than skipped silently, so a run that proved
      // nothing does not read as a run that proved something.
      console.warn(
        "ledger-shas: shallow clone, reachability not checked (see the docblock)",
      );
      expect(shallow).toBe(true);
      return;
    }

    // `--all` rather than `HEAD`: a sha on any branch or tag survives a clone,
    // and one that is only in this machine's reflog does not.
    const reachable = new Set(git(["log", "--format=%h", "--all"]).split("\n").filter(Boolean));

    const dangling = cited.filter(
      (sha) => !reachable.has(sha) && !ALLOWED[sha],
    );

    expect(dangling).toEqual([]);
  });

  it("finds the branch-commit regions, each with shas in it", () => {
    // The 2026-10-12 review's record is one. If the marker stopped matching,
    // its shas would fall back to the looser check above and nothing would say.
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) expect(region.shas.length).toBeGreaterThan(0);
  });

  it("cites, inside a branch-commit region, only that branch's own commits", () => {
    const shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
    if (shallow) {
      console.warn("ledger-shas: shallow clone, branch-commit regions not checked");
      expect(shallow).toBe(true);
      return;
    }

    const misplaced: string[] = [];
    for (const region of regions) {
      const ref = refOf(region.branch);
      if (ref === null) {
        // After the squash merge: these resolve from the pull request only.
        console.warn(
          `ledger-shas: ${region.branch} is gone, its ${region.shas.length} citations in ${region.file} not checked`,
        );
        continue;
      }
      const own = git(["log", "--format=%H", `${region.base}..${ref}`]).split("\n").filter(Boolean);
      for (const sha of region.shas) {
        if (!own.some((full) => full.startsWith(sha))) misplaced.push(`${region.file}: ${sha}`);
      }
    }

    expect(misplaced).toEqual([]);
  });
});
