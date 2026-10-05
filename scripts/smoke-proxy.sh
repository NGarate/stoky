#!/bin/bash

# Checks a running release bundle through its front door: Traefik on the
# host's ports 80/443, with DOMAIN resolved to this machine. Used by the release
# smoke in CI, and runnable by hand against a local `docker compose up`.
#
# The certificate is not verified (-k): a smoke host has no public DNS, so ACME
# cannot issue and Traefik serves its default certificate. What this proves is
# the routing — the Host rule rendered from `{{ env "DOMAIN" }}`, the redirect
# and the upstream — not certificate issuance.
set -euo pipefail

DOMAIN="${1:?Usage: smoke-proxy.sh DOMAIN}"
RESOLVE=(--resolve "$DOMAIN:80:127.0.0.1" --resolve "$DOMAIN:443:127.0.0.1")
CURL=(curl --silent --show-error --max-time 10 "${RESOLVE[@]}")

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
HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
STATUS="$("${CURL[@]}" --insecure --dump-header "$HEADERS" --output /dev/null --write-out '%{http_code}' "https://$DOMAIN/api/health")"
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
OTHER="$("${CURL[@]}" --insecure --output /dev/null --write-out '%{http_code}' \
  --resolve "other.$DOMAIN:443:127.0.0.1" "https://other.$DOMAIN/api/health")"
if [ "$OTHER" = 200 ]; then
  echo "Error: a request for other.$DOMAIN reached the application." >&2
  exit 1
fi

echo "Proxy smoke: OK ($DOMAIN)"
