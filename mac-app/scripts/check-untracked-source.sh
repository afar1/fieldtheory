#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -L "$ROOT_DIR/node_modules" ]; then
  echo "Packaging blocked: node_modules is a symlink." >&2
  echo "Run \`npm ci\` in this checkout so electron-builder can bundle runtime deps." >&2
  exit 1
fi

UNTRACKED_FILES="$(git ls-files --others --exclude-standard)"
if [ -z "$UNTRACKED_FILES" ]; then
  exit 0
fi

# Block packaging when source-like files are untracked, while allowing docs/notes.
BLOCKING_PATTERN='^(electron/.*\.(ts|tsx|js|mjs|cjs|json|swift)|src/.*\.(ts|tsx|js|jsx|css|html)|scripts/.*\.(sh|py|js)|package\.json|package-lock\.json|dynamic-island\.html|electron-builder.*\.json)$'
if command -v rg >/dev/null 2>&1; then
  BLOCKING_FILES="$(
    printf '%s\n' "$UNTRACKED_FILES" | rg --no-line-number "$BLOCKING_PATTERN" || true
  )"
else
  BLOCKING_FILES="$(
    printf '%s\n' "$UNTRACKED_FILES" | grep -E "$BLOCKING_PATTERN" || true
  )"
fi

if [ -n "$BLOCKING_FILES" ]; then
  echo "Untracked source files detected. Add/ignore them before packaging:" >&2
  printf '%s\n' "$BLOCKING_FILES" >&2
  exit 1
fi
