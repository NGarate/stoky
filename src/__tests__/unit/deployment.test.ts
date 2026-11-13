import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRATION_MODES } from "@/lib/auth/registration";
import { DEFAULT_OCR_WORKERS } from "@/server/services/ocr";
import nextConfig from "../../../next.config";

const root = join(import.meta.dir, "../../..");

interface Service {
  image: string;
  build?: unknown;
  ports?: string[];
  volumes?: string[];
  networks: string[];
  environment?: Record<string, string>;
  read_only?: boolean;
  tmpfs?: string[];
  user?: string;
  cap_drop: string[];
  cap_add?: string[];
  security_opt: string[];
  restart: string;
  deploy: {
    resources: { limits: { memory: string; pids?: number; cpus?: unknown } };
  };
  command?: string[];
  healthcheck?: { test: string[] };
  logging?: { driver?: string; options?: Record<string, string> };
}

interface Compose {
  services: Record<string, Service>;
  configs?: unknown;
  networks: Record<string, { internal?: boolean } | null>;
}

const compose = Bun.YAML.parse(
  readFileSync(join(root, "deploy/docker-compose.yml"), "utf8"),
) as Compose;
const template = readFileSync(join(root, "deploy/example.env"), "utf8");

describe("the downloadable installation", () => {
  it("can start from the release files without source or host data mounts", () => {
    for (const service of Object.values(compose.services)) {
      expect(service.image).toBeTruthy();
      expect(service.build).toBeUndefined();
      for (const volume of service.volumes ?? []) {
        expect(volume.split(":")[0]).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
    // Two files install it: this one and example.env. A `configs` entry would
    // be a third the operator has to download beside them.
    expect(compose.configs).toBeUndefined();
  });

  it("requires fresh operator credentials and derives both database connections from one password", () => {
    const database = compose.services.db.environment!;
    const app = compose.services.app.environment!;
    expect(database.POSTGRES_PASSWORD).toMatch(
      /^\$\{POSTGRES_PASSWORD:\?.+\}$/,
    );
    expect(app.DATABASE_URL).toBe(
      `postgresql://${database.POSTGRES_USER}:${database.POSTGRES_PASSWORD}@db:5432/${database.POSTGRES_DB}?schema=public`,
    );
    // Passed through rather than required by Compose: the application refuses
    // a missing or unusable secret at start-up and names the variable.
    expect(app.STOKY_SECRET).toBe("${STOKY_SECRET:-}");
    // Nothing reads the names from before the STOKY_ rename.
    expect(
      Object.keys(app).filter((key) => key.startsWith("NEXTAUTH_")),
    ).toEqual([]);
    // The version comes from .env alone. A `:-` default is a hand-kept copy that
    // goes stale on the next release and is what an .env without the line pulls.
    expect(compose.services.app.image).toMatch(
      /^ghcr\.io\/ngarate\/stoky:\$\{STOKY_VERSION:\?.+\}$/,
    );
    expect(template).toMatch(/^STOKY_VERSION=v\S+$/m);
    expect(template).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(template).toMatch(/^STOKY_SECRET=$/m);
    expect(template).not.toMatch(/NEXTAUTH_SECRET/);
    expect(template).not.toMatch(
      /^(DATABASE_URL|VALKEY_URL|STOKY_URLS|NEXTAUTH_URL)=/m,
    );
  });

  it("names every service image by exact version and digest", () => {
    // A tag can be re-pushed; a digest cannot. Without it the release smoke and
    // an operator's later pull can run different PostgreSQL or Valkey builds
    // under the same release. The tag must still be an exact version
    // (18.6, not 18): it is what a reader and an update tool compare. The app
    // is named by STOKY_VERSION, checked above.
    const services = Object.entries(compose.services).filter(
      ([name]) => name !== "app",
    );
    expect(services.map(([name]) => name).sort()).toEqual(["cache", "db"]);
    for (const [name, service] of services) {
      expect({ name, image: service.image }).toEqual({
        name,
        image: expect.stringMatching(
          /^[a-z0-9./-]+:v?\d+\.\d+[\w.-]*@sha256:[0-9a-f]{64}$/,
        ),
      });
    }
  });

  it("reads receipts with two OCR workers unless the operator says otherwise", () => {
    // Defaulted in Compose for the same reason as STOKY_REGISTRATION: an .env
    // from an earlier release has no such line. The number is the
    // application's own default (`DEFAULT_OCR_WORKERS`), so leaving the line
    // out and keeping it say the same thing.
    expect(compose.services.app.environment!.OCR_WORKERS).toBe(
      `\${OCR_WORKERS:-${DEFAULT_OCR_WORKERS}}`,
    );
    expect(template).toMatch(
      new RegExp(`^OCR_WORKERS=${DEFAULT_OCR_WORKERS}$`, "m"),
    );
  });

  it("closes registration after the first account unless the operator opens it", () => {
    // Defaulted in Compose, unlike the credentials: an .env written for an
    // earlier release has no such line, and for that installation — accounts
    // already exist — first-user means closed, which is the safe answer.
    // `:-` and not `-`, so an empty value gets the default too.
    expect(compose.services.app.environment!.STOKY_REGISTRATION).toBe(
      "${STOKY_REGISTRATION:-first-user}",
    );
    // install.sh appends every key example.env declares to an existing .env,
    // so this line is also what an upgrade through the script writes.
    expect(template).toMatch(/^STOKY_REGISTRATION=first-user$/m);
    // Each value the line's comment offers is one the application accepts:
    // anything else stops it starting.
    for (const mode of REGISTRATION_MODES) {
      expect(template).toMatch(new RegExp(`^#\\s+${mode}:`, "m"));
    }
  });

  it("reports the database healthy only once it accepts TCP connections", () => {
    // The image's init server listens on the unix socket only; a socket probe
    // passes during init and releases the app into a refused connection.
    expect(compose.services.db.healthcheck?.test.join(" ")).toContain(
      "pg_isready -h 127.0.0.1 ",
    );
  });

  it("publishes one port, the application's, and nothing of the database or the cache", () => {
    // Plain HTTP for the operator's proxy, on a port they can move
    // (STOKY_PORT) and an address they can narrow (STOKY_BIND=127.0.0.1).
    expect(compose.services.app.ports).toEqual([
      "${STOKY_BIND:-0.0.0.0}:${STOKY_PORT:-3000}:3000",
    ]);
    expect(compose.services.db.ports).toBeUndefined();
    expect(compose.services.cache.ports).toBeUndefined();
    expect(compose.networks.stoky?.internal).toBe(true);
    expect(compose.services.db.networks).toEqual(["stoky"]);
    expect(compose.services.cache.networks).toEqual(["stoky"]);
    // Docker publishes nothing for a container that is only on an internal
    // network, so the app has a second one, which the other two are not on.
    expect(compose.services.app.networks).toEqual(["stoky", "web"]);
    expect(compose.networks.web?.internal).not.toBe(true);
    expect(compose.services.app.environment?.VALKEY_URL).toBe(
      "redis://cache:6379",
    );
  });

  it("ships no reverse proxy: TLS and certificates are the operator's", () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      "app",
      "cache",
      "db",
    ]);
    for (const service of Object.values(compose.services)) {
      expect(service.image).not.toMatch(/traefik|caddy|nginx/i);
      for (const port of service.ports ?? []) {
        expect(port).not.toMatch(/\b(80|443)\b/);
      }
    }
    expect(template).not.toMatch(/ACME|Let's Encrypt/i);
    // One address: the name the operator's proxy serves over https (D138).
    expect(compose.services.app.environment!.STOKY_URLS).toMatch(
      /^https:\/\/\$\{DOMAIN:\?.+\}$/,
    );
    expect(template).toMatch(/^DOMAIN=$/m);
  });

  it("believes no forwarded header until the operator names their proxy", () => {
    // Empty, not a private range: a LAN client of the published port arrives
    // from one. Commented in the template, so install.sh, which appends every
    // key example.env declares, never writes an empty value for it.
    expect(compose.services.app.environment!.STOKY_TRUSTED_PROXIES).toBe(
      "${STOKY_TRUSTED_PROXIES:-}",
    );
    expect(template).toMatch(/^# STOKY_TRUSTED_PROXIES=$/m);
    expect(template).toMatch(/^# STOKY_BIND=127\.0\.0\.1$/m);
    expect(template).toMatch(/^# STOKY_PORT=3000$/m);
  });

  it("preserves the read-only application and service resource limits", () => {
    for (const service of Object.values(compose.services)) {
      expect(service.cap_drop).toEqual(["ALL"]);
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.restart).toBe("unless-stopped");
      expect(service.deploy.resources.limits.memory).toMatch(/^\d+[mg]$/);
    }
    expect(compose.services.app.read_only).toBe(true);
    expect(compose.services.app.tmpfs).toEqual(["/tmp", "/app/.next/cache"]);
    expect(compose.services.app.volumes).toContain("uploads:/app/uploads");
  });

  // As root the entrypoint steps down through gosu, which needs five
  // capabilities back and is a Go binary carrying every stdlib advisory since
  // the Go it was built with. Started as postgres, neither runs.
  it("starts PostgreSQL as its own user, with no capability back", () => {
    expect(compose.services.db.user).toBe("70:70");
    expect(compose.services.db.cap_add).toBeUndefined();
  });

  it("bounds Valkey's memory below its container limit and evicts least-recently-used keys", () => {
    // Valkey ignores the cgroup limit; without --maxmemory the kernel kills it,
    // and the fail-closed sign-in limiter goes down with it.
    const cache = compose.services.cache;
    expect(cache.command).toEqual([
      "valkey-server",
      "--maxmemory",
      "160mb",
      "--maxmemory-policy",
      "allkeys-lru",
    ]);
    const mebibytes = (size: string, units: Record<string, number>) => {
      const match = /^(\d+)([a-z]+)$/.exec(size.toLowerCase());
      expect(match).not.toBeNull();
      const unit = units[match![2]!];
      expect(unit).toBeDefined();
      return Number(match![1]) * unit!;
    };
    // Valkey's "mb" is 2^20 bytes and its "m" is 10^6; Compose's "m" is 2^20.
    const bound = mebibytes(cache.command![2]!, {
      mb: 1,
      gb: 1024,
      m: 1e6 / 2 ** 20,
      g: 1e9 / 2 ** 20,
    });
    const limit = mebibytes(cache.deploy.resources.limits.memory, {
      m: 1,
      g: 1024,
    });
    // Headroom for the copy-on-write of a background save, which the cgroup
    // counts and maxmemory does not.
    expect(bound).toBeLessThanOrEqual(limit * 0.75);
  });

  it("caps how many processes each service may start, without a CPU limit small hosts would refuse", () => {
    // A fork loop or a runaway thread pool stops at its container's ceiling
    // instead of exhausting the host's process table. Ceilings, not sizing:
    // five to ten times the peak measured under load.
    const limits = Object.fromEntries(
      Object.entries(compose.services).map(([name, service]) => [
        name,
        service.deploy.resources.limits,
      ]),
    );
    // Strict: toEqual ignores an undefined value, so a new service without a
    // pids entry would pass it.
    expect(
      Object.fromEntries(
        Object.entries(limits).map(([name, limit]) => [name, limit.pids]),
      ),
    ).toStrictEqual({
      db: 256,
      cache: 128,
      app: 512,
    });
    // Docker rejects a cpus value above the host's core count, so a fixed one
    // stops the bundle from starting on the small hosts it is meant for.
    for (const [name, limit] of Object.entries(limits)) {
      expect({ name, cpus: limit.cpus }).toEqual({ name, cpus: undefined });
    }
  });

  it("rotates every service's logs instead of letting them fill the disk", () => {
    // Docker's json-file default keeps everything, and an unauthenticated
    // client can add security-log lines; the cap is what bounds the disk.
    for (const [name, service] of Object.entries(compose.services)) {
      // The driver is named beside its options: under a daemon-wide default
      // such as journald, a bare max-size stops the container from starting.
      expect({ name, logging: service.logging }).toEqual({
        name,
        logging: {
          driver: "json-file",
          options: { "max-size": "10m", "max-file": "5" },
        },
      });
    }
  });
});

/**
 * HSTS without `preload`, from the application, which is now the only layer
 * the release ships.
 *
 * `preload` is the domain owner's consent to the browsers' built-in lists:
 * hstspreload.org checks the header, not who submits, and leaving the list is
 * slow. Until 2026-10-12 the app sent it on whatever DOMAIN an operator chose,
 * so an apex install could be listed by anyone, every subdomain with it.
 * hstspreload.org asks software that ships HTTPS defaults not to send it
 * (docs/SECURITY_REVIEW.md §8). An operator who wants it adds it at their own
 * proxy. The value is read from the config, not from a running build.
 */
describe("HSTS", () => {
  it("is two years with subdomains, and does not ask for preloading", async () => {
    // Two years and subdomains: ASVS 5 V3.4.1. docs/INSTALL.md warns what
    // includeSubDomains does when DOMAIN is an apex.
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(
      all?.headers.find((header) => header.key === "Strict-Transport-Security")
        ?.value,
    ).toBe("max-age=63072000; includeSubDomains");
  });
});
