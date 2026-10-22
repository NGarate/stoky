#!/bin/bash

# Compares every published release's notes on GitHub with
# docs/releases/<tag>.md, and fails on the first that differs (after checking
# all of them).
#
# The file is the source: release-draft creates each draft from it, and a
# correction is made in the file and then copied to the release. Nothing
# checked that the copy happened. The v0.1.0-alpha.2 recovery steps were
# corrected in the repository on 2026-10-12, and on 2026-10-22 the published
# release still told operators the version that leaves the app restarting.
# rescan.yml runs this every Monday, so a published release that disagrees with
# its file reaches the owner the way a red scan does.
#
# Line endings and trailing blank lines are not differences; anything else is.
# A draft is not compared: it is refreshed from the file on every tag run.
#
# Usage:
#   bash scripts/check-published-notes.sh [--repo OWNER/NAME]
# Needs `gh` signed in (read access is enough). Exit status: 0 every published
# release matches, 1 some differ or have no file, 2 GitHub could not be asked.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

REPO_ARGS=()
if [ "${1:-}" = --repo ] && [ -n "${2:-}" ]; then
  REPO_ARGS=(--repo "$2")
elif [ "$#" -gt 0 ]; then
  echo "usage: $0 [--repo OWNER/NAME]" >&2
  exit 2
fi

if ! TAGS="$(gh release list "${REPO_ARGS[@]}" --exclude-drafts --limit 1000 --json tagName --jq '.[].tagName')"; then
  echo "Error: could not list the releases." >&2
  exit 2
fi

status=0
checked=0
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  # A tag becomes a path below; only version tags are.
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
    echo "::error::Published release '$tag' is not a version tag."
    status=1
    continue
  fi
  file="docs/releases/$tag.md"
  if [ ! -f "$file" ]; then
    echo "::error::$tag is published, but $file does not exist."
    status=1
    continue
  fi
  if ! body="$(gh release view "$tag" "${REPO_ARGS[@]}" --json body --jq .body)"; then
    echo "Error: could not read the notes of $tag." >&2
    exit 2
  fi
  # $(...) drops trailing newlines from both sides.
  published="$(printf '%s' "$body" | tr -d '\r')"
  expected="$(tr -d '\r' < "$file")"
  checked=$((checked + 1))
  if [ "$published" = "$expected" ]; then
    echo "ok     $tag"
  else
    echo "::error::$tag's published notes differ from $file. Publish the file: gh release edit $tag --notes-file $file"
    diff -u --label "$file" --label "published $tag" <(printf '%s\n' "$expected") <(printf '%s\n' "$published") || true
    status=1
  fi
done <<< "$TAGS"

echo "$checked published release(s) compared."
exit "$status"
