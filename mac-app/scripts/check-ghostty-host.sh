#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

bash "$SCRIPT_DIR/build-ghostty-host.sh" >/dev/null
node - <<'NODE'
const host = require('./electron/native/build/ghostty-host.node');
if (!host || host.probe() !== true) {
  throw new Error('Ghostty native host bridge did not load');
}
console.log('Ghostty native host bridge loaded');
NODE
