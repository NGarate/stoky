import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/github-settings.ts` is the only record of the repository's GitHub
 * security settings, and the only thing that notices one being turned off.
 * These tests run it against a stub `gh` that answers from a fixture, the way
 * install-script.test stubs curl: what is under test is the script's reading
 * of GitHub's answers, not GitHub.
 */

const root = join(import.meta.dir, "../../..");
const script = join(root, "scripts/github-settings.ts");
const REPO = "example/stoky";

interface Ruleset {
  id?: number;
  name: string;
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: { type: string }[];
  bypass_actors: { actor_id: number; actor_type: string; bypass_mode: string }[];
}

const readJson = <T>(path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as T;
const immutable = readJson<Ruleset>(".github/rulesets/release-tags-immutable.json");
const creation = readJson<Ruleset>(".github/rulesets/release-tags-creation.json");
const selectedActions = readJson<{ github_owned_allowed: boolean; verified_allowed: boolean; patterns_allowed: string[] }>(
  ".github/selected-actions.json",
);

type Reply = { status: number; body?: unknown };
type State = Record<string, Reply>;

/** An ISO date `days` from now, as GitHub writes `expires_at`. */
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const interactionLimit = (limit: string, days: number) => ({
  status: 200,
  body: { limit, origin: "repository", expires_at: daysFromNow(days) },
});

const BRANCH_RULESET = {
  id: 24892601,
  name: "Block All except me",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/dependabot/**"] } },
  rules: [
    { type: "non_fast_forward" },
    { type: "creation" },
    { type: "update" },
    { type: "deletion" },
    { type: "required_signatures" },
  ],
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
};

/** Every setting as the script wants it, in the shapes GitHub answers with. */
function inSync(): State {
  const rulesets = [BRANCH_RULESET, { ...immutable, id: 101 }, { ...creation, id: 102 }];
  return {
    "": {
      status: 200,
      body: {
        allow_merge_commit: false,
        allow_rebase_merge: false,
        allow_squash_merge: true,
        delete_branch_on_merge: true,
        squash_merge_commit_title: "PR_TITLE",
        squash_merge_commit_message: "PR_BODY",
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        has_discussions: false,
        security_and_analysis: {
          dependabot_security_updates: { status: "enabled" },
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
    },
    "private-vulnerability-reporting": { status: 200, body: { enabled: true } },
    "immutable-releases": { status: 200, body: { enabled: true, enforced_by_owner: false } },
    "vulnerability-alerts": { status: 204 },
    "automated-security-fixes": { status: 200, body: { enabled: true, paused: false } },
    "code-scanning/default-setup": {
      status: 200,
      body: { state: "configured", languages: ["actions", "javascript-typescript"], query_suite: "extended" },
    },
    "actions/permissions": { status: 200, body: { enabled: true, allowed_actions: "selected", sha_pinning_required: true } },
    "actions/permissions/selected-actions": { status: 200, body: selectedActions },
    "actions/permissions/fork-pr-contributor-approval": {
      status: 200,
      body: { approval_policy: "all_external_contributors" },
    },
    "interaction-limits": interactionLimit("collaborators_only", 150),
    "rulesets?per_page=100": {
      status: 200,
      body: rulesets.map(({ id, name, target, enforcement }) => ({ id, name, target, enforcement })),
    },
    // GET rulesets/ID adds fields the script must ignore.
    ...Object.fromEntries(
      rulesets.map((ruleset) => [
        `rulesets/${ruleset.id}`,
        { status: 200, body: { ...ruleset, source_type: "Repository", current_user_can_bypass: "always" } },
      ]),
    ),
  };
}

/**
 * What the repository answered on 2026-10-12, before any of this was applied;
 * the settings added on 2026-10-23 as they answered that day.
 */
function measured(): State {
  const state = inSync();
  state[""] = {
    status: 200,
    body: {
      allow_merge_commit: true,
      allow_rebase_merge: true,
      allow_squash_merge: true,
      delete_branch_on_merge: false,
      squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
      squash_merge_commit_message: "COMMIT_MESSAGES",
      has_issues: true,
      has_projects: true,
      has_wiki: false,
      has_discussions: false,
      security_and_analysis: {
        dependabot_security_updates: { status: "disabled" },
        secret_scanning: { status: "disabled" },
        secret_scanning_push_protection: { status: "disabled" },
      },
    },
  };
  state["private-vulnerability-reporting"] = { status: 200, body: { enabled: false } };
  state["immutable-releases"] = { status: 200, body: { enabled: false, enforced_by_owner: false } };
  state["automated-security-fixes"] = { status: 200, body: { enabled: false, paused: false } };
  state["code-scanning/default-setup"] = { status: 200, body: { state: "not-configured", query_suite: "default" } };
  state["actions/permissions"] = { status: 200, body: { enabled: true, allowed_actions: "all", sha_pinning_required: false } };
  state["actions/permissions/selected-actions"] = {
    status: 409,
    body: { message: "Conflict", errors: "All actions and workflows are allowed on this repository" },
  };
  state["actions/permissions/fork-pr-contributor-approval"] = {
    status: 200,
    body: { approval_policy: "first_time_contributors" },
  };
  state["rulesets?per_page=100"] = {
    status: 200,
    body: [{ id: BRANCH_RULESET.id, name: BRANCH_RULESET.name, target: "branch", enforcement: "active" }],
  };
  state[`rulesets/${BRANCH_RULESET.id}`] = {
    status: 200,
    body: {
      ...BRANCH_RULESET,
      conditions: { ref_name: { exclude: [], include: ["~ALL"] } },
      bypass_actors: [
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        { actor_id: 24436231, actor_type: "User", bypass_mode: "always" },
      ],
    },
  };
  state["interaction-limits"] = { status: 200, body: {} };
  return state;
}

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

const key = (endpoint: string) => endpoint.replace(/[^A-Za-z0-9]/g, "_");

/**
 * Runs the script with a `gh` that answers GETs from `state` (a missing
 * endpoint is a 404, as `vulnerability-alerts` answers when off), answers
 * every write with `writeStatus`, and records every call.
 */
function run(state: State, args: string[], options: { writeStatus?: number; repo?: string | null } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-github-settings-"));
  fixtures.push(fixture);
  const bin = join(fixture, "bin");
  const replies = join(fixture, "replies");
  const calls = join(fixture, "calls");
  mkdirSync(bin);
  mkdirSync(replies);
  writeFileSync(calls, "");
  const repo = options.repo === undefined ? REPO : options.repo ?? "NGarate/stoky";
  for (const [path, reply] of Object.entries(state)) {
    const endpoint = path === "" ? `repos/${repo}` : `repos/${repo}/${path}`;
    writeFileSync(join(replies, key(endpoint)), `${reply.status}\n${reply.body === undefined ? "" : JSON.stringify(reply.body)}`);
  }
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/bash
method=GET; input=; endpoint=
while [ $# -gt 0 ]; do
  case "$1" in
    api | --include) ;;
    --method) method="$2"; shift ;;
    --input) input="$(cat)"; shift ;;
    *) endpoint="$1" ;;
  esac
  shift
done
printf '%s %s %s\\n' "$method" "$endpoint" "$input" >> "${calls}"
if [ "$method" != GET ]; then
  printf 'HTTP/2.0 ${options.writeStatus ?? 200} X\\n\\n{"message":"stub"}\\n'
  [ ${options.writeStatus ?? 200} -lt 400 ]; exit
fi
file="${replies}/\${endpoint//[^A-Za-z0-9]/_}"
if [ ! -f "$file" ]; then
  printf 'HTTP/2.0 404 Not Found\\n\\n{"message":"Not Found"}\\n'
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
fi
status="$(head -n 1 "$file")"
printf 'HTTP/2.0 %s X\\n\\n' "$status"
tail -n +2 "$file"
[ "$status" -lt 400 ]
`,
    { mode: 0o755 },
  );
  const repoArgs = options.repo === null ? [] : ["--repo", repo];
  const result = Bun.spawnSync([process.execPath, script, ...args, ...repoArgs], {
    cwd: fixture,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    calls: readFileSync(calls, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [method, endpoint, ...body] = line.split(" ");
        const text = body.join(" ");
        return { method, endpoint: endpoint.replace(`repos/${repo}`, "").replace(/^\//, ""), body: text ? JSON.parse(text) : undefined };
      }),
  };
}

const driftLines = (stdout: string) => stdout.split("\n").filter((line) => line.startsWith("DRIFT"));

describe("the release-tag rulesets", () => {
  it("make a published v* tag impossible to move or delete, for everyone", () => {
    expect(immutable.target).toBe("tag");
    expect(immutable.enforcement).toBe("active");
    expect(immutable.conditions.ref_name).toEqual({ include: ["refs/tags/v*"], exclude: [] });
    expect(immutable.rules.map((rule) => rule.type).sort()).toEqual(["deletion", "non_fast_forward", "update"]);
    // A bypass here would make the rule as decorative as the branch
    // ruleset's signatures: the owner's token is the one that leaks.
    expect(immutable.bypass_actors).toEqual([]);
  });

  it("let only an administrator create a v* tag", () => {
    expect(creation.target).toBe("tag");
    expect(creation.enforcement).toBe("active");
    expect(creation.conditions.ref_name).toEqual(immutable.conditions.ref_name);
    expect(creation.rules).toEqual([{ type: "creation" }]);
    expect(creation.bypass_actors).toEqual([{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }]);
  });
});

describe("the Actions allow-list", () => {
  // Called by aquasecurity/trivy-action from inside its own action.yaml, so no
  // workflow names it, and the Trivy steps fail without it.
  const NESTED = ["aquasecurity/setup-trivy@*"];

  const uses = readdirSync(join(root, ".github/workflows"))
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => {
      const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows", file), "utf8")) as {
        jobs?: Record<string, { uses?: string; steps?: { uses?: string }[] }>;
      };
      return Object.values(workflow.jobs ?? {}).flatMap((job) => [job.uses, ...(job.steps ?? []).map((step) => step.uses)]);
    })
    .filter((ref): ref is string => typeof ref === "string" && !ref.startsWith("./") && !ref.startsWith("docker://"));

  const allows = (pattern: string, ref: string) => {
    const [name] = ref.split("@");
    const [patternName] = pattern.split("@");
    return patternName.endsWith("/*") ? name.startsWith(patternName.slice(0, -1)) : name === patternName;
  };

  it("finds the workflows' actions", () => {
    expect(uses.length).toBeGreaterThan(10);
  });

  it("allows every action a workflow uses, or CI stops at the policy check", () => {
    const ownedByGitHub = (ref: string) => /^(actions|github)\//.test(ref);
    const refused = uses.filter(
      (ref) =>
        !(selectedActions.github_owned_allowed && ownedByGitHub(ref)) &&
        !selectedActions.patterns_allowed.some((pattern) => allows(pattern, ref)),
    );
    expect(refused).toEqual([]);
  });

  it("allows nothing a workflow does not use", () => {
    const unused = selectedActions.patterns_allowed.filter(
      (pattern) => !NESTED.includes(pattern) && !uses.some((ref) => allows(pattern, ref)),
    );
    expect(unused).toEqual([]);
    expect(selectedActions.verified_allowed).toBe(false);
  });
});

describe("scripts/github-settings.ts check", () => {
  it("exits 0, reading only, when every setting is as wanted", () => {
    const result = run(inSync(), ["check"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(driftLines(result.stdout)).toEqual([]);
    expect(result.stdout).toContain(`${REPO}: in sync.`);
    expect(result.calls.length).toBeGreaterThan(0);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("reports every setting the repository had off on 2026-10-12, and writes nothing", () => {
    const result = run(measured(), ["check"]);
    expect(result.exitCode).toBe(1);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
    // Dependabot alerts were already on.
    expect(result.stdout).toContain("ok     Dependabot alerts");
    expect(driftLines(result.stdout).map((line) => line.replace(/^DRIFT {2}([^:]+):.*$/, "$1"))).toEqual([
      "Private vulnerability reporting",
      "Immutable releases",
      "Secret scanning and push protection",
      "Dependabot security updates",
      "CodeQL default setup",
      "Actions allow-list and SHA pinning",
      "Fork pull request approval",
      "Squash-only merges",
      'Ruleset "Release tags are immutable"',
      'Ruleset "Release tags are created by an admin"',
      "Dependabot can push its branches",
      "Interactions limited to collaborators",
      "Projects, wiki and discussions off",
    ]);
  });

  const cases: [string, string, (state: State) => void][] = [
    ["Private vulnerability reporting", "enabled is false", (s) => (s["private-vulnerability-reporting"].body = { enabled: false })],
    ["Immutable releases", "enabled is false", (s) => (s["immutable-releases"].body = { enabled: false })],
    [
      "Secret scanning and push protection",
      'secret_scanning_push_protection is "disabled"',
      (s) => {
        const repo = s[""].body as { security_and_analysis: Record<string, { status: string }> };
        repo.security_and_analysis.secret_scanning_push_protection = { status: "disabled" };
      },
    ],
    ["Dependabot alerts", "disabled", (s) => delete s["vulnerability-alerts"]],
    ["Dependabot security updates", "enabled is false", (s) => (s["automated-security-fixes"].body = { enabled: false })],
    [
      "CodeQL default setup",
      'query_suite is "default"',
      (s) => (s["code-scanning/default-setup"].body = { state: "configured", query_suite: "default" }),
    ],
    [
      "Actions allow-list and SHA pinning",
      "sha_pinning_required is false",
      (s) => (s["actions/permissions"].body = { enabled: true, allowed_actions: "selected", sha_pinning_required: false }),
    ],
    [
      "Actions allow-list and SHA pinning",
      "oven-sh/setup-bun@* is not allowed",
      (s) =>
        (s["actions/permissions/selected-actions"].body = {
          ...selectedActions,
          patterns_allowed: selectedActions.patterns_allowed.filter((pattern) => pattern !== "oven-sh/setup-bun@*"),
        }),
    ],
    [
      "Actions allow-list and SHA pinning",
      "evil/action@* is allowed but not listed",
      (s) =>
        (s["actions/permissions/selected-actions"].body = {
          ...selectedActions,
          patterns_allowed: [...selectedActions.patterns_allowed, "evil/action@*"],
        }),
    ],
    [
      "Fork pull request approval",
      'approval_policy is "first_time_contributors"',
      (s) => (s["actions/permissions/fork-pr-contributor-approval"].body = { approval_policy: "first_time_contributors" }),
    ],
    [
      "Squash-only merges",
      "allow_rebase_merge is true",
      (s) => ((s[""].body as Record<string, unknown>).allow_rebase_merge = true),
    ],
    [
      'Ruleset "Release tags are immutable"',
      "bypass_actors",
      (s) =>
        (s["rulesets/101"].body = {
          ...immutable,
          id: 101,
          bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
        }),
    ],
    [
      'Ruleset "Release tags are immutable"',
      "missing",
      (s) => (s["rulesets?per_page=100"].body = (s["rulesets?per_page=100"].body as Ruleset[]).filter((r) => r.id !== 101)),
    ],
    [
      'Ruleset "Release tags are created by an admin"',
      'enforcement is "disabled"',
      (s) => (s["rulesets/102"].body = { ...creation, id: 102, enforcement: "disabled" }),
    ],
    [
      "Dependabot can push its branches",
      'ruleset "Block All except me"',
      (s) =>
        (s[`rulesets/${BRANCH_RULESET.id}`].body = {
          ...BRANCH_RULESET,
          conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
        }),
    ],
    [
      "Dependabot can push its branches",
      'ruleset "Block All except me"',
      (s) =>
        (s[`rulesets/${BRANCH_RULESET.id}`].body = {
          ...BRANCH_RULESET,
          conditions: { ref_name: { include: ["refs/heads/**"], exclude: [] } },
        }),
    ],
    [
      // Creation and update allowed, but a rebase is a force-push and a
      // superseded update deletes its branch.
      "Dependabot can push its branches",
      'ruleset "Block All except me"',
      (s) =>
        (s[`rulesets/${BRANCH_RULESET.id}`].body = {
          ...BRANCH_RULESET,
          conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
          rules: [{ type: "non_fast_forward" }, { type: "deletion" }, { type: "required_signatures" }],
        }),
    ],
    [
      // An exclusion for one ecosystem leaves the github_actions, docker and
      // docker_compose branches in .github/dependabot.yml blocked.
      "Dependabot can push its branches",
      'ruleset "Block All except me"',
      (s) =>
        (s[`rulesets/${BRANCH_RULESET.id}`].body = {
          ...BRANCH_RULESET,
          conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/dependabot/bun/**"] } },
        }),
    ],
    ["Interactions limited to collaborators", "no limit", (s) => (s["interaction-limits"].body = {})],
    [
      "Interactions limited to collaborators",
      'limit is "contributors_only"',
      (s) => (s["interaction-limits"] = interactionLimit("contributors_only", 150)),
    ],
    [
      // It lapses on its own; a month's notice leaves time to set it again.
      "Interactions limited to collaborators",
      "within 30 days",
      (s) => (s["interaction-limits"] = interactionLimit("collaborators_only", 29)),
    ],
    ...(["has_projects", "has_wiki", "has_discussions"] as const).map(
      (feature): [string, string, (state: State) => void] => [
        "Projects, wiki and discussions off",
        `${feature} is true`,
        (s) => ((s[""].body as Record<string, unknown>)[feature] = true),
      ],
    ),
  ];

  for (const [setting, detail, drift] of cases) {
    it(`exits 1 and names only "${setting}" when ${detail}`, () => {
      const state = inSync();
      drift(state);
      const result = run(state, ["check"]);
      expect(result.exitCode).toBe(1);
      const lines = driftLines(result.stdout);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toStartWith(`DRIFT  ${setting}: `);
      expect(lines[0]).toContain(detail);
    });
  }

  it("accepts a branch ruleset narrowed to the default branch, which never reaches Dependabot's", () => {
    const state = inSync();
    state[`rulesets/${BRANCH_RULESET.id}`].body = {
      ...BRANCH_RULESET,
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    };
    expect(run(state, ["check"]).exitCode).toBe(0);
  });

  it("matches ref patterns as GitHub does: `*` stops at a slash, and Dependabot's branches have two", () => {
    const state = inSync();
    state[`rulesets/${BRANCH_RULESET.id}`].body = {
      ...BRANCH_RULESET,
      conditions: { ref_name: { include: ["refs/heads/*", "refs/heads/dependabot/*"], exclude: [] } },
    };
    expect(run(state, ["check"]).exitCode).toBe(0);
  });

  it("ignores a branch ruleset whose only rule Dependabot satisfies", () => {
    const state = inSync();
    state[`rulesets/${BRANCH_RULESET.id}`].body = {
      ...BRANCH_RULESET,
      conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
      rules: [{ type: "required_signatures" }],
    };
    expect(run(state, ["check"]).exitCode).toBe(0);
  });

  it("ignores a branch ruleset that is not enforced", () => {
    const state = inSync();
    state["rulesets?per_page=100"].body = (state["rulesets?per_page=100"].body as Ruleset[]).map((ruleset) =>
      ruleset.id === BRANCH_RULESET.id ? { ...ruleset, enforcement: "disabled" } : ruleset,
    );
    state[`rulesets/${BRANCH_RULESET.id}`].body = {
      ...BRANCH_RULESET,
      enforcement: "disabled",
      conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
    };
    expect(run(state, ["check"]).exitCode).toBe(0);
  });

  it("accepts an interaction limit with more than 30 days left", () => {
    const state = inSync();
    state["interaction-limits"] = interactionLimit("collaborators_only", 31);
    expect(run(state, ["check"]).exitCode).toBe(0);
  });

  it("exits 2, not 1, when GitHub refuses to answer", () => {
    const state = inSync();
    state["private-vulnerability-reporting"] = { status: 403, body: { message: "Must have admin rights to Repository." } };
    const result = run(state, ["check"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("HTTP 403 (Must have admin rights to Repository.)");
    expect(result.stderr).toContain("administrator");
  });

  it("checks NGarate/stoky unless told otherwise, and refuses an unknown mode", () => {
    const result = run(inSync(), ["check"], { repo: null });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("NGarate/stoky: in sync.");
    expect(run(inSync(), ["fix"]).exitCode).toBe(2);
    expect(run(inSync(), []).exitCode).toBe(2);
  });
});

describe("scripts/github-settings.ts apply", () => {
  it("writes nothing when nothing has drifted", () => {
    const result = run(inSync(), ["apply"]);
    expect(result.exitCode).toBe(0);
    expect(result.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(result.stdout).toContain("nothing to apply");
  });

  it("turns on everything that was off on 2026-10-12, and only that", () => {
    const result = run(measured(), ["apply"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const writes = result.calls.filter((call) => call.method !== "GET");
    expect(writes.map((call) => `${call.method} ${call.endpoint}`)).toEqual([
      "PUT private-vulnerability-reporting",
      "PUT immutable-releases",
      "PATCH ",
      "PUT automated-security-fixes",
      "PATCH code-scanning/default-setup",
      // Policy first: the list answers 409 while every action is allowed.
      "PUT actions/permissions",
      "PUT actions/permissions/selected-actions",
      "PUT actions/permissions/fork-pr-contributor-approval",
      "PATCH ",
      "POST rulesets",
      "POST rulesets",
      `PUT rulesets/${BRANCH_RULESET.id}`,
      "PUT interaction-limits",
      "PATCH ",
    ]);
    const body = (index: number) => writes[index].body;
    expect(body(2)).toEqual({
      security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } },
    });
    expect(body(5)).toEqual({ enabled: true, allowed_actions: "selected", sha_pinning_required: true });
    expect(body(6)).toEqual(selectedActions);
    expect(body(8)).toMatchObject({ allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true });
    expect(body(9)).toEqual(immutable);
    expect(body(10)).toEqual(creation);
    // Only the conditions, so the owner's rules and bypass stay as they are.
    expect(body(11)).toEqual({ conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/dependabot/**"] } } });
    expect(body(12)).toEqual({ limit: "collaborators_only", expiry: "six_months" });
    // Issues stay on: the owner files them, and the limit keeps others out.
    expect(body(13)).toEqual({ has_projects: false, has_wiki: false, has_discussions: false });
  });

  it("sets an expiring interaction limit again, restarting its six months", () => {
    const state = inSync();
    state["interaction-limits"] = interactionLimit("collaborators_only", 5);
    const writes = run(state, ["apply"]).calls.filter((call) => call.method !== "GET");
    expect(writes).toEqual([
      { method: "PUT", endpoint: "interaction-limits", body: { limit: "collaborators_only", expiry: "six_months" } },
    ]);
  });

  it("replaces a ruleset that exists under its name rather than adding a second", () => {
    const state = inSync();
    state["rulesets/101"].body = { ...immutable, id: 101, rules: [{ type: "deletion" }] };
    const writes = run(state, ["apply"]).calls.filter((call) => call.method !== "GET");
    expect(writes).toEqual([{ method: "PUT", endpoint: "rulesets/101", body: immutable }]);
  });

  it("exits 2 when GitHub refuses a write", () => {
    const state = inSync();
    state["immutable-releases"].body = { enabled: false };
    const result = run(state, ["apply"], { writeStatus: 403 });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("PUT repos/example/stoky/immutable-releases answered HTTP 403");
  });
});
