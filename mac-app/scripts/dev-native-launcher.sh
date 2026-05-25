#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$APP_DIR"

npm run build:electron --silent
npm run build:native --silent
npm run build:ghostty-host --silent
./node_modules/.bin/wait-on tcp:5173

ELECTRON_PATH="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ ! -x "$ELECTRON_PATH" ]]; then
  ELECTRON_PATH="$APP_DIR/node_modules/.bin/electron"
fi

if [[ -n "${FIELD_THEORY_STARTUP_PROFILE:-}" && -z "${FIELD_THEORY_STARTUP_LAUNCHED_AT_MS:-}" ]]; then
  export FIELD_THEORY_STARTUP_LAUNCHED_AT_MS
  FIELD_THEORY_STARTUP_LAUNCHED_AT_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
fi

FIELD_THEORY_LAUNCHER_ELECTRON_PATH="$ELECTRON_PATH" \
FIELD_THEORY_LAUNCHER_ELECTRON_APP_PATH="$APP_DIR" \
ELECTRON_START_URL="${ELECTRON_START_URL:-http://localhost:5173}" \
LOG_LEVEL="${LOG_LEVEL:-warn}" \
"$APP_DIR/electron/native/build/FieldTheoryLauncher" "$@"
