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
    { if?: unknown; steps?: Array<{ id?: string; run?: unknown }> }
  >;
};

type Context = Record<string, string>;

/**
 * Just enough of GitHub's expression language for a concurrency condition:
 * context properties, single-quoted strings, booleans, `==`, `!=`, `!`, `&&`,
 * `||` and parentheses. String comparison is case-insensitive, as GitHub's is.
 * Anything else throws, so the test fails loudly instead of guessing.
 */
function evaluate(expression: string, context: Context): unknown {
  const tokens =
    expression.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[!()]|[A-Za-z_][\w.-]*|\S/g) ??
    [];
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
