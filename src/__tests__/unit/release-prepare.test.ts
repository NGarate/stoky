import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PrepareDeps,
  prepare,
  replaceSection,
} from "../../../scripts/release-prepare";
import type { CiRun } from "../../../scripts/release-github";

/**
 * `scripts/release-prepare.ts` makes the commit 7fffc6e made by hand. These
 * run it in a throwaway repository with a bare `origin` beside it, written
 * here, with GitHub stubbed: the CI run is an answer, the push goes to the
 * bare origin, and the pull request is a recorded call.
 */

const root = join(import.meta.dir, "../../..");
const fixtures: string[] = [];
const previous = "v0.1.0-alpha.4";
const tag = "v0.1.0-alpha.5";
const branch = `release/${tag}`;
const guide = "https://github.com/NGarate/stoky/blob/master/docs/INSTALL.md";
const appImage = `    image: "ghcr.io/example/stoky:\${STOKY_VERSION:?Define STOKY_VERSION en .env}"`;
const placeholder = "Se genera al preparar la versión.";
const nextNotes = [
  `# Stoky ${tag}`,
  "",
  "Una alpha de prueba.",
  "",
  "## Cómo actualizar",
  "",
  "Cambia STOKY_VERSION.",
  "",
  "## Qué ha cambiado",
  "",
  placeholder,
  "",
  "## English",
  "",
  "A testing alpha.",
  "",
].join("\n");
const readme = (version: string) =>
  `> **Status: ${version} — an alpha release.** See [release notes](docs/releases/${version}.md).\n\nRun the install.sh attached to \`${version}\`.\n`;
const install = (version: string, extra = "") =>
  `# Install\n\nThis guide is for **${version}**, a testing release.\n\nSTOKY_RELEASE=${version}\n${extra}`;

// The fixture's git must not read this machine's configuration: a global
// commit.gpgSign or hooksPath would sign or run something of the owner's.
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries({
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  })) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

function repository() {
  const base = mkdtempSync(join(tmpdir(), "stoky-prepare-"));
  fixtures.push(base);
  const origin = join(base, "origin.git");
  const dir = join(base, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", origin]);
  mkdirSync(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (file: string, text: string) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  git("init", "-q", "-b", "master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgSign", "false");
  for (const script of ["release-assets.sh", "release-notes.ts"]) {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(join(root, "scripts", script), join(dir, "scripts", script));
  }
  write(
    "package.json",
    `{\n  "name": "stoky",\n  "version": "0.1.0-alpha.4",\n  "scripts": {}\n}\n`,
  );
  write(
    "deploy/example.env",
    `# ${guide}\nSTOKY_VERSION=${previous}\nSTOKY_SECRET=\n`,
  );
  write(
    "deploy/install.sh",
    `#!/bin/bash\n# ${guide}\nDEFAULT_VERSION=${previous}\n`,
  );
  write(
    "deploy/docker-compose.yml",
    `# ${guide}\nservices:\n  db:\n    image: postgres:16.14-alpine\n  app:\n${appImage}\n`,
  );
  write("deploy/traefik.yml", "http: {}\n");
  write("README.md", readme(previous));
  write("docs/INSTALL.md", install(previous));
  write(`docs/releases/${previous}.md`, "The previous release.\n");
  git("add", ".");
  git("commit", "-q", "-m", `chore: prepare ${previous}`);
  git("tag", previous);
  write("src/scan.ts", "export {};\n");
  git("add", "src/scan.ts");
  git("commit", "-q", "-m", "feat(inventory): scan a barcode");
  write("docs/releases/NEXT.md", nextNotes);
  git("add", "docs/releases/NEXT.md");
  git("commit", "-q", "-m", "docs: start the next release's notes");
  git("remote", "add", "origin", origin);
  git("push", "-q", "origin", "master", previous);
  git("fetch", "-q", "origin");

  const calls = {
    pushed: [] as string[],
    pulls: [] as Parameters<PrepareDeps["createPullRequest"]>[0][],
    refreshed: 0,
  };
  const out: string[] = [];
  const err: string[] = [];
  const ci: { run: CiRun | null } = {
    run: {
      databaseId: 1,
      status: "completed",
      conclusion: "success",
      url: "https://ci.example/run/1",
    },
  };
  const remoteTags: string[] = [];
  let refresh = () => 0;
  const deps = (): PrepareDeps => ({
    cwd: dir,
    fetch: () => git("fetch", "-q", "origin"),
    remoteTagExists: (name) => remoteTags.includes(name),
    ciRun: () => ci.run,
    refreshImages: () => {
      calls.refreshed++;
      return refresh();
    },
    push: (refspec) => {
      calls.pushed.push(refspec);
      git("push", "-q", "origin", refspec);
    },
    createPullRequest: (options) => {
      calls.pulls.push(options);
      return "https://github.com/example/stoky/pull/42";
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  /** Everything a refusal must leave alone. */
  const snapshot = () => ({
    branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
    head: git("rev-parse", "HEAD").trim(),
    status: git("status", "--porcelain"),
    branches: git(
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/tags",
    ),
    origin: execFileSync(
      "git",
      ["for-each-ref", "--format=%(refname) %(objectname)"],
      { cwd: origin, encoding: "utf8" },
    ),
  });
  const run = (...argv: string[]) => prepare(argv, deps());
  /** Commits on master and pushes it, so origin agrees. */
  const land = (message: string, change: () => void) => {
    change();
    git("add", "-A");
    git("commit", "-q", "-m", message);
    git("push", "-q", "origin", "master");
  };
  return {
    dir,
    origin,
    git,
    write,
    run,
    land,
    snapshot,
    calls,
    out,
    err,
    ci,
    remoteTags,
    setRefresh: (fn: () => number) => (refresh = fn),
  };
}

const read = (dir: string, file: string) =>
  readFileSync(join(dir, file), "utf8");

describe("preparing a release", () => {
  it("makes the preparation commit on release/<tag>, checks it, pushes it and opens its pull request", () => {
    const repo = repository();
    const { dir, git } = repo;
    const master = git("rev-parse", "master").trim();

    expect(repo.run("prerelease")).toBe(0);
    expect(repo.err).toEqual([]);

    expect(git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(branch);
    expect(git("log", "--format=%s", `${master}..HEAD`).trim()).toBe(
      `chore: prepare ${tag}`,
    );
    expect(git("rev-parse", "HEAD~1").trim()).toBe(master);
    expect(git("status", "--porcelain")).toBe("");
    // Exactly the files 7fffc6e changed, STATUS.md aside (that one is prose).
    expect(
      git("diff", "--name-status", "--no-renames", "master", "HEAD")
        .trim()
        .split("\n")
        .sort(),
    ).toEqual(
      [
        "M\tREADME.md",
        "M\tdeploy/example.env",
        "M\tdeploy/install.sh",
        "M\tdocs/INSTALL.md",
        "M\tpackage.json",
        "D\tdocs/releases/NEXT.md",
        `A\tdocs/releases/${tag}.md`,
      ].sort(),
    );
    expect(read(dir, "package.json")).toBe(
      `{\n  "name": "stoky",\n  "version": "0.1.0-alpha.5",\n  "scripts": {}\n}\n`,
    );
    expect(read(dir, "deploy/example.env")).toBe(
      `# ${guide}\nSTOKY_VERSION=${tag}\nSTOKY_SECRET=\n`,
    );
    expect(read(dir, "deploy/install.sh")).toBe(
      `#!/bin/bash\n# ${guide}\nDEFAULT_VERSION=${tag}\n`,
    );
    expect(read(dir, "README.md")).toBe(readme(tag));
    expect(read(dir, "docs/INSTALL.md")).toBe(install(tag));

    // The notes are NEXT.md with the generated list in place of the placeholder.
    const list = execFileSync(
      "bun",
      ["scripts/release-notes.ts", previous, tag],
      { cwd: dir, encoding: "utf8" },
    );
    expect(list).toContain("feat(inventory): scan a barcode");
    const notes = read(dir, `docs/releases/${tag}.md`);
    expect(notes).toBe(nextNotes.replace(placeholder, list.trimEnd()));
    expect(notes).not.toContain(placeholder);

    const body = git("log", "-1", "--format=%b");
    expect(body).toContain(
      `Requested: prerelease, 0.1.0-alpha.4 to 0.1.0-alpha.5. 2 commit(s) since ${previous}`,
    );
    expect(body).toContain(`bun scripts/release-notes.ts ${previous} ${tag}`);

    expect(repo.calls.pushed).toEqual([`${branch}:refs/heads/${branch}`]);
    expect(
      execFileSync("git", ["rev-parse", branch], {
        cwd: repo.origin,
        encoding: "utf8",
      }).trim(),
    ).toBe(git("rev-parse", "HEAD").trim());
    expect(repo.calls.pulls).toEqual([
      {
        base: "master",
        head: branch,
        title: `chore: prepare ${tag}`,
        bodyFile: join(dir, `docs/releases/${tag}.md`),
      },
    ]);
    expect(repo.out.join("\n")).toContain(
      "https://github.com/example/stoky/pull/42",
    );
    expect(repo.out.join("\n")).toContain("release-tag.ts");
    expect(repo.calls.refreshed).toBe(0);
  });

  it("stops before pushing with --no-push", () => {
    const repo = repository();
    expect(repo.run("prerelease", "--no-push")).toBe(0);
    expect(repo.git("log", "-1", "--format=%s").trim()).toBe(
      `chore: prepare ${tag}`,
    );
    expect(repo.calls.pushed).toEqual([]);
    expect(repo.calls.pulls).toEqual([]);
    expect(repo.out.join("\n")).toContain("Not pushed (--no-push)");
  });

  it("takes an explicit version and any bump release-version.ts takes", () => {
    const repo = repository();
    expect(repo.run("preminor", "--no-push")).toBe(0);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(
      "release/v0.2.0-alpha.1",
    );
    expect(read(repo.dir, "deploy/example.env")).toContain(
      "STOKY_VERSION=v0.2.0-alpha.1\n",
    );
  });

  it("stops, leaving the branch, when release-assets.sh refuses the result", () => {
    const repo = repository();
    // A version the preparation does not know to replace.
    repo.land("docs: name an older release", () =>
      repo.write(
        "docs/INSTALL.md",
        install(previous, "Upgrading from v0.0.9.\n"),
      ),
    );
    expect(repo.run("prerelease")).toBe(1);
    const said = repo.err.join("\n");
    expect(said).toContain("release-assets.sh refused");
    expect(said).toContain("v0.0.9");
    expect(said).toContain(`git branch -D ${branch}`);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(branch);
    expect(repo.calls.pushed).toEqual([]);
  });
});

describe("refreshing the service images first", () => {
  const refreshed = (dir: string) => () => {
    const compose = join(dir, "deploy/docker-compose.yml");
    writeFileSync(
      compose,
      readFileSync(compose, "utf8").replace(
        "postgres:16.14-alpine",
        "postgres:16.15-alpine",
      ),
    );
    return 0;
  };

  it("commits the refresh alone, before the preparation, and lists it", () => {
    const repo = repository();
    repo.setRefresh(refreshed(repo.dir));
    expect(repo.run("prerelease", "--refresh-images", "--no-push")).toBe(0);
    expect(
      repo.git("log", "--format=%s", "master..HEAD").trim().split("\n"),
    ).toEqual([
      `chore: prepare ${tag}`,
      `build(docker): refresh the bundle's service images for ${tag}`,
    ]);
    expect(repo.git("show", "--name-only", "--format=", "HEAD~1").trim()).toBe(
      "deploy/docker-compose.yml",
    );
    const notes = read(repo.dir, `docs/releases/${tag}.md`);
    expect(notes).toContain("### 📦 Dependencias e imágenes");
    expect(notes).toContain(
      `* build(docker): refresh the bundle's service images for ${tag}`,
    );
  });

  it("commits nothing for images already current", () => {
    const repo = repository();
    expect(repo.run("prerelease", "--refresh-images", "--no-push")).toBe(0);
    expect(repo.calls.refreshed).toBe(1);
    expect(repo.git("log", "--format=%s", "master..HEAD").trim()).toBe(
      `chore: prepare ${tag}`,
    );
  });

  for (const [label, code, message] of [
    ["a red candidate", 1, "red under the release scan"],
    ["an error", 2, "failed (exit 2)"],
  ] as const) {
    it(`stops on ${label}, leaving the branch with nothing on it`, () => {
      const repo = repository();
      repo.setRefresh(() => code);
      const master = repo.git("rev-parse", "master").trim();
      expect(repo.run("prerelease", "--refresh-images")).toBe(1);
      expect(repo.err.join("\n")).toContain(message);
      expect(repo.err.join("\n")).toContain("left as it is");
      expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(branch);
      expect(repo.git("rev-parse", "HEAD").trim()).toBe(master);
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(repo.calls.pushed).toEqual([]);
    });
  }

  it("stops when the refresh touched anything but the Compose file", () => {
    const repo = repository();
    repo.setRefresh(() => {
      writeFileSync(join(repo.dir, "deploy/example.env"), "changed\n");
      return 0;
    });
    expect(repo.run("prerelease", "--refresh-images")).toBe(1);
    expect(repo.err.join("\n")).toContain(
      "more than deploy/docker-compose.yml",
    );
    expect(repo.calls.pushed).toEqual([]);
  });
});

describe("refusing to start", () => {
  const cases: [
    string,
    (repo: ReturnType<typeof repository>) => void,
    RegExp,
    string[]?,
  ][] = [
    [
      "a branch other than master",
      (r) => r.git("switch", "-q", "-c", "work"),
      /on work.*git switch master/,
    ],
    [
      "a tree with changes",
      (r) => r.write("README.md", "edited\n"),
      /not clean[\s\S]*README\.md/,
    ],
    [
      "an untracked file",
      (r) => r.write("notes.txt", "draft\n"),
      /not clean[\s\S]*notes\.txt/,
    ],
    [
      "master ahead of origin/master",
      (r) => r.git("commit", "-q", "--allow-empty", "-m", "fix: unpushed"),
      /is not origin\/master.*push master/,
    ],
    [
      "master behind origin/master",
      (r) => {
        r.git("commit", "-q", "--allow-empty", "-m", "fix: elsewhere");
        r.git("push", "-q", "origin", "master");
        r.git("reset", "-q", "--hard", "HEAD~1");
      },
      /is not origin\/master/,
    ],
    [
      "no CI run for the commit",
      (r) => (r.ci.run = null),
      /no CI push run on master/,
    ],
    [
      "a CI run still going",
      (r) =>
        (r.ci.run = {
          databaseId: 2,
          status: "in_progress",
          conclusion: "",
          url: "https://ci.example/run/2",
        }),
      /still in_progress.*run\/2/,
    ],
    [
      "a failed CI run",
      (r) =>
        (r.ci.run = {
          databaseId: 3,
          status: "completed",
          conclusion: "failure",
          url: "https://ci.example/run/3",
        }),
      /ended failure.*run\/3/,
    ],
    [
      "no NEXT.md",
      (r) =>
        r.land("docs: drop the notes", () =>
          unlinkSync(join(r.dir, "docs/releases/NEXT.md")),
        ),
      /NEXT\.md does not exist/,
    ],
    [
      "a NEXT.md without its English section",
      (r) =>
        r.land("docs: trim the notes", () =>
          r.write(
            "docs/releases/NEXT.md",
            nextNotes.replace("## English", "## Inglés"),
          ),
        ),
      /lacks "## English"/,
    ],
    [
      "a NEXT.md without the change list's heading",
      (r) =>
        r.land("docs: trim the notes", () =>
          r.write(
            "docs/releases/NEXT.md",
            nextNotes.replace("## Qué ha cambiado", "### Qué ha cambiado"),
          ),
        ),
      /lacks "## Qué ha cambiado"/,
    ],
    [
      "a guide that speaks of the release after",
      (r) =>
        r.land("docs: forward-looking guide", () =>
          r.write(
            "docs/INSTALL.md",
            install(
              previous,
              "Upgrading from the release after this one changes the secret.\n",
            ),
          ),
        ),
      /INSTALL\.md:6: Upgrading from the release after/,
    ],
    [
      "a tag that exists here",
      // On a commit of its own, as a tag made by hand on another branch would be.
      (r) =>
        r.git(
          "tag",
          tag,
          r.git("commit-tree", "HEAD^{tree}", "-m", "elsewhere").trim(),
        ),
      /already exists here/,
    ],
    [
      "a tag that exists on origin",
      (r) => r.remoteTags.push(tag),
      /already exists on origin/,
    ],
    [
      "a release branch left from an attempt",
      (r) => r.git("branch", branch),
      /refs\/heads\/release\/v0\.1\.0-alpha\.5 already exists/,
    ],
    ["a bump that goes backwards", () => {}, /not greater/, ["v0.1.0-alpha.3"]],
  ];

  for (const [label, arrange, message, argv] of cases) {
    it(`on ${label}, changing nothing`, () => {
      const repo = repository();
      arrange(repo);
      const before = repo.snapshot();
      const code = repo.run(...(argv ?? ["prerelease"]));
      expect(code).toBe(1);
      expect(repo.err.join("\n")).toMatch(/^Refused, nothing changed: /);
      expect(repo.err.join("\n")).toMatch(message);
      expect(repo.snapshot()).toEqual(before);
      expect(repo.calls).toEqual({ pushed: [], pulls: [], refreshed: 0 });
    });
  }

  it("calls an unknown flag or a missing bump a usage error", () => {
    const repo = repository();
    const before = repo.snapshot();
    expect(repo.run()).toBe(2);
    expect(repo.run("prerelease", "--force")).toBe(2);
    expect(repo.err.join("\n")).toContain("usage:");
    expect(repo.snapshot()).toEqual(before);
  });
});

describe("filling the change list's section", () => {
  it("replaces the body up to the next second-level heading, keeping the list's own ### headings", () => {
    const list =
      "<!-- cambios:inicio v1 -->\n\n### 🚀 Novedades\n\n* feat: x\n<!-- cambios:fin -->\n";
    expect(
      replaceSection(
        "## Qué ha cambiado\n\nold\n\n### stays? no\n\n## English\n\nText.\n",
        "## Qué ha cambiado",
        list,
      ),
    ).toBe(`## Qué ha cambiado\n\n${list.trimEnd()}\n\n## English\n\nText.\n`);
  });

  it("fills a last section and ends the file with one newline", () => {
    expect(
      replaceSection(
        "# T\n\n## Qué ha cambiado\n\nold\n",
        "## Qué ha cambiado",
        "list\n",
      ),
    ).toBe("# T\n\n## Qué ha cambiado\n\nlist\n");
  });
});
