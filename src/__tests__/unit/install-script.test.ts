import { afterEach, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const script = join(root, "deploy/install.sh");
const version =
  readFileSync(script, "utf8").match(/^DEFAULT_VERSION=(\S+)$/m)?.[1] ?? "";
const files = ["docker-compose.yml", "example.env", "traefik.yml"];
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function sha256(path: string) {
  return new Bun.CryptoHasher("sha256")
    .update(readFileSync(path))
    .digest("hex");
}

// A release served from a directory, built from the repository's own bundle,
// and an empty installation directory beside it.
function setup(options: { volumeExists?: boolean } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-install-"));
  fixtures.push(fixture);
  const release = join(fixture, "release", version);
  const install = join(fixture, "install");
  const bin = join(fixture, "bin");
  for (const directory of [release, install, bin])
    mkdirSync(directory, { recursive: true });
  for (const name of files)
    copyFileSync(join(root, "deploy", name), join(release, name));
  const sums = () =>
    writeFileSync(
      join(release, "SHA256SUMS"),
      files.map((name) => `${sha256(join(release, name))}  ${name}\n`).join(""),
    );
  sums();
  // curl serves the release from the directory, as `--fail` would: the test
  // image has no curl, and what is under test is the script, not curl. Each
  // call's arguments are recorded, one line per call, so a test can see the
  // flags the script passes.
  const curlCalls = join(fixture, "curl-calls");
  writeFileSync(curlCalls, "");
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/bash
printf '%s\\n' "$*" >> "${curlCalls}"
while [ $# -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift ;;
    file://*) source="\${1#file://}" ;;
  esac
  shift
done
[ -f "$source" ] || { echo "curl: (37) Couldn't open file $source" >&2; exit 37; }
cp "$source" "$output"
`,
    { mode: 0o755 },
  );
  // Records every call, so a test can prove nothing was started or pulled.
  const calls = join(fixture, "docker-calls");
  writeFileSync(calls, "");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/bash\necho "$*" >> "${calls}"\n[ "$1 $2" = "volume inspect" ] && exit ${options.volumeExists ? 0 : 1}\nexit 0\n`,
    { mode: 0o755 },
  );
  return {
    release,
    install,
    sums,
    curlCalls: () =>
      readFileSync(curlCalls, "utf8").trim().split("\n").filter(Boolean),
    dockerCalls: () =>
      readFileSync(calls, "utf8").trim().split("\n").filter(Boolean),
    env: () => readFileSync(join(install, ".env"), "utf8"),
    value: (key: string) =>
      readFileSync(join(install, ".env"), "utf8").match(
        new RegExp(`^${key}=(.*)$`, "m"),
      )?.[1],
    mode: (name: string) => statSync(join(install, name)).mode & 0o777,
    // umask 077 is the case that once left Traefik unable to read its routes.
    // `baseUrl: null` leaves the override unset, as an operator's run does.
    run: (
      args: string[] = [],
      {
        baseUrl = `file://${join(fixture, "release")}`,
      }: { baseUrl?: string | null } = {},
    ) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      };
      delete env.STOKY_RELEASE_BASE_URL;
      if (baseUrl !== null) env.STOKY_RELEASE_BASE_URL = baseUrl;
      const result = Bun.spawnSync(
        ["bash", "-c", 'umask 077 && exec bash "$0" "$@"', script, ...args],
        { cwd: install, env },
      );
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    },
  };
}

describe("deploy/install.sh", () => {
  it("names a release version", () => {
    expect(version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("downloads and verifies the release, and writes a .env with two distinct generated secrets", () => {
    const fixture = setup();
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    for (const name of [...files, "SHA256SUMS"]) {
      expect(readFileSync(join(fixture.install, name), "utf8")).toBe(
        readFileSync(join(fixture.release, name), "utf8"),
      );
    }
    const postgres = fixture.value("POSTGRES_PASSWORD");
    const secret = fixture.value("STOKY_SECRET");
    expect(postgres).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(postgres).not.toBe(secret);
    expect(fixture.env()).not.toMatch(/^NEXTAUTH_SECRET=/m);
    expect(fixture.value("STOKY_VERSION")).toBe(version);
    // No default exists for these; the operator fills them in and is told so.
    expect(fixture.value("DOMAIN")).toBe("");
    expect(fixture.value("ACME_EMAIL")).toBe("");
    expect(result.stdout).toContain("DOMAIN ACME_EMAIL");
  });

  it("follows redirects only to https, at TLS 1.2 or later", () => {
    // SHA256SUMS arrives over the same hops as the files: a redirect that
    // dropped to http would let anyone on the path serve both, and pass.
    const fixture = setup();
    expect(fixture.run().exitCode).toBe(0);
    const calls = fixture.curlCalls();
    expect(calls).toHaveLength(files.length + 1);
    for (const call of calls) {
      expect(` ${call} `).toContain(" --proto-redir =https ");
      expect(` ${call} `).toContain(" --tlsv1.2 ");
    }
  });

  it("starts every download from an https URL by default", () => {
    // The redirect rule above is the only protocol restriction the script
    // passes, so the first hop is https only because this URL is.
    const fixture = setup();
    // The stub serves only file://, so the run stops at the first download.
    expect(fixture.run([], { baseUrl: null }).exitCode).not.toBe(0);
    expect(fixture.curlCalls()[0]).toEndWith(
      ` https://github.com/NGarate/stoky/releases/download/${version}/${files[0]}`,
    );
  });

  it("leaves Traefik's file readable and .env private, whatever the umask", () => {
    const fixture = setup();
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.mode("traefik.yml")).toBe(0o644);
    expect(fixture.mode(".env")).toBe(0o600);
  });

  it("never starts, pulls or stops anything", () => {
    const fixture = setup();
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(
      fixture
        .dockerCalls()
        .filter((call) => !call.startsWith("volume inspect")),
    ).toEqual([]);
    expect(result.stdout).toContain("No se ha arrancado nada");
    expect(result.stdout).toContain("docker compose up -d --wait");
  });

  it("changes nothing when run a second time", () => {
    const fixture = setup();
    expect(fixture.run().exitCode).toBe(0);
    const first = fixture.env();
    const again = fixture.run();
    expect(again.exitCode).toBe(0);
    expect(fixture.env()).toBe(first);
    expect(again.stdout).toContain("ya tiene todos los ajustes");
  });

  it("keeps every value an existing .env sets, and adds only what is missing", () => {
    const fixture = setup();
    writeFileSync(
      join(fixture.install, ".env"),
      `STOKY_VERSION=${version}\nDOMAIN=stoky.example.com\nSTOKY_SECRET="kept-as-written-0123456789abcdef0123"\nPOSTGRES_PASSWORD=\n`,
    );
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.value("DOMAIN")).toBe("stoky.example.com");
    expect(fixture.value("STOKY_SECRET")).toBe(
      '"kept-as-written-0123456789abcdef0123"',
    );
    expect(fixture.value("POSTGRES_PASSWORD")).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.value("ACME_EMAIL")).toBe("");
    expect(fixture.env().match(/^POSTGRES_PASSWORD=/gm)).toHaveLength(1);
  });

  it("renames an earlier release's NEXTAUTH_SECRET to STOKY_SECRET, keeping its value", () => {
    // A new secret would sign everybody out and change every account tag in
    // the security log, so the key is renamed and nothing is generated (D137).
    const fixture = setup();
    writeFileSync(
      join(fixture.install, ".env"),
      `STOKY_VERSION=${version}\nDOMAIN=stoky.example.com\nPOSTGRES_PASSWORD=pg\nNEXTAUTH_SECRET="kept"\n`,
    );
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.value("STOKY_SECRET")).toBe('"kept"');
    expect(fixture.env()).not.toMatch(/^NEXTAUTH_SECRET=/m);
    expect(fixture.env().match(/^STOKY_SECRET=/gm)).toHaveLength(1);
    expect(result.stdout).toContain(
      "renombrado NEXTAUTH_SECRET → STOKY_SECRET",
    );
    expect(result.stdout).not.toContain("generado   STOKY_SECRET");
    // Idempotent: a second run has nothing left to rename.
    const renamed = fixture.env();
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.env()).toBe(renamed);
  });

  it("takes the old secret's place when STOKY_SECRET is there but empty", () => {
    // What an operator who copied the new example.env's lines in by hand has.
    const fixture = setup();
    writeFileSync(
      join(fixture.install, ".env"),
      `STOKY_VERSION=${version}\nPOSTGRES_PASSWORD=pg\nSTOKY_SECRET=\nNEXTAUTH_SECRET=kept\n`,
    );
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.value("STOKY_SECRET")).toBe("kept");
    expect(fixture.env().match(/^STOKY_SECRET=/gm)).toHaveLength(1);
    expect(fixture.env()).not.toMatch(/^NEXTAUTH_SECRET=/m);
  });

  it("leaves both lines alone when both are already set", () => {
    // Which one is in use is the application's rule (STOKY_SECRET wins, with a
    // warning); the script does not choose for the operator.
    const fixture = setup();
    writeFileSync(
      join(fixture.install, ".env"),
      `STOKY_VERSION=${version}\nPOSTGRES_PASSWORD=pg\nSTOKY_SECRET=new-one\nNEXTAUTH_SECRET=old-one\n`,
    );
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.value("STOKY_SECRET")).toBe("new-one");
    expect(fixture.value("NEXTAUTH_SECRET")).toBe("old-one");
    expect(result.stdout).not.toContain("renombrado");
  });

  it("refuses a download that does not match its checksum, and writes nothing", () => {
    const fixture = setup();
    writeFileSync(join(fixture.release, "traefik.yml"), "tampered\n");
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("traefik.yml no coincide");
    expect(readdirSync(fixture.install)).toEqual([]);
  });

  it("refuses a SHA256SUMS that leaves a file out", () => {
    const fixture = setup();
    const sums = readFileSync(join(fixture.release, "SHA256SUMS"), "utf8");
    writeFileSync(
      join(fixture.release, "SHA256SUMS"),
      sums
        .split("\n")
        .filter((line) => !line.endsWith("traefik.yml"))
        .join("\n"),
    );
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no incluye traefik.yml");
    expect(readdirSync(fixture.install)).toEqual([]);
  });

  it("refuses to replace an installed file that differs: that is an upgrade", () => {
    const fixture = setup();
    writeFileSync(
      join(fixture.install, "docker-compose.yml"),
      "an older release\n",
    );
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("docker-compose.yml ya existe");
    expect(
      readFileSync(join(fixture.install, "docker-compose.yml"), "utf8"),
    ).toBe("an older release\n");
    expect(existsSync(join(fixture.install, ".env"))).toBe(false);
  });

  it("refuses to invent a database password for a database that already exists", () => {
    const fixture = setup({ volumeExists: true });
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ya existe");
    expect(readdirSync(fixture.install)).toEqual([]);
  });

  it("does not ask about the volume when the password is already set", () => {
    const fixture = setup({ volumeExists: true });
    writeFileSync(
      join(fixture.install, ".env"),
      "POSTGRES_PASSWORD=0123abcd\n",
    );
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.value("POSTGRES_PASSWORD")).toBe("0123abcd");
  });

  for (const tag of ["latest", "v1/../../secret"]) {
    it(`rejects version ${tag}`, () => {
      const fixture = setup();
      const result = fixture.run([tag]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("se esperaba una versión");
      expect(readdirSync(fixture.install)).toEqual([]);
    });
  }
});
