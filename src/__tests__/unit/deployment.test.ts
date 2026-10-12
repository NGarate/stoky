import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  cap_drop: string[];
  security_opt: string[];
  restart: string;
  deploy: { resources: { limits: { memory: string; pids?: number; cpus?: unknown } } };
  command?: string[];
  configs?: { source: string; target: string }[];
  healthcheck?: { test: string[] };
  logging?: { driver?: string; options?: Record<string, string> };
}

interface Compose {
  services: Record<string, Service>;
  configs: Record<string, { file: string; content?: string }>;
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
    for (const config of Object.values(compose.configs)) {
      expect(config.file).toBe("./traefik.yml");
      expect(existsSync(join(root, "deploy", config.file))).toBe(true);
      // Compose refuses to inject inline content into read-only services.
      expect(config.content).toBeUndefined();
    }
  });

  it("requires fresh operator credentials and derives both database connections from one password", () => {
    const database = compose.services.db.environment!;
    const app = compose.services.app.environment!;
    expect(database.POSTGRES_PASSWORD).toMatch(/^\$\{POSTGRES_PASSWORD:\?.+\}$/);
    expect(app.DATABASE_URL).toBe(
      `postgresql://${database.POSTGRES_USER}:${database.POSTGRES_PASSWORD}@db:5432/${database.POSTGRES_DB}?schema=public`,
    );
    expect(app.NEXTAUTH_SECRET).toMatch(/^\$\{NEXTAUTH_SECRET:\?.+\}$/);
    // The version comes from .env alone. A `:-` default is a hand-kept copy that
    // goes stale on the next release and is what an .env without the line pulls.
    expect(compose.services.app.image).toMatch(/^ghcr\.io\/ngarate\/stoky:\$\{STOKY_VERSION:\?.+\}$/);
    expect(template).toMatch(/^STOKY_VERSION=v\S+$/m);
    expect(template).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(template).toMatch(/^NEXTAUTH_SECRET=$/m);
    expect(template).not.toMatch(/^(DATABASE_URL|VALKEY_URL|NEXTAUTH_URL)=/m);
  });

  it("names every service image by exact version and digest", () => {
    // A tag can be re-pushed; a digest cannot. Without it the release smoke and
    // an operator's later pull can run different PostgreSQL, Valkey or Traefik
    // builds under the same release. The tag must still be an exact version
    // (16.15, not 16): it is what a reader and an update tool compare. The app
    // is named by STOKY_VERSION, checked above.
    const services = Object.entries(compose.services).filter(([name]) => name !== "app");
    expect(services.map(([name]) => name).sort()).toEqual(["cache", "db", "traefik"]);
    for (const [name, service] of services) {
      expect({ name, image: service.image }).toEqual({
        name,
        image: expect.stringMatching(/^[a-z0-9./-]+:v?\d+\.\d+[\w.-]*@sha256:[0-9a-f]{64}$/),
      });
    }
  });

  it("reports the database healthy only once it accepts TCP connections", () => {
    // The image's init server listens on the unix socket only; a socket probe
    // passes during init and releases the app into a refused connection.
    expect(compose.services.db.healthcheck?.test.join(" ")).toContain("pg_isready -h 127.0.0.1 ");
  });

  it("keeps the app and stateful services behind Traefik", () => {
    for (const [name, service] of Object.entries(compose.services)) {
      if (name !== "traefik") expect(service.ports).toBeUndefined();
    }
    expect(compose.services.traefik.ports).toEqual(["80:80", "443:443"]);
    expect(compose.networks.stoky?.internal).toBe(true);
    expect(compose.services.db.networks).toEqual(["stoky"]);
    expect(compose.services.cache.networks).toEqual(["stoky"]);
    expect(compose.services.app.environment?.VALKEY_URL).toBe("redis://cache:6379");
  });

  it("preserves the read-only application and service resource limits", () => {
    for (const service of Object.values(compose.services)) {
      expect(service.cap_drop).toEqual(["ALL"]);
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.restart).toBe("unless-stopped");
      expect(service.deploy.resources.limits.memory).toMatch(/^\d+[mg]$/);
    }
    expect(compose.services.app.read_only).toBe(true);
    expect(compose.services.traefik.read_only).toBe(true);
    expect(compose.services.app.tmpfs).toEqual(["/tmp", "/app/.next/cache"]);
    expect(compose.services.app.volumes).toContain("uploads:/app/uploads");
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
    const bound = mebibytes(cache.command![2]!, { mb: 1, gb: 1024, m: 1e6 / 2 ** 20, g: 1e9 / 2 ** 20 });
    const limit = mebibytes(cache.deploy.resources.limits.memory, { m: 1, g: 1024 });
    // Headroom for the copy-on-write of a background save, which the cgroup
    // counts and maxmemory does not.
    expect(bound).toBeLessThanOrEqual(limit * 0.75);
  });

  it("caps how many processes each service may start, without a CPU limit small hosts would refuse", () => {
    // A fork loop or a runaway thread pool stops at its container's ceiling
    // instead of exhausting the host's process table. Ceilings, not sizing:
    // five to ten times the peak measured under load.
    const limits = Object.fromEntries(
      Object.entries(compose.services).map(([name, service]) => [name, service.deploy.resources.limits]),
    );
    // Strict: toEqual ignores an undefined value, so a new service without a
    // pids entry would pass it.
    expect(Object.fromEntries(Object.entries(limits).map(([name, limit]) => [name, limit.pids]))).toStrictEqual({
      db: 256,
      cache: 128,
      app: 512,
      traefik: 128,
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
    expect(Object.keys(compose.services).sort()).toEqual(["app", "cache", "db", "traefik"]);
    for (const [name, service] of Object.entries(compose.services)) {
      // The driver is named beside its options: under a daemon-wide default
      // such as journald, a bare max-size stops the container from starting.
      expect({ name, logging: service.logging }).toEqual({
        name,
        logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "5" } },
      });
    }
  });

  it("routes HTTPS to the application without Docker discovery privileges", () => {
    const traefik = compose.services.traefik;
    expect(traefik.command).toContain("--providers.file.filename=/etc/traefik/dynamic.yml");
    expect(traefik.command?.some((flag) => flag.startsWith("--providers.docker"))).toBe(false);
    expect(traefik.configs).toContainEqual({
      source: "traefik_dynamic",
      target: "/etc/traefik/dynamic.yml",
    });
    const dynamic = Bun.YAML.parse(
      readFileSync(join(root, "deploy", compose.configs.traefik_dynamic.file), "utf8"),
    ) as {
      http: {
        routers: Record<string, { rule: string; service: string; entryPoints: string[]; tls: { certResolver: string } }>;
        services: Record<string, { loadBalancer: { servers: { url: string }[] } }>;
      };
    };
    const router = dynamic.http.routers.stoky;
    const host = traefik.environment!.DOMAIN;
    expect(compose.services.app.environment!.NEXTAUTH_URL).toBe(`https://${host}`);
    expect(router.rule).toBe('Host(`{{ env "DOMAIN" }}`)');
    expect(router.entryPoints).toEqual(["websecure"]);
    expect(router.tls.certResolver).toBe("letsencrypt");
    expect(dynamic.http.services[router.service].loadBalancer.servers).toEqual([
      { url: "http://app:3000" },
    ]);
  });

  it("closes idle client connections after 60s and keeps the whole-request read at 60s", () => {
    // Traefik's default idleTimeout holds a quiet keep-alive connection for
    // 180s. readTimeout covers the request body too, so shortening it would cut
    // off a 10 MiB receipt on a slow uplink. Exact list: a writeTimeout added
    // here would cut off streamed tRPC batches, and should be a decision.
    // Traefik's flag names are case-insensitive, so compare them lowercased.
    const transport = (compose.services.traefik.command ?? [])
      .map((flag) => flag.toLowerCase())
      .filter((flag) => flag.includes(".transport."));
    expect(transport).toEqual(
      ["web", "websecure"].flatMap((entrypoint) => [
        `--entrypoints.${entrypoint}.transport.respondingtimeouts.idletimeout=60s`,
        `--entrypoints.${entrypoint}.transport.respondingtimeouts.readtimeout=60s`,
      ]),
    );
  });

  it("does not let Traefik contact Traefik Labs", () => {
    // checkNewVersion defaults to true and reveals the instance's address to the
    // vendor; sendAnonymousUsage defaults to false and is pinned so a new
    // default cannot turn it on. Exact list, so a second, contradicting flag
    // fails too; lowercased because Traefik's flag names are case-insensitive.
    const global = (compose.services.traefik.command ?? [])
      .map((flag) => flag.toLowerCase())
      .filter((flag) => flag.startsWith("--global."));
    expect(global).toEqual([
      "--global.checknewversion=false",
      "--global.sendanonymoususage=false",
    ]);
  });

  it("accepts TLS 1.2 or later, and only forward-secret AEAD suites at 1.2", () => {
    const dynamic = Bun.YAML.parse(
      readFileSync(join(root, "deploy", compose.configs.traefik_dynamic.file), "utf8"),
    ) as { tls?: { options?: Record<string, unknown> } };
    // The whole object, so neither sniStrict (a handshake failure for every
    // client until ACME issues) nor curvePreferences (drops Go's post-quantum
    // X25519MLKEM768) can arrive unnoticed. Go's defaults, which an absent block
    // leaves in force, accept ECDHE-RSA-AES128-SHA at TLS 1.2.
    expect(dynamic.tls?.options).toEqual({
      default: {
        minVersion: "VersionTLS12",
        cipherSuites: [
          "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
          "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
          "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
          "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
          "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
          "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        ],
      },
    });
  });
});
