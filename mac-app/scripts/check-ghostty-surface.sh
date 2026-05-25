#!/usr/bin/env bash
set -euo pipefail

GHOSTTY_SOURCE_DIR="${GHOSTTY_SOURCE_DIR:-$HOME/dev/ghostty}"
KIT_DIR="$GHOSTTY_SOURCE_DIR/macos/GhosttyKit.xcframework/macos-arm64_x86_64"
HEADER_DIR="$KIT_DIR/Headers"
LIB_PATH="$KIT_DIR/libghostty.a"

if [[ ! -f "$HEADER_DIR/ghostty.h" ]]; then
  echo "Missing GhosttyKit header: $HEADER_DIR/ghostty.h" >&2
  echo "Build Ghostty's macOS xcframework first or set GHOSTTY_SOURCE_DIR." >&2
  exit 1
fi

if [[ ! -f "$LIB_PATH" ]]; then
  echo "Missing GhosttyKit static library: $LIB_PATH" >&2
  echo "Build Ghostty's macOS xcframework first or set GHOSTTY_SOURCE_DIR." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/ghostty_surface_probe.m" <<'OBJC'
#import <Cocoa/Cocoa.h>
#import <ghostty.h>

static void wakeup_cb(void *userdata) {}
static bool action_cb(ghostty_app_t app, ghostty_target_s target, ghostty_action_s action) { return false; }
static void read_clipboard_cb(void *userdata, ghostty_clipboard_e loc, void *state) {}
static void confirm_read_clipboard_cb(void *userdata, const char *str, void *state, ghostty_clipboard_request_e request) {}
static void write_clipboard_cb(void *userdata, ghostty_clipboard_e loc, const ghostty_clipboard_content_s *content, size_t len, bool confirm) {}
static void close_surface_cb(void *userdata, bool processAlive) {}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (ghostty_init((uintptr_t)argc, argv) != GHOSTTY_SUCCESS) return 1;

    ghostty_config_t config = ghostty_config_new();
    if (!config) return 2;
    ghostty_config_finalize(config);

    ghostty_runtime_config_s runtime = {0};
    runtime.supports_selection_clipboard = true;
    runtime.wakeup_cb = wakeup_cb;
    runtime.action_cb = action_cb;
    runtime.read_clipboard_cb = read_clipboard_cb;
    runtime.confirm_read_clipboard_cb = confirm_read_clipboard_cb;
    runtime.write_clipboard_cb = write_clipboard_cb;
    runtime.close_surface_cb = close_surface_cb;

    ghostty_app_t app = ghostty_app_new(&runtime, config);
    if (!app) return 3;

    NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 500)];
    ghostty_surface_config_s surface_config = ghostty_surface_config_new();
    surface_config.platform_tag = GHOSTTY_PLATFORM_MACOS;
    surface_config.platform.macos.nsview = (__bridge void *)view;
    surface_config.scale_factor = 2.0;
    surface_config.font_size = 12.0;
    surface_config.command = "/usr/bin/true";
    surface_config.wait_after_command = true;
    surface_config.context = GHOSTTY_SURFACE_CONTEXT_WINDOW;

    ghostty_surface_t surface = ghostty_surface_new(app, &surface_config);
    if (!surface) return 4;
    ghostty_surface_set_size(surface, 800, 500);
    ghostty_surface_draw(surface);

    ghostty_surface_free(surface);
    ghostty_app_free(app);
    ghostty_config_free(config);
    printf("Ghostty surface probe passed\n");
    return 0;
  }
}
OBJC

clang \
  -fobjc-arc \
  -I "$HEADER_DIR" \
  "$TMP_DIR/ghostty_surface_probe.m" \
  "$LIB_PATH" \
  -framework AppKit \
  -framework CoreGraphics \
  -framework CoreText \
  -framework CoreVideo \
  -framework IOSurface \
  -framework Metal \
  -framework QuartzCore \
  -framework Carbon \
  -lc++ \
  -o "$TMP_DIR/ghostty_surface_probe"

HOME="$TMP_DIR/home" "$TMP_DIR/ghostty_surface_probe"
