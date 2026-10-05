import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The two development compose files share one project (`stoky`, from the
 * directory name) and the services `db` and `cache`. Compose recreates a
 * container whose definition differs from the running one, so any difference
 * between the files means `bun run test:integration` on the host (which uses
 * docker-compose.dev.yml) recreates the services under the devcontainer's
 * running app (docker-compose.yml), off its network — and back again.
 */

type Compose = {
  services: Record<string, Record<string, unknown>>;
  networks?: Record<string, unknown>;
};

const root = join(import.meta.dir, "../../..");
const read = (file: string) =>
  Bun.YAML.parse(readFileSync(join(root, file), "utf8")) as Compose;

const full = read("docker-compose.yml");
const dev = read("docker-compose.dev.yml");

describe("the development compose files", () => {
  for (const service of ["db", "cache"]) {
    it(`define ${service} identically, so neither recreates the other's`, () => {
      expect(dev.services[service]).toEqual(full.services[service]);
    });
  }

  it("put both on the same network definition", () => {
    expect(dev.networks?.stoky).toEqual(full.networks?.stoky);
  });

  it("publish nothing beyond loopback", () => {
    for (const compose of [full, dev]) {
      for (const service of Object.values(compose.services)) {
        for (const port of (service.ports as string[] | undefined) ?? []) {
          expect(port).toStartWith("127.0.0.1:");
        }
      }
    }
  });
});
