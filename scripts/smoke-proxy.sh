#!/bin/bash

# Checks an installation through its front door: your reverse proxy, at the
# name people type, with the certificate verified.
#
#   smoke-proxy.sh --live DOMAIN
#
# The release bundle ships no proxy, so no release can test yours. This asks
# of it the three things an installation depends on (docs/INSTALL.md, "Your
# proxy"):
#
#   1. Plain http://DOMAIN never serves the application: it redirects to
#      https, or does not answer at all (`tailscale serve` opens no port 80).
#   2. https://DOMAIN reaches the application, with a certificate this machine
#      trusts and the application's security headers intact.
#   3. A forged X-Forwarded-For does not buy a fresh sign-in budget. This is
#      the one that fails quietly: a proxy that passes the client's header on,
#      or a STOKY_TRUSTED_PROXIES wider than the proxy, and the per-address
#      sign-in limit is off for anyone who sends one.
#
# Run it from another network than the server's, so that it arrives the way a
# stranger does. It needs bash and curl, nothing of Stoky's.
#
# **It spends one sign-in window for the address it runs from.** Check 3 fills
# the per-address sign-in limit on purpose, so for up to 15 minutes
# (RATE_LIMIT_LOGIN_WINDOW_SECONDS) nobody can sign in from that address. Run
# it from somewhere other than where the household signs in.
set -euo pipefail

if [ "${1:-}" != "--live" ] || [ -z "${2:-}" ]; then
  echo "Usage: smoke-proxy.sh --live DOMAIN" >&2
  echo "It signs in wrongly on purpose until it is refused: for up to 15 minutes afterwards nobody signs in from this address." >&2
  exit 2
fi
DOMAIN="$2"

CURL=(curl --silent --show-error --max-time 10)
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HEADERS="$WORK/headers"

# 1. Plain HTTP. `000` is curl's status for no answer at all, which is as good
# as a redirect: nothing was served. Anything the application wrote is not.
REDIRECT="$("${CURL[@]}" --output /dev/null --write-out '%{http_code} %{redirect_url}' "http://$DOMAIN/api/health" 2> /dev/null || true)"
case "$REDIRECT" in
  "000 "*) ;;
  "301 https://$DOMAIN/"* | "302 https://$DOMAIN/"* | "307 https://$DOMAIN/"* | "308 https://$DOMAIN/"*) ;;
  *)
    echo "Error: http://$DOMAIN/api/health should redirect to https://$DOMAIN/ or not answer; it answered: $REDIRECT" >&2
    exit 1
    ;;
esac

# 2. HTTPS reaches the application, certificate verified, and what the browser
# receives still carries the headers the application set.
STATUS="$("${CURL[@]}" --dump-header "$HEADERS" --output /dev/null --write-out '%{http_code}' "https://$DOMAIN/api/health")"
if [ "$STATUS" != 200 ]; then
  echo "Error: https://$DOMAIN/api/health answered $STATUS, expected 200." >&2
  cat "$HEADERS" >&2
  exit 1
fi
for header in strict-transport-security x-content-type-options x-frame-options content-security-policy; do
  if ! grep -qi "^$header:" "$HEADERS"; then
    echo "Error: the response from https://$DOMAIN/ is missing $header; your proxy is removing a header the application sets." >&2
    cat "$HEADERS" >&2
    exit 1
  fi
done

# 3. The forwarded-header chain. The per-address sign-in limit counts against
# the client address the application settles on: the peer, or what a proxy in
# STOKY_TRUSTED_PROXIES said (`src/server/http/trusted-proxies.ts`). Every
# attempt here forges a different address. When the proxy writes its own
# X-Forwarded-For and only the proxy is trusted, the attempts share this
# machine's one real address and the limit refuses once its budget is spent.
# When the forged header is believed, each attempt is a stranger with a fresh
# budget and the refusal never comes.
#
# Malformed credentials — no address — so nothing is looked up and nothing is
# hashed: the limit counts an attempt before it reads one, and the auth API
# answers 400 INVALID_REQUEST until the budget is spent, then 429 RATE_LIMITED
# with Retry-After (src/server/http/auth-handler.ts). A JSON POST with no
# cookie, as a native client sends one: no Origin is needed without a cookie.
#
# Well past the default of 5, so an installation that raised its limit still
# fails loudly here rather than passing a check it never reached.
MAX_ATTEMPTS="${SMOKE_MAX_SIGNIN_ATTEMPTS:-20}"
THROTTLED=""
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  FORGED="203.0.113.$attempt"
  STATUS="$("${CURL[@]}" \
    --header "X-Forwarded-For: $FORGED" --header "X-Real-IP: $FORGED" \
    --header "Content-Type: application/json" \
    --data '{"email":"","password":""}' \
    --dump-header "$HEADERS" --output "$WORK/signin-body" --write-out '%{http_code}' \
    "https://$DOMAIN/api/auth/sign-in/email")"
  case "$STATUS" in
    429)
      if ! grep -q '"code":"RATE_LIMITED"' "$WORK/signin-body"; then
        echo "Error: sign-in attempt $attempt was throttled, but not by Stoky's per-address limit: $(cat "$WORK/signin-body")" >&2
        exit 1
      fi
      if ! grep -qi '^retry-after: [0-9]' "$HEADERS"; then
        echo "Error: sign-in attempt $attempt was throttled without a Retry-After header." >&2
        exit 1
      fi
      THROTTLED="$attempt"
      break
      ;;
    400) ;;
    *)
      echo "Error: sign-in attempt $attempt should have been refused as malformed (400) or throttled (429); it answered ${STATUS:-nothing}: $(cat "$WORK/signin-body" 2> /dev/null)" >&2
      exit 1
      ;;
  esac
done
if [ -z "$THROTTLED" ]; then
  echo "Error: $MAX_ATTEMPTS sign-in attempts, each forging a different X-Forwarded-For, were never throttled." >&2
  echo "Stoky is believing an address the client wrote, so its per-address limit is off for anyone who sends one. Either" >&2
  echo "your proxy passes the client's X-Forwarded-For on instead of writing its own (nginx does unless told otherwise)," >&2
  echo "or STOKY_TRUSTED_PROXIES lists more than your proxy. See \"Your proxy\" in docs/INSTALL.md." >&2
  echo "(Or this installation's RATE_LIMIT_LOGIN_ATTEMPTS is above $MAX_ATTEMPTS: set SMOKE_MAX_SIGNIN_ATTEMPTS higher.)" >&2
  exit 1
fi

echo "Proxy smoke: OK ($DOMAIN; forged forwarded headers ignored, throttled at attempt $THROTTLED)"
