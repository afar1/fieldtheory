// =============================================================================
// Audio Device Types - Shared type definitions for the audio priority system.
// These types are used across the Electron main process, renderer, and IPC.
// =============================================================================

/**
 * How the audio device is physically connected to the Mac.
 * Used to distinguish between the USB-C dongle and Bluetooth variants of Little One.
 */
export type TransportType = 'usb' | 'bluetooth' | 'built-in' | 'other';

/**
 * Represents a single audio device as seen by CoreAudio.
 */
export interface AudioDevice {
  // CoreAudio device UID - stable identifier that persists across reboots.
  id: string;

  // Human-readable device name (e.g., "MacBook Pro Microphone", "Wireless Microphone").
  name: string;

  // Whether this device supports audio input (microphone).
  isInput: boolean;

  // Whether this device supports audio output (speakers/headphones).
  isOutput: boolean;

  // Device manufacturer (optional, may not be available for all devices).
  manufacturer?: string;

  // How the device is connected (USB, Bluetooth, built-in, etc.).
  transportType?: TransportType;
}

/**
 * The complete audio state managed by AudioManager.
 * This is the single source of truth for UI rendering and policy decisions.
 */
export interface AudioState {
  // All detected audio devices (both input and output).
  devices: AudioDevice[];

  // The current system default input device ID, or null if none.
  defaultInputId: string | null;

  // Whether priority locking is enabled.
  // When true, we actively enforce the priority device as the default mic.
  priorityMode: boolean;

  // The ID of the device selected by the user to prioritize, or null if none selected.
  priorityDeviceId: string | null;

  // If the user manually changed the default input while priorityMode was ON,
  // this stores that device ID. We respect this override until explicitly cleared.
  userOverrideId: string | null;
}

// =============================================================================
// IPC Message Types - Strongly typed messages for Electron main <-> renderer.
// =============================================================================

/**
 * IPC channels used for audio-related communication.
 * All channels are prefixed with 'audio:' for namespacing.
 */
export const AudioIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_STATE: 'audio:getState',
  SET_PRIORITY_MODE: 'audio:setPriorityMode',
  SET_PRIORITY_DEVICE: 'audio:setPriorityDevice',
  RESET_OVERRIDE: 'audio:resetOverride',
  GET_FAVORITE_DEVICE_NAME: 'audio:getFavoriteDeviceName',
  SET_FAVORITE_DEVICE: 'audio:setFavoriteDevice',
  CLEAR_FAVORITE_DEVICE: 'audio:clearFavoriteDevice',

  // Main -> Renderer (send pattern, broadcast)
  STATE_CHANGED: 'audio:stateChanged',
} as const;

/**
 * Payload for setting priority mode.
 */
export interface SetPriorityModePayload {
  enabled: boolean;
}

/**
 * Payload for setting priority device.
 */
export interface SetPriorityDevicePayload {
  deviceId: string | null;
}

// =============================================================================
// Native Helper Message Types - JSON protocol between Electron and Swift CLI.
// =============================================================================

/**
 * Message types sent FROM the Swift helper TO Electron main.
 */
export type HelperOutgoingMessageType =
  | 'devicesChanged'
  | 'defaultInputChanged'
  | 'error'
  | 'log'
  | 'recordingStarted'
  | 'recordingStopped'
  | 'recordingSnapshot'
  | 'recordingCancelled'
  | 'recordingChunkReady'
  | 'audioLevel'
  | 'permissionsStatus'
  | 'focusedTextInputStatus'
  | 'appBecameFrontmost'
  | 'frontmostAppChanged'
  | 'frontmostWindowBounds'
  | 'soundsPreloaded'
  | 'typeIntoAppResult'
  | 'focusWindowByTitleResult';

/**
 * Message types sent FROM Electron main TO the Swift helper.
 */
export type HelperIncomingMessageType =
  | 'getDevices'
  | 'getDefaultInput'
  | 'setDefaultInput'
  | 'startMonitoring'
  | 'startRecording'
  | 'stopRecording'
  | 'snapshotRecording'
  | 'cancelRecording'
  | 'checkPermissions'
  | 'getFrontmostWindowBounds'
  | 'preloadSounds'
  | 'playSound'
  | 'stopSounds'
  | 'typeIntoApp'
  | 'focusWindowByTitle'
  | 'setHarvestMode';

/**
 * Base interface for all messages from the native helper.
 */
export interface HelperMessage {
  type: string;
}

/**
 * Device list update from the helper.
 */
export interface DevicesChangedMessage extends HelperMessage {
  type: 'devicesChanged';
  devices: AudioDevice[];
}

/**
 * Default input device changed notification from the helper.
 */
export interface DefaultInputChangedMessage extends HelperMessage {
  type: 'defaultInputChanged';
  deviceId: string | null;
}

/**
 * Error message from the helper.
 */
export interface HelperErrorMessage extends HelperMessage {
  type: 'error';
  message: string;
}

/**
 * Log message from the helper (for debugging).
 */
export interface HelperLogMessage extends HelperMessage {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Recording started message from the helper.
 */
export interface RecordingStartedMessage extends HelperMessage {
  type: 'recordingStarted';
}

/**
 * Recording stopped message from the helper.
 */
export interface RecordingStoppedMessage extends HelperMessage {
  type: 'recordingStopped';
  filePath: string;
}

/**
 * Recording snapshot message from the helper.
 */
export interface RecordingSnapshotMessage extends HelperMessage {
  type: 'recordingSnapshot';
  filePath: string;
}

/**
 * Recording chunk ready message from the helper.
 * Sent when Swift's silence detection triggers an auto-snapshot.
 */
export interface RecordingChunkReadyMessage extends HelperMessage {
  type: 'recordingChunkReady';
  filePath: string;
}

/**
 * Recording cancelled message from the helper.
 */
export interface RecordingCancelledMessage extends HelperMessage {
  type: 'recordingCancelled';
}

/**
 * Audio level message from the helper (for live waveform display).
 */
export interface AudioLevelMessage extends HelperMessage {
  type: 'audioLevel';
  level: number; // 0.0 to 1.0
}

/**
 * Permissions status message from the helper.
 */
export interface PermissionsStatusMessage extends HelperMessage {
  type: 'permissionsStatus';
  accessibilityGranted: boolean;
}

/**
 * Focused text input status message from the helper.
 * Used to detect if paste will work before attempting.
 */
export interface FocusedTextInputStatusMessage extends HelperMessage {
  type: 'focusedTextInputStatus';
  hasTextInput: boolean;
}

/**
 * App became frontmost message.
 * Sent when Field Theory becomes the frontmost app (e.g., via Cmd+Tab).
 */
export interface AppBecameFrontmostMessage extends HelperMessage {
  type: 'appBecameFrontmost';
}

/**
 * Frontmost app changed message.
 * Sent when any app becomes frontmost (not just Field Theory).
 * Includes window bounds for positioning UI elements like the command launcher.
 */
export interface FrontmostAppChangedMessage extends HelperMessage {
  type: 'frontmostAppChanged';
  bundleId: string | null;
  name: string | null;
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

/**
 * Frontmost window bounds message (on-demand response).
 * Sent in response to getFrontmostWindowBounds command.
 */
export interface FrontmostWindowBoundsMessage extends HelperMessage {
  type: 'frontmostWindowBounds';
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

/**
 * Sounds preloaded message.
 * Sent after preloadSounds command completes.
 */
export interface SoundsPreloadedMessage extends HelperMessage {
  type: 'soundsPreloaded';
  count: number;
}

/**
 * Result of typeIntoApp command.
 * Sent after text has been typed (or failed) into the target app.
 */
export interface TypeIntoAppResultMessage extends HelperMessage {
  type: 'typeIntoAppResult';
  success: boolean;
  error?: string;
}

/**
 * Result of focusWindowByTitle command.
 * Sent after attempting to focus a window by title substring.
 */
export interface FocusWindowByTitleResultMessage extends HelperMessage {
  type: 'focusWindowByTitleResult';
  success: boolean;
  error?: string;
}

/**
 * Union type of all possible messages from the helper.
 */
export type HelperOutgoingMessage =
  | DevicesChangedMessage
  | DefaultInputChangedMessage
  | HelperErrorMessage
  | HelperLogMessage
  | RecordingStartedMessage
  | RecordingStoppedMessage
  | RecordingSnapshotMessage
  | RecordingChunkReadyMessage
  | RecordingCancelledMessage
  | AudioLevelMessage
  | PermissionsStatusMessage
  | FocusedTextInputStatusMessage
  | AppBecameFrontmostMessage
  | FrontmostAppChangedMessage
  | FrontmostWindowBoundsMessage
  | SoundsPreloadedMessage
  | TypeIntoAppResultMessage
  | FocusWindowByTitleResultMessage;

/**
 * Commands sent to the helper.
 */
export interface GetDevicesCommand {
  type: 'getDevices';
}

export interface GetDefaultInputCommand {
  type: 'getDefaultInput';
}

export interface SetDefaultInputCommand {
  type: 'setDefaultInput';
  deviceId: string;
}

export interface StartMonitoringCommand {
  type: 'startMonitoring';
}

export interface StartRecordingCommand {
  type: 'startRecording';
}

export interface StopRecordingCommand {
  type: 'stopRecording';
}

export interface SnapshotRecordingCommand {
  type: 'snapshotRecording';
}

export interface CancelRecordingCommand {
  type: 'cancelRecording';
}

export interface CheckPermissionsCommand {
  type: 'checkPermissions';
}

export interface CheckFocusedTextInputCommand {
  type: 'checkFocusedTextInput';
}

export interface GetFrontmostWindowBoundsCommand {
  type: 'getFrontmostWindowBounds';
}

export interface PreloadSoundsCommand {
  type: 'preloadSounds';
  soundPaths: string[];
}

export interface PlaySoundCommand {
  type: 'playSound';
  soundPath: string;
}

export interface StopSoundsCommand {
  type: 'stopSounds';
}

/**
 * Command to type text into a specific app via pasteboard + CGEvent.
 */
export interface TypeIntoAppCommand {
  type: 'typeIntoApp';
  bundleId: string;
  text: string;
  pressEnter: boolean;
}

/**
 * Command to focus a specific window of an app by title substring.
 */
export interface FocusWindowByTitleCommand {
  type: 'focusWindowByTitle';
  bundleId: string;
  titleSubstring: string;
}

/**
 * Command to set the harvest mode for Swift silence detection.
 */
export interface SetHarvestModeCommand {
  type: 'setHarvestMode';
  mode: 'command' | 'dictation';
}

/**
 * Union type of all possible commands to the helper.
 */
export type HelperIncomingCommand =
  | GetDevicesCommand
  | GetDefaultInputCommand
  | SetDefaultInputCommand
  | StartMonitoringCommand
  | StartRecordingCommand
  | StopRecordingCommand
  | SnapshotRecordingCommand
  | CancelRecordingCommand
  | CheckPermissionsCommand
  | CheckFocusedTextInputCommand
  | GetFrontmostWindowBoundsCommand
  | PreloadSoundsCommand
  | PlaySoundCommand
  | StopSoundsCommand
  | TypeIntoAppCommand
  | FocusWindowByTitleCommand
  | SetHarvestModeCommand;
