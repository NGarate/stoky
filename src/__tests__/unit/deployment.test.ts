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
  deploy: { resources: { limits: { memory: string } } };
  command?: string[];
  configs?: { source: string; target: string }[];
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
});
