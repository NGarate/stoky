import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { guard, TEST_JOBS } from "../../../scripts/ci-tag-guard";

/**
 * `scripts/ci-tag-guard.ts` is what stands between a pushed `v*` tag and a
 * release: it refuses a tag `release:tag` would not have made. A wrong yes
 * ships a release from a commit nobody prepared, so most cases below are a
 * tag that must be refused.
 */

const REPO = "owner/stoky";
const SHA = "7fffc6e2404d2a543b610cc8af5e1f7f682a1e1b";
const TAG = "v0.2.0-alpha.0";

const pullRequest = {
  id: 1,
  event: "pull_request",
  head_branch: `release/${TAG}`,
  html_url: "https://github.test/runs/1",
  head_repository: { full_name: REPO } as { full_name: string } | null,
};
const green = TEST_JOBS.map((name) => ({
  name,
  conclusion: "success" as string | null,
}));

/** What GitHub says of the tagged commit; a release:tag tag unless overridden. */
function github(
  state: {
    subject?: string;
    behind?: number;
    runs?: Array<typeof pullRequest>;
    jobs?: typeof green;
  } = {},
) {
  const asked: string[] = [];
  const get = async (path: string) => {
    asked.push(path);
    if (path.includes("/commits/")) {
      return {
        commit: {
          message: `${state.subject ?? `chore: prepare ${TAG}`}\n\nBody.`,
        },
      };
    }
    if (path.includes("/compare/")) return { behind_by: state.behind ?? 0 };
    if (path.endsWith("/jobs?per_page=100"))
      return { jobs: state.jobs ?? green };
    return { workflow_runs: state.runs ?? [pullRequest] };
  };
  return { get, asked };
}

describe("a pushed release tag", () => {
  it("stands on the merged preparation its pull request tested", async () => {
    const { get, asked } = github();
    expect(await guard(get, REPO, SHA, TAG)).toEqual({
      run: pullRequest.html_url,
    });
    expect(asked).toEqual([
      `/repos/${REPO}/commits/${SHA}`,
      `/repos/${REPO}/compare/${SHA}...master`,
      `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=success&per_page=100`,
      `/repos/${REPO}/actions/runs/1/jobs?per_page=100`,
    ]);
  });

  it("stands on master's push run", async () => {
    const { get } = github({
      runs: [{ ...pullRequest, event: "push", head_branch: "master" }],
    });
    expect(await guard(get, REPO, SHA, TAG)).toEqual({
      run: pullRequest.html_url,
    });
  });

  it("looks past a run that does not count to one that does", async () => {
    const { get } = github({
      runs: [
        { ...pullRequest, id: 2, event: "workflow_dispatch" },
        pullRequest,
      ],
    });
    expect(await guard(get, REPO, SHA, TAG)).toEqual({
      run: pullRequest.html_url,
    });
  });

  for (const subject of [
    "fix(auth): refuse a reused code",
    "chore: prepare v0.2.0-alpha.1",
    // A squash merge: the SHAs the notes link are orphaned (release-tag.ts).
    `chore: prepare ${TAG} (#31)`,
  ]) {
    it(`is refused on a commit titled "${subject}"`, async () => {
      const { get } = github({ subject });
      expect(await guard(get, REPO, SHA, TAG)).toEqual({
        refused: `its commit is "${subject}", not "chore: prepare ${TAG}"`,
      });
    });
  }

  it("is refused on a preparation that never reached master", async () => {
    const { get } = github({ behind: 1 });
    expect(await guard(get, REPO, SHA, TAG)).toEqual({
      refused: "its commit is not on master",
    });
  });

  const untested = { refused: "no CI run has passed the tests on its commit" };

  for (const [what, run] of [
    // A commit does not vouch for itself.
    [
      "another tag's run",
      { ...pullRequest, event: "push", head_branch: "v0.2.0-alpha.0" },
    ],
    ["a manual dispatch", { ...pullRequest, event: "workflow_dispatch" }],
    [
      "a fork's pull request",
      { ...pullRequest, head_repository: { full_name: "someone/stoky" } },
    ],
    [
      "a run whose repository is gone",
      { ...pullRequest, head_repository: null },
    ],
  ] as const) {
    it(`is refused when its commit's only green run is ${what}`, async () => {
      const { get, asked } = github({ runs: [run] });
      expect(await guard(get, REPO, SHA, TAG)).toEqual(untested);
      // Refused for what the run is, before its jobs are read.
      expect(asked.some((path) => path.includes("/jobs"))).toBe(false);
    });
  }

  it("is refused when its commit has no run", async () => {
    const { get } = github({ runs: [] });
    expect(await guard(get, REPO, SHA, TAG)).toEqual(untested);
  });

  for (const name of TEST_JOBS) {
    it(`is refused unless "${name}" passed in that run`, async () => {
      for (const conclusion of ["failure", "skipped", "cancelled", null]) {
        const { get } = github({
          jobs: green.map((job) =>
            job.name === name ? { ...job, conclusion } : job,
          ),
        });
        expect(await guard(get, REPO, SHA, TAG)).toEqual(untested);
      }
      const { get } = github({
        jobs: green.filter((job) => job.name !== name),
      });
      expect(await guard(get, REPO, SHA, TAG)).toEqual(untested);
    });
  }
});

describe("the guard, as the quality job runs it", () => {
  const script = join(import.meta.dir, "../../../scripts/ci-tag-guard.ts");
  // Spawned without blocking: two cases answer from this process.
  async function start(api: string) {
    const child = Bun.spawn(["bun", script], {
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: REPO,
        GITHUB_SHA: SHA,
        GITHUB_REF_NAME: TAG,
        GITHUB_API_URL: api,
      },
      stdout: "pipe",
    });
    const exitCode = await child.exited;
    return { exitCode, stdout: await new Response(child.stdout).text() };
  }
  /** GitHub over HTTP, with one green run of the commit titled `subject`. */
  const serve = (subject: string) =>
    Bun.serve({
      port: 0,
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname.includes("/commits/")) {
          return Response.json({ commit: { message: subject } });
        }
        if (pathname.includes("/compare/")) {
          return Response.json({ behind_by: 0 });
        }
        return Response.json(
          pathname.endsWith("/jobs")
            ? { jobs: green }
            : { workflow_runs: [pullRequest] },
        );
      },
    });

  it("fails the job when GitHub cannot be asked", async () => {
    // Port 9 (discard): nothing answers.
    const result = await start("http://127.0.0.1:9");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`::error::${TAG} is not a release`);
    expect(result.stdout).toContain("re-run this job");
  });

  it("fails the job on a tag it refuses, naming release:tag", async () => {
    const server = serve("docs: something else");
    try {
      const result = await start(`http://127.0.0.1:${server.port}`);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        `::error::${TAG} is not a release: its commit is "docs: something else"`,
      );
      expect(result.stdout).toContain("bun run release:tag");
    } finally {
      await server.stop(true);
    }
  });

  it("passes the job on a tag that stands", async () => {
    const server = serve(`chore: prepare ${TAG}`);
    try {
      const result = await start(`http://127.0.0.1:${server.port}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(pullRequest.html_url);
    } finally {
      await server.stop(true);
    }
  });
});
