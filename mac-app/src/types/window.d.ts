// =============================================================================
// Window Type Declarations - Extend the Window interface with our APIs.
// =============================================================================

/**
 * Audio device transport type.
 */
type TransportType = 'usb' | 'bluetooth' | 'built-in' | 'other';

/**
 * Represents an audio device.
 */
interface AudioDevice {
  id: string;
  name: string;
  isInput: boolean;
  isOutput: boolean;
  manufacturer?: string;
  transportType?: TransportType;
  isLittleOne?: boolean;
}

/**
 * Complete audio state.
 */
interface AudioState {
  devices: AudioDevice[];
  defaultInputId: string | null;
  priorityMode: boolean;
  userOverrideId: string | null;
  littleOnePresent: boolean;
  preferredLittleOneId: string | null;
}

/**
 * The audio API exposed by the preload script.
 */
interface AudioAPI {
  getState: () => Promise<AudioState>;
  setPriorityMode: (enabled: boolean) => Promise<void>;
  resetOverride: () => Promise<void>;
  onStateChanged: (callback: (state: AudioState) => void) => () => void;
}

/**
 * Platform information exposed by the preload script.
 */
interface PlatformInfo {
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
}

/**
 * Extend the Window interface with our custom APIs.
 */
declare global {
  interface Window {
    audioAPI?: AudioAPI;
    platform?: PlatformInfo;
  }
}

export {};
