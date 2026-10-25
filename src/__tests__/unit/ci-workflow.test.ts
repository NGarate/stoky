import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
      permissions?: Record<string, unknown>;
      steps?: Array<{
        id?: string;
        name?: unknown;
        if?: unknown;
        "continue-on-error"?: unknown;
        uses?: unknown;
        run?: unknown;
        env?: Record<string, unknown>;
        with?: Record<string, unknown>;
      }>;
    }
  >;
};

/**
 * Expression contexts: strings, and booleans such as
 * `github.event.repository.private`.
 */
type Context = Record<string, string | boolean>;

/**
 * Just enough of GitHub's expression language for the conditions below:
 * context properties, single-quoted strings, integers, booleans, `==`, `!=`,
 * `!`, `&&`, `||`, parentheses and `always()`. String comparison is
 * case-insensitive, as GitHub's is. Anything else throws, so the test fails
 * loudly instead of guessing.
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
    // `always()`, the one status function a condition below uses: true
    // whatever the earlier steps did.
    if (token === "always" && peek() === "(") {
      take();
      if (take() !== ")") {
        throw new Error(`always takes no argument: ${expression}`);
      }
      return true;
    }
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
  [
    "dispatch on master",
    run("workflow_dispatch", "refs/heads/master", "branch"),
  ],
  ["push of a tag", run("push", "refs/tags/v0.1.0-alpha.3", "tag")],
  [
    "dispatch on a tag",
    run("workflow_dispatch", "refs/tags/v0.1.0-alpha.3", "tag"),
  ],
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

  it.each(triggers)(
    "never cancels a run that can publish: %s",
    (_, context) => {
      if (publishes(context)) expect(cancels(context)).toBe(false);
    },
  );

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
    const steps = jobs
      .flatMap((j) => j.steps ?? [])
      .filter(
        (step) =>
          typeof step.uses === "string" && step.uses.startsWith(`${action}@`),
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

  // Every job, not a list of the ones that matter: e2e and audit run on a tag
  // and gate image-publish, and a list is what let them restore Bun from the
  // cache until zizmor's cache-poisoning audit named them.
  it("downloads Bun on a tag rather than restore it from the cache, in every job", () => {
    for (const step of using("oven-sh/setup-bun")) {
      expect(input(step, "no-cache", tag)).toBe("true");
    }
  });

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

// image-build's Trivy gate scans a build that is never pushed; on a tag the
// pushed image is a clean rebuild, and nothing compares the two digests. So
// release-draft scans the digest it is about to promote, from the registry,
// before the version tag can name it.
describe("the CI workflow's release scans the digest it promotes", () => {
  const steps = workflow.jobs?.["release-draft"]?.steps ?? [];
  const at = (found: number, what: string) => {
    if (found < 0) throw new Error(`release-draft has no ${what}`);
    return found;
  };
  const scanAt = at(
    steps.findIndex(
      (s) =>
        typeof s.uses === "string" &&
        s.uses.startsWith("aquasecurity/trivy-action@"),
    ),
    "Trivy step",
  );
  const scan = steps[scanAt];
  const promoteAt = at(
    steps.findIndex(
      (s) => typeof s.run === "string" && s.run.includes("imagetools create"),
    ),
    "promotion step",
  );
  const loginAt = at(
    steps.findIndex(
      (s) =>
        typeof s.uses === "string" && s.uses.startsWith("docker/login-action@"),
    ),
    "registry login",
  );

  const digest =
    "sha256:0000000000000000000000000000000000000000000000000000000000000001";
  const nameStep = String(scan.with?.["image-ref"]).match(
    /\$\{\{\s*steps\.([\w-]+)\.outputs\.name\s*\}\}/,
  )?.[1];
  const context: Context = {
    ...run("push", "refs/tags/v0.1.0-alpha.3", "tag"),
    "needs.image-publish.outputs.digest": digest,
    [`steps.${nameStep}.outputs.name`]: "ghcr.io/ngarate/stoky",
  };

  it("scans before the version tag is created, after logging in", () => {
    expect(scanAt).toBeLessThan(promoteAt);
    expect(scanAt).toBeGreaterThan(loginAt);
  });

  it("scans the exact digest the promotion retags", () => {
    expect(interpolate(scan.with?.["image-ref"], context)).toBe(
      `ghcr.io/ngarate/stoky@${digest}`,
    );
    expect(interpolate(steps[promoteAt].env?.EXPECTED_DIGEST, context)).toBe(
      digest,
    );
    expect(steps[promoteAt].run).toContain('"$IMAGE@$EXPECTED_DIGEST"');
  });

  it("names the image in lowercase, before the scan, as the promotion does", () => {
    const nameAt = at(
      steps.findIndex((s) => s.id === nameStep),
      `step with id ${nameStep}`,
    );
    expect(nameAt).toBeLessThan(scanAt);
    expect(steps[nameAt].run).toContain("${IMAGE_NAME,,}");
    // The name the scan reads is the image the promotion retags.
    const name = String(steps[nameAt].run).match(/name=([^"\s]+)/)?.[1];
    expect(name).toBe("${REGISTRY}/${IMAGE_NAME,,}");
    expect(steps[promoteAt].run).toContain(`IMAGE="${name}"`);
  });

  it("blocks the job on every tag, never skipped or tolerated", () => {
    expect(scan.if).toBeUndefined();
    expect(scan["continue-on-error"]).toBeUndefined();
  });

  it("reads the image from the registry, never a local copy", () => {
    expect(scan.env?.TRIVY_IMAGE_SRC).toBe("remote");
  });

  it("fails on fixable critical or high findings, with a pinned Trivy", () => {
    expect(String(scan.with?.["exit-code"])).toBe("1");
    expect(scan.with?.severity).toBe("CRITICAL,HIGH");
    expect(String(scan.with?.["ignore-unfixed"])).toBe("true");
    expect(String(scan.with?.cache)).toBe("false");
    expect(scan.with?.version).toBe("v0.69.3");
  });
});

// The bundle's service images were scanned only after publication, by
// rescan.yml: v0.1.0-alpha.3 shipped a Traefik with four HIGH advisories.
// release-images scans them with the gate's rule on a tag, and release-draft
// needs it, so a red bundle never becomes a draft.
describe("the CI workflow's release scans the bundle's service images", () => {
  type Job = NonNullable<typeof workflow.jobs>[string] & {
    needs?: unknown;
    "continue-on-error"?: unknown;
  };
  const job = (name: string) => {
    const found = workflow.jobs?.[name] as Job | undefined;
    if (!found) throw new Error(`ci.yml has no ${name} job`);
    return found;
  };
  const scanStep = () => {
    const steps = (job("release-images").steps ?? []).filter(
      (s) =>
        typeof s.run === "string" &&
        s.run.includes("scripts/scan-bundle-images.sh"),
    );
    expect(steps).toHaveLength(1);
    return steps[0];
  };

  it("holds the draft until the scan passes", () => {
    const needs = job("release-draft").needs;
    expect(Array.isArray(needs) ? needs : [needs]).toContain("release-images");
    // A needed job that fails or is skipped skips the dependant, unless the
    // dependant opts out with a status function.
    expect(String(job("release-draft").if)).not.toMatch(
      /always\(|failure\(|cancelled\(|!success\(/,
    );
  });

  it("runs on every tag, and on a pull request, but never on master", () => {
    const scan = job("release-images");
    expect(
      condition(scan.if, run("push", "refs/tags/v0.1.0-alpha.4", "tag")),
    ).toBe(true);
    expect(
      condition(scan.if, run("pull_request", "refs/pull/42/merge", "branch")),
    ).toBe(true);
    expect(condition(scan.if, run("push", "refs/heads/master", "branch"))).toBe(
      false,
    );
  });

  it("scans what the bundle names, and cannot be tolerated", () => {
    const step = scanStep();
    // No arguments: the images deploy/docker-compose.yml names, not a list
    // that could leave one out.
    expect(String(step.run).trim()).toBe("bash scripts/scan-bundle-images.sh");
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
    expect(job("release-images")["continue-on-error"]).toBeUndefined();
  });

  it("holds no credential: nothing to push, nothing to write", () => {
    expect(job("release-images").permissions).toBeUndefined();
    const checkout = (job("release-images").steps ?? []).find(
      (s) =>
        typeof s.uses === "string" && s.uses.startsWith("actions/checkout@"),
    );
    expect(String(checkout?.with?.["persist-credentials"])).toBe("false");
  });
});

// SHA256SUMS comes from the same release as the files it covers, so it detects
// damage, not replacement: anything holding contents: write can swap a
// published file and its checksum line together. release-draft therefore
// attests every installation file it attaches, so an operator can check each
// against this workflow and tag (`gh attestation verify`, INSTALL.md). The
// action skips a path that matches nothing without failing, so the attested
// list is compared with the draft's own, file for file.
describe("the CI workflow's release attests its installation files", () => {
  const job = workflow.jobs?.["release-draft"];
  const steps = job?.steps ?? [];
  const attestAction = "actions/attest-build-provenance@";
  const usesAttest = (s: { uses?: unknown }) =>
    typeof s.uses === "string" && s.uses.startsWith(attestAction);

  const attestAt = steps.findIndex(usesAttest);
  const attest = steps[attestAt];
  const runs = (needle: string) =>
    steps.findIndex((s) => typeof s.run === "string" && s.run.includes(needle));
  const packageAt = runs("scripts/release-assets.sh");
  const checkAt = runs("config --images");
  const draftAt = runs("gh release create");

  const runnerTemp = "/home/runner/work/_temp";
  const tag: Context = {
    ...run("push", "refs/tags/v0.1.0-alpha.3", "tag"),
    "github.event.repository.private": false,
    "runner.temp": runnerTemp,
  };

  /** The files the draft step attaches: its `ASSETS=(...)` array, expanded. */
  const draftAssets = () => {
    const script = String(steps[draftAt]?.run ?? "");
    const list = script.match(/^\s*ASSETS=\(([^)]*)\)/m)?.[1];
    if (!list) throw new Error("the draft step has no ASSETS=(...) array");
    return [...list.matchAll(/"([^"]+)"/g)].map(([, path]) =>
      path.replaceAll("$RUNNER_TEMP", runnerTemp),
    );
  };

  const attested = () =>
    interpolate(attest?.with?.["subject-path"], tag)
      .split(/[\n,]/)
      .map((path) => path.trim())
      .filter(Boolean);

  it("grants the job what a provenance attestation needs", () => {
    expect(job?.permissions?.["id-token"]).toBe("write");
    expect(job?.permissions?.attestations).toBe("write");
  });

  it("attests once, after packaging and checking, before the draft exists", () => {
    expect(steps.filter(usesAttest)).toHaveLength(1);
    expect(packageAt).toBeGreaterThanOrEqual(0);
    expect(checkAt).toBeGreaterThan(packageAt);
    expect(attestAt).toBeGreaterThan(checkAt);
    expect(attestAt).toBeLessThan(draftAt);
  });

  it("attests exactly the files the draft attaches, SHA256SUMS included", () => {
    const assets = draftAssets();
    expect(assets).toHaveLength(5);
    expect(assets).toContain(`${runnerTemp}/release/SHA256SUMS`);
    expect(attested().toSorted()).toEqual(assets.toSorted());
  });

  it("names each file, never a glob that could match nothing", () => {
    for (const path of attested()) expect(path).not.toMatch(/[*?[{]/);
  });

  it("runs on every public tag run, gated as the image's attestation is", () => {
    const image = workflow.jobs?.["image-publish"]?.steps?.find(usesAttest);
    expect(image).toBeDefined();
    expect(attest?.if).toBe(image?.if);
    expect(condition(attest?.if, tag)).toBe(true);
    expect(attest?.["continue-on-error"]).toBeUndefined();
  });
});

// Every action is pinned by commit SHA with its exact version beside it, in
// every workflow. Two pins were once the SHAs of annotated tag objects (`# v2`,
// `# v3`): the runner resolves those, but the commits API answers 422 for them,
// so Dependabot and SHA-pinning enforcement cannot reliably check or bump them,
// and a major-only comment does not say which release the SHA is. Whether a SHA
// is a commit can only be asked of GitHub, so the known tag objects are named
// here and the rest is checked by `gh api repos/<owner>/<repo>/commits/<sha>`
// when a pin changes.
describe("the workflows' action pins", () => {
  const directory = join(root, ".github/workflows");
  const files = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file));
  const sources = files.map((file) => ({
    file,
    source: readFileSync(join(directory, file), "utf8"),
  }));
  const usesLines = (source: string) =>
    source.split("\n").filter((line) => /^\s*(-\s+)?uses:/.test(line));
  const lines = sources.flatMap(({ file, source }) =>
    usesLines(source).map((line) => ({ file, line })),
  );
  const pin =
    /^\s*(?:-\s+)?uses: ([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@([0-9a-f]{40}) # (v?\d+\.\d+\.\d+)$/;

  const tagObjects = [
    // actions/attest-build-provenance tag object `v2` -> commit e8998f9 (v2.4.0)
    "96b4a1ef7235a096b17240c259729fdd70c83d45",
    // github/codeql-action tag object `v3` -> commit c4dd10e (v3.37.6)
    "c3400c2f38909e0dcf3c3a41f2030a8217be5d3e",
  ];

  it("reads both workflows", () => {
    expect(files).toContain("ci.yml");
    expect(files).toContain("rescan.yml");
  });

  // The parsed workflow, so a pin written in a form the line scan misses (a
  // quoted value, a flow mapping) is counted and fails the comparison.
  it.each(sources.map(({ file, source }) => [file, source]))(
    "scans every step that uses an action: %s",
    (_, source) => {
      const parsed = Bun.YAML.parse(source) as {
        jobs?: Record<string, { steps?: Array<{ uses?: unknown }> }>;
      };
      const parsedUses = Object.values(parsed.jobs ?? {}).flatMap((job) =>
        (job.steps ?? [])
          .map((step) => step.uses)
          .filter((uses) => uses !== undefined),
      );
      expect(usesLines(source).length).toBeGreaterThan(0);
      expect(usesLines(source).length).toBe(parsedUses.length);
    },
  );

  it.each(lines.map(({ file, line }) => [`${file}: ${line.trim()}`, line]))(
    "pins by a 40-hex SHA with the exact version: %s",
    (_, line) => {
      expect(line).toMatch(pin);
    },
  );

  // A moving label changes the operating system under every job at once, the
  // release path included, on GitHub's schedule: `ubuntu-latest` began moving
  // to Ubuntu 26 on 2026-10-19. A version is changed by an edit someone reads.
  it.each(sources.map(({ file, source }) => [file, source]))(
    "runs every job on a runner image named by version: %s",
    (_, source) => {
      const parsed = Bun.YAML.parse(source) as {
        jobs?: Record<string, { "runs-on"?: unknown }>;
      };
      const runners = Object.values(parsed.jobs ?? {}).map(
        (job) => job["runs-on"],
      );
      expect(runners.length).toBeGreaterThan(0);
      for (const runner of runners)
        expect(runner).toMatch(/^ubuntu-\d{2}\.\d{2}$/);
    },
  );

  it("pins no annotated tag object", () => {
    for (const { source } of sources) {
      for (const sha of tagObjects) expect(source).not.toContain(sha);
    }
  });

  // Across workflows too, so the weekly rescan cannot drift from ci.yml's pin.
  it("names one version for each SHA of an action, and one SHA per version", () => {
    const versions = new Map<string, string>();
    const shas = new Map<string, string>();
    for (const { line } of lines) {
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

// A release is scanned once, before its version tag exists; ci.yml runs only
// on a push, a pull request or a dispatch, so on a quiet trunk an advisory
// published later reached nobody (SECURITY_REVIEW #17). rescan.yml scans the
// newest published release's images every week with the release gate's
// scanner. These hold its shape: a schedule, no trigger that runs other code,
// least privilege, no cache, every image of the release, and a gate that fails.
describe("the weekly rescan of the published release", () => {
  type Step = {
    id?: string;
    if?: unknown;
    uses?: unknown;
    run?: unknown;
    env?: Record<string, unknown>;
    with?: Record<string, unknown>;
  };
  type Job = {
    needs?: unknown;
    if?: unknown;
    "continue-on-error"?: unknown;
    env?: Record<string, unknown>;
    permissions?: Record<string, unknown>;
    strategy?: { "fail-fast"?: unknown; matrix?: Record<string, unknown> };
    outputs?: Record<string, unknown>;
    steps?: Step[];
  };
  const rescan = Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows/rescan.yml"), "utf8"),
  ) as {
    on?: Record<string, unknown>;
    env?: Record<string, unknown>;
    permissions?: Record<string, unknown>;
    jobs?: Record<string, Job>;
  };
  const jobs = rescan.jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const trivySteps = steps.filter(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("aquasecurity/trivy-action@"),
  );

  /** The scan job: the one whose matrix supplies the image. */
  const scanJob = () => {
    const found = Object.entries(jobs).find(([, job]) =>
      job.steps?.some((s) => String(s.with?.["image-ref"]).includes("matrix.")),
    );
    if (!found)
      throw new Error("rescan.yml has no job scanning a matrix image");
    return found;
  };

  /** The minimal cron form: five fields, each a literal or `*`. */
  const cron = () => {
    const schedule = rescan.on?.schedule as
      Array<{ cron?: unknown }> | undefined;
    expect(schedule).toHaveLength(1);
    return String(schedule?.[0]?.cron).trim().split(/\s+/);
  };

  it("runs on a weekly schedule and by hand, never on pushed or proposed code", () => {
    expect(Object.keys(rescan.on ?? {}).toSorted()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cron();
    expect(minute).toMatch(/^\d{1,2}$/);
    expect(hour).toMatch(/^\d{1,2}$/);
    expect(dayOfMonth).toBe("*");
    expect(month).toBe("*");
    expect(dayOfWeek).toMatch(/^[0-6]$/);
  });

  it("starts off the hour, when GitHub delays schedules most", () => {
    expect(cron()[0]).not.toBe("0");
  });

  it("grants only contents: read by default", () => {
    expect(rescan.permissions).toEqual({ contents: "read" });
  });

  it("grants write only to the scan job, and only for its SARIF upload", () => {
    const [name, scan] = scanJob();
    expect(scan.permissions).toEqual({
      contents: "read",
      "security-events": "write",
      actions: "read",
    });
    for (const [other, job] of Object.entries(jobs)) {
      if (other === name) continue;
      for (const level of Object.values(job.permissions ?? {})) {
        expect(level).not.toBe("write");
      }
    }
  });

  it("scans the newest published release, prereleases included", () => {
    const release = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("gh release list"),
    );
    if (typeof release?.run !== "string") {
      throw new Error("rescan.yml does not resolve a release");
    }
    // Every release so far is an alpha; `releases/latest` answers 404 for them.
    expect(release.run).toContain("--exclude-drafts");
    expect(release.run).not.toContain("--exclude-pre-releases");
    expect(release.run).not.toContain("releases/latest");
  });

  it("scans every image the release's own Compose file resolves", () => {
    const images = steps.find(
      (s) =>
        typeof s.run === "string" && s.run.includes("config --format json"),
    );
    if (typeof images?.run !== "string" || !images.id) {
      throw new Error("rescan.yml does not read the release's Compose file");
    }
    expect(images.run).toMatch(
      /gh release download "\$RELEASE_TAG" --pattern docker-compose\.yml/,
    );
    expect(images.env?.STOKY_VERSION).toBe(images.env?.RELEASE_TAG);

    // The image list reaches the matrix unchanged: step -> job output -> include.
    const [producer, producerJob] = Object.entries(jobs).find(([, job]) =>
      job.steps?.includes(images),
    ) ?? ["", {} as Job];
    const output = Object.entries(producerJob.outputs ?? {}).find(([, value]) =>
      new RegExp(`steps\\.${images.id}\\.outputs\\.images\\b`).test(
        String(value),
      ),
    )?.[0];
    expect(output).toBeDefined();
    const [, scan] = scanJob();
    expect(String(scan.strategy?.matrix?.include).replace(/\s+/g, "")).toBe(
      `\${{fromJSON(needs.${producer}.outputs.${output})}}`,
    );
    expect(scan.needs).toEqual([producer]);
  });

  it("keeps scanning the other images when one is red", () => {
    expect(scanJob()[1].strategy?.["fail-fast"]).toBe(false);
  });

  it("runs Trivy pinned, from the registry, with no Actions cache", () => {
    expect(trivySteps).toHaveLength(2);
    for (const step of trivySteps) {
      expect(String(step.with?.cache)).toBe("false");
      expect(step.with?.version).toBe("v0.69.3");
      expect(step.env?.TRIVY_IMAGE_SRC).toBe("remote");
      expect(step.with?.["image-ref"]).toBe("${{ matrix.image }}");
    }
  });

  it("uses the scanner version the release gate uses", () => {
    const releaseScan = workflow.jobs?.["release-draft"]?.steps?.find(
      (s) =>
        typeof s.uses === "string" &&
        s.uses.startsWith("aquasecurity/trivy-action@"),
    );
    for (const step of trivySteps) {
      expect(step.uses).toBe(releaseScan?.uses);
      expect(step.with?.version).toBe(releaseScan?.with?.version);
    }
  });

  it("fails the run on a fixable critical or high finding, skipping only gosu", () => {
    const gates = trivySteps.filter(
      (s) => String(s.with?.["exit-code"]) === "1",
    );
    expect(gates).toHaveLength(1);
    const [gate] = gates;
    expect(gate.with?.severity).toBe("CRITICAL,HIGH");
    expect(String(gate.with?.["ignore-unfixed"])).toBe("true");
    expect(gate.if).toBeUndefined();
    expect(
      (gate as { "continue-on-error"?: unknown })["continue-on-error"],
    ).toBeUndefined();
    // One file, measured unreachable; anything broader is a new decision.
    expect(gate.with?.["skip-files"]).toBe("usr/local/bin/gosu");
    expect(gate.with?.["skip-dirs"]).toBeUndefined();
    expect(gate.with?.trivyignores).toBeUndefined();
    // The report keeps what the gate skips.
    const report = trivySteps.find((s) => s !== gate);
    expect(report?.with?.format).toBe("sarif");
    expect(report?.with?.["skip-files"]).toBeUndefined();
    // Nor can the gate be quieted from around it: a job that may fail, a job
    // that never runs, or a TRIVY_* variable (TRIVY_SKIP_DIRS, TRIVY_IGNOREFILE,
    // TRIVY_EXIT_CODE) set on the workflow, the job or a step.
    const [, scan] = scanJob();
    expect(scan.if).toBeUndefined();
    expect(scan["continue-on-error"]).toBeUndefined();
    const trivyEnv = [rescan.env, scan.env, ...trivySteps.map((s) => s.env)]
      .flatMap((env) => Object.keys(env ?? {}))
      .filter(
        (name) => name.startsWith("TRIVY_") && name !== "TRIVY_IMAGE_SRC",
      );
    expect(trivyEnv).toEqual([]);
  });

  // The published copy of a release's notes drifted from its file once (the
  // v0.1.0-alpha.2 recovery steps), and nothing said so for ten days.
  it("compares every published release's notes with its file, untolerated", () => {
    const runs = Object.entries(jobs).flatMap(([name, job]) =>
      (job.steps ?? [])
        .filter(
          (s) =>
            typeof s.run === "string" &&
            s.run.includes("scripts/check-published-notes.sh"),
        )
        .map((step) => ({ name, job, step })),
    );
    expect(runs).toHaveLength(1);
    const [{ job, step }] = runs;
    expect(String(step.run).trim()).toBe(
      "bash scripts/check-published-notes.sh",
    );
    expect(step.if).toBeUndefined();
    expect(
      (step as { "continue-on-error"?: unknown })["continue-on-error"],
    ).toBeUndefined();
    expect(job.if).toBeUndefined();
    expect(job["continue-on-error"]).toBeUndefined();
    expect(job.needs).toBeUndefined();
    expect(job.permissions).toBeUndefined();
  });

  it("uploads a report per image, apart from master's, wherever GitHub accepts it", () => {
    const upload = steps.find(
      (s) =>
        typeof s.uses === "string" &&
        s.uses.startsWith("github/codeql-action/upload-sarif@"),
    );
    if (!upload) throw new Error("rescan.yml uploads no SARIF");
    const category = String(upload.with?.category);
    expect(category).toContain("${{ matrix.service }}");
    expect(category).not.toBe("trivy");
    const visibility = String(upload.if).match(
      /needs\.([\w-]+)\.outputs\.([\w-]+)/,
    );
    if (!visibility) throw new Error("the upload does not read the visibility");
    const key = `needs.${visibility[1]}.outputs.${visibility[2]}`;
    expect(condition(upload.if, { [key]: "false" })).toBe(true);
    expect(condition(upload.if, { [key]: "true" })).toBe(false);
  });
});

// Nothing proposed updates: every bump was a reaction to an advisory, and the
// SHA-pinned actions and the bundle's images aged silently. Dependabot now
// proposes them as pull requests the owner reviews. These hold what makes
// those pull requests safe to read: every surface covered, a week's wait after
// a release, majors kept apart, and no major of a service an installation
// keeps data in or exposes.
describe("Dependabot's update configuration", () => {
  type Update = {
    "package-ecosystem"?: unknown;
    directory?: unknown;
    schedule?: { interval?: unknown };
    cooldown?: Record<string, unknown>;
    groups?: Record<string, { "update-types"?: unknown }>;
    ignore?: Array<{ "dependency-name"?: unknown; "update-types"?: unknown }>;
    "commit-message"?: { prefix?: unknown; include?: unknown };
  };
  const config = Bun.YAML.parse(
    readFileSync(join(root, ".github/dependabot.yml"), "utf8"),
  ) as { version?: unknown; updates?: Update[] };
  const updates = config.updates ?? [];
  const entry = (ecosystem: string) => {
    const found = updates.filter((u) => u["package-ecosystem"] === ecosystem);
    if (found.length !== 1) {
      throw new Error(`expected one ${ecosystem} entry, found ${found.length}`);
    }
    return found[0];
  };

  it("is a version 2 configuration", () => {
    expect(config.version).toBe(2);
  });

  // The manifest each entry reads, so a moved file fails here rather than in a
  // Dependabot log nobody opens.
  it("covers the lockfile, the actions, the Dockerfile and the release bundle", () => {
    expect(
      updates
        .map((u) => `${String(u["package-ecosystem"])} ${String(u.directory)}`)
        .toSorted(),
    ).toEqual([
      "bun /",
      "docker /",
      "docker-compose /deploy",
      "github-actions /",
    ]);
    for (const manifest of [
      "bun.lock",
      "Dockerfile",
      "deploy/docker-compose.yml",
    ]) {
      expect(existsSync(join(root, manifest))).toBe(true);
    }
  });

  it.each(updates.map((u) => [String(u["package-ecosystem"]), u]))(
    "checks weekly and waits at least a week after a release: %s",
    (_, update) => {
      expect(update.schedule?.interval).toBe("weekly");
      expect(Number(update.cooldown?.["default-days"])).toBeGreaterThanOrEqual(
        7,
      );
      // Exemptions would let a dependency skip the wait.
      expect(update.cooldown?.exclude).toBeUndefined();
    },
  );

  // A group with no update-types takes every type, majors included.
  it.each(updates.map((u) => [String(u["package-ecosystem"]), u]))(
    "groups minor and patch updates and never a major: %s",
    (_, update) => {
      const groups = Object.values(update.groups ?? {});
      expect(groups).toHaveLength(1);
      expect(
        (groups[0]["update-types"] as string[] | undefined)?.toSorted(),
      ).toEqual(["minor", "patch"]);
    },
  );

  // Read from the bundle, so a service added to it without the rule fails.
  it("never proposes a major of an image the release bundle runs", () => {
    const bundle = Bun.YAML.parse(
      readFileSync(join(root, "deploy/docker-compose.yml"), "utf8"),
    ) as { services?: Record<string, { image?: unknown }> };
    const images = Object.values(bundle.services ?? {})
      .map((service) => String(service.image))
      .filter((image) => !image.includes("${"))
      // postgres:16-alpine@sha256:… -> postgres
      .map((image) => image.split("@")[0].replace(/:[^:/]+$/, ""));
    expect(images.toSorted()).toEqual(["postgres", "traefik", "valkey/valkey"]);
    const ignored = (entry("docker-compose").ignore ?? [])
      .filter((rule) =>
        (rule["update-types"] as string[] | undefined)?.includes(
          "version-update:semver-major",
        ),
      )
      .map((rule) => rule["dependency-name"]);
    for (const image of images) expect(ignored).toContain(image);
  });

  // An ignore with no update-types silences every version of a dependency,
  // patches included.
  it("ignores majors only, never a dependency's patches", () => {
    for (const update of updates) {
      for (const rule of update.ignore ?? []) {
        expect(rule["update-types"]).toEqual(["version-update:semver-major"]);
      }
    }
  });

  // CLAUDE.md's Commit Convention, read from CLAUDE.md. Dependabot appends the
  // colon, and `include: scope` adds `(deps)` or `(deps-dev)`: the scope the
  // hand-made dependency bumps in this history already carry.
  it("titles its commits with a type and a scope CLAUDE.md names", () => {
    const convention = readFileSync(join(root, "CLAUDE.md"), "utf8");
    const listed = (label: string) =>
      [
        ...(
          convention.match(new RegExp(`${label}:([^.]*)\\.`))?.[1] ?? ""
        ).matchAll(/`([\w-]+)`/g),
      ].map((m) => m[1]);
    const types = listed("Types");
    const scopes = [...listed("Scopes"), "deps", "deps-dev"];
    expect(types).toContain("build");
    expect(scopes).toContain("docker");
    for (const update of updates) {
      const message = update["commit-message"];
      const prefix = String(message?.prefix);
      const title = message?.include === "scope" ? `${prefix}(deps)` : prefix;
      const match = title.match(/^(\w+)(?:\(([\w-]+)\))?$/);
      if (!match)
        throw new Error(`not a Conventional Commits prefix: ${title}`);
      expect(types).toContain(match[1]);
      if (match[2]) expect(scopes).toContain(match[2]);
    }
  });
});
