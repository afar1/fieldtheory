/**
 * macOS Say Engine
 *
 * Fallback TTS engine using macOS built-in `say` command.
 * Provides a British male voice approximation of the Librarian character.
 *
 * Voice selection priority:
 * 1. Daniel (British English, enhanced - best quality)
 * 2. Oliver (British English)
 * 3. Arthur (British English)
 * 4. System default (if none available)
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  NarrationEngine,
  NarrationProfile,
  NarrateResult,
  MACOS_BRITISH_MALE_VOICES,
  MACOS_FALLBACK_VOICE,
} from '../types';

const execAsync = promisify(exec);

/**
 * Detected macOS voice with quality info.
 */
interface MacOSVoice {
  name: string;
  locale: string;
  quality: 'premium' | 'enhanced' | 'default';
}

/**
 * macOS Say TTS Engine.
 * Uses the `say` command for offline text-to-speech.
 */
export class MacOSSayEngine {
  private availableVoices: MacOSVoice[] = [];
  private selectedVoice: string = MACOS_FALLBACK_VOICE;
  private initialized = false;
  private currentProcess: ChildProcess | null = null;

  /**
   * Initialize the engine by detecting available voices.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.detectVoices();
      this.selectBestVoice();
      this.initialized = true;
      console.log(`[MacOSSayEngine] Initialized with voice: ${this.selectedVoice}`);
    } catch (error) {
      console.error('[MacOSSayEngine] Init failed:', error);
      // Fall back to default, `say` will use system default
      this.selectedVoice = '';
      this.initialized = true;
    }
  }

  /**
   * Detect available voices on the system.
   */
  private async detectVoices(): Promise<void> {
    try {
      // Get list of all installed voices
      const { stdout } = await execAsync('say -v "?"');
      const lines = stdout.trim().split('\n');

      this.availableVoices = [];

      for (const line of lines) {
        // Format: "Voice Name    locale    # description"
        // Example: "Daniel               en_GB    # Daniel is a built-in compact voice."
        const match = line.match(/^(\S+(?:\s+\S+)*?)\s{2,}(\S+)\s+#/);
        if (match) {
          const name = match[1].trim();
          const locale = match[2];

          // Check for enhanced/premium indicators
          let quality: 'premium' | 'enhanced' | 'default' = 'default';
          if (line.includes('premium') || line.includes('Premium')) {
            quality = 'premium';
          } else if (line.includes('enhanced') || line.includes('Enhanced')) {
            quality = 'enhanced';
          }

          this.availableVoices.push({ name, locale, quality });
        }
      }

      console.log(`[MacOSSayEngine] Found ${this.availableVoices.length} voices`);
    } catch (error) {
      console.warn('[MacOSSayEngine] Failed to detect voices:', error);
    }
  }

  /**
   * Select the best available British male voice.
   */
  private selectBestVoice(): void {
    // Check for our preferred voices in order
    for (const preferredName of MACOS_BRITISH_MALE_VOICES) {
      const voice = this.availableVoices.find(
        (v) => v.name === preferredName && v.locale.startsWith('en_GB')
      );
      if (voice) {
        this.selectedVoice = voice.name;
        console.log(`[MacOSSayEngine] Selected voice: ${voice.name} (${voice.quality})`);
        return;
      }
    }

    // Fallback: any British English voice
    const anyBritish = this.availableVoices.find((v) => v.locale.startsWith('en_GB'));
    if (anyBritish) {
      this.selectedVoice = anyBritish.name;
      console.log(`[MacOSSayEngine] Fallback to British voice: ${anyBritish.name}`);
      return;
    }

    // Last resort: use Daniel without locale check (might be installed differently)
    this.selectedVoice = MACOS_FALLBACK_VOICE;
    console.log(`[MacOSSayEngine] Using default fallback: ${this.selectedVoice}`);
  }

  /**
   * Get the currently selected voice.
   */
  getSelectedVoice(): string {
    return this.selectedVoice;
  }

  /**
   * Synthesize text to an audio file.
   */
  async synthesize(
    text: string,
    outputPath: string,
    _profile: NarrationProfile
  ): Promise<NarrateResult> {
    await this.init();

    // Build say command
    // -o outputs to file (AIFF format by default)
    // -v selects voice
    // -r sets rate (words per minute) - Librarian should be deliberate
    // Rate: 175 is slightly slower than default ~200
    const rate = 175;

    const args = ['-o', outputPath, '-r', String(rate)];

    if (this.selectedVoice) {
      args.push('-v', this.selectedVoice);
    }

    // The text is passed via stdin to avoid shell escaping issues
    return new Promise((resolve, reject) => {
      const process = spawn('say', args);
      this.currentProcess = process;

      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        this.currentProcess = null;

        if (code === 0) {
          resolve({
            audioPath: outputPath,
            fromCache: false,
            engine: 'macos_say' as NarrationEngine,
          });
        } else {
          reject(new Error(`say exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });

      // Write text to stdin
      process.stdin.write(text);
      process.stdin.end();
    });
  }

  /**
   * Play an audio file using afplay.
   */
  async play(audioPath: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const process = spawn('afplay', [audioPath]);
      this.currentProcess = process;

      process.on('error', reject);

      // Return immediately, caller can listen to events
      resolve(process);
    });
  }

  /**
   * Stop any current playback.
   */
  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  /**
   * Test voice synthesis with a short phrase.
   */
  async testVoice(): Promise<NarrateResult> {
    await this.init();

    const testText = 'The archive remembers what others forget.';
    const testOutputPath = '/tmp/fieldtheory-macos-say-test.aiff';

    return this.synthesize(testText, testOutputPath, 'librarian_v1');
  }

  /**
   * Check if the engine is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which say');
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let instance: MacOSSayEngine | null = null;

export function getMacOSSayEngine(): MacOSSayEngine {
  if (!instance) {
    instance = new MacOSSayEngine();
  }
  return instance;
}
