#!/bin/bash

# The dependency audit, for running locally: `bun audit --audit-level moderate`
# with one difference — an advisory endpoint it cannot reach is a skip, not a
# failure.
#
# Unlike every other check here, the audit has to reach the network: it sends
# package names and versions to the npm advisory endpoint. Those are the public
# names of public packages, which is why that is acceptable where React
# Doctor's Socket.dev upload was not. But it makes this the one check that
# fails offline, and `bun audit` says so with the same exit status it uses for
# a vulnerable tree. Offline is not a finding, so it exits 75 (EX_TEMPFAIL)
# instead, and verify-local.sh and check-scope.sh report "skipped: offline".
#
# CI's `audit` job calls `bun audit` directly and does not come through here:
# there, an endpoint that cannot be reached must fail the gate.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

code=0
bun audit --audit-level moderate 2>&1 | tee "$OUTPUT_FILE" || code=${PIPESTATUS[0]}

# Measured offline (unshare -rn), Bun 1.4.2:
#   error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - DNSResolveFailed
if [ "$code" -ne 0 ] && grep -q '^error: POST .*/security/advisories/bulk' "$OUTPUT_FILE"; then
  echo "Dependency audit skipped: offline, the advisory endpoint could not be reached." >&2
  exit 75
fi
exit "$code"
