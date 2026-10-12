import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Only a push publishes an image. A manual dispatch selects any ref, and
 * publishing from one put an unreviewed branch on the public registry as
 * `sha-<commit>` with valid provenance.
 *
 * The workflow's concurrency group cancels a superseded run. On a pull request
 * that saves minutes; in a group a publishing run uses (master or a tag) it can
 * land after the push that moved `latest` or `sha-<commit>` and before the
 * attestation step, leaving a published image with no provenance. The arriving
 * run's `cancel-in-progress` decides, so a dispatch on master must not cancel
 * even though it publishes nothing itself. And the newest arrival in a group
 * replaces the run pending there regardless, so a run that cannot publish must
 * not share a publishing run's group at all.
 *
 * The test evaluates `cancel-in-progress`, the group and image-publish's `if`
 * against the contexts of real triggers rather than comparing their spelling,
 * so an equivalent rewrite passes and a regression does not.
 */

const root = join(import.meta.dir, "../../..");
const workflow = Bun.YAML.parse(
  readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
) as {
  on?: { push?: { branches?: unknown; tags?: unknown } };
  concurrency?: { group?: unknown; "cancel-in-progress"?: unknown };
  jobs?: Record<
    string,
    {
      if?: unknown;
      "timeout-minutes"?: unknown;
      steps?: Array<{
        id?: string;
        if?: unknown;
        uses?: unknown;
        run?: unknown;
        with?: Record<string, unknown>;
      }>;
    }
  >;
};

type Context = Record<string, string>;

/**
 * Just enough of GitHub's expression language for the conditions below:
 * context properties, single-quoted strings, integers, booleans, `==`, `!=`,
 * `!`, `&&`, `||` and parentheses. String comparison is case-insensitive, as
 * GitHub's is. Anything else throws, so the test fails loudly instead of
 * guessing.
 */
function evaluate(expression: string, context: Context): unknown {
  const tokens =
    expression.match(
      /'(?:[^']|'')*'|==|!=|&&|\|\||[!()]|\d+|[A-Za-z_][\w.-]*|\S/g,
    ) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  const equal = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;

  function primary(): unknown {
    const token = take();
    if (token === undefined) throw new Error(`unexpected end: ${expression}`);
    if (token === "(") {
      const value = or();
      if (take() !== ")") throw new Error(`missing ): ${expression}`);
      return value;
    }
    if (token === "!") return !primary();
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (/^\d+$/.test(token)) return Number(token);
    if (token === "true") return true;
    if (token === "false") return false;
    if (token in context) return context[token];
    throw new Error(`unsupported token ${token} in ${expression}`);
  }
  function comparison(): unknown {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = take();
      const right = primary();
      left = op === "==" ? equal(left, right) : !equal(left, right);
    }
    return left;
  }
  function and(): unknown {
    let left = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      left = left && right;
    }
    return left;
  }
  function or(): unknown {
    let left = and();
    while (peek() === "||") {
      take();
      const right = and();
      left = left || right;
    }
    return left;
  }

  const value = or();
  if (at !== tokens.length) throw new Error(`trailing input in ${expression}`);
  return value;
}

/** A YAML value as the runner sees it: literal, or one `${{ }}` expression. */
function resolve(value: unknown, context: Context): unknown {
  if (typeof value !== "string") return value;
  const whole = value.trim().match(/^\$\{\{([\s\S]*)\}\}$/);
  if (!whole) throw new Error(`not a single expression: ${value}`);
  return evaluate(whole[1], context);
}

/** A string with `${{ }}` substitutions, such as the concurrency group. */
function interpolate(value: unknown, context: Context): string {
  if (typeof value !== "string") throw new Error(`not a string: ${value}`);
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression: string) =>
    String(evaluate(expression, context)),
  );
}

/** A job `if:`, which GitHub evaluates as an expression with or without `${{ }}`. */
function condition(value: unknown, context: Context): unknown {
  if (value === undefined) return true;
  if (typeof value !== "string") throw new Error(`not a condition: ${value}`);
  const whole = value.trim().match(/^\$\{\{([\s\S]*)\}\}$/);
  return evaluate(whole ? whole[1] : value, context);
}

const run = (
  event: string,
  ref: string,
  refType: "branch" | "tag",
): Context => ({
  "github.event_name": event,
  "github.ref": ref,
  "github.ref_type": refType,
  "github.ref_name": ref.replace(/^refs\/(heads|tags|pull)\//, ""),
  "github.workflow": "CI",
});

const cancels = (context: Context) =>
  resolve(workflow.concurrency?.["cancel-in-progress"], context);

const group = (context: Context) =>
  interpolate(workflow.concurrency?.group, context);

const publishes = (context: Context) => {
  const job = workflow.jobs?.["image-publish"];
  if (!job) throw new Error("ci.yml has no image-publish job");
  return condition(job.if, context);
};

/** Every trigger ci.yml declares, on the refs each can carry. */
const triggers: Array<[string, Context]> = [
  ["push to master", run("push", "refs/heads/master", "branch")],
  ["dispatch on master", run("workflow_dispatch", "refs/heads/master", "branch")],
  ["push of a tag", run("push", "refs/tags/v0.1.0-alpha.3", "tag")],
  ["dispatch on a tag", run("workflow_dispatch", "refs/tags/v0.1.0-alpha.3", "tag")],
  [
    "dispatch on another branch",
    run("workflow_dispatch", "refs/heads/fix/topic-2026-10-12", "branch"),
  ],
  ["pull request", run("pull_request", "refs/pull/42/merge", "branch")],
];

describe("the CI workflow's concurrency", () => {
  it("groups runs by ref, so a pull request never cancels master", () => {
    expect(String(workflow.concurrency?.group)).toContain("github.ref");
  });

  it("never cancels a run on master, which may be mid-publish", () => {
    expect(cancels(run("push", "refs/heads/master", "branch"))).toBe(false);
    expect(
      cancels(run("workflow_dispatch", "refs/heads/master", "branch")),
    ).toBe(false);
  });

  it("never cancels a release tag run", () => {
    expect(cancels(run("push", "refs/tags/v0.1.0-alpha.3", "tag"))).toBe(false);
    expect(
      cancels(run("workflow_dispatch", "refs/tags/v0.1.0-alpha.3", "tag")),
    ).toBe(false);
  });

  it.each(triggers)("never cancels a run that can publish: %s", (_, context) => {
    if (publishes(context)) expect(cancels(context)).toBe(false);
  });

  // The arriving run's `cancel-in-progress` is what cancels the running one,
  // so the rule is about every run that can land in a publishing run's group.
  it.each(triggers)(
    "never lets a run cancel a publishing run in its group: %s",
    (_, arriving) => {
      for (const [, running] of triggers) {
        if (group(running) === group(arriving) && publishes(running)) {
          expect(cancels(arriving)).toBe(false);
        }
      }
    },
  );

  // The newest run to arrive in a group replaces the one pending there,
  // whatever `cancel-in-progress` says (GitHub's default `queue: single`). A
  // run that cannot publish arriving in a publishing group would therefore
  // cancel a pending push, and that push's commit would never be published:
  // push A running, push B pending, a dispatch on master takes B's place.
  it.each(triggers)(
    "never puts a run that cannot publish in a publishing run's group: %s",
    (_, arriving) => {
      if (publishes(arriving)) return;
      for (const [, other] of triggers) {
        if (publishes(other)) expect(group(arriving)).not.toBe(group(other));
      }
    },
  );

  it("still cancels a superseded pull-request run", () => {
    expect(cancels(run("pull_request", "refs/pull/42/merge", "branch"))).toBe(
      true,
    );
  });
});

describe("the CI workflow's image publication", () => {
  it("publishes from a push to master and from a pushed tag", () => {
    expect(publishes(run("push", "refs/heads/master", "branch"))).toBe(true);
    expect(publishes(run("push", "refs/tags/v0.1.0-alpha.3", "tag"))).toBe(
      true,
    );
  });

  it("accepts a push only on master and `v*` tags", () => {
    expect(workflow.on?.push?.branches).toEqual(["master"]);
    expect(workflow.on?.push?.tags).toEqual(["v*"]);
  });

  it.each(
    triggers.filter(([, context]) => context["github.event_name"] !== "push"),
  )("verifies without publishing: %s", (_, context) => {
    expect(publishes(context)).toBe(false);
  });
});

// `changes` skips the image when nothing but docs changed since the last
// successful run on master, which is only sound while every such run either
// published or was docs-only itself. A dispatch on master now succeeds without
// publishing, and a fork's pull request from its own `master` lists under that
// branch name, so the base must come from push runs alone.
describe("the CI workflow's image-skip base", () => {
  it("takes the base only from successful push runs on master", () => {
    const step = workflow.jobs?.changes?.steps?.find((s) => s.id === "diff");
    if (typeof step?.run !== "string") {
      throw new Error("ci.yml has no `changes` diff step");
    }
    const query = step.run
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .find((line) => line.includes("gh run list"));
    expect(query).toBeDefined();
    expect(query).toMatch(/--branch[ =]master\b/);
    expect(query).toMatch(/(--event[ =]|-e )push\b/);
    expect(query).toMatch(/--status[ =]success\b/);
  });
});

// A release is built and packaged from nothing the Actions cache holds. The
// cache of a master or tag run can be written by any job in a master run, e2e
// included, whose container holds the runner's docker socket; a compromised
// test-only package could otherwise plant a Bun binary for release-draft
// (contents: write, packages: write, logged in to GHCR) or a production layer
// for the tag's image build, after image-build's scan had passed. `latest` and
// `sha-` keep the layer cache: no installation is told to run them.
describe("the CI workflow's release path restores no cache", () => {
  const tag = run("push", "refs/tags/v0.1.0-alpha.3", "tag");
  const master = run("push", "refs/heads/master", "branch");

  const job = (name: string) => {
    const found = workflow.jobs?.[name];
    if (!found) throw new Error(`ci.yml has no ${name} job`);
    return found;
  };

  /** Every step of `jobName` (or of every job) that uses `action`. */
  const using = (action: string, jobName?: string) => {
    const jobs = jobName ? [job(jobName)] : Object.values(workflow.jobs ?? {});
    const steps = jobs.flatMap((j) => j.steps ?? []).filter(
      (step) => typeof step.uses === "string" && step.uses.startsWith(`${action}@`),
    );
    if (steps.length === 0) throw new Error(`no step uses ${action}`);
    return steps;
  };

  /**
   * An action input as the action reads it: a string. A literal is stringified,
   * a `${{ }}` value is evaluated for `context` first; an omitted one is "".
   */
  const input = (
    step: { with?: Record<string, unknown> },
    name: string,
    context: Context,
  ) => {
    const value = step.with?.[name];
    if (value === undefined) return "";
    if (typeof value === "string" && !value.includes("${{")) return value;
    return String(resolve(value, context));
  };

  const push = () => {
    const step = job("image-publish").steps?.find((s) => s.id === "push");
    if (!step) throw new Error("image-publish has no `push` step");
    return step;
  };

  it.each(["quality", "release-draft"])(
    "downloads Bun on a tag rather than restore it from the cache: %s",
    (name) => {
      for (const step of using("oven-sh/setup-bun", name)) {
        expect(input(step, "no-cache", tag)).toBe("true");
      }
    },
  );

  it("builds a tag's image without reading or using the layer cache", () => {
    expect(input(push(), "cache-from", tag)).toBe("");
    expect(input(push(), "no-cache", tag)).toBe("true");
    expect(input(push(), "cache-to", tag)).toBe("");
  });

  it("keeps the layer cache for master's image", () => {
    expect(input(push(), "cache-from", master)).toBe("type=gha");
    expect(input(push(), "no-cache", master)).not.toBe("true");
  });

  it("gives a tag's clean build a longer limit than master's cached one", () => {
    const limit = job("image-publish")["timeout-minutes"];
    expect(resolve(limit, tag)).toBe(30);
    expect(resolve(limit, master)).toBe(10);
  });

  it("fetches Trivy and its database on a tag, in every scan", () => {
    for (const step of using("aquasecurity/trivy-action")) {
      expect(input(step, "cache", tag)).toBe("false");
    }
  });
});

// Every action is pinned by commit SHA with its exact version beside it. Two
// pins were once the SHAs of annotated tag objects (`# v2`, `# v3`): the runner
// resolves those, but the commits API answers 422 for them, so Dependabot and
// SHA-pinning enforcement cannot reliably check or bump them, and a major-only
// comment does not say which release the SHA is. Whether a SHA is a commit can
// only be asked of GitHub, so the known tag objects are named here and the rest
// is checked by `gh api repos/<owner>/<repo>/commits/<sha>` when a pin changes.
describe("the CI workflow's action pins", () => {
  const source = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const lines = source
    .split("\n")
    .filter((line) => /^\s*(-\s+)?uses:/.test(line));
  const pin =
    /^\s*(?:-\s+)?uses: ([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@([0-9a-f]{40}) # (v?\d+\.\d+\.\d+)$/;

  // The parsed workflow, so a pin written in a form the line scan misses (a
  // quoted value, a flow mapping) is counted and fails the comparison below.
  const parsedUses = Object.values(workflow.jobs ?? {}).flatMap((job) =>
    ((job as { steps?: Array<{ uses?: unknown }> }).steps ?? [])
      .map((step) => step.uses)
      .filter((uses) => uses !== undefined),
  );

  const tagObjects = [
    // actions/attest-build-provenance tag object `v2` -> commit e8998f9 (v2.4.0)
    "96b4a1ef7235a096b17240c259729fdd70c83d45",
    // github/codeql-action tag object `v3` -> commit c4dd10e (v3.37.6)
    "c3400c2f38909e0dcf3c3a41f2030a8217be5d3e",
  ];

  it("scans every step that uses an action", () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBe(parsedUses.length);
  });

  it.each(lines.map((line) => [line.trim()]))(
    "pins by a 40-hex SHA with the exact version: %s",
    (line) => {
      expect(line).toMatch(pin);
    },
  );

  it("pins no annotated tag object", () => {
    for (const sha of tagObjects) expect(source).not.toContain(sha);
  });

  it("names one version for each SHA of an action, and one SHA per version", () => {
    const versions = new Map<string, string>();
    const shas = new Map<string, string>();
    for (const line of lines) {
      const match = line.match(pin);
      if (!match) continue; // reported by the test above
      const [, repo, sha, version] = match;
      const plain = version.replace(/^v/, "");
      expect(versions.get(`${repo}@${sha}`) ?? plain).toBe(plain);
      expect(shas.get(`${repo}@${plain}`) ?? sha).toBe(sha);
      versions.set(`${repo}@${sha}`, plain);
      shas.set(`${repo}@${plain}`, sha);
    }
  });
});
