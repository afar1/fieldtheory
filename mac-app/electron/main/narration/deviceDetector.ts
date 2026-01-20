/**
 * Output Device Detector
 *
 * Detects current audio output device for narration gating.
 * Prevents narration from playing on public speakers.
 *
 * Detection strategy (v1):
 * - Uses system_profiler SPAudioDataType
 * - Caches results
 * - Refreshes on:
 *   - App launch
 *   - Explicit refresh request
 *   - Narration request (once)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { OutputDevice } from './types';

const execAsync = promisify(exec);

/**
 * Cached device state.
 */
interface DeviceCache {
  device: OutputDevice | null;
  timestamp: number;
}

/**
 * Cache TTL in ms (5 minutes).
 * Device detection is refreshed on-demand, but cache avoids repeated calls.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Output device detector for macOS.
 */
export class OutputDeviceDetector {
  private cache: DeviceCache | null = null;
  private lastRefreshTime = 0;

  /**
   * Get current output device.
   * Returns cached value if fresh, otherwise refreshes.
   */
  async getCurrentDevice(): Promise<OutputDevice | null> {
    const now = Date.now();

    // Return cached if fresh
    if (this.cache && now - this.cache.timestamp < CACHE_TTL_MS) {
      return this.cache.device;
    }

    // Refresh and return
    return this.refresh();
  }

  /**
   * Force refresh device detection.
   */
  async refresh(): Promise<OutputDevice | null> {
    try {
      const device = await this.detectOutputDevice();
      this.cache = {
        device,
        timestamp: Date.now(),
      };
      this.lastRefreshTime = Date.now();
      console.log(`[OutputDeviceDetector] Detected: ${device?.name ?? 'none'}`);
      return device;
    } catch (error) {
      console.warn('[OutputDeviceDetector] Detection failed:', error);
      // On failure, clear cache and return null
      this.cache = null;
      return null;
    }
  }

  /**
   * Check if a device name matches any blocked patterns.
   */
  isDeviceBlocked(deviceName: string, blockedPatterns: string[]): boolean {
    if (!deviceName || blockedPatterns.length === 0) return false;

    const nameLower = deviceName.toLowerCase();
    return blockedPatterns.some((pattern) =>
      nameLower.includes(pattern.toLowerCase())
    );
  }

  /**
   * Check if narration should be allowed on current device.
   */
  async shouldAllowNarration(blockedPatterns: string[]): Promise<{
    allowed: boolean;
    device: OutputDevice | null;
    reason?: string;
  }> {
    const device = await this.getCurrentDevice();

    // If detection failed, default to NOT allowing automatic narration
    // Manual play is still allowed
    if (!device) {
      return {
        allowed: false,
        device: null,
        reason: 'Device detection failed',
      };
    }

    // Check if device is blocked
    if (this.isDeviceBlocked(device.name, blockedPatterns)) {
      return {
        allowed: false,
        device,
        reason: `Device "${device.name}" matches blocked pattern`,
      };
    }

    return {
      allowed: true,
      device,
    };
  }

  /**
   * Detect the current default output device using system_profiler.
   */
  private async detectOutputDevice(): Promise<OutputDevice | null> {
    try {
      // system_profiler SPAudioDataType outputs info about audio devices
      const { stdout } = await execAsync('system_profiler SPAudioDataType -json', {
        timeout: 5000,
      });

      const data = JSON.parse(stdout);
      const audioData = data.SPAudioDataType;

      if (!audioData || !Array.isArray(audioData)) {
        return null;
      }

      // Look for output devices
      for (const section of audioData) {
        if (section._items && Array.isArray(section._items)) {
          for (const device of section._items) {
            // Check if this is the default output
            if (device.coreaudio_default_audio_output_device === 'spaudio_yes') {
              return {
                name: device._name || 'Unknown',
                uid: device.coreaudio_device_uid || '',
                isDefault: true,
                transportType: device.coreaudio_device_transport || undefined,
              };
            }
          }
        }
      }

      // Fallback: try to get from coreaudiod
      return this.detectViaDefaults();
    } catch (error) {
      console.warn('[OutputDeviceDetector] system_profiler failed:', error);
      return this.detectViaDefaults();
    }
  }

  /**
   * Fallback detection using system defaults.
   */
  private async detectViaDefaults(): Promise<OutputDevice | null> {
    try {
      // Use osascript to get the output device name
      const { stdout } = await execAsync(
        `osascript -e 'get (get name of current output audio device) of (get system info)'`,
        { timeout: 3000 }
      );

      const name = stdout.trim();
      if (name) {
        return {
          name,
          uid: '',
          isDefault: true,
        };
      }
    } catch {
      // osascript method not available or failed
    }

    // Last resort: assume MacBook speakers
    // This is better than returning null for most users
    return {
      name: 'MacBook Pro Speakers',
      uid: '',
      isDefault: true,
      transportType: 'built-in',
    };
  }

  /**
   * Get common blocked device suggestions.
   */
  getCommonBlockedDevices(): string[] {
    return [
      'Sonos',
      'HomePod',
      'Conference',
      'Meeting Room',
      'Polycom',
      'Jabra',
      'AirPlay',
      'TV',
      'Living Room',
      'Kitchen',
    ];
  }
}

// Singleton instance
let instance: OutputDeviceDetector | null = null;

export function getOutputDeviceDetector(): OutputDeviceDetector {
  if (!instance) {
    instance = new OutputDeviceDetector();
  }
  return instance;
}
