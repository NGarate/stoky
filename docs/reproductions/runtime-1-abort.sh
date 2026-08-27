#!/usr/bin/env bash
#
# A self-contained reproduction of ISSUES.md RUNTIME-1's `AbortError` half.
#
# **The claim.** Serving Next 16.3's standalone output with `bun` raises one
# unhandled `AbortError` per *completed* request carrying
# `Next-Router-Prefetch: 3`. `node` serving the identical artefact raises none.
#
# **`experimental.partialPrefetching` is not required**, and that was measured
# rather than assumed — this script reproduces on a build with the option
# removed. What the option decides is whether a *browser* ever sends that
# header: with it on the router sends kind `3`, with it off it sends kind `1`
# and the server raises nothing. So the option governs the client, and the
# defect is in the server either way. A maintainer needs no config to see it.
#
# **Not part of any suite**, like `test-5.test.ts` beside it. Run it by hand:
#
#     set -a; . ./.env; set +a
#     bash docs/reproductions/runtime-1-abort.sh
#
# It needs a built standalone artefact (`pnpm build`), a reachable PostgreSQL
# and Valkey, and both runtimes on PATH. It builds nothing: a build inside a
# measurement hides what is being measured.
#
# ## Four things this script does that four earlier probes did not
#
# Every one of them produced a confident wrong answer first, and they are all
# `docs/STATUS.md` trap 9 wearing a different face.
#
# 1. **It follows redirects.** `/inventory` answers 307 to a prefetch, and
#    `curl` without `-L` stops there having rendered nothing. Every earlier
#    `curl` probe reported 0 for this reason alone.
# 2. **It waits on the HTTP status, not on curl's exit code.** A 500 satisfies
#    `curl -s -o /dev/null` exactly as well as a 200 does — which is how a
#    server that was listening and refusing to render read as a working one.
# 3. **It checks the server it started is the server answering.** A port held
#    by somebody else's process answers 200 while yours exits with EADDRINUSE,
#    and then every count comes from a log nothing wrote.
# 4. **It supplies a real secret.** `src/lib/auth/secret.ts` refuses to start on
#    fewer than 32 characters, and a refusing server counts zero of everything.
#
# ## What a run looks like
#
#     bun   : 10 AbortError(s) for 10 prefetch requests
#     node  :  0 AbortError(s) for 10 prefetch requests
#
# Exits non-zero if that shape does not hold, so it is a check rather than a
# printout.

set -euo pipefail

REQUESTS="${REQUESTS:-10}"
ROUTE="${ROUTE:-/inventory}"
ARTEFACT=".next/standalone/server.js"

fail() {
  echo "runtime-1-abort: $1" >&2
  exit 1
}

[ -f "$ARTEFACT" ] || fail "no standalone build at $ARTEFACT — run 'pnpm build' first"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is unset — 'set -a; . ./.env; set +a'"
[ -n "${VALKEY_URL:-}" ] || fail "VALKEY_URL is unset — 'set -a; . ./.env; set +a'"
command -v bun >/dev/null || fail "bun is not on PATH"
command -v node >/dev/null || fail "node is not on PATH"

# The standalone output deliberately excludes these; the Dockerfile copies them
# in the same way.
[ -d ".next/standalone/.next/static" ] || cp -r .next/static .next/standalone/.next/static
[ -d ".next/standalone/public" ] || cp -r public .next/standalone/public

# 32 characters minimum, or the server binds the port and then refuses every
# render — see the header.
SECRET="$(openssl rand -base64 32)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A port nothing already holds. Answering is not proof of being yours.
free_port() {
  local port
  for port in $(seq 4100 4160); do
    if ! ss -ltn 2>/dev/null | grep -q ":${port} "; then
      echo "$port"
      return 0
    fi
  done
  fail "no free port in 4100-4160"
}

# Serves the artefact under $1 and prints how many AbortErrors $REQUESTS
# completed prefetches produce.
measure() {
  local runtime="$1"
  local port log pid code
  port="$(free_port)"
  log="$WORK/$runtime.log"

  DATABASE_URL="$DATABASE_URL" \
  VALKEY_URL="$VALKEY_URL" \
  NODE_ENV=production \
  PORT="$port" \
  HOSTNAME=127.0.0.1 \
  NEXTAUTH_SECRET="$SECRET" \
  NEXTAUTH_URL="http://127.0.0.1:$port" \
    "$runtime" "$ARTEFACT" >"$log" 2>&1 &
  pid=$!

  # Wait on the *status*, not on curl's exit code, and give up rather than spin.
  local waited=0
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$port/login" 2>/dev/null || true)"
    [ "$code" = "200" ] && break
    waited=$((waited + 1))
    [ "$waited" -gt 60 ] && { kill "$pid" 2>/dev/null || true; fail "$runtime never served 200 — see $log"; }
    sleep 1
  done

  # And confirm the process we started is the one answering.
  grep -q "Ready" "$log" || { kill "$pid" 2>/dev/null || true; fail "$runtime printed no ready line — port taken? see $log"; }

  local before after i
  before="$(grep -c "AbortError" "$log" || true)"
  for i in $(seq 1 "$REQUESTS"); do
    # -L, because a prefetch to a dashboard route answers 307 and the redirect
    # is where the render — and the rejection — happens.
    curl -sL -o /dev/null -m 20 \
      -H 'RSC: 1' -H 'Next-Router-Prefetch: 3' \
      "http://127.0.0.1:$port$ROUTE?_rsc=repro$i" || true
  done
  sleep 3
  after="$(grep -c "AbortError" "$log" || true)"

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  echo "$((after - before))"
}

echo "runtime-1-abort: $REQUESTS prefetch requests to $ROUTE, per runtime"
BUN_COUNT="$(measure bun)"
printf 'bun   : %2s AbortError(s) for %s prefetch requests\n' "$BUN_COUNT" "$REQUESTS"
NODE_COUNT="$(measure node)"
printf 'node  : %2s AbortError(s) for %s prefetch requests\n' "$NODE_COUNT" "$REQUESTS"

if [ "$BUN_COUNT" -gt 0 ] && [ "$NODE_COUNT" -eq 0 ]; then
  echo "runtime-1-abort: reproduced — the runtime is the only variable"
  exit 0
fi

echo "runtime-1-abort: NOT the shape RUNTIME-1 describes." >&2
echo "  Expected bun > 0 and node = 0." >&2
echo "  Both 0 would mean the defect is fixed, or that $ROUTE stopped" >&2
echo "  rendering — try a different dashboard route. It does NOT mean" >&2
echo "  partialPrefetching is off: this reproduces without it." >&2
exit 1
