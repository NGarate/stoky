#!/bin/bash
#
# Run a suite inside this project's own development image.
#
# The gates used to run on whatever toolchain the runner had, which is not what
# gets deployed. That gap is not theoretical here: `sharp` on the host decoded
# what `sharp` in the image could not, and an afternoon went into a HEIC
# investigation that ran the wrong way round because of it. A suite that passes
# somewhere nobody deploys proves less than it appears to.
#
# The checkout is mounted over the image's copy of it, and `node_modules` is
# not: an anonymous volume keeps the image's own tree, which is the point —
# those are the native modules production loads, built for this platform.
#
# The mount is not a convenience. `.dockerignore` excludes `.git` and
# `.gitignore`, so inside the bare image oxlint has no ignore file to honour
# and walks into `node_modules` — measured, it dies on
# `node_modules/tesseract.js: Is a directory`. Three unit tests ask git about
# the repository for the same reason. Mounting the workspace gives both what
# they need without loosening what the build context carries.
#
# Usage:
#   scripts/ci-in-image.sh quality
#   scripts/ci-in-image.sh test
#   CHANGED_BASE=<sha> scripts/ci-in-image.sh changed
#
# Environment:
#   CI_NETWORK    Docker network for the container. Defaults to `host`, which
#                 is how a GitHub runner reaches its service containers through
#                 their published ports. Locally, pass the compose network
#                 (`stoky_default`) and address the services by name.
#   CHANGED_BASE  For `changed`: the commit a pull request is compared with.
#                 Its merge base with HEAD has to be in the clone, which is
#                 why the quality job checks out the full history.
#   DATABASE_URL  Passed through. The integration suite needs it; `quality`
#                 does not and does not read it.
#   VALKEY_URL    As above. Locally, give it a spare database index —
#                 `redis://cache:6379/7` — or the rate-limit test fails on
#                 counters left by an earlier run against the shared dev
#                 cache. In CI the services are fresh per job and this does
#                 not arise; measured both ways.

set -euo pipefail

SUITE="${1:-}"
IMAGE_TAG="${IMAGE_TAG:-stoky-dev:ci}"
CI_NETWORK="${CI_NETWORK:-host}"

if [ "$SUITE" != "quality" ] && [ "$SUITE" != "test" ] && [ "$SUITE" != "changed" ]; then
  echo "usage: $0 {quality|test|changed}" >&2
  exit 2
fi
if [ "$SUITE" = "changed" ] && [ -z "${CHANGED_BASE:-}" ]; then
  echo "Error: the changed suite needs CHANGED_BASE, the commit to compare with." >&2
  exit 2
fi

echo "==> Building the development image"
# `--target development`: it adds Bash and Git for the suites, while both
# stages carry the same Bun runtime. It trusts the /app checkout mounted below.
docker build --target development --tag "$IMAGE_TAG" .

case "$SUITE" in
  quality)
    COMMANDS='bun run lint \
      && bun run typecheck \
      && bun run check:react \
      && bun run check:contrast \
      && bun run check:links'
    ;;
  changed)
    # The pull request's own changes, before the whole-project gates: a fast
    # answer about what this change did. It proves nothing on its own — a
    # change can break a file it did not touch — so `quality` still runs.
    # --no-pipeline-lint: this image has no Docker to run actionlint, its
    # bundled shellcheck or zizmor from, and check-ci.sh has already linted
    # every workflow and script on the runner. CHANGED_BASE expands inside the container, which
    # receives it below.
    COMMANDS='bash scripts/check-scope.sh changed --base "$CHANGED_BASE" --no-pipeline-lint'
    ;;
  test)
    # Migrations first, against an empty database. A migration that only works
    # on an already-prepared one is a migration that fails on somebody's first
    # install — which is what happened with pg_trgm.
    #
    # `bunx --bun prisma`, because prisma is a binary rather than a script; and
    # `bun run test:*` rather than `bun test:*`, because the bare form would
    # invoke Bun's own runner and sweep every suite at once.
    COMMANDS='bunx --bun prisma migrate deploy \
      && bun run test:unit \
      && bun run test:components \
      && bun run test:integration:only'
    ;;
esac

echo "==> Running '$SUITE' inside $IMAGE_TAG (network: $CI_NETWORK)"
docker run --rm \
  --network "$CI_NETWORK" \
  --volume "$PWD:/app" \
  --volume /app/node_modules \
  --env "DATABASE_URL=${DATABASE_URL:-}" \
  --env "VALKEY_URL=${VALKEY_URL:-}" \
  --env "CHANGED_BASE=${CHANGED_BASE:-}" \
  --env "STOKY_SECRET=${STOKY_SECRET:-ci-only-not-a-real-secret}" \
  --env "NEXTAUTH_URL=${NEXTAUTH_URL:-http://localhost:3000}" \
  --env CI=true \
  "$IMAGE_TAG" \
  sh -c "$COMMANDS"
