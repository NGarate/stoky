/**
 * Refreshes the release bundle's service images — PostgreSQL, Valkey,
 * Traefik, as deploy/docker-compose.yml pins them — to the newest build of
 * the same major, which is RELEASING.md step 4 done by a program instead of
 * by hand.
 *
 * Run: bun scripts/release-refresh-images.ts                  # write the updates
 *      bun scripts/release-refresh-images.ts --check          # report and scan them, write nothing
 *      bun scripts/release-refresh-images.ts --compose FILE   # another Compose file
 *
 * For each service other than `app` (named by STOKY_VERSION, not a refresh's
 * business), from its pin `NAME:TAG@sha256:DIGEST`:
 *
 * 1. The floating tag of the same major comes from the pinned tag:
 *    `16.15-alpine` → `16-alpine`, `8.1.10-alpine` → `8-alpine`,
 *    `v3.7.16` → `v3`. A tag is an optional `v`, a dotted version of at least
 *    two numbers, and an optional suffix starting with a letter; anything
 *    else (`latest`, a bare `16`) is refused, not guessed at.
 * 2. The floating tag's digest is its multi-platform index's — refused if the
 *    tag names a single manifest — read with
 *    `docker buildx imagetools inspect REF --format '{{json .Manifest}}'`.
 *    When it is the pinned digest, the image is unchanged and that one
 *    request is all it costs (Docker Hub's anonymous limit, see versionOf).
 * 3. The exact version that index is comes from its linux/amd64 image config
 *    (`--format '{{json .Image}}'` on that manifest's digest, so the tag
 *    cannot move between this read and the last), from a source measured per
 *    image on the registry on 2026-10-23 and listed in VERSION_SOURCES. An
 *    image with no measured source is refused: the source differs between
 *    images, and a wrong guess here would be written into a release.
 * 4. The exact tag (`16.15-alpine`, `8.1.10-alpine`, `v3.7.16`) must name the
 *    same index digest, or the image is refused: the line written must say
 *    what it pins.
 *
 * A version of another major, or older than the pin, is refused: a new major
 * is a migration with its own release note, not a refresh. The same version
 * at a new digest is an update — upstream rebuilt it, usually on a patched
 * base image — and is what a refresh most often finds.
 *
 * Every candidate is then scanned with scripts/scan-bundle-images.sh, the
 * release gate's scanner and rule, one image per run so the summary can say
 * which one is red (each run downloads Trivy's database again; there are at
 * most three). Only when every candidate is clean is anything written, and
 * then only the `image:` lines that change: everything else in the file is
 * kept byte for byte.
 *
 * Exit codes — another script relies on them:
 *   0  the updates were written (with --check: are available and clean), or
 *      there is nothing to update
 *   1  some candidate has a fixable CRITICAL or HIGH finding; nothing written.
 *      The release waits for upstream (RELEASING.md step 4).
 *   2  an error: a usage error, an unparseable tag, a digest mismatch, a
 *      major change, a registry failure, or a scan that exits other than 0
 *      or 1; nothing written
 *
 * scan-bundle-images.sh exits 1 when Trivy itself fails, not only on a
 * finding — measured 2026-10-23, when its database download returned 404 —
 * so a broken scanner reads here as a red candidate. That errs the safe way:
 * nothing is written. Its output, printed above the summary, says which.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCANNER = join(import.meta.dir, "scan-bundle-images.sh");

export const OK = 0;
export const RED = 1;
export const ERROR = 2;

class Refused extends Error {}

/**
 * Where each image says which version it is, measured with
 * `docker buildx imagetools inspect NAME:FLOATING --format '{{json .Image}}'`
 * (linux/amd64). postgres and valkey carry no version label but set the
 * version their Dockerfile builds; traefik sets no such variable but labels
 * the image with the tag, `v` included. postgres's index annotation
 * (`16.15-alpine3.24`) names the Alpine release, which the tag does not.
 */
const VERSION_SOURCES: Record<string, { env: string } | { label: string }> = {
  postgres: { env: "PG_VERSION" },
  "valkey/valkey": { env: "VALKEY_VERSION" },
  traefik: { label: "org.opencontainers.image.version" },
};

const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TAG = /^(v?)(\d+)((?:\.\d+)+)(-[A-Za-z][0-9A-Za-z._-]*)?$/;
const VERSION = /^\d+(?:\.\d+)+$/;

export interface Tag {
  prefix: string;
  /** The dotted version, without the prefix: `16.15`, `3.7.16`. */
  version: string;
  major: string;
  suffix: string;
}

export function parseTag(tag: string): Tag | null {
  const match = tag.match(TAG);
  if (!match) return null;
  const [, prefix, major, rest, suffix = ""] = match;
  return { prefix, version: major + rest, major, suffix };
}

export function floatingTag(tag: Tag): string {
  return tag.prefix + tag.major + tag.suffix;
}

/** `NAME:TAG@sha256:…` → its parts; null when it is not pinned that way. */
export function parsePin(image: string): { name: string; tag: string; digest: string } | null {
  const at = image.indexOf("@");
  if (at === -1) return null;
  const reference = image.slice(0, at);
  const digest = image.slice(at + 1);
  const colon = reference.lastIndexOf(":");
  if (colon === -1 || colon < reference.lastIndexOf("/") || !DIGEST.test(digest)) return null;
  return { name: reference.slice(0, colon), tag: reference.slice(colon + 1), digest };
}

function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function imagetools(reference: string, format: string): unknown {
  const result = Bun.spawnSync(["docker", "buildx", "imagetools", "inspect", reference, "--format", format]);
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || `exit ${result.exitCode}`;
    throw new Refused(`docker buildx imagetools inspect ${reference}: ${message}`);
  }
  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    throw new Refused(`docker buildx imagetools inspect ${reference} printed no JSON for ${format}`);
  }
}

interface Index {
  digest: string;
  /** The digest of the index's linux/amd64 manifest. */
  amd64: string | undefined;
}

/** The multi-platform index `reference` names. */
function indexOf(reference: string): Index {
  const manifest = imagetools(reference, "{{json .Manifest}}") as {
    mediaType?: string;
    digest?: string;
    manifests?: { digest?: string; platform?: { os?: string; architecture?: string; variant?: string } }[];
  };
  if (!INDEX_TYPES.has(manifest.mediaType ?? "")) {
    throw new Refused(`${reference} is not a multi-platform index (${manifest.mediaType ?? "no media type"})`);
  }
  if (!DIGEST.test(manifest.digest ?? "")) throw new Refused(`${reference} has no sha256 digest`);
  const amd64 = manifest.manifests?.find(
    ({ platform }) => platform?.os === "linux" && platform.architecture === "amd64" && !platform.variant,
  )?.digest;
  return { digest: manifest.digest!, amd64 };
}

type Config = { config?: { Env?: string[]; Labels?: Record<string, string> } };

/**
 * The version the index's linux/amd64 image says it is, without a leading
 * `v`. Read from that one manifest: `{{json .Image}}` on the index fetches
 * every platform's manifest, eight for postgres, and Docker Hub allows an
 * anonymous address 100 manifest requests an hour — measured: the
 * measurements behind this script spent them.
 */
function versionOf(name: string, index: Index): string {
  const source = VERSION_SOURCES[name.replace(/^(docker\.io\/)?(library\/)?/, "")];
  if (!source) throw new Refused(`${name}: no measured source for its version (VERSION_SOURCES)`);
  if (!index.amd64 || !DIGEST.test(index.amd64)) throw new Refused(`${name}@${index.digest} has no linux/amd64 image`);
  const reference = `${name}@${index.amd64}`;
  const image = imagetools(reference, "{{json .Image}}") as Config & Record<string, Config | undefined>;
  // One manifest prints its image; an index (were the digest one) prints them keyed by platform.
  const config = image.config ?? image["linux/amd64"]?.config;
  if (!config) throw new Refused(`${reference} has no image config`);
  const digest = index.digest;
  const value =
    "env" in source
      ? config.Env?.find((entry) => entry.startsWith(`${source.env}=`))?.slice(source.env.length + 1)
      : config.Labels?.[source.label];
  const where = "env" in source ? `env ${source.env}` : `label ${source.label}`;
  if (value === undefined) throw new Refused(`${name}@${digest} has no ${where}`);
  const version = value.replace(/^v/, "");
  if (!VERSION.test(version)) throw new Refused(`${name}@${digest}: ${where} is "${value}", not a version`);
  return version;
}

interface Row {
  service: string;
  from: string;
  to: string;
  scan: string;
}

/** What the newest build of `image`'s major is, or null when it is `image`. */
function candidateFor(image: string): string | null {
  const pin = parsePin(image);
  if (!pin) throw new Refused(`"${image}" is not pinned as NAME:TAG@sha256:DIGEST`);
  const tag = parseTag(pin.tag);
  if (!tag) throw new Refused(`cannot derive the floating tag of "${pin.tag}"; refusing to guess`);

  const floating = `${pin.name}:${floatingTag(tag)}`;
  const index = indexOf(floating);
  const digest = index.digest;
  // The pin is the build the floating tag names: one request, and done. Its
  // tag was checked against this digest when it was written.
  if (digest === pin.digest) return null;

  const version = versionOf(pin.name, index);
  const major = version.split(".")[0];
  if (major !== tag.major) {
    throw new Refused(`${floating} is ${version}: a new major is a migration, not a refresh`);
  }
  if (compareVersions(version, tag.version) < 0) {
    throw new Refused(`${floating} is ${version}, older than the pinned ${tag.version}`);
  }
  const exact = tag.prefix + version + tag.suffix;
  const exactDigest = indexOf(`${pin.name}:${exact}`).digest;
  if (exactDigest !== digest) {
    throw new Refused(`${pin.name}:${exact} is ${exactDigest}, but ${floating} is ${digest}`);
  }
  return `${pin.name}:${exact}@${digest}`;
}

/** The scan's verdict on one image: the release gate's exit status. */
function scan(image: string): "clean" | "red" {
  const result = Bun.spawnSync(["bash", SCANNER, image], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode === 0) return "clean";
  if (result.exitCode === 1) return "red";
  throw new Refused(`scan-bundle-images.sh ${image} failed (exit ${result.exitCode})`);
}

/** `text` with exactly the one `image:` line naming `from` now naming `to`. */
function rewrite(text: string, from: string, to: string): string {
  const lines = text.split("\n");
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(`^(\\s*image:\\s*["']?)${escaped}(["']?\\s*(?:#.*)?)$`);
  const found = lines.flatMap((text, index) => (line.test(text) ? [index] : []));
  if (found.length !== 1) throw new Refused(`${from} is on ${found.length} image lines, not one`);
  lines[found[0]] = lines[found[0]].replace(line, (_, head: string, tail: string) => head + to + tail);
  return lines.join("\n");
}

function table(rows: Row[]): string {
  const header: Row = { service: "SERVICE", from: "FROM", to: "TO", scan: "SCAN" };
  const all = [header, ...rows];
  const keys = ["service", "from", "to", "scan"] as const;
  const width = keys.map((key) => Math.max(...all.map((row) => row[key].length)));
  return all.map((row) => keys.map((key, i) => row[key].padEnd(width[i])).join("  ").trimEnd()).join("\n");
}

export function main(argv: string[]): number {
  let check = false;
  let compose = join(ROOT, "deploy/docker-compose.yml");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--compose" && argv[i + 1] !== undefined) compose = resolve(argv[++i]);
    else {
      console.error("Usage: bun scripts/release-refresh-images.ts [--check] [--compose FILE]");
      return ERROR;
    }
  }
  const near = relative(process.cwd(), compose);
  const shown = near && !near.startsWith("..") ? near : compose;

  let text: string;
  let services: Record<string, { image?: unknown }>;
  try {
    text = readFileSync(compose, "utf8");
    services = (Bun.YAML.parse(text) as { services?: Record<string, { image?: unknown }> }).services ?? {};
  } catch (error) {
    console.error(`Error: cannot read ${shown}: ${(error as Error).message}`);
    return ERROR;
  }

  const rows: Row[] = [];
  const updates: { row: Row; from: string; to: string }[] = [];
  let failed = false;
  for (const [service, { image }] of Object.entries(services)) {
    if (service === "app") continue;
    const from = typeof image === "string" ? image : "(no image)";
    try {
      if (typeof image !== "string") throw new Refused(`service ${service} names no image`);
      const to = candidateFor(image);
      const row = { service, from, to: to ?? "unchanged", scan: to ? "not scanned" : "-" };
      rows.push(row);
      if (to) updates.push({ row, from: image, to });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      rows.push({ service, from, to: "refused", scan: "-" });
      console.error(`Error: ${service}: ${error.message}`);
      failed = true;
    }
  }
  if (rows.length === 0) {
    console.error(`Error: ${shown} names no service image besides app.`);
    return ERROR;
  }
  if (failed) {
    console.log(table(rows));
    console.error(`Error: nothing scanned and nothing written to ${shown}.`);
    return ERROR;
  }
  if (updates.length === 0) {
    console.log(table(rows));
    console.log(`Nothing to update: each service image of ${shown} is the newest build of its major.`);
    return OK;
  }

  let red = false;
  for (const update of updates) {
    try {
      update.row.scan = scan(update.to);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      update.row.scan = "failed";
      console.log(table(rows));
      console.error(`Error: ${error.message}. Nothing written to ${shown}.`);
      return ERROR;
    }
    red ||= update.row.scan === "red";
  }
  console.log(table(rows));
  if (red) {
    console.error(
      `Error: a candidate has a fixable CRITICAL or HIGH finding. Nothing written to ${shown}; ` +
        "the release waits for upstream (RELEASING.md step 4).",
    );
    return RED;
  }
  if (check) {
    console.log(`${updates.length} update(s) available and clean. Nothing written (--check).`);
    return OK;
  }

  let next = text;
  try {
    for (const { from, to } of updates) next = rewrite(next, from, to);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`Error: ${error.message}. Nothing written to ${shown}.`);
    return ERROR;
  }
  writeFileSync(compose, next);
  console.log(`Updated ${updates.length} image(s) in ${shown}.`);
  return OK;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
