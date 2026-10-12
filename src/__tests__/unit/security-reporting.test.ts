import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A security report has two ways in: the link SECURITY.md publishes, and the
 * issue chooser, where a reporter who never reads SECURITY.md starts. If the
 * two drift apart, one of them sends people somewhere that is not the private
 * form, and the likely result is a public issue — a zero-day for every
 * installation, because none can be patched before the details are read.
 *
 * Other documents link to the policy by its heading's anchor, so renaming the
 * heading would quietly break every one of those links; that is checked too.
 */

const root = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const ANCHOR = "reporting-a-vulnerability";
const HEADING = "## Reporting a vulnerability";

function reportingSection(): string {
  const security = read("SECURITY.md");
  const start = security.indexOf(`${HEADING}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = security.indexOf("\n## ", start + HEADING.length);
  return security.slice(start, end === -1 ? undefined : end);
}

/** The bold link that opens the section is the published channel. */
function publishedChannel(): string {
  const match = reportingSection().match(/\*\*<(https:\/\/[^>]+)>\*\*/);
  expect(match).not.toBeNull();
  return match![1];
}

type ChooserConfig = {
  blank_issues_enabled?: unknown;
  contact_links?: Array<{ name?: unknown; url?: unknown; about?: unknown }>;
};

const chooser = Bun.YAML.parse(read(".github/ISSUE_TEMPLATE/config.yml")) as ChooserConfig;

describe("vulnerability reporting channel", () => {
  it("publishes the private advisory form of this repository", () => {
    expect(publishedChannel()).toBe("https://github.com/NGarate/stoky/security/advisories/new");
  });

  it("sends the issue chooser to the same place SECURITY.md does", () => {
    const urls = (chooser.contact_links ?? []).map((link) => link.url);
    expect(urls).toContain(publishedChannel());
  });

  it("names the security link in Spanish first, then English", () => {
    const link = (chooser.contact_links ?? []).find((l) => l.url === publishedChannel());
    expect(typeof link?.name).toBe("string");
    expect(typeof link?.about).toBe("string");
    const name = link!.name as string;
    expect(name.indexOf("vulnerabilidad")).toBeGreaterThanOrEqual(0);
    expect(name.indexOf("vulnerabilidad")).toBeLessThan(name.indexOf("vulnerability"));
  });

  it("keeps blank issues while there is no template to file an ordinary bug with", () => {
    const templates = readdirSync(join(root, ".github/ISSUE_TEMPLATE")).filter(
      (file) => file !== "config.yml",
    );
    // With no templates, disabling blank issues leaves the chooser offering
    // only the security link, and an ordinary bug report has nowhere to go.
    if (templates.length === 0) expect(chooser.blank_issues_enabled).toBe(true);
  });

  it("says what to do when the form is not offered", () => {
    // The form exists for outsiders only while the repository's private
    // vulnerability reporting setting is on, which no file here controls.
    expect(reportingSection()).toContain("https://github.com/NGarate/stoky/issues/new");
  });

  it("keeps the anchor other documents link to", () => {
    for (const [path, link] of [
      ["SECURITY.md", `(#${ANCHOR})`],
      ["docs/INSTALL.md", `(../SECURITY.md#${ANCHOR})`],
    ] as const) {
      expect(read(path)).toContain(link);
    }
    expect(read("SECURITY.md")).toContain(`\n${HEADING}\n`);
  });
});
