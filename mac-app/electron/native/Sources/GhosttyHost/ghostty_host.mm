#import <Cocoa/Cocoa.h>
#import <ghostty.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <node_api.h>
#include <string>
#include <vector>

static ghostty_config_t gConfig = nullptr;
static ghostty_app_t gApp = nullptr;
static std::string gClipboardReadBuffer;
static std::string gEmbeddedHome;

static void RunOnMainSync(dispatch_block_t block);

@class FieldTheoryGhosttyHostView;

struct GhosttyHostSession {
  FieldTheoryGhosttyHostView *view = nil;
  ghostty_surface_t surface = nullptr;
  std::string workingDirectory;
  std::string command;
  std::vector<ghostty_env_var_s> envVars;
};

static std::map<std::string, GhosttyHostSession> gSessions;
static std::string gActiveSessionId;

static GhosttyHostSession *SessionForId(const std::string &sessionId) {
  auto found = gSessions.find(sessionId);
  if (found == gSessions.end()) return nullptr;
  return &found->second;
}

static void FreeGhosttySurfaceAsync(ghostty_surface_t surface) {
  if (!surface) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    ghostty_surface_free(surface);
    if (gApp) ghostty_app_tick(gApp);
  });
}

static void RemoveSessionView(GhosttyHostSession &session) {
  if (session.view) {
    [(NSView *)session.view removeFromSuperview];
    session.view = nil;
  }
}

static void DetachSession(const std::string &sessionId, bool freeSurface) {
  GhosttyHostSession *session = SessionForId(sessionId);
  if (!session) return;

  ghostty_surface_t surface = session->surface;
  session->surface = nullptr;
  RemoveSessionView(*session);
  if (gActiveSessionId == sessionId) gActiveSessionId.clear();
  if (freeSurface) FreeGhosttySurfaceAsync(surface);
}

static ghostty_input_mods_e GhosttyModsFromFlags(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if (flags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
  if (flags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
  if (flags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
  if (flags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
  if (flags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
  return (ghostty_input_mods_e)mods;
}

static ghostty_input_mods_e GhosttyModsFromEvent(NSEvent *event) {
  return GhosttyModsFromFlags(event.modifierFlags);
}

static uint32_t UnshiftedCodepointFromEvent(NSEvent *event) {
  if (event.type != NSEventTypeKeyDown && event.type != NSEventTypeKeyUp) return 0;
  NSString *characters = [event charactersByApplyingModifiers:0];
  if (characters.length == 0) return 0;
  return [characters characterAtIndex:0];
}

static NSString *GhosttyTextFromEvent(NSEvent *event) {
  NSString *characters = event.characters;
  if (characters.length == 0) return nil;
  if (characters.length == 1) {
    const unichar character = [characters characterAtIndex:0];
    if (character < 0x20) return event.charactersIgnoringModifiers;
    if (character >= 0xF700 && character <= 0xF8FF) return nil;
  }
  return characters;
}

static ghostty_input_key_s GhosttyKeyEventFromNSEvent(NSEvent *event, ghostty_input_action_e action) {
  ghostty_input_key_s key = {};
  key.action = action;
  key.mods = GhosttyModsFromEvent(event);
  key.consumed_mods = GhosttyModsFromFlags(event.modifierFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  key.keycode = event.keyCode;
  key.unshifted_codepoint = UnshiftedCodepointFromEvent(event);
  key.composing = false;
  return key;
}

static bool SendGhosttyKeyEvent(ghostty_surface_t surface, NSEvent *event, ghostty_input_action_e action, NSString *text = nil) {
  if (!surface) return false;
  ghostty_input_key_s key = GhosttyKeyEventFromNSEvent(event, action);
  if (text.length > 0) {
    const char *bytes = text.UTF8String;
    if (bytes && static_cast<unsigned char>(bytes[0]) >= 0x20) {
      key.text = bytes;
      const bool handled = ghostty_surface_key(surface, key);
      if (gApp) ghostty_app_tick(gApp);
      return handled;
    }
  }
  const bool handled = ghostty_surface_key(surface, key);
  if (gApp) ghostty_app_tick(gApp);
  return handled;
}

static uint32_t GhosttyModifierForKeyCode(unsigned short keyCode) {
  switch (keyCode) {
    case 0x39: return GHOSTTY_MODS_CAPS;
    case 0x38:
    case 0x3C: return GHOSTTY_MODS_SHIFT;
    case 0x3B:
    case 0x3E: return GHOSTTY_MODS_CTRL;
    case 0x3A:
    case 0x3D: return GHOSTTY_MODS_ALT;
    case 0x37:
    case 0x36: return GHOSTTY_MODS_SUPER;
    default: return GHOSTTY_MODS_NONE;
  }
}

static ghostty_input_mouse_button_e GhosttyMouseButtonFromEvent(NSEvent *event) {
  switch (event.buttonNumber) {
    case 0: return GHOSTTY_MOUSE_LEFT;
    case 1: return GHOSTTY_MOUSE_RIGHT;
    case 2: return GHOSTTY_MOUSE_MIDDLE;
    case 3: return GHOSTTY_MOUSE_FOUR;
    case 4: return GHOSTTY_MOUSE_FIVE;
    case 5: return GHOSTTY_MOUSE_SIX;
    case 6: return GHOSTTY_MOUSE_SEVEN;
    case 7: return GHOSTTY_MOUSE_EIGHT;
    case 8: return GHOSTTY_MOUSE_NINE;
    case 9: return GHOSTTY_MOUSE_TEN;
    case 10: return GHOSTTY_MOUSE_ELEVEN;
    default: return GHOSTTY_MOUSE_UNKNOWN;
  }
}

static ghostty_input_scroll_mods_t GhosttyScrollModsFromEvent(NSEvent *event) {
  int32_t mods = event.hasPreciseScrollingDeltas ? 1 : 0;
  mods |= ((int32_t)event.momentumPhase & 0b111) << 1;
  return mods;
}

@interface FieldTheoryGhosttyHostView : NSView
@property(nonatomic, copy) NSString *sessionId;
@end

@implementation FieldTheoryGhosttyHostView

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (void)mouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (session && session->surface) {
    gActiveSessionId = self.sessionId.UTF8String ?: "";
    ghostty_surface_set_focus(session->surface, true);
    ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, GhosttyModsFromEvent(event));
  }
}

- (void)mouseUp:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (session && session->surface) {
    ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, GhosttyModsFromEvent(event));
    ghostty_surface_mouse_pressure(session->surface, 0, 0);
  }
}

- (void)rightMouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface || !ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, GhosttyModsFromEvent(event))) {
    [super rightMouseDown:event];
  }
}

- (void)rightMouseUp:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface || !ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, GhosttyModsFromEvent(event))) {
    [super rightMouseUp:event];
  }
}

- (void)otherMouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (session && session->surface) {
    gActiveSessionId = self.sessionId.UTF8String ?: "";
    ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_PRESS, GhosttyMouseButtonFromEvent(event), GhosttyModsFromEvent(event));
  }
}

- (void)otherMouseUp:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (session && session->surface) {
    ghostty_surface_mouse_button(session->surface, GHOSTTY_MOUSE_RELEASE, GhosttyMouseButtonFromEvent(event), GhosttyModsFromEvent(event));
  }
}

- (void)sendMousePosition:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface) return;
  NSPoint position = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(session->surface, position.x, self.frame.size.height - position.y, GhosttyModsFromEvent(event));
}

- (void)mouseMoved:(NSEvent *)event {
  [self sendMousePosition:event];
}

- (void)mouseDragged:(NSEvent *)event {
  [self sendMousePosition:event];
}

- (void)rightMouseDragged:(NSEvent *)event {
  [self sendMousePosition:event];
}

- (void)otherMouseDragged:(NSEvent *)event {
  [self sendMousePosition:event];
}

- (void)scrollWheel:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface) return;
  double x = event.scrollingDeltaX;
  double y = event.scrollingDeltaY;
  if (event.hasPreciseScrollingDeltas) {
    x *= 2;
    y *= 2;
  }
  ghostty_surface_mouse_scroll(session->surface, x, y, GhosttyScrollModsFromEvent(event));
}

- (void)keyDown:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface) {
    [super keyDown:event];
    return;
  }
  gActiveSessionId = self.sessionId.UTF8String ?: "";

  NSString *text = GhosttyTextFromEvent(event);
  const ghostty_input_action_e action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
  SendGhosttyKeyEvent(session->surface, event, action, text);
}

- (void)keyUp:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface) {
    [super keyUp:event];
    return;
  }
  SendGhosttyKeyEvent(session->surface, event, GHOSTTY_ACTION_RELEASE);
}

- (void)flagsChanged:(NSEvent *)event {
  GhosttyHostSession *session = SessionForId(self.sessionId.UTF8String ?: "");
  if (!session || !session->surface) {
    [super flagsChanged:event];
    return;
  }

  const uint32_t modifier = GhosttyModifierForKeyCode(event.keyCode);
  if (modifier == GHOSTTY_MODS_NONE) return;

  ghostty_input_action_e action = GHOSTTY_ACTION_RELEASE;
  const uint32_t mods = GhosttyModsFromEvent(event);
  if ((mods & modifier) != 0) {
    action = GHOSTTY_ACTION_PRESS;
  }
  SendGhosttyKeyEvent(session->surface, event, action);
}

@end

static void WakeupCallback(void *userdata) {
  RunOnMainSync(^{
    if (gApp) ghostty_app_tick(gApp);
  });
}
static bool ActionCallback(ghostty_app_t app, ghostty_target_s target, ghostty_action_s action) { return false; }
static void ReadClipboardCallback(void *userdata, ghostty_clipboard_e loc, void *state) {
  RunOnMainSync(^{
    GhosttyHostSession *session = static_cast<GhosttyHostSession *>(userdata);
    if (!session || !session->surface) return;
    NSPasteboard *pasteboard = loc == GHOSTTY_CLIPBOARD_SELECTION ? [NSPasteboard pasteboardWithName:NSPasteboardNameFind] : [NSPasteboard generalPasteboard];
    NSString *value = [pasteboard stringForType:NSPasteboardTypeString] ?: @"";
    gClipboardReadBuffer = value.UTF8String ?: "";
    ghostty_surface_complete_clipboard_request(session->surface, gClipboardReadBuffer.c_str(), state, false);
  });
}

static void ConfirmReadClipboardCallback(void *userdata, const char *str, void *state, ghostty_clipboard_request_e request) {
  RunOnMainSync(^{
    GhosttyHostSession *session = static_cast<GhosttyHostSession *>(userdata);
    if (session && session->surface) ghostty_surface_complete_clipboard_request(session->surface, str ?: "", state, true);
  });
}

static void WriteClipboardCallback(void *userdata, ghostty_clipboard_e loc, const ghostty_clipboard_content_s *content, size_t len, bool confirm) {
  RunOnMainSync(^{
    NSPasteboard *pasteboard = loc == GHOSTTY_CLIPBOARD_SELECTION ? [NSPasteboard pasteboardWithName:NSPasteboardNameFind] : [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    for (size_t index = 0; index < len; index++) {
      if (!content[index].mime || !content[index].data || strcmp(content[index].mime, "text/plain") != 0) continue;
      [pasteboard setString:[NSString stringWithUTF8String:content[index].data] ?: @"" forType:NSPasteboardTypeString];
      break;
    }
  });
}

static void CloseSurfaceCallback(void *userdata, bool processAlive) {
  RunOnMainSync(^{
    GhosttyHostSession *session = static_cast<GhosttyHostSession *>(userdata);
    if (!session) return;
    session->surface = nullptr;
    RemoveSessionView(*session);
  });
}

static void *PointerFromBuffer(napi_env env, napi_value value) {
  bool is_buffer = false;
  napi_is_buffer(env, value, &is_buffer);
  if (!is_buffer) return nullptr;

  void *data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, value, &data, &length);
  if (length < sizeof(void *)) return nullptr;

  void *pointer = nullptr;
  memcpy(&pointer, data, sizeof(void *));
  return pointer;
}

static double NumberArg(napi_env env, napi_value value) {
  double result = 0;
  napi_get_value_double(env, value, &result);
  return result;
}

static bool BoolArg(napi_env env, napi_value value) {
  bool result = false;
  napi_get_value_bool(env, value, &result);
  return result;
}

static NSString *StringArg(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);
  return [NSString stringWithUTF8String:buffer.data()];
}

static ghostty_input_action_e ActionArg(napi_env env, napi_value value) {
  NSString *action = StringArg(env, value);
  if ([action isEqualToString:@"release"]) return GHOSTTY_ACTION_RELEASE;
  if ([action isEqualToString:@"repeat"]) return GHOSTTY_ACTION_REPEAT;
  return GHOSTTY_ACTION_PRESS;
}

static napi_value NapiBoolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value NapiString(napi_env env, const char *value, size_t length) {
  napi_value result;
  napi_create_string_utf8(env, value ?: "", value ? length : 0, &result);
  return result;
}

static void RunOnMainSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), block);
}

static void RunOnMainAsync(dispatch_block_t block) {
  dispatch_async(dispatch_get_main_queue(), block);
}

static BOOL IsEmbeddedIncompatibleConfigLine(NSString *line) {
  NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  if (trimmed.length == 0 || [trimmed hasPrefix:@"#"]) return NO;

  NSArray<NSString *> *keys = @[
    @"font-family",
    @"font-family-bold",
    @"font-size",
    @"font-style",
    @"font-style-bold",
    @"adjust-cell-height",
    @"adjust-font-baseline",
    @"shell-integration-features",
  ];
  for (NSString *key in keys) {
    if ([trimmed hasPrefix:[key stringByAppendingString:@" "]]) return YES;
    if ([trimmed hasPrefix:[key stringByAppendingString:@"="]]) return YES;
  }
  return NO;
}

static NSString *DefaultGhosttyConfigPath(void) {
  NSDictionary<NSString *, NSString *> *environment = NSProcessInfo.processInfo.environment;
  NSString *explicitPath = environment[@"GHOSTTY_CONFIG_PATH"];
  NSFileManager *fileManager = NSFileManager.defaultManager;
  if (explicitPath.length > 0 && [fileManager isReadableFileAtPath:explicitPath]) return explicitPath;

  NSString *configHome = environment[@"XDG_CONFIG_HOME"];
  if (configHome.length == 0) configHome = [NSHomeDirectory() stringByAppendingPathComponent:@".config"];

  NSArray<NSString *> *candidates = @[
    [[configHome stringByAppendingPathComponent:@"ghostty"] stringByAppendingPathComponent:@"config"],
    [[configHome stringByAppendingPathComponent:@"ghostty"] stringByAppendingPathComponent:@"config.ghostty"],
  ];
  for (NSString *candidate in candidates) {
    if ([fileManager isReadableFileAtPath:candidate]) return candidate;
  }
  return nil;
}

static NSString *EmbeddedGhosttyHome(void) {
  NSString *sourcePath = DefaultGhosttyConfigPath();
  if (sourcePath.length == 0) return nil;

  NSError *readError = nil;
  NSString *source = [NSString stringWithContentsOfFile:sourcePath encoding:NSUTF8StringEncoding error:&readError];
  if (!source || readError) {
    fprintf(stderr, "Field Theory Ghostty config: failed to read %s\n", sourcePath.UTF8String);
    return nil;
  }

  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  [source enumerateLinesUsingBlock:^(NSString *line, BOOL *stop) {
    if (IsEmbeddedIncompatibleConfigLine(line)) {
      [lines addObject:[@"# Field Theory embedded Ghostty compatibility: " stringByAppendingString:line]];
    } else {
      [lines addObject:line];
    }
  }];
  [lines addObject:@"window-vsync = false"];

  NSString *directory = [NSTemporaryDirectory() stringByAppendingPathComponent:@"fieldtheory-ghostty/home/.config/ghostty"];
  NSFileManager *fileManager = NSFileManager.defaultManager;
  [fileManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *targetPath = [directory stringByAppendingPathComponent:@"config"];
  NSString *target = [[lines componentsJoinedByString:@"\n"] stringByAppendingString:@"\n"];
  NSError *writeError = nil;
  if (![target writeToFile:targetPath atomically:YES encoding:NSUTF8StringEncoding error:&writeError]) {
    fprintf(stderr, "Field Theory Ghostty config: failed to write embedded config %s\n", targetPath.UTF8String);
    return nil;
  }
  return [NSTemporaryDirectory() stringByAppendingPathComponent:@"fieldtheory-ghostty/home"];
}

static void LoadEmbeddedGhosttyConfig(ghostty_config_t config) {
  NSString *embeddedHome = EmbeddedGhosttyHome();
  if (embeddedHome.length == 0) {
    ghostty_config_load_default_files(config);
    return;
  }

  gEmbeddedHome = embeddedHome.UTF8String ?: "";
  const char *previousHome = getenv("HOME");
  std::string previousHomeValue = previousHome ?: "";
  const char *previousConfigHome = getenv("XDG_CONFIG_HOME");
  std::string previousConfigHomeValue = previousConfigHome ?: "";
  setenv("HOME", gEmbeddedHome.c_str(), 1);
  unsetenv("XDG_CONFIG_HOME");
  ghostty_config_load_default_files(config);
  if (previousHome) {
    setenv("HOME", previousHomeValue.c_str(), 1);
  }
  if (previousConfigHome) {
    setenv("XDG_CONFIG_HOME", previousConfigHomeValue.c_str(), 1);
  } else {
    unsetenv("XDG_CONFIG_HOME");
  }
}

static bool EnsureGhosttyApp(void) {
  static bool initialized = false;
  if (!initialized) {
    char arg0[] = "fieldtheory";
    char *argv[] = { arg0, nullptr };
    if (ghostty_init(1, argv) != GHOSTTY_SUCCESS) return false;
    initialized = true;
  }

  if (!gConfig) {
    gConfig = ghostty_config_new();
    if (!gConfig) return false;
    LoadEmbeddedGhosttyConfig(gConfig);
    ghostty_config_load_recursive_files(gConfig);
    ghostty_config_finalize(gConfig);

    uint32_t diagnosticsCount = ghostty_config_diagnostics_count(gConfig);
    for (uint32_t i = 0; i < diagnosticsCount; i++) {
      ghostty_diagnostic_s diagnostic = ghostty_config_get_diagnostic(gConfig, i);
      if (diagnostic.message) fprintf(stderr, "Field Theory Ghostty config: %s\n", diagnostic.message);
    }
  }

  if (!gApp) {
    ghostty_runtime_config_s runtime = {};
    runtime.supports_selection_clipboard = true;
    runtime.wakeup_cb = WakeupCallback;
    runtime.action_cb = ActionCallback;
    runtime.read_clipboard_cb = ReadClipboardCallback;
    runtime.confirm_read_clipboard_cb = ConfirmReadClipboardCallback;
    runtime.write_clipboard_cb = WriteClipboardCallback;
    runtime.close_surface_cb = CloseSurfaceCallback;
    gApp = ghostty_app_new(&runtime, gConfig);
  }

  return gApp != nullptr;
}

static FieldTheoryGhosttyHostView *EnsureHostView(GhosttyHostSession &session, const std::string &sessionId, NSView *parent, CGFloat x, CGFloat y, CGFloat width, CGFloat height) {
  if (!session.view) {
    session.view = [[FieldTheoryGhosttyHostView alloc] initWithFrame:NSMakeRect(x, y, width, height)];
    session.view.sessionId = [NSString stringWithUTF8String:sessionId.c_str()];
    session.view.autoresizingMask = NSViewMinYMargin | NSViewWidthSizable;
    [parent addSubview:session.view positioned:NSWindowAbove relativeTo:nil];
  }
  session.view.frame = NSMakeRect(x, y, width, height);
  return session.view;
}

static napi_value Probe(napi_env env, napi_callback_info info) {
  return NapiBoolean(env, true);
}

static napi_value AttachPlaceholder(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value args[6];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 6) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  NSView *parent = (__bridge NSView *)PointerFromBuffer(env, args[1]);
  if (!parent) return NapiBoolean(env, false);

  const CGFloat x = NumberArg(env, args[2]);
  const CGFloat y = NumberArg(env, args[3]);
  const CGFloat width = NumberArg(env, args[4]);
  const CGFloat height = NumberArg(env, args[5]);

  RunOnMainSync(^{
    GhosttyHostSession &session = gSessions[sessionId];
    NSView *view = EnsureHostView(session, sessionId, parent, x, y, width, height);
    view.wantsLayer = YES;
    view.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.06 green:0.07 blue:0.08 alpha:1.0].CGColor;
    view.layer.borderColor = [NSColor colorWithCalibratedRed:0.06 green:0.72 blue:0.51 alpha:0.9].CGColor;
    view.layer.borderWidth = 1.0;
  });

  return NapiBoolean(env, true);
}

static napi_value AttachGhostty(napi_env env, napi_callback_info info) {
  size_t argc = 8;
  napi_value args[8];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 8) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  NSView *parent = (__bridge NSView *)PointerFromBuffer(env, args[1]);
  if (!parent) return NapiBoolean(env, false);

  const CGFloat x = NumberArg(env, args[2]);
  const CGFloat y = NumberArg(env, args[3]);
  const CGFloat width = NumberArg(env, args[4]);
  const CGFloat height = NumberArg(env, args[5]);
  NSString *workingDirectory = StringArg(env, args[6]);
  NSString *command = StringArg(env, args[7]);

  __block bool ok = false;
  RunOnMainSync(^{
    if (!EnsureGhosttyApp()) return;
    GhosttyHostSession &session = gSessions[sessionId];
    session.workingDirectory = workingDirectory.UTF8String ?: "";
    session.command = command.UTF8String ?: "";
    FieldTheoryGhosttyHostView *view = EnsureHostView(session, sessionId, parent, x, y, width, height);
    if (!session.surface && view.wantsLayer) {
      view.layer = nil;
      view.wantsLayer = NO;
    }
    view.hidden = NO;

    for (auto &entry : gSessions) {
      if (entry.second.view && entry.first != sessionId) entry.second.view.hidden = YES;
      if (entry.second.surface) ghostty_surface_set_focus(entry.second.surface, entry.first == sessionId);
    }

    if (!session.surface) {
      session.envVars = {
        { "TERM", "xterm-256color" },
        { "COLORTERM", "truecolor" },
      };
      ghostty_surface_config_s surfaceConfig = ghostty_surface_config_new();
      surfaceConfig.platform_tag = GHOSTTY_PLATFORM_MACOS;
      surfaceConfig.platform.macos.nsview = (__bridge void *)view;
      surfaceConfig.userdata = &session;
      surfaceConfig.scale_factor = parent.window.backingScaleFactor ?: 2.0;
      surfaceConfig.font_size = 12.0;
      surfaceConfig.working_directory = session.workingDirectory.c_str();
      surfaceConfig.command = session.command.c_str();
      surfaceConfig.env_vars = session.envVars.data();
      surfaceConfig.env_var_count = session.envVars.size();
      surfaceConfig.wait_after_command = true;
      surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_TAB;
      session.surface = ghostty_surface_new(gApp, &surfaceConfig);
    }
    if (!session.surface) return;
    ghostty_surface_set_focus(session.surface, true);
    ghostty_surface_set_size(session.surface, (uint32_t)width, (uint32_t)height);
    if (gApp) ghostty_app_tick(gApp);
    [parent.window makeFirstResponder:view];
    gActiveSessionId = sessionId;
    ok = true;
  });

  return NapiBoolean(env, ok);
}

static napi_value UpdateFrame(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 5) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  const CGFloat x = NumberArg(env, args[1]);
  const CGFloat y = NumberArg(env, args[2]);
  const CGFloat width = NumberArg(env, args[3]);
  const CGFloat height = NumberArg(env, args[4]);

  __block bool ok = false;
  RunOnMainSync(^{
    GhosttyHostSession *session = SessionForId(sessionId);
    if (!session || !session->view) return;
    session->view.frame = NSMakeRect(x, y, width, height);
    if (session->surface) {
      ghostty_surface_set_size(session->surface, (uint32_t)width, (uint32_t)height);
      if (gApp) ghostty_app_tick(gApp);
    }
    ok = true;
  });

  return NapiBoolean(env, ok);
}

static napi_value SendText(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  NSString *text = StringArg(env, args[1]);
  std::string bytes = text.UTF8String ?: "";
  if (bytes.empty()) return NapiBoolean(env, false);

  GhosttyHostSession *session = SessionForId(sessionId);
  if (!session || !session->surface) return NapiBoolean(env, false);
  ghostty_surface_text(session->surface, bytes.c_str(), bytes.size());
  if (gApp) ghostty_app_tick(gApp);

  return NapiBoolean(env, true);
}

static napi_value SendKey(napi_env env, napi_callback_info info) {
  size_t argc = 10;
  napi_value args[10];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 10) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  const ghostty_input_action_e action = ActionArg(env, args[1]);
  const uint32_t keyCode = (uint32_t)NumberArg(env, args[2]);
  NSString *text = StringArg(env, args[3]);
  const uint32_t unshiftedCodepoint = (uint32_t)NumberArg(env, args[4]);

  uint32_t mods = GHOSTTY_MODS_NONE;
  if (BoolArg(env, args[5])) mods |= GHOSTTY_MODS_SHIFT;
  if (BoolArg(env, args[6])) mods |= GHOSTTY_MODS_CTRL;
  if (BoolArg(env, args[7])) mods |= GHOSTTY_MODS_ALT;
  if (BoolArg(env, args[8])) mods |= GHOSTTY_MODS_SUPER;
  if (BoolArg(env, args[9])) mods |= GHOSTTY_MODS_CAPS;

  GhosttyHostSession *session = SessionForId(sessionId);
  if (!session || !session->surface) return NapiBoolean(env, false);

  ghostty_input_key_s key = {};
  key.action = action;
  key.keycode = keyCode;
  key.mods = (ghostty_input_mods_e)mods;
  key.consumed_mods = (ghostty_input_mods_e)(mods & ~(GHOSTTY_MODS_CTRL | GHOSTTY_MODS_SUPER));
  key.unshifted_codepoint = unshiftedCodepoint;
  key.composing = false;

  const char *bytes = text.UTF8String;
  if (bytes && static_cast<unsigned char>(bytes[0]) >= 0x20) key.text = bytes;

  ghostty_surface_key(session->surface, key);
  if (gApp) ghostty_app_tick(gApp);

  return NapiBoolean(env, true);
}

static napi_value ReadText(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) return NapiString(env, "", 0);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";

  __block std::string snapshot;
  RunOnMainSync(^{
    GhosttyHostSession *session = SessionForId(sessionId);
    if (!session || !session->surface) return;

    ghostty_selection_s selection = {};
    selection.top_left = {
      GHOSTTY_POINT_SCREEN,
      GHOSTTY_POINT_COORD_TOP_LEFT,
      0,
      0,
    };
    selection.bottom_right = {
      GHOSTTY_POINT_SCREEN,
      GHOSTTY_POINT_COORD_BOTTOM_RIGHT,
      0,
      0,
    };
    selection.rectangle = false;

    ghostty_text_s text = {};
    if (!ghostty_surface_read_text(session->surface, selection, &text)) return;
    if (text.text && text.text_len > 0) snapshot.assign(text.text, text.text_len);
    ghostty_surface_free_text(session->surface, &text);
  });

  return NapiString(env, snapshot.c_str(), snapshot.size());
}

static unsigned short SyntheticKeyCodeForCharacter(unichar character) {
  switch ([[NSString stringWithCharacters:&character length:1].lowercaseString characterAtIndex:0]) {
    case 'a': return 0x00;
    case 's': return 0x01;
    case 'd': return 0x02;
    case 'f': return 0x03;
    case 'h': return 0x04;
    case 'g': return 0x05;
    case 'z': return 0x06;
    case 'x': return 0x07;
    case 'c': return 0x08;
    case 'v': return 0x09;
    case 'b': return 0x0B;
    case 'q': return 0x0C;
    case 'w': return 0x0D;
    case 'e': return 0x0E;
    case 'r': return 0x0F;
    case 'y': return 0x10;
    case 't': return 0x11;
    case 'o': return 0x1F;
    case 'u': return 0x20;
    case 'i': return 0x22;
    case 'p': return 0x23;
    case 'l': return 0x25;
    case 'j': return 0x26;
    case 'k': return 0x28;
    case 'n': return 0x2D;
    case 'm': return 0x2E;
    case '_':
    case '-': return 0x1B;
    default: return 0;
  }
}

static NSEventModifierFlags SyntheticModifierFlagsForCharacter(unichar character) {
  if ([[NSCharacterSet uppercaseLetterCharacterSet] characterIsMember:character]) return NSEventModifierFlagShift;
  if (character == '_') return NSEventModifierFlagShift;
  return 0;
}

static NSString *SyntheticCharactersIgnoringModifiers(NSString *characters) {
  if ([characters isEqualToString:@"_"]) return @"-";
  return characters.lowercaseString;
}

static void SendSyntheticKey(FieldTheoryGhosttyHostView *view, NSString *characters, unsigned short keyCode, NSEventModifierFlags flags = 0) {
  NSString *charactersIgnoringModifiers = SyntheticCharactersIgnoringModifiers(characters);
  NSEvent *down = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                   location:NSZeroPoint
                              modifierFlags:flags
                                  timestamp:[NSDate timeIntervalSinceReferenceDate]
                               windowNumber:view.window.windowNumber
                                    context:nil
                                 characters:characters
                charactersIgnoringModifiers:charactersIgnoringModifiers
                                  isARepeat:NO
                                    keyCode:keyCode];
  NSEvent *up = [NSEvent keyEventWithType:NSEventTypeKeyUp
                                 location:NSZeroPoint
                            modifierFlags:flags
                                timestamp:[NSDate timeIntervalSinceReferenceDate]
                             windowNumber:view.window.windowNumber
                                  context:nil
                               characters:characters
              charactersIgnoringModifiers:charactersIgnoringModifiers
                                isARepeat:NO
                                  keyCode:keyCode];
  [view keyDown:down];
  [view keyUp:up];
}

static napi_value SendSyntheticTextForTesting(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";
  NSString *text = StringArg(env, args[1]);
  if (text.length == 0) return NapiBoolean(env, false);

  RunOnMainAsync(^{
    GhosttyHostSession *session = SessionForId(sessionId);
    if (!session || !session->view || !session->surface) return;
    for (NSUInteger index = 0; index < text.length; index++) {
      NSString *character = [text substringWithRange:NSMakeRange(index, 1)];
      unichar codepoint = [text characterAtIndex:index];
      if (codepoint == '\n' || codepoint == '\r') {
        SendSyntheticKey(session->view, @"\r", 0x24);
      } else {
        SendSyntheticKey(session->view, character, SyntheticKeyCodeForCharacter(codepoint), SyntheticModifierFlagsForCharacter(codepoint));
      }
    }
  });

  return NapiBoolean(env, true);
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) return NapiBoolean(env, false);

  NSString *sessionIdString = StringArg(env, args[0]);
  const std::string sessionId = sessionIdString.UTF8String ?: "";

  RunOnMainSync(^{
    DetachSession(sessionId, true);
  });

  return NapiBoolean(env, true);
}

static void SetFunction(napi_env env, napi_value exports, const char *name, napi_callback callback) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &fn);
  napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
  SetFunction(env, exports, "probe", Probe);
  SetFunction(env, exports, "attachPlaceholder", AttachPlaceholder);
  SetFunction(env, exports, "attachGhostty", AttachGhostty);
  SetFunction(env, exports, "updateFrame", UpdateFrame);
  SetFunction(env, exports, "sendText", SendText);
  SetFunction(env, exports, "sendKey", SendKey);
  SetFunction(env, exports, "readText", ReadText);
  SetFunction(env, exports, "sendSyntheticTextForTesting", SendSyntheticTextForTesting);
  SetFunction(env, exports, "detach", Detach);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
