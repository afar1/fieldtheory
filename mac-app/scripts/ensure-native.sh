#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$APP_DIR/electron/native/build/FieldTheoryHelper"
DIARIZER="$APP_DIR/electron/diarization/.build/release/FieldTheoryDiarizer"

if [[ -x "$HELPER" && -x "$DIARIZER" ]]; then
  exit 0
fi

bash "$SCRIPT_DIR/setup-native.sh"
