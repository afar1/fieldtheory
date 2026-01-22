/**
 * Narration Capability
 *
 * Local, offline text-to-speech for the Librarian.
 * Reads auto-opened readings aloud with a canonical, restrained voice.
 *
 * Architecture:
 * - NarrationManager: Main orchestrator (IPC handlers call this)
 * - NarrationCache: Content-hash based audio caching
 * - MacOSSayEngine: Fallback TTS using macOS say
 * - OutputDeviceDetector: Device gating for public speakers
 *
 * Voice profile (librarian_v1):
 * - Male, ever-so-slightly British
 * - Flat but not robotic
 * - Deliberate pacing, clear consonants
 * - Slightly synthetic, archivist-like
 *
 * Future: Chatterbox sidecar for higher quality synthesis.
 */

export * from './types';
export * from './cache';
export * from './narrationManager';
export * from './deviceDetector';
export * from './engines/macos-say';
export * from './engines/elevenlabs';
