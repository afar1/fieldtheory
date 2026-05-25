#!/usr/bin/env bash
set -euo pipefail

GHOSTTY_SOURCE_DIR="${GHOSTTY_SOURCE_DIR:-$HOME/dev/ghostty}"
INCLUDE_DIR="$GHOSTTY_SOURCE_DIR/zig-out/include"
LIB_DIR="$GHOSTTY_SOURCE_DIR/zig-out/lib"
LIB_PATH=""

for candidate in \
  "$LIB_DIR/libghostty-vt.dylib" \
  "$LIB_DIR/libghostty-vt.0.dylib" \
  "$LIB_DIR/libghostty-vt.0.1.0.dylib"
do
  if [[ -f "$candidate" ]]; then
    LIB_PATH="$candidate"
    break
  fi
done

if [[ ! -f "$INCLUDE_DIR/ghostty/vt.h" ]]; then
  echo "Missing Ghostty VT header: $INCLUDE_DIR/ghostty/vt.h" >&2
  echo "Build Ghostty first or set GHOSTTY_SOURCE_DIR to a checkout with zig-out artifacts." >&2
  exit 1
fi

if [[ -z "$LIB_PATH" ]]; then
  echo "Missing libghostty-vt dylib in: $LIB_DIR" >&2
  echo "Build Ghostty first or set GHOSTTY_SOURCE_DIR to a checkout with zig-out artifacts." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/ghostty_vt_probe.c" <<'C'
#include <stddef.h>
#include <string.h>
#include <ghostty/vt.h>

int main(void) {
  GhosttyOscParser parser;
  if (ghostty_osc_new(NULL, &parser) != GHOSTTY_SUCCESS) return 1;

  const char *title = "field-theory";
  ghostty_osc_next(parser, '0');
  ghostty_osc_next(parser, ';');
  for (size_t i = 0; i < strlen(title); i++) {
    ghostty_osc_next(parser, title[i]);
  }

  GhosttyOscCommand command = ghostty_osc_end(parser, 0);
  const char *extracted = NULL;
  const int ok = ghostty_osc_command_data(command, GHOSTTY_OSC_DATA_CHANGE_WINDOW_TITLE_STR, &extracted);
  ghostty_osc_free(parser);
  return ok && extracted && strcmp(extracted, title) == 0 ? 0 : 1;
}
C

clang \
  -I "$INCLUDE_DIR" \
  "$TMP_DIR/ghostty_vt_probe.c" \
  "$LIB_PATH" \
  -Wl,-rpath,"$LIB_DIR" \
  -o "$TMP_DIR/ghostty_vt_probe"

"$TMP_DIR/ghostty_vt_probe"
echo "Ghostty VT probe passed: $LIB_PATH"
