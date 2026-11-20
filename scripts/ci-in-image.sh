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
# `src/generated` is kept the same way: the Prisma client the image's own
# `prisma generate` wrote, which a CI checkout does not have (it is ignored)
# and which generating here would write into the checkout as root.
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
#   scripts/ci-in-image.sh test                # unit, components, integration
#   scripts/ci-in-image.sh test integration    # one of them, as CI runs it
#
# Environment:
#   CI_NETWORK    Docker network for the container. Defaults to `host`, which
#                 is how a GitHub runner reaches its service containers through
#                 their published ports. Locally, pass the compose network
#                 (`stoky_default`) and address the services by name.
#   DATABASE_URL  Passed through. The integration suite needs it; `quality`
#                 does not and does not read it.
#   VALKEY_URL    As above. Locally, give it a spare database index —
#                 `redis://cache:6379/7` — or the rate-limit test fails on
#                 counters left by an earlier run against the shared dev
#                 cache. In CI the services are fresh per job and this does
#                 not arise; measured both ways.
#   TEST_REPORTS  For `test`: an absolute directory that each suite also
#                 writes a JUnit report into, `<suite>.xml`, for
#                 scripts/junit-summary.ts. Unset, none is written. CI sets
#                 it outside the checkout, since the container writes as root.

set -euo pipefail

SUITE="${1:-}"
PART="${2:-}"
IMAGE_TAG="${IMAGE_TAG:-stoky-dev:ci}"
CI_NETWORK="${CI_NETWORK:-host}"

USAGE="usage: $0 {quality|test [unit|components|integration]}"
if [ "$SUITE" != "quality" ] && [ "$SUITE" != "test" ]; then
  echo "$USAGE" >&2
  exit 2
fi
case "$SUITE:$PART" in
  test: | test:unit | test:components | test:integration | quality:) ;;
  *)
    echo "$USAGE" >&2
    exit 2
    ;;
esac

echo "==> Building the development image"
# `--target development`: it adds Bash and Git for the suites, while both
# stages carry the same Bun runtime. It trusts the /app checkout mounted below.
docker build --target development --tag "$IMAGE_TAG" .

case "$SUITE" in
  quality)
    COMMANDS='bun run lint \
      && bun run check:format \
      && bun run typecheck \
      && bun run check:react \
      && bun run check:contrast \
      && bun run check:links \
      && bun run check:unused'
    ;;
  test)
    # Migrations first, against an empty database. A migration that only works
    # on an already-prepared one is a migration that fails on somebody's first
    # install — which is what happened with pg_trgm.
    #
    # Then the schema against what the migrations built: the tests run on a
    # client generated from schema.prisma, so an index or a foreign key added
    # there without a migration passes every one of them and never reaches an
    # install. `--exit-code` exits 2 on any difference.
    #
    # `bunx --bun prisma`, because prisma is a binary rather than a script; and
    # `bun run test:*` rather than `bun test:*`, because the bare form would
    # invoke Bun's own runner and sweep every suite at once.
    #
    # One suite when PART names it: CI runs each on its own runner. Only the
    # integration suite reads the database, so the migrations run before it.
    MIGRATE='bunx --bun prisma migrate deploy \
      && bunx --bun prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code'
    # `suite NAME SCRIPT`: one suite's command. With TEST_REPORTS it also
    # writes a JUnit report, NAME.xml; the console output stays as it is.
    suite() {
      echo "bun run $2${TEST_REPORTS:+ --reporter=junit --reporter-outfile=/reports/$1.xml}"
    }
    case "$PART" in
      unit) COMMANDS="$(suite unit test:unit)" ;;
      components) COMMANDS="$(suite components test:components)" ;;
      integration) COMMANDS="$MIGRATE && $(suite integration test:integration:only)" ;;
      *) COMMANDS="$MIGRATE && $(suite unit test:unit) && $(suite components test:components) && $(suite integration test:integration:only)" ;;
    esac
    ;;
esac

REPORTS_VOLUME=()
if [ -n "${TEST_REPORTS:-}" ]; then
  mkdir -p "$TEST_REPORTS"
  REPORTS_VOLUME=(--volume "$TEST_REPORTS:/reports")
fi

echo "==> Running '$SUITE${PART:+ $PART}' inside $IMAGE_TAG (network: $CI_NETWORK)"
# The `+` form: Bash before 4.4 calls an empty array unbound under `set -u`.
docker run --rm \
  --network "$CI_NETWORK" \
  --volume "$PWD:/app" \
  --volume /app/node_modules \
  --volume /app/src/generated \
  ${REPORTS_VOLUME[@]+"${REPORTS_VOLUME[@]}"} \
  --env "DATABASE_URL=${DATABASE_URL:-}" \
  --env "VALKEY_URL=${VALKEY_URL:-}" \
  --env "STOKY_SECRET=${STOKY_SECRET:-ci-only-not-a-real-secret}" \
  --env "STOKY_URLS=${STOKY_URLS:-http://localhost:3000}" \
  --env CI=true \
  "$IMAGE_TAG" \
  sh -c "$COMMANDS"
