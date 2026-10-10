#!/bin/bash

# Installs a git pre-commit hook that runs `scripts/check-scope.sh staged`.
#
#   bash scripts/install-hooks.sh              # install
#   bash scripts/install-hooks.sh --uninstall  # remove it again
#
# Opt-in, never automatic: a hook installed behind someone's back is a hook
# they delete. Git's own hooks rather than husky, which would be one more
# dependency to do what a file in .git/hooks already does.
#
# The hook is feedback, not a gate — CI is the gate. `git commit --no-verify`
# skips it for a commit that must go in anyway.
#
# The hooks directory comes from git, so core.hooksPath and worktrees are
# honoured. A pre-commit hook this script did not write is left alone: the
# script stops and says so rather than replace it.

set -euo pipefail

MARKER="# Installed by stoky scripts/install-hooks.sh"

HOOKS_DIR="$(git rev-parse --git-path hooks)"
HOOK="${HOOKS_DIR}/pre-commit"

ours() {
  [ -f "$HOOK" ] && grep -qxF "$MARKER" "$HOOK"
}

case "${1:-}" in
  "")
    if [ -e "$HOOK" ] && ! ours; then
      echo "Error: ${HOOK} already exists and was not written by this script." >&2
      echo "Merge it by hand: have it run 'bash scripts/check-scope.sh staged'." >&2
      exit 1
    fi
    mkdir -p "$HOOKS_DIR"
    cat >"$HOOK" <<EOF
#!/bin/sh
${MARKER}
# Feedback, not a gate. Skip it once with: git commit --no-verify
# Remove it with: bash scripts/install-hooks.sh --uninstall
exec bash "\$(git rev-parse --show-toplevel)/scripts/check-scope.sh" staged
EOF
    chmod +x "$HOOK"
    echo "Installed ${HOOK}: every commit runs scripts/check-scope.sh staged."
    ;;
  --uninstall)
    if ours; then
      rm "$HOOK"
      echo "Removed ${HOOK}."
    elif [ -e "$HOOK" ]; then
      echo "Left ${HOOK} alone: this script did not write it." >&2
      exit 1
    else
      echo "No pre-commit hook installed."
    fi
    ;;
  *)
    echo "usage: $0 [--uninstall]" >&2
    exit 2
    ;;
esac
