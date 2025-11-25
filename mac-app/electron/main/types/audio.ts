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
  | 'log';

/**
 * Message types sent FROM Electron main TO the Swift helper.
 */
export type HelperIncomingMessageType =
  | 'getDevices'
  | 'getDefaultInput'
  | 'setDefaultInput'
  | 'startMonitoring';

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
 * Union type of all possible messages from the helper.
 */
export type HelperOutgoingMessage =
  | DevicesChangedMessage
  | DefaultInputChangedMessage
  | HelperErrorMessage
  | HelperLogMessage;

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

/**
 * Union type of all possible commands to the helper.
 */
export type HelperIncomingCommand =
  | GetDevicesCommand
  | GetDefaultInputCommand
  | SetDefaultInputCommand
  | StartMonitoringCommand;
