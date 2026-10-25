import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/release-notes.ts` writes the change list a release's notes carry,
 * and release-assets.sh checks it on every tag. These run it in a throwaway
 * repository whose history is written here, so each commit's place in the
 * list is a fact of the fixture rather than of this repository's past.
 */

const root = join(import.meta.dir, "../../..");
const script = join(root, "scripts/release-notes.ts");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

function repository() {
  const dir = mkdtempSync(join(tmpdir(), "stoky-notes-"));
  fixtures.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
  git("init", "-q", "-b", "master");
  let n = 0;
  /** A commit touching `file` (a fresh one by default) with `message`. */
  const commit = (message: string, file = `file-${n++}.txt`) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), `${n} ${message}\n`);
    git("add", file);
    git("commit", "-q", "--no-gpg-sign", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  const notes = (...args: string[]) =>
    Bun.spawnSync(["bun", script, ...args], {
      cwd: dir,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  commit("chore: the first commit");
  git("tag", "v0.1.0");
  return { dir, git, commit, notes };
}

/** The list's sections, each with the subjects listed under it. */
function sections(list: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current = "";
  for (const line of list.split("\n")) {
    if (line.startsWith("### ")) result[(current = line.slice(4))] = [];
    else if (line.startsWith("* "))
      result[current].push(
        line.slice(2).replace(/ \(\[`[0-9a-f]{7}`\]\(.*\)\)$/, ""),
      );
  }
  return result;
}

describe("a release's change list", () => {
  it("files each kind of change under its own heading, internal ones left out", () => {
    const { commit, notes } = repository();
    commit("feat(inventory): scan a barcode");
    commit("fix(receipts): keep the total");
    commit("perf(prices): cache the chart");
    commit("build(deps): bump next from 16.4.0 to 16.4.1");
    commit("build(docker): move traefik to v3.7.16");
    commit("docs: explain an upgrade step", "docs/INSTALL.md");
    commit("docs: record a measurement", "docs/STATUS.md");
    commit("ci: pin the runner");
    commit("test: cover the scan");
    commit("refactor(products): split the form");
    commit("build: add a script");
    commit("Merge-like subject that is not conventional");
    const result = notes("v0.1.0", "v0.2.0");
    expect(result.exitCode).toBe(0);
    expect(sections(result.stdout.toString())).toEqual({
      "🚀 Novedades": ["feat(inventory): scan a barcode"],
      "🌟 Mejoras": ["perf(prices): cache the chart"],
      "🐛 Correcciones": ["fix(receipts): keep the total"],
      "📦 Dependencias e imágenes": [
        "build(deps): bump next from 16.4.0 to 16.4.1",
        "build(docker): move traefik to v3.7.16",
      ],
      "📚 Documentación": ["docs: explain an upgrade step"],
      "🧩 Otros": ["Merge-like subject that is not conventional"],
    });
  });

  it("lists a breaking or security change once, ahead of its type", () => {
    const { commit, notes } = repository();
    commit("feat(auth)!: replace the sign-in library");
    commit(
      "fix(auth): refuse a reused code\n\nBREAKING CHANGE: old codes stop working",
    );
    commit("fix(auth): limit sign-in attempts\n\nChangelog: security");
    commit("feat(ui): a new badge\n\nChangelog: skip");
    const list = notes("v0.1.0", "v0.2.0").stdout.toString();
    expect(sections(list)).toEqual({
      "🚨 Cambios incompatibles": [
        "feat(auth)!: replace the sign-in library",
        "fix(auth): refuse a reused code",
      ],
      "🔒 Seguridad": ["fix(auth): limit sign-in attempts"],
    });
    // In the order the headings are written, the breaking ones first.
    expect(list.indexOf("🚨")).toBeLessThan(list.indexOf("🔒"));
  });

  it("links each commit, a squashed pull request, and the full comparison", () => {
    const { commit, notes } = repository();
    const sha = commit("feat(shopping): share a list (#42)");
    const list = notes("v0.1.0", "v0.2.0").stdout.toString();
    expect(list).toContain(
      `* feat(shopping): share a list in [#42](https://github.com/NGarate/stoky/pull/42) ([\`${sha.slice(0, 7)}\`](https://github.com/NGarate/stoky/commit/${sha}))`,
    );
    expect(list).toContain(
      "**Changelog completo**: https://github.com/NGarate/stoky/compare/v0.1.0...v0.2.0",
    );
    expect(list.startsWith("<!-- cambios:inicio v0.1.0 -->\n")).toBe(true);
    expect(list.trimEnd().endsWith("<!-- cambios:fin -->")).toBe(true);
  });

  it("lists only what came after the previous tag, oldest first", () => {
    const { git, commit, notes } = repository();
    commit("feat: before the tag");
    git("tag", "v0.2.0");
    commit("feat: first after");
    commit("feat: second after");
    expect(
      sections(notes("v0.2.0", "v0.3.0").stdout.toString())["🚀 Novedades"],
    ).toEqual(["feat: first after", "feat: second after"]);
  });

  it("refuses a previous version that is not a tag", () => {
    const { notes } = repository();
    expect(notes("v0.0.9", "v0.2.0").exitCode).toBe(2);
    expect(notes("master", "v0.2.0").exitCode).toBe(2);
  });
});

describe("checking a release's notes against its commits", () => {
  const withNotes = () => {
    const fixture = repository();
    fixture.commit("feat(inventory): scan a barcode");
    fixture.commit("fix(receipts): keep the total");
    const list = fixture.notes("v0.1.0", "v0.2.0").stdout.toString();
    const file = join(fixture.dir, "notes.md");
    const write = (body: string) =>
      writeFileSync(
        file,
        `# Stoky v0.2.0\n\nPrólogo.\n\n## Qué ha cambiado\n\n${body}\n`,
      );
    write(list.trimEnd());
    return {
      ...fixture,
      list,
      file,
      write,
      check: () => fixture.notes("--check", file, "v0.2.0"),
    };
  };

  it("passes when the list is the one the commits give", () => {
    expect(withNotes().check().exitCode).toBe(0);
  });

  it("fails when a commit arrived after the list was written", () => {
    const { commit, check } = withNotes();
    commit("fix(prices): round the euro");
    const result = check();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "bun scripts/release-notes.ts v0.1.0 v0.2.0",
    );
  });

  it("fails when the list was edited by hand", () => {
    const { list, write, check } = withNotes();
    write(
      list
        .replace(
          "* fix(receipts): keep the total",
          "* fix(receipts): keep the total, better",
        )
        .trimEnd(),
    );
    expect(check().exitCode).toBe(1);
  });

  it("fails when the comparison names another version", () => {
    const { list, notes, file } = withNotes();
    writeFileSync(file, list);
    expect(notes("--check", file, "v0.3.0").exitCode).toBe(1);
  });

  it("refuses notes with no list rather than passing them", () => {
    const { write, check } = withNotes();
    write("Nothing generated here.");
    expect(check().exitCode).toBe(2);
  });
});
