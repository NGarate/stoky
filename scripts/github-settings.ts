/**
 * The repository's GitHub security and contribution settings, as code, with a
 * drift check.
 *
 * Run: bun scripts/github-settings.ts check [--repo OWNER/NAME]
 *      bun scripts/github-settings.ts apply [--repo OWNER/NAME]
 *
 * Every setting below lives on GitHub, not in the checkout, so nothing in the
 * repository showed whether it was on, and nothing went red when it was turned
 * off again. The 2026-10-12 security review found private vulnerability
 * reporting, immutable releases, secret scanning, push protection, Dependabot
 * security updates and CodeQL all off on a public repository, Actions allowing
 * any action at any ref, and no rule protecting a release tag — each a one-off
 * click away, and each a click away from being undone. The owner's 2026-10-23
 * decision to close the repository to other people's contributions for now is
 * held the same way.
 *
 * `check` makes GET requests only. It prints one line per setting and exits 1
 * when any of them differs from what this file and `.github/` say it should
 * be. `apply` writes only the settings that differ, with the same PUT and
 * PATCH requests every time, so running it twice changes nothing the second
 * time; rulesets are matched by name, created when missing and replaced when
 * different, and the release environment's deployment policies by name and
 * type, created when missing and deleted when not listed. Run `check` again
 * afterwards: CodeQL's default setup is applied asynchronously.
 *
 * Both need `gh` signed in as an administrator of the repository, which is why
 * this is the owner's tool and never a CI step: most of these endpoints need
 * the administration permission, which a workflow token cannot be granted, and
 * a gate that goes red for want of a permission is one people learn to ignore.
 *
 * Exit codes: 0 in sync (or applied), 1 drift, 2 a usage error or a request
 * GitHub refused.
 *
 * The bodies that are long enough to be worth reviewing as files are files:
 * `.github/rulesets/*.json` (sent as they are) and `.github/selected-actions.json`
 * (the Actions allow-list, which `src/__tests__/unit/github-settings.test.ts`
 * holds against every `uses:` in the workflows). `docs/RELEASING.md`
 * (Repository settings) says what each setting is for.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_REPO = "NGarate/stoky";

/** The exclusion that lets Dependabot push its branches. */
const DEPENDABOT_EXCLUDE = "refs/heads/dependabot/**";

/**
 * Rules that refuse a push Dependabot makes to its own branch: it creates one,
 * adds to it, force-pushes it when it rebases, and deletes it when a newer
 * update supersedes the pull request; a pull request, status check or
 * deployment rule refuses any direct push. `required_signatures` is absent
 * because Dependabot's commits are signed by GitHub.
 */
const DEPENDABOT_BLOCKING_RULES = new Set([
  "creation",
  "update",
  "deletion",
  "non_fast_forward",
  "pull_request",
  "required_status_checks",
  "required_deployments",
]);

/**
 * One branch per entry in `.github/dependabot.yml`, named as Dependabot names
 * them (`dependabot/<ecosystem>/<directory>/<dependency>-<version>`), so an
 * exclusion that covers only some ecosystems is still reported.
 */
function dependabotBranches(): string[] {
  const config = Bun.YAML.parse(readFileSync(join(ROOT, ".github/dependabot.yml"), "utf8")) as {
    updates?: { "package-ecosystem": string; directory?: string }[];
  };
  return (config.updates ?? []).map((update) => {
    const directory = (update.directory ?? "/").replace(/^\/+|\/+$/g, "");
    const ecosystem = update["package-ecosystem"].replace(/-/g, "_");
    return `refs/heads/dependabot/${ecosystem}${directory ? `/${directory}` : ""}/example-1.0.0`;
  });
}

const MERGE_SETTINGS = {
  allow_merge_commit: false,
  allow_rebase_merge: true,
  allow_squash_merge: true,
  delete_branch_on_merge: true,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "PR_BODY",
} as const;

const ACTIONS_PERMISSIONS = { enabled: true, allowed_actions: "selected", sha_pinning_required: true } as const;

const CODEQL = { state: "configured", query_suite: "extended" } as const;

/**
 * Contributions are closed for now (the owner's decision of 2026-10-23): only
 * collaborators may comment, open issues or open pull requests. Six months is
 * the longest GitHub sets, and the limit then lapses on its own, so it is
 * drift well before it does: `apply` sets it again, which restarts the six
 * months.
 */
const INTERACTION_LIMIT = { limit: "collaborators_only", expiry: "six_months" } as const;
const INTERACTION_LIMIT_NOTICE_DAYS = 30;

/**
 * Nothing beyond the code, releases and issues. Issues stay: the owner files
 * them, and the interaction limit is what keeps other people out of them.
 */
const FEATURES = { has_projects: false, has_wiki: false, has_discussions: false } as const;

/**
 * The environment a publishing job waits on: one approval, by the repository's
 * owner, for a run from a `v*` tag and nothing else. Self-review is allowed
 * because the owner is the only maintainer, and so the one who pushed the tag:
 * with it prevented, nobody could approve.
 */
const RELEASE_ENVIRONMENT = "environments/release";
const RELEASE_POLICIES = `${RELEASE_ENVIRONMENT}/deployment-branch-policies`;
const RELEASE_REFS = [{ name: "v*", type: "tag" }] as const;
const CUSTOM_BRANCH_POLICIES = { protected_branches: false, custom_branch_policies: true } as const;

interface Environment {
  protection_rules?: {
    type: string;
    prevent_self_review?: boolean;
    reviewers?: { type?: string; reviewer?: { id?: number } }[];
  }[];
  deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
}

interface DeploymentPolicy {
  id?: number;
  name?: string;
  type?: string;
}

interface RefCondition {
  include?: string[];
  exclude?: string[];
}

interface Rule {
  type: string;
  parameters?: unknown;
}

interface BypassActor {
  actor_id: number | null;
  actor_type: string;
  bypass_mode: string;
}

interface Ruleset {
  id?: number;
  name: string;
  target: string;
  enforcement: string;
  conditions?: { ref_name?: RefCondition };
  rules?: Rule[];
  bypass_actors?: BypassActor[];
}

interface SelectedActions {
  github_owned_allowed?: boolean;
  verified_allowed?: boolean;
  patterns_allowed?: string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;
}

const RULESET_FILES = [".github/rulesets/release-tags-immutable.json", ".github/rulesets/release-tags-creation.json"];
const SELECTED_ACTIONS_FILE = ".github/selected-actions.json";

/** A request GitHub refused, or one that could not be made. Exit 2, never drift. */
class RequestError extends Error {}

interface Reply {
  status: number;
  body: unknown;
}

class GitHub {
  private readonly cache = new Map<string, Reply>();

  constructor(readonly repo: string) {}

  private endpoint(path: string) {
    return path === "" ? `repos/${this.repo}` : `repos/${this.repo}/${path}`;
  }

  private request(method: string, path: string, body?: unknown): Reply {
    const endpoint = this.endpoint(path);
    const args = ["gh", "api", "--include", "--method", method, endpoint];
    if (body !== undefined) args.push("--input", "-");
    let proc;
    try {
      proc = Bun.spawnSync(args, {
        stdin: body === undefined ? "ignore" : new TextEncoder().encode(JSON.stringify(body)),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      throw new RequestError("`gh` was not found. Install the GitHub CLI and sign in with `gh auth login`.");
    }
    // `--include` puts the status line first: the only reliable way to tell a
    // 404 that means "off" from one that means "no access", since gh's own
    // message differs between status codes.
    const output = proc.stdout.toString();
    const status = /^HTTP\/\S+ (\d{3})/.exec(output);
    if (!status) {
      throw new RequestError(`${method} ${endpoint}: ${proc.stderr.toString().trim() || "no response from gh"}`);
    }
    const blank = output.search(/\r?\n\r?\n/);
    const text = blank === -1 ? "" : output.slice(blank).trim();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: Number(status[1]), body: parsed };
  }

  private static ok(reply: Reply) {
    return reply.status >= 200 && reply.status < 300;
  }

  private refused(method: string, path: string, reply: Reply): RequestError {
    const message = (reply.body as { message?: string } | null)?.message ?? "";
    return new RequestError(
      `${method} ${this.endpoint(path)} answered HTTP ${reply.status}${message ? ` (${message})` : ""}. ` +
        `This needs \`gh\` signed in as an administrator of ${this.repo}.`,
    );
  }

  /** GET, cached for the run. Statuses in `expected` are answers, not errors. */
  get(path: string, expected: number[] = []): Reply {
    let reply = this.cache.get(path);
    if (!reply) {
      reply = this.request("GET", path);
      this.cache.set(path, reply);
    }
    if (!GitHub.ok(reply) && !expected.includes(reply.status)) throw this.refused("GET", path, reply);
    return reply;
  }

  write(method: "PUT" | "PATCH" | "POST" | "DELETE", path: string, body?: unknown) {
    const reply = this.request(method, path, body);
    if (!GitHub.ok(reply)) throw this.refused(method, path, reply);
  }
}

interface Setting {
  name: string;
  /** What differs, one line each; empty when the setting is as it should be. */
  drift(gh: GitHub): string[];
  apply(gh: GitHub): void;
}

function differs(field: string, actual: unknown, wanted: unknown): string[] {
  return JSON.stringify(actual) === JSON.stringify(wanted)
    ? []
    : [`${field} is ${JSON.stringify(actual) ?? "absent"}, want ${JSON.stringify(wanted)}`];
}

function repository(gh: GitHub) {
  return gh.get("").body as Record<string, unknown> & {
    owner?: { id?: number };
    security_and_analysis?: Record<string, { status?: string } | undefined>;
  };
}

/**
 * The environment as `apply` sends it. The reviewer is the repository's owner,
 * read rather than written down, so `--repo` names a fork's owner on a fork.
 * A repository owned by an organisation would need a person or team named
 * instead; NGarate/stoky belongs to a personal account.
 */
function releaseEnvironment(gh: GitHub) {
  return {
    reviewers: [{ type: "User", id: repository(gh).owner?.id }],
    prevent_self_review: false,
    deployment_branch_policy: CUSTOM_BRANCH_POLICIES,
  };
}

const refKey = (policy: DeploymentPolicy) => `${policy.type}:${policy.name}`;

function releaseRefs(gh: GitHub): DeploymentPolicy[] {
  return (gh.get(`${RELEASE_POLICIES}?per_page=100`).body as { branch_policies?: DeploymentPolicy[] }).branch_policies ?? [];
}

/** `{"enabled": true}` endpoints that a bare PUT turns on. */
function toggle(name: string, path: string): Setting {
  return {
    name,
    drift: (gh) => differs("enabled", (gh.get(path).body as { enabled?: unknown }).enabled, true),
    apply: (gh) => gh.write("PUT", path),
  };
}

/** GitHub's ref patterns: `*` stops at a slash, `**` does not. */
function glob(pattern: string): RegExp {
  const source = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`);
}

function refMatches(condition: RefCondition | undefined, ref: string): boolean {
  const hits = (pattern: string) =>
    pattern === "~ALL" || (pattern !== "~DEFAULT_BRANCH" && glob(pattern).test(ref));
  return (condition?.include ?? []).some(hits) && !(condition?.exclude ?? []).some(hits);
}

function rulesetByName(gh: GitHub, name: string): Ruleset | undefined {
  const listed = (gh.get("rulesets?per_page=100").body as Ruleset[]).find((ruleset) => ruleset.name === name);
  return listed?.id === undefined ? undefined : (gh.get(`rulesets/${listed.id}`).body as Ruleset);
}

/** The parts of a ruleset that decide what it does, order-independent. */
function rulesetShape(ruleset: Ruleset) {
  const sorted = (values: string[]) => [...values].sort();
  return {
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    include: sorted(ruleset.conditions?.ref_name?.include ?? []),
    exclude: sorted(ruleset.conditions?.ref_name?.exclude ?? []),
    rules: sorted((ruleset.rules ?? []).map((rule) => JSON.stringify({ type: rule.type, parameters: rule.parameters ?? null }))),
    bypass_actors: sorted(
      (ruleset.bypass_actors ?? []).map((actor) => `${actor.actor_type}:${actor.actor_id}:${actor.bypass_mode}`),
    ),
  };
}

function rulesetSetting(file: string): Setting {
  const wanted = readJson<Ruleset>(file);
  return {
    name: `Ruleset "${wanted.name}"`,
    drift: (gh) => {
      const actual = rulesetByName(gh, wanted.name);
      if (!actual) return ["missing"];
      const have = rulesetShape(actual);
      const want = rulesetShape(wanted);
      return (Object.keys(want) as (keyof typeof want)[]).flatMap((key) => differs(key, have[key], want[key]));
    },
    apply: (gh) => {
      const actual = rulesetByName(gh, wanted.name);
      if (actual?.id === undefined) gh.write("POST", "rulesets", wanted);
      else gh.write("PUT", `rulesets/${actual.id}`, wanted);
    },
  };
}

/**
 * Active branch rulesets with a rule that refuses one of Dependabot's pushes
 * on a branch it would open. Dependabot pushes as itself, so a ruleset only an
 * owner bypasses stops every version and security update before its pull
 * request exists, or the first time it rebases one.
 */
function blockingDependabot(gh: GitHub): Ruleset[] {
  const branches = dependabotBranches();
  return (gh.get("rulesets?per_page=100").body as Ruleset[])
    .filter((listed) => listed.target === "branch" && listed.enforcement === "active")
    .map((listed) => gh.get(`rulesets/${listed.id}`).body as Ruleset)
    .filter(
      (ruleset) =>
        (ruleset.rules ?? []).some((rule) => DEPENDABOT_BLOCKING_RULES.has(rule.type)) &&
        branches.some((branch) => refMatches(ruleset.conditions?.ref_name, branch)),
    );
}

const SETTINGS: Setting[] = [
  toggle("Private vulnerability reporting", "private-vulnerability-reporting"),
  toggle("Immutable releases", "immutable-releases"),
  {
    name: "Secret scanning and push protection",
    drift: (gh) => {
      const analysis = repository(gh).security_and_analysis ?? {};
      return ["secret_scanning", "secret_scanning_push_protection"].flatMap((feature) =>
        differs(feature, analysis[feature]?.status, "enabled"),
      );
    },
    apply: (gh) =>
      gh.write("PATCH", "", {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      }),
  },
  {
    // 204 when on, 404 when off: the endpoint has no body to read.
    name: "Dependabot alerts",
    drift: (gh) => (gh.get("vulnerability-alerts", [404]).status === 404 ? ["disabled"] : []),
    apply: (gh) => gh.write("PUT", "vulnerability-alerts"),
  },
  toggle("Dependabot security updates", "automated-security-fixes"),
  {
    name: "CodeQL default setup",
    drift: (gh) => {
      const setup = gh.get("code-scanning/default-setup").body as Record<string, unknown>;
      return [...differs("state", setup.state, CODEQL.state), ...differs("query_suite", setup.query_suite, CODEQL.query_suite)];
    },
    apply: (gh) => gh.write("PATCH", "code-scanning/default-setup", CODEQL),
  },
  {
    name: "Actions allow-list and SHA pinning",
    drift: (gh) => {
      const permissions = gh.get("actions/permissions").body as Record<string, unknown>;
      const problems = (Object.keys(ACTIONS_PERMISSIONS) as (keyof typeof ACTIONS_PERMISSIONS)[]).flatMap((key) =>
        differs(key, permissions[key], ACTIONS_PERMISSIONS[key]),
      );
      // The list answers 409 unless the policy is `selected`; there is no
      // list to compare until it is.
      if (permissions.allowed_actions !== "selected") return problems;
      const actual = gh.get("actions/permissions/selected-actions").body as SelectedActions;
      const wanted = readJson<SelectedActions>(SELECTED_ACTIONS_FILE);
      const have = new Set(actual.patterns_allowed ?? []);
      const want = new Set(wanted.patterns_allowed ?? []);
      return [
        ...problems,
        ...differs("github_owned_allowed", actual.github_owned_allowed, wanted.github_owned_allowed),
        ...differs("verified_allowed", actual.verified_allowed, wanted.verified_allowed),
        ...[...want].filter((pattern) => !have.has(pattern)).map((pattern) => `${pattern} is not allowed`),
        ...[...have].filter((pattern) => !want.has(pattern)).map((pattern) => `${pattern} is allowed but not listed`),
      ];
    },
    // Back to back, policy first: the list cannot be written while every
    // action is allowed, and between the two calls only GitHub's own actions
    // may run.
    apply: (gh) => {
      gh.write("PUT", "actions/permissions", ACTIONS_PERMISSIONS);
      gh.write("PUT", "actions/permissions/selected-actions", readJson<SelectedActions>(SELECTED_ACTIONS_FILE));
    },
  },
  {
    name: "Fork pull request approval",
    drift: (gh) =>
      differs(
        "approval_policy",
        (gh.get("actions/permissions/fork-pr-contributor-approval").body as { approval_policy?: unknown }).approval_policy,
        "all_external_contributors",
      ),
    apply: (gh) =>
      gh.write("PUT", "actions/permissions/fork-pr-contributor-approval", { approval_policy: "all_external_contributors" }),
  },
  {
    name: "Squash or rebase merges",
    drift: (gh) => {
      const repo = repository(gh);
      return (Object.keys(MERGE_SETTINGS) as (keyof typeof MERGE_SETTINGS)[]).flatMap((key) =>
        differs(key, repo[key], MERGE_SETTINGS[key]),
      );
    },
    apply: (gh) => gh.write("PATCH", "", MERGE_SETTINGS),
  },
  ...RULESET_FILES.map(rulesetSetting),
  {
    name: "Dependabot can push its branches",
    drift: (gh) => blockingDependabot(gh).map((ruleset) => `ruleset "${ruleset.name}" restricts ${DEPENDABOT_EXCLUDE}`),
    // Excluded rather than given a bypass: Dependabot also force-pushes when it
    // rebases its own pull request, which non_fast_forward would refuse.
    apply: (gh) => {
      for (const ruleset of blockingDependabot(gh)) {
        const condition = ruleset.conditions?.ref_name ?? {};
        gh.write("PUT", `rulesets/${ruleset.id}`, {
          conditions: {
            ref_name: { include: condition.include ?? [], exclude: [...(condition.exclude ?? []), DEPENDABOT_EXCLUDE] },
          },
        });
      }
    },
  },
  {
    // `{}` when there is none. While the owner's account has a limit of its
    // own, GitHub refuses this repository's PUT with 409.
    name: "Interactions limited to collaborators",
    drift: (gh) => {
      const current = gh.get("interaction-limits").body as { limit?: string; expires_at?: string } | null;
      if (!current?.limit) return ["no limit"];
      const problems = differs("limit", current.limit, INTERACTION_LIMIT.limit);
      const left = Date.parse(current.expires_at ?? "") - Date.now();
      if (!(left > INTERACTION_LIMIT_NOTICE_DAYS * 86_400_000)) {
        problems.push(`expires ${current.expires_at ?? "at an unknown date"}, within ${INTERACTION_LIMIT_NOTICE_DAYS} days`);
      }
      return problems;
    },
    apply: (gh) => gh.write("PUT", "interaction-limits", INTERACTION_LIMIT),
  },
  {
    name: "Projects, wiki and discussions off",
    drift: (gh) => {
      const repo = repository(gh);
      return (Object.keys(FEATURES) as (keyof typeof FEATURES)[]).flatMap((key) => differs(key, repo[key], FEATURES[key]));
    },
    apply: (gh) => gh.write("PATCH", "", FEATURES),
  },
  {
    name: "Release environment, approved by the owner, from v* tags only",
    drift: (gh) => {
      const reply = gh.get(RELEASE_ENVIRONMENT, [404]);
      if (reply.status === 404) return ["missing"];
      const environment = reply.body as Environment;
      const wanted = releaseEnvironment(gh);
      const rule = environment.protection_rules?.find((candidate) => candidate.type === "required_reviewers");
      const policy = environment.deployment_branch_policy;
      const problems = [
        ...differs(
          "reviewers",
          (rule?.reviewers ?? []).map((reviewer) => `${reviewer.type}:${reviewer.reviewer?.id}`).sort(),
          wanted.reviewers.map((reviewer) => `${reviewer.type}:${reviewer.id}`),
        ),
        ...differs("prevent_self_review", rule?.prevent_self_review, wanted.prevent_self_review),
        ...differs(
          "deployment_branch_policy",
          policy ? { protected_branches: policy.protected_branches, custom_branch_policies: policy.custom_branch_policies } : null,
          CUSTOM_BRANCH_POLICIES,
        ),
      ];
      // The patterns apply, and can be listed, only while custom policies are on.
      if (policy?.custom_branch_policies !== true) return problems;
      return [...problems, ...differs("policies", releaseRefs(gh).map(refKey).sort(), RELEASE_REFS.map(refKey))];
    },
    // The environment first: a policy can be added only once custom policies
    // are on. Then exactly the listed refs, removing the others first so a
    // branch pattern of the same name cannot stand in the way.
    apply: (gh) => {
      gh.write("PUT", RELEASE_ENVIRONMENT, releaseEnvironment(gh));
      const current = releaseRefs(gh);
      const wanted = new Set(RELEASE_REFS.map(refKey));
      for (const policy of current) {
        if (!wanted.has(refKey(policy))) gh.write("DELETE", `${RELEASE_POLICIES}/${policy.id}`);
      }
      for (const policy of RELEASE_REFS) {
        if (!current.some((existing) => refKey(existing) === refKey(policy))) gh.write("POST", RELEASE_POLICIES, policy);
      }
    },
  },
];

function main(argv: string[]): number {
  const [mode, ...rest] = argv;
  const repoValid = rest.length === 0 || (rest.length === 2 && rest[0] === "--repo" && /^[\w.-]+\/[\w.-]+$/.test(rest[1]));
  if ((mode !== "check" && mode !== "apply") || !repoValid) {
    console.error("usage: bun scripts/github-settings.ts check|apply [--repo OWNER/NAME]");
    return 2;
  }
  const repo = rest[1] ?? DEFAULT_REPO;

  const gh = new GitHub(repo);
  let drifted = 0;
  try {
    for (const setting of SETTINGS) {
      const drift = setting.drift(gh);
      if (drift.length === 0) {
        console.log(`ok     ${setting.name}`);
        continue;
      }
      drifted += 1;
      if (mode === "check") {
        console.log(`DRIFT  ${setting.name}: ${drift.join("; ")}`);
      } else {
        console.log(`apply  ${setting.name}: ${drift.join("; ")}`);
        setting.apply(gh);
      }
    }
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    console.error(`Error: ${error.message}`);
    return 2;
  }

  if (mode === "apply") {
    console.log(
      drifted === 0
        ? `${repo}: nothing to apply.`
        : `${repo}: applied ${drifted} setting(s). Run check again; CodeQL's setup completes asynchronously.`,
    );
    return 0;
  }
  console.log(drifted === 0 ? `${repo}: in sync.` : `${repo}: ${drifted} setting(s) drifted.`);
  return drifted === 0 ? 0 : 1;
}

process.exit(main(Bun.argv.slice(2)));
