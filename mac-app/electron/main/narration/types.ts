/**
 * Narration Capability Types
 *
 * Local, offline text-to-speech for the Librarian.
 * Capability-oriented architecture with profiles.
 */

/**
 * Narration profile identifier.
 * v1 hard-codes librarian_v1 only.
 */
export type NarrationProfile = 'librarian_v1';

/**
 * Current narration engine being used.
 */
export type NarrationEngine = 'chatterbox' | 'macos_say' | 'elevenlabs';

/**
 * Installation status for the narration capability.
 */
export type NarrationInstallStatus =
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'install_failed';

/**
 * Playback status for a narration.
 */
export type NarrationPlaybackStatus =
  | 'idle'
  | 'generating'
  | 'playing'
  | 'paused'
  | 'stopped';

/**
 * Synthesis parameters for voice generation.
 * Chatterbox-specific but abstracted for future engines.
 */
export interface SynthesisParameters {
  /** Emotional exaggeration (0-1). Librarian target: 0.35 */
  exaggeration: number;
  /** CFG weight for guidance (0-1). Librarian target: 0.30 */
  cfgWeight: number;
  /** Temperature for variation (0-1). Librarian target: 0.75 */
  temperature: number;
}

/**
 * Default synthesis parameters for librarian_v1 profile.
 * Voice: The Librarian from Snow Crash - measured, confident, slightly British.
 * Imparts knowledge with authority but never pompous or overbearing.
 */
export const LIBRARIAN_V1_PARAMS: SynthesisParameters = {
  exaggeration: 0.20,  // Low for measured, calm delivery
  cfgWeight: 0.45,     // Higher for consistent authority
  temperature: 0.75,
};

/**
 * Text chunking constants for long content.
 * Chunking prevents memory issues and enables continuous playback.
 */
export const CHUNK_MIN_LENGTH = 100;   // Min chars per chunk (avoid tiny chunks)
export const CHUNK_MAX_LENGTH = 1000;  // Max chars per chunk (~150 words, memory safe)
export const CHUNK_THRESHOLD = 500;    // Only chunk texts longer than this

/**
 * macOS say voice configuration for fallback.
 * British male voices available in macOS.
 */
export const MACOS_BRITISH_MALE_VOICES = [
  'Daniel',      // British English (highest quality)
  'Oliver',      // British English
  'Arthur',      // British English (enhanced)
] as const;

/**
 * Preferred macOS voice for librarian fallback.
 */
export const MACOS_FALLBACK_VOICE = 'Daniel';

/**
 * Options for narration synthesis.
 */
export interface NarrateOptions {
  /** Profile to use. v1 only supports librarian_v1. */
  profile?: NarrationProfile;
  /** Force regeneration even if cached. */
  forceRegenerate?: boolean;
}

/**
 * Result from narration synthesis.
 */
export interface NarrateResult {
  /** Path to the generated audio file. */
  audioPath: string;
  /** Whether this was served from cache. */
  fromCache: boolean;
  /** Duration in milliseconds (if known). */
  durationMs?: number;
  /** Engine that generated the audio. */
  engine: NarrationEngine;
}

/**
 * Status returned by getStatus().
 */
export interface NarrationStatus {
  /** Installation state. */
  installStatus: NarrationInstallStatus;
  /** Current playback state. */
  playbackStatus: NarrationPlaybackStatus;
  /** Engine being used (if installed). */
  engine: NarrationEngine | null;
  /** Currently playing reading path (if any). */
  currentReadingPath: string | null;
  /** Cache size in bytes. */
  cacheSizeBytes: number;
  /** Number of cached items. */
  cachedItemCount: number;
  /** Whether Chatterbox is installed. */
  chatterboxInstalled?: boolean;
  /** Whether Chatterbox is currently installing. */
  chatterboxInstalling?: boolean;
  /** User's preferred engine. */
  preferredEngine?: NarrationEngine;
  /** Whether ElevenLabs is configured (has API key). */
  elevenlabsConfigured?: boolean;
  /** Currently selected ElevenLabs voice ID. */
  elevenlabsVoiceId?: string;
}

/**
 * Output device information for gating.
 */
export interface OutputDevice {
  /** Device name as reported by system. */
  name: string;
  /** Device UID. */
  uid: string;
  /** Whether this is the current default output. */
  isDefault: boolean;
  /** Transport type (e.g., 'built-in', 'bluetooth', 'usb'). */
  transportType?: string;
}

/**
 * ElevenLabs voice configuration.
 */
export interface ElevenLabsVoice {
  /** Voice ID from ElevenLabs. */
  voiceId: string;
  /** Display name. */
  name: string;
  /** Speed multiplier (1.0 = normal, 1.18 = 18% faster). */
  speed?: number;
}

/**
 * Default ElevenLabs voices for the Librarian character.
 * Custom voices with optimized speed settings.
 */
export const ELEVENLABS_LIBRARIAN_VOICES: ElevenLabsVoice[] = [
  { voiceId: 'PIGsltMj3gFMR34aFDI3', name: 'Male', speed: 1.0 },
  { voiceId: 'bD9maNcCuQQS75DGuteM', name: 'Female', speed: 1.10 },
];

/**
 * Narration settings stored in preferences.
 */
export interface NarrationPreferences {
  /** Whether narration capability is installed. */
  installed: boolean;
  /** Installed version (for updates). */
  installedVersion?: string;
  /** Whether to auto-speak on reading open. */
  speakOnOpen: boolean;
  /** Blocked device name substrings (case-insensitive). */
  blockedDevices: string[];
  /** Cache size limit in bytes (default 2GB). */
  cacheSizeLimitBytes: number;
  /** Preferred narration engine. */
  preferredEngine?: NarrationEngine;
  /** ElevenLabs API key (stored securely). */
  elevenlabsApiKey?: string;
  /** ElevenLabs voice ID to use. */
  elevenlabsVoiceId?: string;
  /** ElevenLabs model ID (defaults to eleven_multilingual_v2). */
  elevenlabsModelId?: string;
}

/**
 * Default narration preferences.
 */
export const DEFAULT_NARRATION_PREFS: NarrationPreferences = {
  installed: false,
  speakOnOpen: false, // Off by default, user must enable
  blockedDevices: [],
  cacheSizeLimitBytes: 2 * 1024 * 1024 * 1024, // 2 GB
};

/**
 * Cache entry for narration audio.
 */
export interface NarrationCacheEntry {
  /** Content hash (SHA-256 of text + profile + params). */
  contentHash: string;
  /** Path to audio file. */
  audioPath: string;
  /** Profile used. */
  profile: NarrationProfile;
  /** Engine that generated it. */
  engine: NarrationEngine;
  /** File size in bytes. */
  sizeBytes: number;
  /** Created timestamp. */
  createdAt: number;
  /** Last accessed timestamp (for LRU). */
  lastAccessedAt: number;
}

/**
 * Cache manifest stored on disk.
 */
export interface NarrationCacheManifest {
  /** Version for migrations. */
  version: number;
  /** Map of content hash to cache entry. */
  entries: Record<string, NarrationCacheEntry>;
  /** Map of reading path to last known content hash. */
  readingHashes: Record<string, string>;
}

/**
 * Deliberate pause before playback (part of Librarian character).
 * 200-400ms as specified.
 */
export const PLAYBACK_DELAY_MS = 300;

/**
 * IPC channel names for narration.
 */
export const NarrationIPCChannels = {
  INSTALL: 'narration:install',
  GET_STATUS: 'narration:getStatus',
  PLAY_READING: 'narration:playReading',
  STOP: 'narration:stop',
  PAUSE: 'narration:pause',
  RESUME: 'narration:resume',
  TOGGLE_PAUSE: 'narration:togglePause',
  GET_PLAYBACK_PROGRESS: 'narration:getPlaybackProgress',
  GET_OUTPUT_DEVICE: 'narration:getOutputDevice',
  REFRESH_DEVICES: 'narration:refreshDevices',
  GET_PREFS: 'narration:getPrefs',
  SET_SPEAK_ON_OPEN: 'narration:setSpeakOnOpen',
  ADD_BLOCKED_DEVICE: 'narration:addBlockedDevice',
  REMOVE_BLOCKED_DEVICE: 'narration:removeBlockedDevice',
  CLEAR_CACHE: 'narration:clearCache',
  // Chatterbox-specific
  CHECK_CHATTERBOX_REQUIREMENTS: 'narration:checkChatterboxRequirements',
  INSTALL_CHATTERBOX: 'narration:installChatterbox',
  GET_CHATTERBOX_STATUS: 'narration:getChatterboxStatus',
  TEST_CHATTERBOX_VOICE: 'narration:testChatterboxVoice',
  TEST_MACOS_VOICE: 'narration:testMacOSVoice',
  SET_PREFERRED_ENGINE: 'narration:setPreferredEngine',
  // ElevenLabs-specific
  SET_ELEVENLABS_API_KEY: 'narration:setElevenlabsApiKey',
  SET_ELEVENLABS_VOICE: 'narration:setElevenlabsVoice',
  TEST_ELEVENLABS_VOICE: 'narration:testElevenlabsVoice',
  GET_ELEVENLABS_VOICES: 'narration:getElevenlabsVoices',
  CHECK_ELEVENLABS_CONNECTION: 'narration:checkElevenlabsConnection',
  GET_LIBRARIAN_VOICES: 'narration:getLibrarianVoices',
  GET_CURRENT_VOICE_ID: 'narration:getCurrentVoiceId',
  // Events (renderer listens)
  GENERATION_STARTED: 'narration:generationStarted',
  PLAYBACK_STARTED: 'narration:playbackStarted',
  PLAYBACK_PAUSED: 'narration:playbackPaused',
  PLAYBACK_RESUMED: 'narration:playbackResumed',
  PLAYBACK_STOPPED: 'narration:playbackStopped',
  PLAYBACK_ERROR: 'narration:playbackError',
  INSTALL_PROGRESS: 'narration:installProgress',
} as const;
