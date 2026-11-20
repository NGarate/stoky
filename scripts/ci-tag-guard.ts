/**
 * Refuses a release tag that `release:tag` would not have made.
 *
 * Run: bun scripts/ci-tag-guard.ts   (ci.yml's quality job, on a tag only)
 *
 * A pushed `v*` tag starts the release, and GitHub cannot tell the tag
 * `scripts/release-tag.ts` pushed, after its checks, from one typed by hand
 * without them. So the tag's run asks what that script asks, of GitHub, and
 * fails before anything is published unless:
 *   - the tagged commit's subject is `chore: prepare <tag>`, exactly;
 *   - that commit is on master;
 *   - a run of ci.yml on that very commit finished green with every job in
 *     TEST_JOBS passed: a pull request's from a branch of this repository, or
 *     a push to master. A tag's run never counts, since its own test jobs are
 *     green without having tested anything (below).
 *
 * The last one is also why a tag's run does not test the commit again: the
 * test steps of those jobs do not run on a tag (ci.yml), because this has
 * found the run in which they passed on the same tree.
 *
 * Any other answer refuses, an API error included: re-run the job. A refused
 * tag cannot be deleted or moved (the tag rulesets), so its version is spent.
 *
 * Reads GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GITHUB_TOKEN and
 * GITHUB_API_URL. Exit codes: 0 the tag stands, 1 refused.
 */

/** The jobs of ci.yml that test a commit, by name. */
export const TEST_JOBS = [
  "Lint, types, contrast",
  "Unit tests",
  "Component tests",
  "Integration tests",
  "End-to-end",
];

type Run = {
  id: number;
  event: string;
  head_branch: string | null;
  html_url: string;
  head_repository: { full_name: string } | null;
};
type Job = { name: string; conclusion: string | null };

/** GET a path of GitHub's REST API, parsed. Throws on any other answer. */
type Get = (path: string) => Promise<unknown>;

const counts = (run: Run, repository: string) =>
  run.head_repository?.full_name === repository &&
  (run.event === "pull_request" ||
    (run.event === "push" && run.head_branch === "master"));

/** The run that tested the tag's commit, or why the tag is refused. */
export async function guard(
  get: Get,
  repository: string,
  sha: string,
  tag: string,
): Promise<{ run: string } | { refused: string }> {
  const { commit } = (await get(`/repos/${repository}/commits/${sha}`)) as {
    commit: { message: string };
  };
  const subject = commit.message.split("\n")[0];
  if (subject !== `chore: prepare ${tag}`) {
    return {
      refused: `its commit is "${subject}", not "chore: prepare ${tag}"`,
    };
  }
  const { behind_by: behind } = (await get(
    `/repos/${repository}/compare/${sha}...master`,
  )) as { behind_by: number };
  if (behind !== 0) return { refused: "its commit is not on master" };

  const { workflow_runs: runs } = (await get(
    `/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=100`,
  )) as { workflow_runs: Run[] };
  for (const run of runs.filter((candidate) => counts(candidate, repository))) {
    const { jobs } = (await get(
      `/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`,
    )) as { jobs: Job[] };
    const passed = (name: string) =>
      jobs.some((job) => job.name === name && job.conclusion === "success");
    if (TEST_JOBS.every(passed)) return { run: run.html_url };
  }
  return { refused: "no CI run has passed the tests on its commit" };
}

if (import.meta.main) {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_REF_NAME: tag,
    GITHUB_TOKEN: token,
    GITHUB_API_URL: api = "https://api.github.com",
  } = process.env;
  let answer: Awaited<ReturnType<typeof guard>>;
  try {
    if (!repository || !sha || !tag) {
      throw new Error("needs GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME");
    }
    answer = await guard(
      async (path) => {
        const response = await fetch(api + path, {
          headers: {
            accept: "application/vnd.github+json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!response.ok) throw new Error(`${response.status} for ${path}`);
        return response.json();
      },
      repository,
      sha,
      tag,
    );
  } catch (error) {
    answer = {
      refused: `GitHub could not be asked (${error}); re-run this job`,
    };
  }
  if ("refused" in answer) {
    console.log(
      `::error::${tag} is not a release: ${answer.refused}. Releases are tagged with \`bun run release:tag\` (docs/RELEASING.md).`,
    );
    process.exit(1);
  }
  console.log(
    `::notice::${tag}'s commit passed its tests in ${answer.run}: not repeated.`,
  );
}
