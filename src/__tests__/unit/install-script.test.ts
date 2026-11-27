import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
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
const files = ["docker-compose.yml", "example.env"];
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
function setup(
  options: {
    /** What `id -u` answers: not root unless a test says so. */
    uid?: number;
    /** sudo refuses, as it does without a password or a sudoers entry. */
    sudoRefuses?: boolean;
    /** What `stat` says of data/'s directories: owner and mode, as `%u:%g %a`. */
    stat?: Record<string, string>;
  } = {},
) {
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
    `#!/bin/bash\necho "$*" >> "${calls}"\nexit 0\n`,
    { mode: 0o755 },
  );
  // Giving a directory to another user takes root, which a test has neither
  // on a workstation nor reliably in CI's image, where it is root. So `id`
  // says who the script runs as, `install` creates the directory without
  // its owner, and both it and `sudo` record each call, in order.
  const ownership = join(fixture, "ownership-calls");
  writeFileSync(ownership, "");
  writeFileSync(
    join(bin, "id"),
    `#!/bin/bash\n[ "$1" = -u ] && echo ${options.uid ?? 1000}\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "install"),
    `#!/bin/bash\necho "install $*" >> "${ownership}"\nmkdir -p -m 700 "\${@: -1}"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "sudo"),
    `#!/bin/bash
echo "sudo $*" >> "${ownership}"
${
  options.sudoRefuses
    ? `echo "sudo: a password is required" >&2; exit 1`
    : `exec "$@"`
}
`,
    { mode: 0o755 },
  );
  if (options.stat)
    writeFileSync(
      join(bin, "stat"),
      `#!/bin/bash
case "\${@: -1}" in
${Object.entries(options.stat)
  .map(([dir, answer]) => `  ${dir}) echo "${answer}" ;;`)
  .join("\n")}
  *) exit 1 ;;
esac
`,
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
    ownershipCalls: () =>
      readFileSync(ownership, "utf8").trim().split("\n").filter(Boolean),
    env: () => readFileSync(join(install, ".env"), "utf8"),
    value: (key: string) =>
      readFileSync(join(install, ".env"), "utf8").match(
        new RegExp(`^${key}=(.*)$`, "m"),
      )?.[1],
    mode: (name: string) => statSync(join(install, name)).mode & 0o777,
    // Under umask 077, the strictest an operator's shell is likely to have,
    // unless a test says otherwise. `baseUrl: null` leaves the override
    // unset, as an operator's run does.
    run: (
      args: string[] = [],
      {
        baseUrl = `file://${join(fixture, "release")}`,
        umask = "077",
      }: { baseUrl?: string | null; umask?: string } = {},
    ) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      };
      delete env.STOKY_RELEASE_BASE_URL;
      if (baseUrl !== null) env.STOKY_RELEASE_BASE_URL = baseUrl;
      const result = Bun.spawnSync(
        [
          "bash",
          "-c",
          `umask ${umask} && exec bash "$0" "$@"`,
          script,
          ...args,
        ],
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
    // No default exists for it; the operator fills it in and is told so, and
    // told that TLS is their proxy's: nothing here asks for a certificate.
    expect(fixture.value("DOMAIN")).toBe("");
    expect(fixture.env()).not.toContain("ACME_EMAIL");
    expect(result.stdout).toContain("rellena: DOMAIN\n");
    expect(result.stdout).toContain("STOKY_TRUSTED_PROXIES");
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
      ` https://github.com/nogcode/stoky/releases/download/${version}/${files[0]}`,
    );
  });

  it("leaves .env private, whatever the umask", () => {
    const fixture = setup();
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.mode(".env")).toBe(0o600);
  });

  it("never starts, pulls or stops anything", () => {
    const fixture = setup();
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.dockerCalls()).toEqual([]);
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
    expect(fixture.env().match(/^POSTGRES_PASSWORD=/gm)).toHaveLength(1);
  });

  it("generates STOKY_SECRET beside the name it had before the rename, and leaves that line alone", () => {
    const fixture = setup();
    writeFileSync(
      join(fixture.install, ".env"),
      `STOKY_VERSION=${version}\nPOSTGRES_PASSWORD=pg\nNEXTAUTH_SECRET=old-one\n`,
    );
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.value("STOKY_SECRET")).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.value("NEXTAUTH_SECRET")).toBe("old-one");
    expect(result.stdout).not.toContain("renombrado");
  });

  it("refuses a download that does not match its checksum, and writes nothing", () => {
    const fixture = setup();
    writeFileSync(join(fixture.release, "example.env"), "tampered\n");
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("example.env no coincide");
    expect(readdirSync(fixture.install)).toEqual([]);
  });

  it("refuses a SHA256SUMS that leaves a file out", () => {
    const fixture = setup();
    const sums = readFileSync(join(fixture.release, "SHA256SUMS"), "utf8");
    writeFileSync(
      join(fixture.release, "SHA256SUMS"),
      sums
        .split("\n")
        .filter((line) => !line.endsWith("example.env"))
        .join("\n"),
    );
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no incluye example.env");
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

  it("refuses to invent a database password where a database directory already exists", () => {
    // Empty here, and still refused: once PostgreSQL's user owns it, the
    // script cannot look inside, and a fresh password over an existing
    // database locks the application out of it.
    const fixture = setup();
    mkdirSync(join(fixture.install, "data/postgres"), { recursive: true });
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("data/postgres ya existe");
    expect(readdirSync(fixture.install)).toEqual(["data"]);
    expect(readdirSync(join(fixture.install, "data"))).toEqual(["postgres"]);
  });

  it("refuses just the same when .env is there but leaves the password empty", () => {
    const fixture = setup();
    mkdirSync(join(fixture.install, "data/postgres"), { recursive: true });
    writeFileSync(join(fixture.install, ".env"), "POSTGRES_PASSWORD=\n");
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("data/postgres ya existe");
    expect(fixture.env()).toBe("POSTGRES_PASSWORD=\n");
  });

  it("keeps the database directory and its password when the password is already set", () => {
    const fixture = setup();
    mkdirSync(join(fixture.install, "data/postgres"), { recursive: true });
    writeFileSync(
      join(fixture.install, ".env"),
      "POSTGRES_PASSWORD=0123abcd\n",
    );
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.value("POSTGRES_PASSWORD")).toBe("0123abcd");
  });

  it("creates data/ and backups/ closed to every other user, whatever the umask", () => {
    const fixture = setup();
    expect(fixture.run([], { umask: "000" }).exitCode).toBe(0);
    expect(fixture.mode("data")).toBe(0o700);
    expect(fixture.mode("backups")).toBe(0o700);
  });

  it("closes a data/ that already exists open to other users", () => {
    // A disk mounted at ./data, or a `mkdir data` under umask 022: the mode
    // of data/ is what keeps a host account sharing a container's uid out.
    const fixture = setup();
    mkdirSync(join(fixture.install, "data"), { mode: 0o755 });
    chmodSync(join(fixture.install, "data"), 0o755);
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.mode("data")).toBe(0o700);
  });

  it("gives the database to PostgreSQL's user and the receipts to the app's, through sudo when not root", () => {
    const fixture = setup();
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.ownershipCalls()).toEqual([
      "sudo install -d -m 00700 -o 70 -g 70 data/postgres",
      "install -d -m 00700 -o 70 -g 70 data/postgres",
      "sudo install -d -m 00700 -o 1000 -g 1000 data/uploads",
      "install -d -m 00700 -o 1000 -g 1000 data/uploads",
    ]);
    expect(result.stdout).toContain("se pide con sudo");
  });

  it("gives them away itself when run as root", () => {
    const fixture = setup({ uid: 0 });
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.ownershipCalls()).toEqual([
      "install -d -m 00700 -o 70 -g 70 data/postgres",
      "install -d -m 00700 -o 1000 -g 1000 data/uploads",
    ]);
    expect(result.stdout).not.toContain("sudo");
  });

  it("stops with what to run as root when sudo refuses, keeping the .env it wrote", () => {
    const fixture = setup({ sudoRefuses: true });
    const result = fixture.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "  install -d -m 00700 -o 70 -g 70 data/postgres\n  install -d -m 00700 -o 1000 -g 1000 data/uploads\n",
    );
    expect(fixture.value("POSTGRES_PASSWORD")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves alone directories that already belong to their containers' users", () => {
    // What a second run finds: nothing to give away, and no sudo prompt.
    const fixture = setup({
      stat: { "data/postgres": "70:70 700", "data/uploads": "1000:1000 700" },
    });
    mkdirSync(join(fixture.install, "data/postgres"), { recursive: true });
    mkdirSync(join(fixture.install, "data/uploads"), { recursive: true });
    writeFileSync(
      join(fixture.install, ".env"),
      "POSTGRES_PASSWORD=0123abcd\n",
    );
    const result = fixture.run();
    expect(result.exitCode).toBe(0);
    expect(fixture.ownershipCalls()).toEqual([]);
    expect(result.stdout).toContain("conservado data/postgres (70:70)");
    expect(result.stdout).toContain("conservado data/uploads (1000:1000)");
  });

  it("gives a directory its mode back when only the mode is wrong", () => {
    // Copying a Docker volume's contents in with `cp -a /from/. /to/` brings
    // the volume root's mode along: PostgreSQL's image leaves it 1777.
    const fixture = setup({
      stat: { "data/postgres": "70:70 1777", "data/uploads": "1000:1000 700" },
    });
    mkdirSync(join(fixture.install, "data/postgres"), { recursive: true });
    mkdirSync(join(fixture.install, "data/uploads"), { recursive: true });
    writeFileSync(
      join(fixture.install, ".env"),
      "POSTGRES_PASSWORD=0123abcd\n",
    );
    expect(fixture.run().exitCode).toBe(0);
    expect(fixture.ownershipCalls()).toEqual([
      "sudo install -d -m 00700 -o 70 -g 70 data/postgres",
      "install -d -m 00700 -o 70 -g 70 data/postgres",
    ]);
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
