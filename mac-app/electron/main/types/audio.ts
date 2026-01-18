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
  | 'recordingCancelled'
  | 'audioLevel'
  | 'permissionsStatus'
  | 'focusedTextInputStatus'
  | 'keyEvent'
  | 'keyboardMonitoringDisabled'
  | 'menuBarClicked'
  | 'appBecameFrontmost'
  | 'frontmostAppChanged'
  | 'frontmostWindowBounds';

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
  | 'cancelRecording'
  | 'checkPermissions'
  | 'startKeyboardMonitoring'
  | 'stopKeyboardMonitoring'
  | 'getFrontmostWindowBounds';

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
 * Key event message from the helper (for global keyboard capture).
 */
export interface KeyEventMessage extends HelperMessage {
  type: 'keyEvent';
  characters: string;
  keyCode: number;
  modifiers: string[];
}

/**
 * Keyboard monitoring disabled message (permission revoked).
 */
export interface KeyboardMonitoringDisabledMessage extends HelperMessage {
  type: 'keyboardMonitoringDisabled';
}

/**
 * Menu bar clicked message.
 * Sent when user clicks in the menu bar area so Field Theory can hide.
 */
export interface MenuBarClickedMessage extends HelperMessage {
  type: 'menuBarClicked';
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
 * Union type of all possible messages from the helper.
 */
export type HelperOutgoingMessage =
  | DevicesChangedMessage
  | DefaultInputChangedMessage
  | HelperErrorMessage
  | HelperLogMessage
  | RecordingStartedMessage
  | RecordingStoppedMessage
  | RecordingCancelledMessage
  | AudioLevelMessage
  | PermissionsStatusMessage
  | FocusedTextInputStatusMessage
  | KeyEventMessage
  | KeyboardMonitoringDisabledMessage
  | MenuBarClickedMessage
  | AppBecameFrontmostMessage
  | FrontmostAppChangedMessage
  | FrontmostWindowBoundsMessage;

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

export interface CancelRecordingCommand {
  type: 'cancelRecording';
}

export interface CheckPermissionsCommand {
  type: 'checkPermissions';
}

export interface CheckFocusedTextInputCommand {
  type: 'checkFocusedTextInput';
}

export interface StartKeyboardMonitoringCommand {
  type: 'startKeyboardMonitoring';
}

export interface StopKeyboardMonitoringCommand {
  type: 'stopKeyboardMonitoring';
}

export interface GetFrontmostWindowBoundsCommand {
  type: 'getFrontmostWindowBounds';
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
  | CancelRecordingCommand
  | CheckPermissionsCommand
  | CheckFocusedTextInputCommand
  | StartKeyboardMonitoringCommand
  | StopKeyboardMonitoringCommand
  | GetFrontmostWindowBoundsCommand;
