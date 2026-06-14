#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$APP_DIR/electron/native/build/FieldTheoryHelper"
LAUNCHER="$APP_DIR/electron/native/build/FieldTheoryLauncher"

if [[ -x "$HELPER" && -x "$LAUNCHER" ]]; then
  exit 0
fi

bash "$SCRIPT_DIR/setup-native.sh"
