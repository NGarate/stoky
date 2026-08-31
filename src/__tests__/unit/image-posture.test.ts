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
 * being lost — a later `USER root`, a dropped `rm -rf`, a `read_only: false` —
 * and none of those would fail the build or any other test.
 *
 * This is the text half, in the shape of `bun-version.test.ts` and
 * `ocr-tessdata.test.ts`: it proves the directives are present and consistent.
 * Whether they *hold* on the built image — that `id -un` is really `node`,
 * that npm is really gone, that the container really starts read-only — is the
 * behavioural half, and belongs to the CI image job, which runs the image the
 * scan is about to publish. The two are complementary: this catches the edit,
 * that catches the reality.
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
  it("runs as node, and never returns to root after", () => {
    const stage = productionStage();
    expect(stage).toContain("\nUSER node");
    // A `USER root` after the drop would silently undo it. There must be none
    // in the production stage after the `USER node` line.
    const afterDrop = stage.slice(stage.indexOf("\nUSER node"));
    expect(afterDrop).not.toContain("USER root");
  });

  it("keeps the uploads directory writable by that user", () => {
    // Without this, `USER node` turns the first receipt upload into EACCES —
    // the failure mode the Dockerfile comment records.
    expect(productionStage()).toContain("chown -R node:node /app/uploads");
  });
});

describe("the production image ships no npm", () => {
  it("deletes npm in the same RUN that installed with it", () => {
    const stage = productionStage();
    // npm is used once, to install the Prisma CLI, then removed on the last
    // line of the same RUN so no layer carries it. The removal must come
    // after the last npm invocation in the stage — otherwise a later layer
    // ships npm and its vendored advisories (Dockerfile's own reasoning).
    const removal = stage.indexOf(
      "rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx",
    );
    expect(removal).toBeGreaterThan(-1);
    const lastNpmUse = stage.lastIndexOf("npm install");
    expect(lastNpmUse).toBeGreaterThan(-1);
    expect(removal).toBeGreaterThan(lastNpmUse);
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
    // catches.
    const compose = readFileSync(
      join(ROOT, "docker-compose.prod.yml"),
      "utf8",
    );
    // Scope to the app service: from just past `app:` to the next top-level
    // service key (a two-space-indented `name:`), so a `read_only` on another
    // service cannot satisfy this.
    const marker = "\n  app:\n";
    const appStart = compose.indexOf(marker);
    expect(appStart).toBeGreaterThan(-1);
    const rest = compose.slice(appStart + marker.length);
    const nextService = rest.search(/^ {2}[a-z][\w-]*:/m);
    const appBlock = nextService > -1 ? rest.slice(0, nextService) : rest;

    expect(appBlock).toContain("read_only: true");
    expect(appBlock).toContain("no-new-privileges:true");
    expect(appBlock).toContain("cap_drop: [ALL]");
    expect(appBlock).toContain("- /tmp");
    expect(appBlock).toContain("- /app/.next/cache");
    expect(appBlock).toContain("uploads:/app/uploads");
  });
});
