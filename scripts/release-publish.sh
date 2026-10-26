#!/bin/bash

# Publishes a release draft, run by the owner once they have reviewed it. In
# order, stopping at the first step that cannot go on:
#
#   1. scripts/release-verify-draft.sh <tag>. Anything but exit 0 stops here,
#      with that exit status, and nothing is published.
#   2. Decides the release's flags. --prerelease when the tag has a `-`
#      suffix (v0.1.0-alpha.4), as release-draft drafts it. --latest only for
#      a stable tag that is the highest stable version, by `sort -V`, among
#      the published releases and itself; a prerelease is never latest, and
#      neither is a patch to an older line. Immich's publish job decides the
#      same way: GitHub's own default would make whatever was published last
#      the latest, a v1.0.5 published after v1.1.0 included.
#   3. gh release edit <tag> --draft=false --prerelease=<..> --latest=<..>
#      With immutable releases on, this is one-way: the files and the tag of
#      a published release can no longer be replaced.
#   4. scripts/check-published-notes.sh: the published notes are the file's.
#   5. gh workflow run rescan.yml --ref master, which scans the newest
#      published release (now this one) and compares the notes again on
#      GitHub's side; prints the run's URL once it appears.
#   6. A summary.
#
# A failure in step 4 or 5 does not undo step 3: the release stays published,
# the summary says what failed, and the exit status is 1.
#
# Not done here: a Docker `stable` channel, an image tag that follows the
# newest stable release. Moving it is a retag on GHCR, which needs
# packages: write, and the owner's local credentials do not have it; it is to
# be a CI job.
#
# Usage:
#   bash scripts/release-publish.sh vVERSION [--repo OWNER/NAME]
#
# The repository is --repo, else $GH_REPO, else the one `gh repo view` names.
# Needs gh signed in with push access (a draft is invisible without it), and
# everything release-verify-draft.sh needs. Exit status: 0 published and
# every later step ok; 1 published but the notes check or the rescan
# dispatch failed, or the edit itself failed; otherwise the verification's
# own status (1 a check failed, 2 it could not start) or 2 for bad arguments
# or a release list GitHub would not give — and nothing published.
#
# STOKY_PUBLISH_POLL_ATTEMPTS (default 10) and STOKY_PUBLISH_POLL_INTERVAL
# (seconds, default 3) bound the wait for the rescan run to be listed, when
# `gh workflow run` does not print its URL itself. The tests
# (src/__tests__/unit/release-publish.test.ts) stub gh and both scripts.

set -euo pipefail

USAGE="usage: bash scripts/release-publish.sh vVERSION [--repo OWNER/NAME]"
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$'
STABLE_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
POLL_ATTEMPTS="${STOKY_PUBLISH_POLL_ATTEMPTS:-10}"
POLL_INTERVAL="${STOKY_PUBLISH_POLL_INTERVAL:-3}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

usage_error() {
  echo "$USAGE" >&2
  exit 2
}

TAG=""
REPO="${GH_REPO:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      [ -n "${2:-}" ] || usage_error
      REPO="$2"
      shift
      ;;
    -*) usage_error ;;
    *)
      [ -z "$TAG" ] || usage_error
      TAG="$1"
      ;;
  esac
  shift
done
[ -n "$TAG" ] || usage_error
if [[ ! "$TAG" =~ $VERSION_RE ]]; then
  echo "Error: expected a version tag such as v0.1.0-alpha.1, got '$TAG'." >&2
  exit 2
fi
if [[ ! "$POLL_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ ! "$POLL_INTERVAL" =~ ^[0-9]+$ ]]; then
  echo "Error: STOKY_PUBLISH_POLL_ATTEMPTS and STOKY_PUBLISH_POLL_INTERVAL must be whole numbers." >&2
  exit 2
fi
if ! command -v gh > /dev/null; then
  echo "Error: gh is needed and is not installed." >&2
  exit 2
fi
if [ -z "$REPO" ] && ! REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"; then
  echo "Error: could not tell which repository; pass --repo OWNER/NAME." >&2
  exit 2
fi
if [[ ! "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "Error: expected a repository such as NGarate/stoky, got '$REPO'." >&2
  exit 2
fi

echo "==> 1/5 Verifying the draft $TAG of $REPO"
verified=0
bash scripts/release-verify-draft.sh "$TAG" --repo "$REPO" || verified=$?
if [ "$verified" != 0 ]; then
  echo "Error: $TAG did not verify (exit $verified). Nothing was published." >&2
  exit "$verified"
fi

echo "==> 2/5 Deciding how to publish it"
PRERELEASE=false
LATEST=false
if [[ "$TAG" == *-* ]]; then
  PRERELEASE=true
else
  if ! PUBLISHED="$(gh release list --repo "$REPO" --exclude-drafts --limit 1000 --json tagName --jq '.[].tagName')"; then
    echo "Error: could not list the published releases. Nothing was published." >&2
    exit 2
  fi
  HIGHEST="$({ grep -E "$STABLE_RE" <<< "$PUBLISHED" || true; echo "$TAG"; } | sort -V | tail -n 1)"
  [ "$HIGHEST" != "$TAG" ] || LATEST=true
fi
echo "    prerelease=$PRERELEASE latest=$LATEST"

echo "==> 3/5 Publishing"
if ! gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease="$PRERELEASE" --latest="$LATEST"; then
  echo "Error: gh release edit failed; check whether $TAG is still a draft: gh release view $TAG --repo $REPO" >&2
  exit 1
fi

status=0
echo "==> 4/5 Comparing the published notes with their files"
NOTES=ok
if ! bash scripts/check-published-notes.sh --repo "$REPO"; then
  NOTES="FAIL (above; the release is published regardless)"
  status=1
fi

echo "==> 5/5 Dispatching the rescan of the newest published release"
RESCAN=""
# Runs listed from a few seconds before the dispatch, in case the clocks
# disagree. In epoch seconds, compared by gh's jq, because only GNU date
# takes `-d '-10 seconds'`, and CI runs this in the Alpine image.
SINCE="$(( $(date -u +%s) - 10 ))"
if OUTPUT="$(gh workflow run rescan.yml --repo "$REPO" --ref master 2>&1)"; then
  echo "$OUTPUT"
  # Recent gh prints the created run's URL; otherwise it is looked up.
  RESCAN="$(grep -oE 'https://[^[:space:]]+/actions/runs/[0-9]+' <<< "$OUTPUT" | head -n 1 || true)"
  attempt=0
  while [ -z "$RESCAN" ] && [ "$attempt" -lt "$POLL_ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    sleep "$POLL_INTERVAL"
    RESCAN="$(gh run list --repo "$REPO" --workflow rescan.yml --event workflow_dispatch --limit 10 \
      --json url,createdAt --jq "[.[] | select((.createdAt | fromdateiso8601) >= $SINCE)] | .[0].url // empty" || true)"
  done
  [ -n "$RESCAN" ] || RESCAN="dispatched; not listed yet: gh run list --repo $REPO --workflow rescan.yml"
else
  echo "$OUTPUT" >&2
  RESCAN="FAIL: not dispatched (gh workflow run rescan.yml --repo $REPO --ref master)"
  status=1
fi

URL="$(gh release view "$TAG" --repo "$REPO" --json url --jq .url 2>/dev/null || echo "gh release view $TAG --repo $REPO")"
echo
echo "Published $TAG (prerelease=$PRERELEASE, latest=$LATEST)"
echo "  release  $URL"
echo "  notes    $NOTES"
echo "  rescan   $RESCAN"
exit "$status"
