import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

import type { ParakeetSetupError } from './types/transcribe';

const execFileAsync = promisify(execFile);

export interface ParakeetPythonProbeResult {
  command: string;
  found: boolean;
  versionOutput?: string | null;
  version?: { major: number; minor: number; patch: number | null } | null;
  venvOk?: boolean;
  error?: string | null;
}

export interface ParakeetPythonPreflightSuccess {
  ok: true;
  pythonCommand: string;
  detail: string;
}

export interface ParakeetPythonPreflightFailure {
  ok: false;
  setupError: ParakeetSetupError;
}

export type ParakeetPythonPreflightResult =
  | ParakeetPythonPreflightSuccess
  | ParakeetPythonPreflightFailure;

const PARAKEET_PYTHON_CANDIDATES = [
  '/opt/homebrew/opt/python@3.13/bin/python3.13',
  '/opt/homebrew/opt/python@3.13/bin/python3',
  '/opt/homebrew/opt/python@3.12/bin/python3.12',
  '/opt/homebrew/opt/python@3.12/bin/python3',
  '/opt/homebrew/opt/python@3.11/bin/python3.11',
  '/opt/homebrew/opt/python@3.11/bin/python3',
  '/opt/homebrew/opt/python@3.10/bin/python3.10',
  '/opt/homebrew/opt/python@3.10/bin/python3',
  '/usr/local/opt/python@3.13/bin/python3.13',
  '/usr/local/opt/python@3.13/bin/python3',
  '/usr/local/opt/python@3.12/bin/python3.12',
  '/usr/local/opt/python@3.12/bin/python3',
  '/usr/local/opt/python@3.11/bin/python3.11',
  '/usr/local/opt/python@3.11/bin/python3',
  '/usr/local/opt/python@3.10/bin/python3.10',
  '/usr/local/opt/python@3.10/bin/python3',
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3',
];

export const PARAKEET_PYTHON_RECOVERY_COMMAND = 'brew install python@3.12';

export function parsePythonVersionOutput(output: string | null | undefined): {
  major: number;
  minor: number;
  patch: number | null;
} | null {
  const match = output?.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return null;

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: match[3] ? Number.parseInt(match[3], 10) : null,
  };
}

function isSupportedPythonVersion(version: { major: number; minor: number } | null | undefined): boolean {
  return Boolean(version && version.major === 3 && version.minor >= 10);
}

function formatVersion(version: { major: number; minor: number; patch: number | null } | null | undefined): string {
  if (!version) return 'unknown version';
  return version.patch == null
    ? `${version.major}.${version.minor}`
    : `${version.major}.${version.minor}.${version.patch}`;
}

function buildSetupError(
  code: ParakeetSetupError['code'],
  summary: string,
  detail: string,
  moreInfo: string
): ParakeetPythonPreflightFailure {
  return {
    ok: false,
    setupError: {
      code,
      summary,
      detail,
      recoveryCommand: PARAKEET_PYTHON_RECOVERY_COMMAND,
      moreInfo,
    },
  };
}

export function classifyParakeetPythonPreflight(
  probes: ParakeetPythonProbeResult[]
): ParakeetPythonPreflightResult {
  const found = probes.filter((probe) => probe.found);
  if (found.length === 0) {
    return buildSetupError(
      'missing-python',
      'Python 3.10 or newer is required for Parakeet setup.',
      'Field Theory could not find python3.10, python3.11, python3.12, python3.13, or python3 on PATH or in common Homebrew locations.',
      'Install a supported Homebrew Python, then retry Parakeet setup.'
    );
  }

  const supported = found.filter((probe) => isSupportedPythonVersion(probe.version));
  if (supported.length === 0) {
    const detail = found
      .map((probe) => `${probe.command}: ${formatVersion(probe.version)}${probe.error ? ` (${probe.error})` : ''}`)
      .join('\n');
    return buildSetupError(
      'unsupported-python',
      'Parakeet setup needs Python 3.10 or newer.',
      `Found Python, but every detected version was too old or unreadable.\n\n${detail}`,
      'Install Python 3.12 with Homebrew, then retry Parakeet setup.'
    );
  }

  const usable = supported.find((probe) => probe.venvOk);
  if (usable) {
    return {
      ok: true,
      pythonCommand: usable.command,
      detail: `${usable.command}: Python ${formatVersion(usable.version)}`,
    };
  }

  const detail = supported
    .map((probe) => `${probe.command}: Python ${formatVersion(probe.version)} (${probe.error || 'venv check failed'})`)
    .join('\n');
  return buildSetupError(
    'python-venv-failed',
    'Python was found, but it cannot create a virtual environment.',
    `Parakeet setup found a supported Python, but python -m venv failed.\n\n${detail}`,
    'Install a Homebrew Python with venv support, then retry Parakeet setup.'
  );
}

async function probePythonCommand(command: string): Promise<ParakeetPythonProbeResult> {
  if (command.startsWith('/') && !fs.existsSync(command)) {
    return { command, found: false, error: 'not found' };
  }

  try {
    const { stdout } = await execFileAsync(
      command,
      ['-c', 'import sys; print(f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'],
      { timeout: 10_000 }
    );
    const versionOutput = stdout.trim();
    const version = parsePythonVersionOutput(versionOutput);
    if (!isSupportedPythonVersion(version)) {
      return { command, found: true, versionOutput, version, venvOk: false };
    }

    try {
      await execFileAsync(command, ['-m', 'venv', '--help'], { timeout: 10_000 });
      return { command, found: true, versionOutput, version, venvOk: true };
    } catch (error) {
      return {
        command,
        found: true,
        versionOutput,
        version,
        venvOk: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { command, found: false, error: 'not found' };
    }
    return {
      command,
      found: true,
      version: null,
      venvOk: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runParakeetPythonPreflight(): Promise<ParakeetPythonPreflightResult> {
  const probes: ParakeetPythonProbeResult[] = [];
  const seen = new Set<string>();

  for (const command of PARAKEET_PYTHON_CANDIDATES) {
    if (seen.has(command)) continue;
    seen.add(command);
    const probe = await probePythonCommand(command);
    probes.push(probe);
    if (probe.found && isSupportedPythonVersion(probe.version) && probe.venvOk) {
      return classifyParakeetPythonPreflight(probes);
    }
  }

  return classifyParakeetPythonPreflight(probes);
}
