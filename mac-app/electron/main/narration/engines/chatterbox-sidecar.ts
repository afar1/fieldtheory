/**
 * Chatterbox Sidecar Engine
 *
 * High-quality TTS engine using Chatterbox model via Python HTTP sidecar.
 * Apple Silicon only (MPS acceleration).
 *
 * Voice profile (librarian_v1):
 * - Male, ever-so-slightly British
 * - Flat but not robotic
 * - Low emotional variance
 * - Deliberate pacing
 *
 * Storage: ~/Library/Application Support/Field Theory/Narration/chatterbox/
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import { spawn, ChildProcess, execSync, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import {
  NarrationEngine,
  NarrationProfile,
  NarrateResult,
  SynthesisParameters,
  LIBRARIAN_V1_PARAMS,
} from '../types';

/**
 * Sidecar process state.
 */
type SidecarState = 'stopped' | 'starting' | 'ready' | 'busy' | 'error';

/**
 * Installation status for Chatterbox.
 */
export interface ChatterboxInstallStatus {
  installed: boolean;
  installing: boolean;
  version?: string;
  pythonPath?: string;
  error?: string;
}

/**
 * Sidecar health response.
 */
interface SidecarHealthResponse {
  status: 'ready' | 'loading' | 'idle';
  model_loaded: boolean;
  device: string;
  sample_rate: number;
}

/**
 * Synthesis response from sidecar.
 */
interface SynthesisResponse {
  audio_path: string;
  duration_ms: number;
  sample_rate: number;
  synthesis_time_ms: number;
}

// Constants
const CHATTERBOX_DIR_NAME = 'chatterbox';
const VENV_DIR_NAME = 'venv';
const CONFIG_FILE = 'config.json';
const SERVER_SCRIPT = 'server.py';
const PID_FILE = 'sidecar.pid';
const BASE_PORT = 31337;
const STARTUP_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 120000;
const MIN_DISK_SPACE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/**
 * Chatterbox sidecar engine.
 * High-quality local TTS using Chatterbox model via Python HTTP server.
 */
export class ChatterboxSidecarEngine extends EventEmitter {
  private state: SidecarState = 'stopped';
  private sidecarProcess: ChildProcess | null = null;
  private sidecarPort: number | null = null;
  private installStatus: ChatterboxInstallStatus = {
    installed: false,
    installing: false,
  };

  private baseDir: string;
  private venvDir: string;
  private configPath: string;

  constructor() {
    super();
    // ~/Library/Application Support/Field Theory/Narration/chatterbox/
    this.baseDir = path.join(
      app.getPath('userData'),
      'Narration',
      CHATTERBOX_DIR_NAME
    );
    this.venvDir = path.join(this.baseDir, VENV_DIR_NAME);
    this.configPath = path.join(this.baseDir, CONFIG_FILE);
  }

  /**
   * Check if Chatterbox is installed.
   */
  async isInstalled(): Promise<boolean> {
    try {
      // Check venv exists
      await fs.access(path.join(this.venvDir, 'bin', 'python'));

      // Check config exists
      await fs.access(this.configPath);
      const config = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));

      // Check server.py exists
      await fs.access(path.join(this.baseDir, SERVER_SCRIPT));

      this.installStatus.installed = true;
      this.installStatus.version = config.version;
      this.installStatus.pythonPath = config.pythonPath;
      return true;
    } catch {
      this.installStatus.installed = false;
      return false;
    }
  }

  /**
   * Get current installation status.
   */
  getInstallStatus(): ChatterboxInstallStatus {
    return { ...this.installStatus };
  }

  /**
   * Check installation requirements before starting.
   * Returns null if all requirements met, or an error message if not.
   */
  async checkRequirements(): Promise<{
    canInstall: boolean;
    error?: string;
    pythonUrl?: string;
  }> {
    // Check Apple Silicon
    if (!this.isAppleSilicon()) {
      return {
        canInstall: false,
        error: 'Chatterbox requires Apple Silicon (M1/M2/M3/M4). Intel Macs are not supported.',
      };
    }

    // Check Python
    const pythonPath = await this.findPython();
    if (!pythonPath) {
      return {
        canInstall: false,
        error: 'Python 3.9+ is required.',
        pythonUrl: 'https://www.python.org/downloads/',
      };
    }

    // Check disk space
    const freeSpace = await this.getFreeDiskSpace();
    if (freeSpace < MIN_DISK_SPACE_BYTES) {
      const freeGB = (freeSpace / (1024 * 1024 * 1024)).toFixed(1);
      return {
        canInstall: false,
        error: `Need 5GB free space. Only ${freeGB}GB available.`,
      };
    }

    return { canInstall: true };
  }

  /**
   * Install Chatterbox runtime and dependencies.
   * Emits progress events during installation.
   */
  async install(
    onProgress?: (progress: number, message: string) => void
  ): Promise<boolean> {
    if (this.installStatus.installing) {
      console.warn('[ChatterboxSidecar] Installation already in progress');
      return false;
    }

    this.installStatus.installing = true;
    this.installStatus.error = undefined;

    try {
      // Step 1: Check Apple Silicon (5%)
      onProgress?.(5, 'Checking system requirements...');
      if (!this.isAppleSilicon()) {
        throw new Error(
          'Chatterbox requires Apple Silicon (M1/M2/M3/M4). Intel Macs are not supported.'
        );
      }

      // Step 2: Find Python (10%)
      onProgress?.(10, 'Finding Python...');
      const pythonPath = await this.findPython();
      if (!pythonPath) {
        throw new Error(
          'Python 3.9+ is required. Download from https://www.python.org/downloads/ and install, then try again.'
        );
      }
      console.log(`[ChatterboxSidecar] Using Python: ${pythonPath}`);

      // Step 3: Check disk space (15%)
      onProgress?.(15, 'Checking disk space...');
      const freeSpace = await this.getFreeDiskSpace();
      if (freeSpace < MIN_DISK_SPACE_BYTES) {
        const freeGB = (freeSpace / (1024 * 1024 * 1024)).toFixed(1);
        throw new Error(
          `Need 5GB free space for Chatterbox. Only ${freeGB}GB available.`
        );
      }

      // Step 4: Create directory structure (20%)
      onProgress?.(20, 'Creating directories...');
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'logs'), { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'reference'), { recursive: true });

      // Step 5: Create virtual environment (25%)
      onProgress?.(25, 'Creating Python environment...');
      await this.createVenv(pythonPath);

      // Step 6: Install dependencies (30-80%)
      onProgress?.(30, 'Installing Chatterbox (~2GB download)...');
      await this.installDependencies((pipProgress, pipMessage) => {
        // Map pip progress (0-100) to our range (30-80)
        const mappedProgress = 30 + (pipProgress * 0.5);
        onProgress?.(mappedProgress, pipMessage);
      });

      // Step 7: Copy server script (85%)
      onProgress?.(85, 'Setting up server...');
      await this.copyServerScript();

      // Step 8: Verify installation (90%)
      onProgress?.(90, 'Verifying installation...');
      await this.verifyInstallation();

      // Step 9: Save config (95%)
      onProgress?.(95, 'Saving configuration...');
      await this.saveConfig(pythonPath);

      // Done (100%)
      onProgress?.(100, 'Installation complete');
      this.installStatus.installed = true;
      this.installStatus.installing = false;
      this.installStatus.pythonPath = pythonPath;
      console.log('[ChatterboxSidecar] Installation complete');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatterboxSidecar] Installation failed:', message);
      this.installStatus.installing = false;
      this.installStatus.error = message;
      onProgress?.(0, `Installation failed: ${message}`);

      // Clean up partial installation
      await this.cleanupFailedInstall();

      return false;
    }
  }

  /**
   * Clean up a failed or partial installation.
   */
  async cleanupFailedInstall(): Promise<void> {
    console.log('[ChatterboxSidecar] Cleaning up failed installation...');
    try {
      // Check if config exists (indicates successful install)
      try {
        await fs.access(this.configPath);
        // Config exists, don't clean up - this might be a valid install
        console.log('[ChatterboxSidecar] Config exists, skipping cleanup');
        return;
      } catch {
        // No config, safe to clean up
      }

      // Remove the entire chatterbox directory
      await fs.rm(this.baseDir, { recursive: true, force: true });
      console.log('[ChatterboxSidecar] Cleaned up partial installation');
    } catch (cleanupError) {
      console.warn('[ChatterboxSidecar] Cleanup warning:', cleanupError);
    }
  }

  /**
   * Start the sidecar process.
   */
  async start(): Promise<boolean> {
    if (this.state === 'ready') {
      return true;
    }

    if (this.state === 'starting') {
      // Wait for startup to complete
      return this.waitForReady();
    }

    if (!(await this.isInstalled())) {
      console.warn('[ChatterboxSidecar] Cannot start: not installed');
      return false;
    }

    // Kill any orphaned process
    await this.killOrphanProcess();

    this.state = 'starting';
    console.log('[ChatterboxSidecar] Starting sidecar...');

    return new Promise((resolve) => {
      const pythonPath = path.join(this.venvDir, 'bin', 'python');
      const serverPath = path.join(this.baseDir, SERVER_SCRIPT);

      this.sidecarProcess = spawn(pythonPath, [serverPath, '--port', String(BASE_PORT)], {
        cwd: this.baseDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      let startupComplete = false;
      const timeoutId = setTimeout(() => {
        if (!startupComplete) {
          console.error('[ChatterboxSidecar] Startup timeout');
          this.stop();
          this.state = 'error';
          resolve(false);
        }
      }, STARTUP_TIMEOUT_MS);

      this.sidecarProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log(`[ChatterboxSidecar] stdout: ${output.trim()}`);

        // Look for ready signal
        const match = output.match(/SIDECAR_READY:(\d+)/);
        if (match && !startupComplete) {
          startupComplete = true;
          clearTimeout(timeoutId);
          this.sidecarPort = parseInt(match[1], 10);
          this.state = 'ready';
          console.log(`[ChatterboxSidecar] Ready on port ${this.sidecarPort}`);
          resolve(true);
        }
      });

      this.sidecarProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[ChatterboxSidecar] stderr: ${data.toString().trim()}`);
      });

      this.sidecarProcess.on('close', (code) => {
        console.log(`[ChatterboxSidecar] Process exited with code ${code}`);
        this.sidecarProcess = null;
        this.sidecarPort = null;
        this.state = 'stopped';

        if (!startupComplete) {
          clearTimeout(timeoutId);
          resolve(false);
        }
      });

      this.sidecarProcess.on('error', (error) => {
        console.error('[ChatterboxSidecar] Process error:', error);
        this.state = 'error';
        if (!startupComplete) {
          clearTimeout(timeoutId);
          resolve(false);
        }
      });
    });
  }

  /**
   * Stop the sidecar process.
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped' && !this.sidecarProcess) {
      return;
    }

    console.log('[ChatterboxSidecar] Stopping sidecar...');

    // Try graceful shutdown via HTTP
    if (this.sidecarPort) {
      try {
        await this.httpPost('/shutdown', {});
        // Wait a bit for graceful exit
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        // Ignore errors, will force kill
      }
    }

    // Force kill if still running
    if (this.sidecarProcess) {
      this.sidecarProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (this.sidecarProcess) {
        this.sidecarProcess.kill('SIGKILL');
      }
    }

    this.sidecarProcess = null;
    this.sidecarPort = null;
    this.state = 'stopped';
    console.log('[ChatterboxSidecar] Stopped');
  }

  /**
   * Synthesize text to audio.
   */
  async synthesize(
    text: string,
    outputPath: string,
    profile: NarrationProfile,
    params: SynthesisParameters = LIBRARIAN_V1_PARAMS
  ): Promise<NarrateResult> {
    // Ensure sidecar is running
    if (this.state !== 'ready') {
      const started = await this.start();
      if (!started) {
        throw new Error('Failed to start Chatterbox sidecar');
      }
    }

    console.log(`[ChatterboxSidecar] Synthesizing ${text.length} chars...`);

    const response = await this.httpPost<SynthesisResponse>('/synthesize', {
      text,
      output_path: outputPath,
      params: {
        exaggeration: params.exaggeration,
        cfg_weight: params.cfgWeight,
      },
    });

    console.log(
      `[ChatterboxSidecar] Synthesis complete: ${response.duration_ms}ms audio in ${response.synthesis_time_ms}ms`
    );

    return {
      audioPath: response.audio_path,
      fromCache: false,
      durationMs: response.duration_ms,
      engine: 'chatterbox' as NarrationEngine,
    };
  }

  /**
   * Test voice synthesis with a short phrase.
   */
  async testVoice(): Promise<NarrateResult> {
    const testText = 'The archive remembers what others forget.';
    const testOutputPath = path.join(this.baseDir, 'test-voice.wav');

    return this.synthesize(testText, testOutputPath, 'librarian_v1');
  }

  /**
   * Get health status from sidecar.
   */
  async getHealth(): Promise<SidecarHealthResponse | null> {
    if (this.state !== 'ready' || !this.sidecarPort) {
      return null;
    }

    try {
      return await this.httpGet<SidecarHealthResponse>('/health');
    } catch {
      return null;
    }
  }

  /**
   * Get current sidecar state.
   */
  getState(): SidecarState {
    return this.state;
  }

  /**
   * Check if sidecar is ready for synthesis.
   */
  isReady(): boolean {
    return this.state === 'ready';
  }

  // ==================== Private Methods ====================

  /**
   * Check if running on Apple Silicon.
   */
  private isAppleSilicon(): boolean {
    try {
      const arch = execSync('uname -m', { encoding: 'utf-8' }).trim();
      return arch === 'arm64';
    } catch {
      return false;
    }
  }

  /**
   * Find Python 3.9+ on the system.
   */
  private async findPython(): Promise<string | null> {
    const candidates = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
    ];

    for (const candidate of candidates) {
      try {
        const version = execSync(`${candidate} --version`, {
          encoding: 'utf-8',
        }).trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);
          if (major === 3 && minor >= 9) {
            return candidate;
          }
        }
      } catch {
        // Not found or version too old
      }
    }

    // Try 'which python3' as fallback
    try {
      const pythonPath = execSync('which python3', { encoding: 'utf-8' }).trim();
      const version = execSync(`${pythonPath} --version`, {
        encoding: 'utf-8',
      }).trim();
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major === 3 && minor >= 9) {
          return pythonPath;
        }
      }
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Get free disk space in bytes.
   */
  private async getFreeDiskSpace(): Promise<number> {
    try {
      const output = execSync(`df -k "${app.getPath('userData')}" | tail -1`, {
        encoding: 'utf-8',
      });
      const parts = output.trim().split(/\s+/);
      // Available space is typically the 4th column (in 1K blocks)
      const availableKB = parseInt(parts[3], 10);
      return availableKB * 1024;
    } catch {
      // Assume enough space if we can't check
      return MIN_DISK_SPACE_BYTES + 1;
    }
  }

  /**
   * Create Python virtual environment.
   */
  private async createVenv(pythonPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(
        `"${pythonPath}" -m venv "${this.venvDir}"`,
        { timeout: 60000 },
        (error, stdout, stderr) => {
          if (error) {
            console.error('[ChatterboxSidecar] venv creation stderr:', stderr);
            reject(new Error(`Failed to create virtual environment: ${error.message}`));
          } else {
            console.log('[ChatterboxSidecar] Virtual environment created');
            resolve();
          }
        }
      );
    });
  }

  /**
   * Install Python dependencies via pip.
   * Uses staged installation to avoid numpy build issues on Apple Silicon.
   */
  private async installDependencies(
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    const pipPath = path.join(this.venvDir, 'bin', 'pip');

    // Helper to run pip commands
    const runPip = (args: string[], progressMsg: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        console.log(`[ChatterboxSidecar] Running: pip ${args.join(' ')}`);
        const proc = spawn(pipPath, args, { cwd: this.baseDir });

        proc.stdout?.on('data', (data: Buffer) => {
          console.log(`[ChatterboxSidecar] pip: ${data.toString().trim()}`);
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          if (output.includes('Downloading') || output.includes('Installing') || output.includes('Collecting')) {
            console.log(`[ChatterboxSidecar] pip: ${output.trim()}`);
          }
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`${progressMsg} failed with code ${code}`));
          }
        });

        proc.on('error', (error) => {
          reject(new Error(`${progressMsg} error: ${error.message}`));
        });
      });
    };

    // Step 1: Upgrade pip
    onProgress?.(0, 'Upgrading pip...');
    try {
      await runPip(['install', '--upgrade', 'pip'], 'pip upgrade');
    } catch (e) {
      console.warn('[ChatterboxSidecar] pip upgrade warning:', e);
      // Continue anyway
    }

    // Step 2: Install PyTorch with MPS support first
    // This installs numpy 2.x which has wheels for Apple Silicon
    onProgress?.(10, 'Installing PyTorch (~1GB)...');
    await runPip(
      ['install', 'torch', 'torchaudio'],
      'PyTorch install'
    );

    // Step 3: Install other dependencies that chatterbox needs
    // (scipy, soundfile, transformers, etc. work with numpy 2.x)
    onProgress?.(40, 'Installing audio libraries...');
    await runPip(
      ['install', 'scipy', 'soundfile', 'librosa', 'transformers', 'tokenizers', 'huggingface-hub', 'safetensors', 'confection', 'resemble-perth', 'einops', 's3prl', 's3tokenizer', 'conformer', 'diffusers', 'pyloudnorm', 'omegaconf', 'pykakasi'],
      'audio libraries install'
    );

    // Step 4: Install chatterbox-tts without its dependencies
    // (numpy constraint is too strict, but it works fine with numpy 2.x)
    onProgress?.(70, 'Installing Chatterbox TTS...');
    await runPip(
      ['install', '--no-deps', 'chatterbox-tts'],
      'chatterbox-tts install'
    );

    onProgress?.(100, 'Dependencies installed');
    console.log('[ChatterboxSidecar] Dependencies installed');
  }

  /**
   * Copy server.py from app resources to chatterbox directory.
   */
  private async copyServerScript(): Promise<void> {
    // In development, it's in resources/chatterbox/server.py relative to project
    // In production, it's in app.asar/resources/chatterbox/server.py
    const possiblePaths = [
      // Production: extraResources
      path.join(process.resourcesPath, 'chatterbox', SERVER_SCRIPT),
      // Development: relative to electron main
      path.join(__dirname, '..', '..', '..', '..', 'resources', 'chatterbox', SERVER_SCRIPT),
      // Alternative dev path
      path.join(app.getAppPath(), 'resources', 'chatterbox', SERVER_SCRIPT),
    ];

    let sourcePath: string | null = null;
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        sourcePath = p;
        break;
      } catch {
        // Try next
      }
    }

    if (!sourcePath) {
      throw new Error('Could not find server.py in app resources');
    }

    const destPath = path.join(this.baseDir, SERVER_SCRIPT);
    await fs.copyFile(sourcePath, destPath);
    console.log(`[ChatterboxSidecar] Copied server.py from ${sourcePath}`);
  }

  /**
   * Verify installation by starting sidecar and checking health.
   */
  private async verifyInstallation(): Promise<void> {
    // Quick import check
    const pythonPath = path.join(this.venvDir, 'bin', 'python');

    return new Promise((resolve, reject) => {
      exec(
        `"${pythonPath}" -c "import torch; import chatterbox; print('OK')"`,
        { timeout: 30000 },
        (error, stdout, stderr) => {
          if (error) {
            console.error('[ChatterboxSidecar] Verification stderr:', stderr);
            reject(new Error('Failed to import Chatterbox. Installation may be incomplete.'));
          } else if (stdout.trim() === 'OK') {
            console.log('[ChatterboxSidecar] Verification passed');
            resolve();
          } else {
            reject(new Error('Unexpected verification output'));
          }
        }
      );
    });
  }

  /**
   * Save installation config.
   */
  private async saveConfig(pythonPath: string): Promise<void> {
    const config = {
      version: '1.0.0',
      pythonPath,
      installedAt: new Date().toISOString(),
      venvPath: this.venvDir,
    };
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Kill orphaned sidecar process from previous run.
   */
  private async killOrphanProcess(): Promise<void> {
    const pidPath = path.join(this.baseDir, PID_FILE);
    try {
      const pidStr = await fs.readFile(pidPath, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`[ChatterboxSidecar] Killed orphan process ${pid}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Process already gone
        }
      }
      await fs.unlink(pidPath);
    } catch {
      // No PID file or already cleaned up
    }
  }

  /**
   * Wait for sidecar to become ready.
   */
  private async waitForReady(): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      if (this.state === 'ready') return true;
      if (this.state === 'error' || this.state === 'stopped') return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  /**
   * HTTP GET request to sidecar.
   */
  private httpGet<T>(endpoint: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.sidecarPort) {
        reject(new Error('Sidecar not running'));
        return;
      }

      const req = http.get(
        `http://127.0.0.1:${this.sidecarPort}${endpoint}`,
        { timeout: REQUEST_TIMEOUT_MS },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) {
                reject(new Error(json.error));
              } else {
                resolve(json as T);
              }
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * HTTP POST request to sidecar.
   */
  private httpPost<T>(endpoint: string, body: object): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.sidecarPort) {
        reject(new Error('Sidecar not running'));
        return;
      }

      const data = JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.sidecarPort,
          path: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let responseData = '';
          res.on('data', (chunk) => (responseData += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(responseData);
              if (json.error) {
                reject(new Error(json.error));
              } else {
                resolve(json as T);
              }
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${responseData}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(data);
      req.end();
    });
  }
}

// Singleton instance
let instance: ChatterboxSidecarEngine | null = null;

export function getChatterboxSidecarEngine(): ChatterboxSidecarEngine {
  if (!instance) {
    instance = new ChatterboxSidecarEngine();
  }
  return instance;
}
