/**
 * ElevenLabs TTS Engine
 *
 * Cloud-based high-quality TTS using ElevenLabs API.
 * Requires internet connection and API key.
 *
 * Voice profile (librarian_v1):
 * - Male, ever-so-slightly British
 * - Flat but not robotic
 * - Low emotional variance
 * - Deliberate pacing
 */

import https from 'https';
import fs from 'fs/promises';
import { createWriteStream, WriteStream } from 'fs';
import path from 'path';
import {
  NarrationEngine,
  NarrationProfile,
  NarrateResult,
  ELEVENLABS_LIBRARIAN_VOICES,
} from '../types';

/**
 * ElevenLabs API configuration.
 */
const ELEVENLABS_API_BASE = 'api.elevenlabs.io';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Voice information from ElevenLabs API.
 */
export interface ElevenLabsVoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

/**
 * ElevenLabs engine status.
 */
export interface ElevenLabsStatus {
  configured: boolean;
  connected: boolean;
  voiceId?: string;
  voiceName?: string;
  error?: string;
}

/**
 * ElevenLabs TTS engine.
 * Cloud-based synthesis using ElevenLabs API.
 */
export class ElevenLabsEngine {
  private apiKey: string | null = null;
  private voiceId: string;
  private modelId: string;
  private lastConnectionCheck: number = 0;
  private connectionValid: boolean = false;

  constructor() {
    // Default to Male voice
    this.voiceId = 'PIGsltMj3gFMR34aFDI3';
    this.modelId = DEFAULT_MODEL_ID;
  }

  /**
   * Configure the engine with API key.
   */
  configure(apiKey: string, voiceId?: string, modelId?: string): void {
    this.apiKey = apiKey;
    if (voiceId) this.voiceId = voiceId;
    if (modelId) this.modelId = modelId;
    // Invalidate connection check
    this.lastConnectionCheck = 0;
    this.connectionValid = false;
    console.log('[ElevenLabs] Configured with voice:', this.voiceId);
  }

  /**
   * Check if engine is configured (has API key).
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Get current voice ID.
   */
  getVoiceId(): string {
    return this.voiceId;
  }

  /**
   * Set voice ID.
   */
  setVoiceId(voiceId: string): void {
    this.voiceId = voiceId;
    console.log('[ElevenLabs] Voice set to:', voiceId);
  }

  /**
   * Check connection to ElevenLabs API.
   * Caches result for 5 minutes.
   */
  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    if (!this.apiKey) {
      return { connected: false, error: 'API key not configured' };
    }

    // Use cached result if recent
    const now = Date.now();
    if (now - this.lastConnectionCheck < 5 * 60 * 1000 && this.connectionValid) {
      return { connected: true };
    }

    try {
      // Try to fetch user info as a connection test
      await this.apiRequest<{ subscription: unknown }>('/v1/user', 'GET');
      this.lastConnectionCheck = now;
      this.connectionValid = true;
      return { connected: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.connectionValid = false;
      return { connected: false, error: message };
    }
  }

  /**
   * Get available voices from ElevenLabs.
   */
  async getVoices(): Promise<ElevenLabsVoiceInfo[]> {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    const response = await this.apiRequest<{ voices: ElevenLabsVoiceInfo[] }>(
      '/v1/voices',
      'GET'
    );
    return response.voices;
  }

  /**
   * Synthesize text to audio file.
   */
  async synthesize(
    text: string,
    outputPath: string,
    _profile: NarrationProfile
  ): Promise<NarrateResult> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    console.log(`[ElevenLabs] Synthesizing ${text.length} chars with voice ${this.voiceId}...`);
    const startTime = Date.now();

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Make TTS request
    const audioData = await this.textToSpeech(text);

    // Write to file
    await fs.writeFile(outputPath, audioData);

    const synthesisTime = Date.now() - startTime;
    console.log(`[ElevenLabs] Synthesis complete in ${synthesisTime}ms: ${outputPath}`);

    return {
      audioPath: outputPath,
      fromCache: false,
      engine: 'elevenlabs' as NarrationEngine,
    };
  }

  /**
   * Test voice with a sample phrase.
   */
  async testVoice(outputDir: string): Promise<NarrateResult> {
    const testText = 'The archive remembers what others forget.';
    const testOutputPath = path.join(outputDir, 'elevenlabs-test.mp3');

    return this.synthesize(testText, testOutputPath, 'librarian_v1');
  }

  /**
   * Get engine status.
   */
  async getStatus(): Promise<ElevenLabsStatus> {
    const configured = this.isConfigured();

    if (!configured) {
      return { configured: false, connected: false };
    }

    const connectionCheck = await this.checkConnection();
    const voiceInfo = ELEVENLABS_LIBRARIAN_VOICES.find(v => v.voiceId === this.voiceId);

    return {
      configured: true,
      connected: connectionCheck.connected,
      voiceId: this.voiceId,
      voiceName: voiceInfo?.name || 'Custom Voice',
      error: connectionCheck.error,
    };
  }

  // ==================== Private Methods ====================

  /**
   * Make text-to-speech API request.
   */
  private async textToSpeech(text: string): Promise<Buffer> {
    // Look up speed setting for current voice
    const voiceConfig = ELEVENLABS_LIBRARIAN_VOICES.find(v => v.voiceId === this.voiceId);
    const speed = voiceConfig?.speed ?? 1.0;

    return new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        text,
        model_id: this.modelId,
        output_format: DEFAULT_OUTPUT_FORMAT,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed,
        },
      });

      const options: https.RequestOptions = {
        hostname: ELEVENLABS_API_BASE,
        port: 443,
        path: `/v1/text-to-speech/${this.voiceId}`,
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey!,
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          let errorData = '';
          res.on('data', (chunk) => (errorData += chunk));
          res.on('end', () => {
            try {
              const error = JSON.parse(errorData);
              reject(new Error(error.detail?.message || `API error: ${res.statusCode}`));
            } catch {
              reject(new Error(`API error: ${res.statusCode} - ${errorData}`));
            }
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Make generic API request.
   */
  private apiRequest<T>(endpoint: string, method: string, body?: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestBody = body ? JSON.stringify(body) : undefined;

      const options: https.RequestOptions = {
        hostname: ELEVENLABS_API_BASE,
        port: 443,
        path: endpoint,
        method,
        headers: {
          'Accept': 'application/json',
          'xi-api-key': this.apiKey!,
          ...(requestBody && {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          }),
        },
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            try {
              const error = JSON.parse(data);
              reject(new Error(error.detail?.message || `API error: ${res.statusCode}`));
            } catch {
              reject(new Error(`API error: ${res.statusCode}`));
            }
            return;
          }

          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }
}

// Singleton instance
let instance: ElevenLabsEngine | null = null;

export function getElevenLabsEngine(): ElevenLabsEngine {
  if (!instance) {
    instance = new ElevenLabsEngine();
  }
  return instance;
}
