#!/bin/bash

# Checks a running release bundle through its front door: Traefik on ports
# 80/443. Used by the release smoke in CI, and runnable by hand.
#
#   smoke-proxy.sh DOMAIN          a local `docker compose up`: every request
#                                  is sent to 127.0.0.1, whatever DOMAIN
#                                  resolves to, and the certificate is not
#                                  verified (-k) — a smoke host has no public
#                                  DNS, so ACME cannot issue and Traefik serves
#                                  its default certificate.
#   smoke-proxy.sh --live DOMAIN   a real installation, through public DNS, with
#                                  the certificate verified. What the local run
#                                  cannot prove: that the ingress actually in
#                                  front of the app — the operator's network,
#                                  any proxy ahead of Traefik — behaves the same.
#
# **It spends one sign-in window for the address it runs from.** The forwarded-
# header check below fills the per-address sign-in limit on purpose, so for up
# to 15 minutes (RATE_LIMIT_LOGIN_WINDOW_SECONDS) nobody can sign in from that
# address. Harmless in CI; on --live, run it from somewhere other than where
# the household signs in.
set -euo pipefail

LIVE=false
if [ "${1:-}" = "--live" ]; then
  LIVE=true
  shift
fi
DOMAIN="${1:?Usage: smoke-proxy.sh [--live] DOMAIN}"

CURL=(curl --silent --show-error --max-time 10)
if [ "$LIVE" = true ]; then
  # Everything to wherever DOMAIN really resolves, so the off-host requests
  # below reach the same front door without needing their own DNS.
  CURL+=(--connect-to "::$DOMAIN:")
  VERIFY=()
else
  CURL+=(--connect-to "::127.0.0.1:")
  VERIFY=(--insecure)
fi

# Plain HTTP must only redirect.
REDIRECT="$("${CURL[@]}" --output /dev/null --write-out '%{http_code} %{redirect_url}' "http://$DOMAIN/api/health")"
case "$REDIRECT" in
  "301 https://$DOMAIN/api/health" | "302 https://$DOMAIN/api/health" | "307 https://$DOMAIN/api/health" | "308 https://$DOMAIN/api/health") ;;
  *)
    echo "Error: http://$DOMAIN/ should redirect to HTTPS, got: $REDIRECT" >&2
    exit 1
    ;;
esac

# HTTPS for the configured host reaches the application, and the security
# headers survive the proxy. Both the application and Traefik's middleware set
# them, so this cannot tell which one did: it checks what the browser receives.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HEADERS="$WORK/headers"
STATUS="$("${CURL[@]}" "${VERIFY[@]}" --dump-header "$HEADERS" --output /dev/null --write-out '%{http_code}' "https://$DOMAIN/api/health")"
if [ "$STATUS" != 200 ]; then
  echo "Error: https://$DOMAIN/api/health answered $STATUS through Traefik, expected 200." >&2
  cat "$HEADERS" >&2
  exit 1
fi
for header in strict-transport-security x-content-type-options x-frame-options; do
  if ! grep -qi "^$header:" "$HEADERS"; then
    echo "Error: the response through Traefik is missing $header." >&2
    cat "$HEADERS" >&2
    exit 1
  fi
done

# Any other host must not reach the application: the router is Host-scoped.
# Traefik's own refusal is a 404 (or a 421, when it notices the TLS name and
# the Host disagree). Anything else — a 401, a redirect to /login — is a
# response the application wrote, so "not 200" is not enough.
#
# -k on these whatever the mode: an unrouted name gets Traefik's default
# certificate, and what is being proven is the routing, not the certificate.
refused_by_proxy() {
  local what="$1" status="$2"
  case "$status" in
    404 | 421) ;;
    *)
      echo "Error: $what answered $status; only the proxy's own 404/421 proves it did not reach the application." >&2
      exit 1
      ;;
  esac
}

# Another name, in both the TLS handshake and the Host header.
refused_by_proxy "https://other.$DOMAIN/" \
  "$("${CURL[@]}" --insecure --output /dev/null --write-out '%{http_code}' "https://other.$DOMAIN/api/health")"

# The right TLS name with another Host: what a client that controls its own
# headers sends to slip past a router that only looked at the handshake.
refused_by_proxy "https://$DOMAIN/ with Host: other.$DOMAIN" \
  "$("${CURL[@]}" --insecure --header "Host: other.$DOMAIN" --output /dev/null --write-out '%{http_code}' "https://$DOMAIN/api/health")"

# The forwarded-header chain. The per-address sign-in limit counts against the
# last hop of X-Forwarded-For, falling back to X-Real-IP
# (`src/lib/rate-limit.ts`), and that is a client address only if the proxy
# drops what the client sent and writes its own. Every attempt here forges a
# different address in both. Behind a proxy that strips them, the attempts
# share the one real address and the limit refuses once its budget is spent;
# behind one that passes them through, each attempt is a stranger with a fresh
# budget and the refusal never comes.
#
# Malformed credentials, so nothing is looked up and nothing is hashed: the
# limit counts an attempt before it reads one. The outcome is the `code` Auth.js
# puts on the redirect to the sign-in page.
COOKIES="$WORK/cookies"
CSRF="$("${CURL[@]}" "${VERIFY[@]}" --cookie-jar "$COOKIES" "https://$DOMAIN/api/auth/csrf" \
  | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"
if [ -z "$CSRF" ]; then
  echo "Error: https://$DOMAIN/api/auth/csrf returned no CSRF token." >&2
  exit 1
fi

# Well past the default of 5, so an installation that raised its limit still
# fails loudly here rather than passing a check it never reached.
MAX_ATTEMPTS="${SMOKE_MAX_SIGNIN_ATTEMPTS:-20}"
THROTTLED=""
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  FORGED="203.0.113.$attempt"
  LOCATION="$("${CURL[@]}" "${VERIFY[@]}" --cookie "$COOKIES" \
    --header "X-Forwarded-For: $FORGED" --header "X-Real-IP: $FORGED" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=" --data-urlencode "password=" \
    --output /dev/null --write-out '%{redirect_url}' \
    "https://$DOMAIN/api/auth/callback/credentials")"
  case "$LOCATION" in
    "https://$DOMAIN/login?"*"code=rate_limited"*)
      THROTTLED="$attempt"
      break
      ;;
    "https://$DOMAIN/login?"*"code=credentials"*) ;;
    *)
      echo "Error: sign-in attempt $attempt should have been refused as malformed or throttled; it redirected to: ${LOCATION:-nothing}" >&2
      exit 1
      ;;
  esac
done
if [ -z "$THROTTLED" ]; then
  echo "Error: $MAX_ATTEMPTS sign-in attempts, each forging a different X-Forwarded-For and X-Real-IP, were never throttled." >&2
  echo "The proxy is passing client-supplied forwarded headers to the application, so its per-address limit is off for anyone who sends one." >&2
  echo "(Or this installation's RATE_LIMIT_LOGIN_ATTEMPTS is above $MAX_ATTEMPTS: set SMOKE_MAX_SIGNIN_ATTEMPTS higher.)" >&2
  exit 1
fi

echo "Proxy smoke: OK ($DOMAIN; forged forwarded headers ignored, throttled at attempt $THROTTLED)"
