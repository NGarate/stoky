import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The workflow's concurrency group cancels a superseded run. On a pull request
 * that saves minutes; on any run that reaches image-publish (a master or tag
 * push, or a dispatch on any ref) it can land after the push that moved
 * `latest` or `sha-<commit>` and before the attestation step, leaving a
 * published image with no provenance.
 *
 * The test evaluates `cancel-in-progress` and image-publish's `if` against the
 * contexts of real triggers rather than comparing their spelling, so an
 * equivalent rewrite passes and a regression to `true` (or to anything that
 * cancels a run that publishes) does not.
 */

const root = join(import.meta.dir, "../../..");
const workflow = Bun.YAML.parse(
  readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
) as {
  concurrency?: { group?: unknown; "cancel-in-progress"?: unknown };
  jobs?: Record<string, { if?: unknown }>;
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

  it("never cancels a dispatch on another branch, which publishes `sha-`", () => {
    const context = run(
      "workflow_dispatch",
      "refs/heads/fix/topic-2026-10-12",
      "branch",
    );
    expect(publishes(context)).toBe(true);
    expect(cancels(context)).toBe(false);
  });

  it.each(triggers)("never cancels a run that can publish: %s", (_, context) => {
    if (publishes(context)) expect(cancels(context)).toBe(false);
  });

  it("still cancels a superseded pull-request run", () => {
    expect(cancels(run("pull_request", "refs/pull/42/merge", "branch"))).toBe(
      true,
    );
  });
});
