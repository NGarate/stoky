import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { floatingTag, parseTag } from "../../../scripts/release-refresh-images";

/**
 * `scripts/release-refresh-images.ts` moves the bundle's service pins to the
 * newest build of their major, and a release depends on its exit codes. These
 * run it against a stub `docker` that answers `buildx imagetools inspect` from
 * a fixture registry shaped like the real one's output (index manifests, image
 * configs keyed by platform), and a stub scan-bundle-images.sh beside it that
 * is red for the images a test names: what is under test is which pin is
 * written and when nothing is, not the registry or Trivy.
 */

const root = join(import.meta.dir, "../../..");
const real = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

/** The pins the real Compose file holds, so these tests follow a release's refresh. */
const services = Bun.YAML.parse(real) as { services: Record<string, { image: string }> };
function pinOf(service: string) {
  const image = services.services[service].image;
  const match = image.match(/^(.+):([^:@]+)@(sha256:[0-9a-f]{64})$/);
  if (!match) throw new Error(`${service} is not pinned: ${image}`);
  const [, name, tag, digest] = match;
  return { image, name, tag, digest };
}
const PINS = { db: pinOf("db"), cache: pinOf("cache"), traefik: pinOf("traefik") };

const digest = (n: number) => "sha256:" + n.toString(16).padStart(2, "0").repeat(32);

/** The version source each image carries on the real registry (the script's VERSION_SOURCES). */
function config(name: string, version: string) {
  if (name === "postgres") return { Env: ["PATH=/usr/bin", "GOSU_VERSION=1.19", `PG_VERSION=${version}`] };
  if (name === "valkey/valkey") return { Env: ["PATH=/usr/bin", `VALKEY_VERSION=${version}`] };
  if (name === "traefik") return { Env: ["PATH=/usr/bin"], Labels: { "org.opencontainers.image.version": `v${version}` } };
  throw new Error(`no fixture source for ${name}`);
}

function setup() {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-refresh-"));
  fixtures.push(fixture);
  for (const directory of ["scripts", "deploy", "bin", "registry"]) mkdirSync(join(fixture, directory));
  copyFileSync(join(root, "scripts/release-refresh-images.ts"), join(fixture, "scripts/release-refresh-images.ts"));
  const compose = join(fixture, "deploy/docker-compose.yml");
  writeFileSync(compose, real);
  const log = join(fixture, "calls");
  const red = join(fixture, "red");
  writeFileSync(log, "");
  writeFileSync(red, "");

  const file = (reference: string, kind: "manifest" | "image") =>
    join(fixture, "registry", `${reference.replace(/[/:@]/g, "_")}.${kind}.json`);
  writeFileSync(
    join(fixture, "bin/docker"),
    `#!/bin/bash
printf 'docker' >> "${log}"; printf ' [%s]' "$@" >> "${log}"; echo >> "${log}"
[ "$1 $2 $3 $5" = "buildx imagetools inspect --format" ] || exit 99
case "$6" in
  '{{json .Manifest}}') kind=manifest ;;
  '{{json .Image}}') kind=image ;;
  *) exit 98 ;;
esac
file="${join(fixture, "registry")}/$(printf '%s' "$4" | tr '/:@' '___').$kind.json"
[ -f "$file" ] || { echo "ERROR: docker.io/library/$4: not found" >&2; exit 1; }
cat "$file"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fixture, "scripts/scan-bundle-images.sh"),
    `#!/bin/bash
printf 'scan' >> "${log}"; printf ' [%s]' "$@" >> "${log}"; echo >> "${log}"
for image; do grep -Fxq "$image" "${red}" && exit 1; done
exit 0
`,
  );

  /**
   * `tags` of `name` name the index `at`, whose linux/amd64 manifest's image
   * says it is `version` — and whose other platforms say another, so a
   * version read from the wrong one goes red.
   */
  const publish = (name: string, tags: string[], at: string, version: string) => {
    const platform = (architecture: string, variant?: string) =>
      "sha256:" + new Bun.CryptoHasher("sha256").update(`${at} ${architecture} ${variant}`).digest("hex");
    const entry = (architecture: string, variant?: string) => ({
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: platform(architecture, variant),
      platform: { architecture, os: "linux", ...(variant && { variant }) },
    });
    const index = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      digest: at,
      size: 1234,
      manifests: [entry("arm", "v7"), entry("amd64"), entry("arm64", "v8")],
    };
    for (const tag of tags) writeFileSync(file(`${name}:${tag}`, "manifest"), JSON.stringify(index, null, 2));
    // `{{json .Image}}` on one platform's manifest prints that image, not a map.
    const image = { architecture: "amd64", os: "linux", config: config(name, version) };
    writeFileSync(file(`${name}@${platform("amd64")}`, "image"), JSON.stringify(image, null, 2));
    for (const [architecture, variant] of [["arm", "v7"], ["arm64", "v8"]]) {
      const other = { architecture, os: "linux", variant, config: config(name, "0.0.1") };
      writeFileSync(file(`${name}@${platform(architecture, variant)}`, "image"), JSON.stringify(other, null, 2));
    }
  };
  /** The registry as the pins left it: each floating tag still names its pin. */
  for (const pin of Object.values(PINS)) {
    const tag = parseTag(pin.tag)!;
    publish(pin.name, [floatingTag(tag), pin.tag], pin.digest, tag.version);
  }

  const run = (...args: string[]) => {
    const result = Bun.spawnSync(["bun", "scripts/release-refresh-images.ts", ...args], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}` },
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  const calls = (tool: string) =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(`${tool} `))
      .map((line) => [...line.matchAll(/\[([^\]]*)\]/g)].map(([, arg]) => arg));
  const scanned = () => calls("scan").flat();
  const markRed = (...images: string[]) => writeFileSync(red, images.map((image) => `${image}\n`).join(""));
  const content = () => readFileSync(compose, "utf8");
  const setCompose = (text: string) => writeFileSync(compose, text);
  return { run, publish, scanned, markRed, content, setCompose, calls };
}

/** deployment.test.ts's rule for a service image, applied to `text`. */
function pinnedLikeDeploymentTest(text: string) {
  const { services } = Bun.YAML.parse(text) as { services: Record<string, { image: string }> };
  return Object.entries(services)
    .filter(([name]) => name !== "app")
    .every(([, { image }]) => /^[a-z0-9./-]+:v?\d+\.\d+[\w.-]*@sha256:[0-9a-f]{64}$/.test(image));
}

const NEW_TRAEFIK = `traefik:v3.99.1@${digest(1)}`;

describe("refreshing the bundle's service images", () => {
  it("derives the floating tag of the same major, and parses nothing else", () => {
    expect(floatingTag(parseTag("16.15-alpine")!)).toBe("16-alpine");
    expect(floatingTag(parseTag("8.1.10-alpine")!)).toBe("8-alpine");
    expect(floatingTag(parseTag("v3.7.16")!)).toBe("v3");
    expect(floatingTag(parseTag("16.15-alpine3.24")!)).toBe("16-alpine3.24");
    for (const tag of ["latest", "16", "v3", "16-alpine", "alpine", "16.15-", "16.15-3"]) {
      expect({ tag, parsed: parseTag(tag) }).toEqual({ tag, parsed: null });
    }
  });

  it("changes nothing, and scans nothing, when every pin is the newest build", () => {
    const { run, scanned, content } = setup();
    const result = run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Nothing to update");
    expect(content()).toBe(real);
    expect(scanned()).toEqual([]);
  });

  // Docker Hub allows an anonymous address 100 manifest requests an hour, and
  // `{{json .Image}}` on an index costs one per platform.
  it("reads one index per image when nothing changed", () => {
    const { run, calls } = setup();
    expect(run().exitCode).toBe(0);
    const references = calls("docker").map((args) => `${args[3]} ${args[5]}`);
    expect(references.toSorted()).toEqual(
      Object.values(PINS)
        .map((pin) => `${pin.name}:${floatingTag(parseTag(pin.tag)!)} {{json .Manifest}}`)
        .toSorted(),
    );
  });

  it("writes a newer build of the same major, scanned, and changes no other byte", () => {
    const { run, publish, scanned, content } = setup();
    publish("traefik", ["v3", "v3.99.1"], digest(1), "3.99.1");
    const result = run();
    expect(result.exitCode).toBe(0);
    expect(scanned()).toEqual([NEW_TRAEFIK]);
    expect(content()).toBe(real.replace(`image: ${PINS.traefik.image}\n`, `image: ${NEW_TRAEFIK}\n`));
    expect(content()).not.toBe(real);
    expect(pinnedLikeDeploymentTest(content())).toBe(true);
    expect(result.stdout).toMatch(new RegExp(`traefik\\s+${PINS.traefik.image.replace(/[.$]/g, "\\$&")}\\s+${NEW_TRAEFIK.replace(/[.$]/g, "\\$&")}\\s+clean`));
  });

  // Upstream rebuilds a version on a patched base under the same tag: the pin
  // keeps its tag and takes the new index.
  it("takes a rebuild of the pinned version at its new digest", () => {
    const { run, publish, content } = setup();
    const tag = parseTag(PINS.db.tag)!;
    publish("postgres", [floatingTag(tag), PINS.db.tag], digest(2), tag.version);
    expect(run().exitCode).toBe(0);
    expect(content()).toBe(real.replace(PINS.db.image, `postgres:${PINS.db.tag}@${digest(2)}`));
  });

  it("refuses when the exact tag names another index than the floating one", () => {
    const { run, publish, scanned, content } = setup();
    publish("traefik", ["v3"], digest(1), "3.99.1");
    publish("traefik", ["v3.99.1"], digest(3), "3.99.1");
    const result = run();
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("traefik:v3.99.1");
    expect(content()).toBe(real);
    expect(scanned()).toEqual([]);
  });

  it("writes nothing, not even a clean update, when a candidate is red", () => {
    const { run, publish, markRed, scanned, content } = setup();
    publish("traefik", ["v3", "v3.99.1"], digest(1), "3.99.1");
    publish("valkey/valkey", ["8-alpine", "8.99.0-alpine"], digest(4), "8.99.0");
    markRed(NEW_TRAEFIK);
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(scanned().toSorted()).toEqual([NEW_TRAEFIK, `valkey/valkey:8.99.0-alpine@${digest(4)}`].toSorted());
    expect(content()).toBe(real);
    expect(result.stdout).toMatch(/traefik\s.*\sred$/m);
    expect(result.stdout).toMatch(/cache\s.*\sclean$/m);
  });

  it("refuses a new major, which is a migration and not a refresh", () => {
    const { run, publish, scanned, content } = setup();
    publish("traefik", ["v3", "v4.0.0"], digest(5), "4.0.0");
    const result = run();
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("new major");
    expect(content()).toBe(real);
    expect(scanned()).toEqual([]);
  });

  it("with --check, reports and scans an update and writes nothing", () => {
    const { run, publish, markRed, scanned, content } = setup();
    publish("traefik", ["v3", "v3.99.1"], digest(1), "3.99.1");
    const clean = run("--check");
    expect(clean.exitCode).toBe(0);
    expect(scanned()).toEqual([NEW_TRAEFIK]);
    expect(clean.stdout).toContain(NEW_TRAEFIK);
    expect(content()).toBe(real);

    markRed(NEW_TRAEFIK);
    expect(run("--check").exitCode).toBe(1);
    expect(content()).toBe(real);
  });

  it.each(["latest", "v3"])("refuses a pin whose tag %p it cannot parse, rather than guess", (tag) => {
    const { run, setCompose, content, calls, scanned } = setup();
    const broken = real.replace(PINS.traefik.image, `traefik:${tag}@${PINS.traefik.digest}`);
    setCompose(broken);
    const result = run();
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`"${tag}"`);
    expect(content()).toBe(broken);
    expect(calls("docker").some((args) => args.some((arg) => arg.startsWith("traefik")))).toBe(false);
    expect(scanned()).toEqual([]);
  });

  it("refuses when the registry does not answer for a floating tag", () => {
    const { run, setCompose, content } = setup();
    const unknown = real.replace(PINS.traefik.image, `traefik:v9.1.0@${PINS.traefik.digest}`);
    setCompose(unknown);
    const result = run();
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("not found");
    expect(content()).toBe(unknown);
  });
});
