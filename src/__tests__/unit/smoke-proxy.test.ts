import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/smoke-proxy.sh --live DOMAIN` is the operator's check of their own
 * reverse proxy, the one thing no release can test for them. These run it
 * against a stub `curl` that answers as an installation would — the script,
 * not curl or a proxy, is what is under test. It was also run for real on
 * 2026-11-13, against the bundle behind Caddy with TLS and behind four
 * proxies broken on purpose (`docs/STATUS.md`).
 */

const root = join(import.meta.dir, "..", "..", "..");
const script = join(root, "scripts/smoke-proxy.sh");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

const APP_HEADERS = [
  "strict-transport-security: max-age=63072000; includeSubDomains",
  "x-content-type-options: nosniff",
  "x-frame-options: DENY",
  "content-security-policy: default-src 'self'",
];

interface Installation {
  /** What plain http answers, as curl's `%{http_code} %{redirect_url}`. */
  http?: string;
  health?: string;
  headers?: string[];
  /** The proxy passes the client's X-Forwarded-For on, and it is believed. */
  believesForged?: boolean;
  /** What a refusal past the limit looks like. */
  refusal?: { body: string; headers: string[] };
}

function run(installation: Installation = {}, args = ["--live", "stoky.test"]) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-smoke-proxy-"));
  fixtures.push(fixture);
  const bin = join(fixture, "bin");
  const state = join(fixture, "state");
  mkdirSync(bin);
  mkdirSync(state);
  const refusal = installation.refusal ?? {
    body: '{"code":"RATE_LIMITED","message":"Too many attempts"}',
    headers: ["retry-after: 900"],
  };
  // Five attempts per address, as the application's default: the sixth from
  // one address is refused. A forged address that is believed is its own.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/bash
url="\${@: -1}"
forged=""
while [ $# -gt 1 ]; do
  case "$1" in
    --dump-header) headers="$2"; shift ;;
    --output) output="$2"; shift ;;
    --header) case "$2" in "X-Forwarded-For: "*) forged="\${2#X-Forwarded-For: }" ;; esac; shift ;;
  esac
  shift
done
case "$url" in
  http://*)
    printf '%s' "$STUB_HTTP"
    [ "\${STUB_HTTP%% *}" = 000 ] && exit 7
    ;;
  https://stoky.test/api/health)
    printf '%s\\n' "$STUB_HEADERS" > "$headers"
    printf '%s' "$STUB_HEALTH"
    ;;
  https://stoky.test/api/auth/sign-in/email)
    key=everyone
    [ "$STUB_BELIEVES_FORGED" = 1 ] && key="\${forged:-everyone}"
    echo attempt >> "${state}/$key"
    if [ "$(wc -l < "${state}/$key")" -gt 5 ]; then
      printf '%s\\n' "$STUB_REFUSAL_HEADERS" > "$headers"
      printf '%s' "$STUB_REFUSAL_BODY" > "$output"
      printf 429
    else
      printf '{"code":"INVALID_REQUEST"}' > "$output"
      printf 400
    fi
    ;;
  *) exit 6 ;;
esac
`,
    { mode: 0o755 },
  );
  const result = Bun.spawnSync(["bash", script, ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_HTTP: installation.http ?? "308 https://stoky.test/api/health",
      STUB_HEALTH: installation.health ?? "200",
      STUB_HEADERS: (installation.headers ?? APP_HEADERS).join("\n"),
      STUB_BELIEVES_FORGED: installation.believesForged ? "1" : "0",
      STUB_REFUSAL_BODY: refusal.body,
      STUB_REFUSAL_HEADERS: refusal.headers.join("\n"),
    },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("smoke-proxy.sh --live", () => {
  it("passes a proxy that redirects http, keeps the headers and writes its own X-Forwarded-For", () => {
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // Five attempts are the budget, so the sixth is the first refused: all
    // twenty forged addresses were counted as one client.
    expect(result.stdout).toContain("throttled at attempt 6");
  });

  it("fails a proxy that passes a forged X-Forwarded-For on to an application that believes it", () => {
    const result = run({ believesForged: true });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("were never throttled");
    expect(result.stderr).toContain("STOKY_TRUSTED_PROXIES");
    expect(result.stdout).toBe("");
  });

  it("accepts a front door with no port 80 at all, as tailscale serve has", () => {
    expect(run({ http: "000 " }).exitCode).toBe(0);
  });

  it("fails when plain http serves the application", () => {
    const result = run({ http: "200 " });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("should redirect to https://stoky.test/");
  });

  it("fails when http redirects somewhere else", () => {
    expect(
      run({ http: "308 https://elsewhere.test/api/health" }).exitCode,
    ).toBe(1);
  });

  it("fails when https does not reach a healthy application", () => {
    const result = run({ health: "502" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("answered 502, expected 200");
  });

  it.each(APP_HEADERS.map((header) => header.split(":")[0]))(
    "fails when the proxy drops %s",
    (name) => {
      const result = run({
        headers: APP_HEADERS.filter((header) => !header.startsWith(name)),
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`is missing ${name}`);
    },
  );

  it("does not take somebody else's 429 for the application's limit", () => {
    // A proxy's or a CDN's own rate limit would refuse the forged attempts
    // too, and prove nothing about whose address the application counted.
    const result = run({
      refusal: { body: "Too Many Requests", headers: ["retry-after: 1"] },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not by Stoky's per-address limit");
  });

  it("fails a refusal that does not say how long to wait", () => {
    const result = run({
      refusal: { body: '{"code":"RATE_LIMITED"}', headers: ["x-other: 1"] },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without a Retry-After header");
  });

  it("asks for --live, and says what running it costs, before sending anything", () => {
    for (const args of [
      [],
      ["stoky.test"],
      ["--live"],
      ["--local", "stoky.test"],
    ]) {
      const result = run({}, args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Usage: smoke-proxy.sh --live DOMAIN");
      expect(result.stderr).toContain("15 minutes");
    }
  });
});
