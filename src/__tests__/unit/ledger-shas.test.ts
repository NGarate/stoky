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
function citedIn(file: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  return [...source.matchAll(/`([0-9a-f]{7})`/g)].map((match) => match[1] as string);
}

describe("the shas the documents cite", () => {
  const cited = [...new Set(LEDGERS.flatMap(citedIn))].sort();

  it("finds plenty, so the check below is not vacuous", () => {
    // A regex that quietly matches nothing passes every assertion after it and
    // proves the opposite of what it claims.
    expect(cited.length).toBeGreaterThan(200);
  });

  it("all resolve to a commit on a branch", () => {
    // `--all` rather than `HEAD`: a sha on any branch or tag survives a clone,
    // and one that is only in this machine's reflog does not.
    const reachable = new Set(
      execFileSync("git", ["log", "--format=%h", "--all"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
        .split("\n")
        .filter(Boolean),
    );

    const dangling = cited.filter(
      (sha) => !reachable.has(sha) && !ALLOWED[sha],
    );

    expect(dangling).toEqual([]);
  });
});
