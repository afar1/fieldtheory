/**
 * Renderer-side sound manager using Web Audio API.
 * Provides instant (~1ms) sound playback by preloading sounds as AudioBuffers.
 * This bypasses the main process entirely for minimal latency.
 */

type SoundId = 'windowOpen' | 'windowClose' | 'artifactDiscovery';

// Map sound events to their file names
const SOUND_FILES: Record<SoundId, string> = {
  windowOpen: 'Click.mp3',
  windowClose: 'MenuClose.mp3',
  artifactDiscovery: 'ArtifactDiscovery.wav',
};

class RendererSoundManager {
  private audioContext: AudioContext | null = null;
  private soundBuffers: Map<string, AudioBuffer> = new Map();
  private isPreloaded = false;
  private preloadPromise: Promise<void> | null = null;
  private enabled = true;

  /**
   * Initialize the AudioContext (must be called after user interaction on some browsers).
   */
  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    // Resume if suspended (browsers may suspend until user interaction)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * Preload all sound files as AudioBuffers.
   * Call once when the renderer loads.
   */
  async preload(): Promise<void> {
    // Avoid duplicate preloading
    if (this.preloadPromise) {
      return this.preloadPromise;
    }

    this.preloadPromise = this._doPreload();
    return this.preloadPromise;
  }

  private async _doPreload(): Promise<void> {
    const context = this.ensureContext();
    const soundFiles = Object.values(SOUND_FILES);
    const uniqueFiles = [...new Set(soundFiles)];

    console.log('[RendererSoundManager] Preloading sounds:', uniqueFiles);

    const loadPromises = uniqueFiles.map(async (filename) => {
      try {
        // In Electron, we can access files from the public/sounds directory
        // During dev, Vite serves from public/. In production, it's in resources/sounds/
        const soundPath = `./sounds/${filename}`;
        const response = await fetch(soundPath);

        if (!response.ok) {
          console.warn(`[RendererSoundManager] Failed to fetch ${filename}: ${response.status}`);
          return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        this.soundBuffers.set(filename, audioBuffer);
        console.log(`[RendererSoundManager] Loaded: ${filename}`);
      } catch (error) {
        console.warn(`[RendererSoundManager] Failed to load ${filename}:`, error);
      }
    });

    await Promise.all(loadPromises);
    this.isPreloaded = true;
    console.log(`[RendererSoundManager] Preloaded ${this.soundBuffers.size}/${uniqueFiles.length} sounds`);
  }

  /**
   * Play a sound by its event ID.
   * Returns immediately - playback is fire-and-forget.
   */
  play(soundId: SoundId): void {
    if (!this.enabled) return;

    const filename = SOUND_FILES[soundId];
    if (!filename) {
      console.warn(`[RendererSoundManager] Unknown sound ID: ${soundId}`);
      return;
    }

    const buffer = this.soundBuffers.get(filename);
    if (!buffer) {
      console.warn(`[RendererSoundManager] Sound not preloaded: ${filename}`);
      return;
    }

    try {
      const context = this.ensureContext();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      // Source will be garbage collected after playback completes
    } catch (error) {
      console.warn(`[RendererSoundManager] Failed to play ${filename}:`, error);
    }
  }

  /**
   * Enable or disable sound playback.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if sounds are enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if sounds have been preloaded.
   */
  isReady(): boolean {
    return this.isPreloaded;
  }
}

// Singleton instance
export const rendererSoundManager = new RendererSoundManager();
