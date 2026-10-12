import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The production image's security posture, as text, so an edit that quietly
 * undoes it fails a suite rather than a deployment.
 *
 * `SECURITY_REVIEW.md` §7 named this the one posture check that had become no
 * test: the image runs as an unprivileged user, ships no npm, and is served
 * on a read-only root filesystem. Each property is one directive away from
 * being lost — a later `USER root`, a Node base, a `read_only: false` —
 * and none of those would fail the build or any other test.
 *
 * This is the text half, in the shape of `bun-version.test.ts` and
 * `ocr-tessdata.test.ts`: it proves the directives are present and consistent.
 * Whether they *hold* on the built image — that `id -un` is really `bun`,
 * that npm is really gone, that the container really starts read-only — is the
 * behavioural half. The release job starts the published image against fresh
 * volumes, after all gates and the image scan; local installation tests also
 * exercise proxy routing and restore. Static checks alone do not prove startup.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** The production stage only — a `USER` in an earlier stage must not count. */
function productionStage(): string {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const start = dockerfile.search(/^FROM .* AS production$/m);
  expect(start).toBeGreaterThan(-1);
  // The production stage is the last one, so it runs to EOF.
  return dockerfile.slice(start);
}

describe("the production image drops privilege", () => {
  it("runs as bun, and never returns to root after", () => {
    const stage = productionStage();
    expect(stage).toContain("\nUSER bun");
    // A `USER root` after the drop would silently undo it. There must be none
    // in the production stage after the `USER bun` line.
    const afterDrop = stage.slice(stage.indexOf("\nUSER bun"));
    expect(afterDrop).not.toContain("USER root");
  });

  it("keeps the uploads directory writable by that user", () => {
    // Without this, `USER bun` turns the first receipt upload into EACCES —
    // the failure mode the Dockerfile comment records.
    expect(productionStage()).toContain("chown -R bun:bun /app/uploads");
  });
});

describe("the application images use only the Bun runtime", () => {
  it("derives all stages from the pinned Bun image", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const bases = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
    // By version tag *and* index digest: a tag can be re-pushed, so the tag
    // alone lets the release build a different base with no change here.
    expect(bases[0]).toMatch(/^oven\/bun:\d+\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$/);
    expect(bases.slice(1)).toEqual(["bun", "bun", "bun", "bun"]);
    const instructions = dockerfile.replace(/^#.*$/gm, "");
    expect(instructions).not.toMatch(/npm (?:install|init)\b|apk add[^\n]*nodejs/);
  });

  it("runs migrations explicitly with Bun and uses the locked CLI", () => {
    const stage = productionStage();
    expect(stage).toContain("COPY --from=builder /opt/prisma/ /opt/prisma/");
    expect(stage).toContain("bun /opt/prisma/node_modules/prisma/build/index.js migrate deploy");
    expect(stage).toContain("&& exec bun server.js");
  });
});

/** The builder stage only, up to the next `FROM`. */
function builderStage(): string {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const start = dockerfile.search(/^FROM .* AS builder$/m);
  expect(start).toBeGreaterThan(-1);
  const rest = dockerfile.slice(start + 1);
  const end = rest.search(/^FROM /m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the Prisma engines are verified against pinned checksums", () => {
  // Prisma's postinstall downloads the native engines from binaries.prisma.sh
  // and checks them only against a .sha256 from the same origin; bun.lock's
  // integrity covers the npm tarballs, not these. The schema engine runs on
  // every start (`migrate deploy`) and the standalone query engine is loaded
  // into the server. Measured in a fresh `--target builder` build: these four
  // paths are every native engine under /opt/prisma and .next/standalone,
  // which are what the production stage copies.
  const ENGINE = "linux-musl-openssl-3.0.x";
  const shipped = [
    ["SCHEMA", `/opt/prisma/node_modules/prisma/node_modules/@prisma/engines/schema-engine-${ENGINE}`],
    ["QUERY", `/opt/prisma/node_modules/prisma/node_modules/@prisma/engines/libquery_engine-${ENGINE}.so.node`],
    ["QUERY", `/opt/prisma/node_modules/prisma/libquery_engine-${ENGINE}.so.node`],
    ["QUERY", `/app/.next/standalone/node_modules/.prisma/client/libquery_engine-${ENGINE}.so.node`],
  ];

  function checkInstruction(): string {
    const stage = builderStage();
    const start = stage.search(/^RUN printf '%s {2}%s\\n'/m);
    expect(start).toBeGreaterThan(-1);
    // A RUN continues while its lines end in a backslash.
    const lines = stage.slice(start).split("\n");
    const end = lines.findIndex((line) => !line.endsWith("\\"));
    return lines.slice(0, end + 1).join("\n");
  }

  it("pins each engine's SHA-256 in an ARG", () => {
    const stage = builderStage();
    expect(stage).toMatch(/^ARG PRISMA_SCHEMA_ENGINE_SHA256=[0-9a-f]{64}$/m);
    expect(stage).toMatch(/^ARG PRISMA_QUERY_ENGINE_SHA256=[0-9a-f]{64}$/m);
  });

  it("checks every shipped copy against its pin with sha256sum -c", () => {
    const run = checkInstruction();
    const pairs = [...run.matchAll(/"\$\{PRISMA_(\w+)_ENGINE_SHA256\}" (\S+)/g)].map(([, kind, path]) => [
      kind,
      path,
    ]);
    expect(pairs).toEqual(shipped);
    expect(run).toContain("| sha256sum -c -");
  });

  it("fails the build on an engine copy the list does not name", () => {
    // The text check cannot see a fifth copy (a new binaryTarget, a second
    // generator output). The count in the same RUN can.
    const run = checkInstruction();
    const count = run.match(/find \/opt\/prisma \/app\/\.next\/standalone .*\| wc -l\)" = (\d+)$/m);
    expect(count?.[1]).toBe(String(shipped.length));
  });

  it("checks after the engines are staged, so it sees what ships", () => {
    const stage = builderStage();
    const check = stage.indexOf(checkInstruction());
    expect(check).toBeGreaterThan(stage.indexOf("RUN bun run build"));
    expect(check).toBeGreaterThan(stage.indexOf("stage-runtime-deps.ts prisma /opt/prisma/node_modules"));
  });
});

describe("the production image ships no demo seed", () => {
  it("copies only the schema and the migrations out of prisma/", () => {
    // `prisma/seed.ts` creates an OWNER with the password the README
    // publishes. A whole-directory COPY is how it got into the image, and any
    // new file in prisma/ would follow it the same way.
    const prismaCopy = /^COPY --from=builder \/app\/prisma(\S*) (\S+)$/gm;
    const copies = [...productionStage().matchAll(prismaCopy)].map(([, source, target]) => [
      source,
      target,
    ]);
    expect(copies).toEqual([
      ["/schema.prisma", "./prisma/schema.prisma"],
      ["/migrations", "./prisma/migrations"],
    ]);
  });

  it("fails the build if the seed is present anyway", () => {
    // The text check above cannot see a seed that arrives some other way (a
    // standalone trace, a broader COPY of /app). The build assertion can, and
    // it also proves the migrations landed in prisma/migrations rather than
    // flattened into prisma/.
    const stage = productionStage();
    expect(stage).toContain("test ! -e /app/prisma/seed.ts");
    expect(stage).toContain("test -f /app/prisma/migrations/migration_lock.toml");
  });
});

describe("the production image's health check", () => {
  it("asks /api/health, not merely whether the port answers", () => {
    // The reasoning the Dockerfile spells out: a listener that is up but
    // cannot reach Postgres or Valkey is not healthy, and /login would report
    // it as such. A text edit to `/login` would quietly lose that.
    const stage = productionStage();
    expect(stage).toContain("HEALTHCHECK");
    expect(stage).toContain("/api/health");
  });
});

describe("the production compose runs read-only", () => {
  it("makes the app root read-only, with only the three writable exceptions", () => {
    // Not a Dockerfile property — read-only lives in compose, with tmpfs for
    // the two paths Next and the OS must write and the uploads volume for the
    // one the app must. A `read_only: false`, or a missing tmpfs, is what this
    // catches. deploy/ is the one production definition; the source build
    // overrides it (below), so this is the file that has to hold.
    const compose = Bun.YAML.parse(
      readFileSync(join(ROOT, "deploy/docker-compose.yml"), "utf8"),
    ) as { services: Record<string, Record<string, unknown>> };
    const app = compose.services.app;

    expect(app.read_only).toBe(true);
    expect(app.security_opt).toContain("no-new-privileges:true");
    expect(app.cap_drop).toEqual(["ALL"]);
    expect(app.tmpfs).toEqual(["/tmp", "/app/.next/cache"]);
    expect(app.volumes).toContain("uploads:/app/uploads");
  });

  it("builds from source without restating, and so without drifting from, that definition", () => {
    // docker-compose.prod.yml used to be a full second copy of the hardening
    // and had already diverged (an older Traefik with the Docker socket). It
    // may now only add the build. Anything else here would override deploy/.
    const override = Bun.YAML.parse(
      readFileSync(join(ROOT, "docker-compose.prod.yml"), "utf8"),
    ) as { name: string; services: Record<string, Record<string, unknown>> };

    expect(Object.keys(override).sort()).toEqual(["name", "services"]);
    expect(override.name).not.toBe("stoky-release");
    expect(Object.keys(override.services)).toEqual(["app"]);
    expect(Object.keys(override.services.app).sort()).toEqual(["build", "pull_policy"]);
  });
});

describe("the build context leaves out local secrets and state", () => {
  // `COPY . .` in the builder and development stages takes whatever the
  // context holds, and .dockerignore patterns match from the context root: a
  // bare `.env*` misses `deploy/.env`, which the documented source build has
  // the operator fill with the real database password and NEXTAUTH_SECRET.
  // Measured with sentinels sent through a throwaway build: with root-only
  // rules, deploy/.env, nested node_modules and .next, `.claude/`,
  // `.playwright/auth/` and a stray traineddata all arrived.
  const rules = readFileSync(join(ROOT, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("excludes env files, dependencies and build output at every depth", () => {
    expect(rules).toContain("**/.env*");
    expect(rules).toContain("**/node_modules");
    expect(rules).toContain("**/.next");
  });

  it("re-includes only the documented example, after the rule it relaxes", () => {
    // Later rules win, so a negation placed before `**/.env*` would be inert,
    // and any other negation is a hole someone has to justify.
    expect(rules.filter((rule) => rule.startsWith("!"))).toEqual(["!.env.example"]);
    expect(rules.indexOf("!.env.example")).toBeGreaterThan(rules.indexOf("**/.env*"));
  });

  it("excludes agent and tool state, OCR models and incremental build info", () => {
    const local = [".claude", ".codex", ".opencode", ".playwright", "*.traineddata", "*.tsbuildinfo"];
    for (const rule of local) expect(rules).toContain(rule);
  });
});
