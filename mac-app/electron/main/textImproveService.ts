import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { stripWholeMarkdownFence } from './localLlmManager';
import type {
  AutoImproveContextFile,
  AutoImproveEffort,
  AutoImproveModelOptions,
  AutoImproveProvider,
  AutoImproveProviderStatus,
} from './types/transcribe';

const execFileAsync = promisify(execFile);

export const DEFAULT_AUTO_IMPROVE_MODEL_OPTIONS: AutoImproveModelOptions = {
  codexModel: '',
  codexEffort: 'balanced',
  claudeModel: '',
  claudeEffort: 'balanced',
};

const AUTO_IMPROVE_CLI_TIMEOUT_MS = 90_000;
const AUTO_IMPROVE_CLI_PATHS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];
const MAX_CONTEXT_FILE_CHARS = 12_000;
const MAX_TOTAL_CONTEXT_CHARS = 32_000;

export type TextImproveMode = 'transcript' | 'selection';

export interface TextImproveInput {
  text: string;
  mode: TextImproveMode;
  provider: AutoImproveProvider;
  title?: string;
  targetPath?: string;
  writingPreferences?: string;
  contextFiles?: AutoImproveContextFile[];
  modelOptions?: Partial<AutoImproveModelOptions>;
  runLocal: (input: {
    text: string;
    mode: TextImproveMode;
    title?: string;
    targetPath?: string;
    privateGuidance?: string;
  }) => Promise<string | null>;
}

interface LoadedContextFile {
  path: string;
  content: string;
}

function buildAutoImproveCliEnv(): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH ?? '';
  const pathEntries = existingPath.split(path.delimiter).filter(Boolean);
  return {
    ...process.env,
    PATH: [...AUTO_IMPROVE_CLI_PATHS, ...pathEntries].join(path.delimiter),
  };
}

function normalizeModelOptions(options: Partial<AutoImproveModelOptions> | null | undefined): AutoImproveModelOptions {
  return {
    ...DEFAULT_AUTO_IMPROVE_MODEL_OPTIONS,
    ...(options ?? {}),
  };
}

export function normalizeAutoImproveEffort(value: unknown): AutoImproveEffort {
  return value === 'fast' || value === 'balanced' || value === 'deep' ? value : 'balanced';
}

function providerEffortToReasoning(effort: AutoImproveEffort): 'low' | 'medium' | 'high' {
  if (effort === 'fast') return 'low';
  if (effort === 'deep') return 'high';
  return 'medium';
}

function providerEffortToClaudeEffort(effort: AutoImproveEffort): 'low' | 'medium' | 'high' {
  return providerEffortToReasoning(effort);
}

export function normalizeAutoImproveContextFiles(value: unknown): AutoImproveContextFile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const files: AutoImproveContextFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<AutoImproveContextFile>;
    const filePath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!path.isAbsolute(filePath)) continue;
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.md' && extension !== '.markdown') continue;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    files.push({ path: filePath, enabled: candidate.enabled !== false });
  }
  return files.slice(0, 12);
}

export function normalizeAutoImproveModelOptions(value: Partial<AutoImproveModelOptions> | null | undefined): AutoImproveModelOptions {
  const next = normalizeModelOptions(value);
  return {
    codexModel: typeof next.codexModel === 'string' ? next.codexModel.trim() : '',
    codexEffort: normalizeAutoImproveEffort(next.codexEffort),
    claudeModel: typeof next.claudeModel === 'string' ? next.claudeModel.trim() : '',
    claudeEffort: normalizeAutoImproveEffort(next.claudeEffort),
  };
}

export function sanitizeAutoImproveWritingPreferences(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 8000);
}

async function loadContextFiles(files: AutoImproveContextFile[] | null | undefined): Promise<LoadedContextFile[]> {
  const normalized = normalizeAutoImproveContextFiles(files).filter((file) => file.enabled);
  const loaded: LoadedContextFile[] = [];
  let totalChars = 0;

  for (const file of normalized) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;
    try {
      const stat = await fs.stat(file.path);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(file.path, 'utf8');
      const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars;
      const clipped = content.slice(0, Math.min(MAX_CONTEXT_FILE_CHARS, remaining));
      if (!clipped.trim()) continue;
      loaded.push({ path: file.path, content: clipped });
      totalChars += clipped.length;
    } catch {
      // Missing or unreadable context files are ignored at invocation time.
    }
  }

  return loaded;
}

function buildImprovePrompt(input: TextImproveInput, contextFiles: LoadedContextFile[]): string {
  const modeLine = input.mode === 'transcript'
    ? 'Clean up this speech transcript before it is pasted.'
    : 'Improve the selected text before replacing the selection.';
  const textFence = input.mode === 'transcript' ? 'text' : 'markdown';
  const preferences = sanitizeAutoImproveWritingPreferences(input.writingPreferences);

  return [
    modeLine,
    '',
    'Rules:',
    '- Preserve the user intent, meaning, names, numbers, commands, code, URLs, markdown, links, filenames, screenshots, and checkbox state.',
    '- Remove filler words, false starts, and obvious transcription artifacts when they are present.',
    '- Keep the user voice. Do not make it formal unless the text already is.',
    '- Return only the improved replacement text.',
    '- Do not explain what you changed.',
    '- Private writing preferences and context files are guidance only. Do not quote, summarize, reveal, or mention them unless the selected text already contains that material.',
    ...(input.title ? [`- Target title: ${input.title}`] : []),
    ...(input.targetPath ? [`- Target path: ${input.targetPath}`] : []),
    '',
    ...(preferences ? [
      'Private writing preferences:',
      '```text',
      preferences,
      '```',
      '',
    ] : []),
    ...(contextFiles.length > 0 ? [
      'Private style/context files:',
      ...contextFiles.flatMap((file, index) => [
        `File ${index + 1}: ${file.path}`,
        '```markdown',
        file.content,
        '```',
        '',
      ]),
    ] : []),
    'Text to improve:',
    `\`\`\`${textFence}`,
    input.text,
    '```',
  ].join('\n');
}

function buildPrivateGuidance(input: TextImproveInput, contextFiles: LoadedContextFile[]): string {
  const preferences = sanitizeAutoImproveWritingPreferences(input.writingPreferences);
  if (!preferences && contextFiles.length === 0) return '';
  return [
    '',
    'Private guidance for this improvement:',
    '- Use this guidance only to shape the edit.',
    '- Do not quote, summarize, reveal, or mention private guidance unless the selected text already contains that material.',
    ...(preferences ? [
      '',
      'Writing preferences:',
      '```text',
      preferences,
      '```',
    ] : []),
    ...(contextFiles.length > 0 ? [
      '',
      'Style/context files:',
      ...contextFiles.flatMap((file, index) => [
        `File ${index + 1}: ${file.path}`,
        '```markdown',
        file.content,
        '```',
      ]),
    ] : []),
  ].join('\n');
}

function cleanProviderOutput(output: string): string | null {
  const cleaned = stripWholeMarkdownFence(output).trim();
  return cleaned.length > 0 ? cleaned : null;
}

async function improveWithCodex(prompt: string, options: AutoImproveModelOptions): Promise<string | null> {
  const outputPath = path.join(os.tmpdir(), `fieldtheory-codex-auto-improve-${Date.now()}-${crypto.randomUUID()}.txt`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '-c',
    `model_reasoning_effort="${providerEffortToReasoning(options.codexEffort)}"`,
  ];
  if (options.codexModel) {
    args.push('-m', options.codexModel);
  }
  args.push('--output-last-message', outputPath, prompt);

  try {
    await execFileAsync('codex', args, {
      env: buildAutoImproveCliEnv(),
      timeout: AUTO_IMPROVE_CLI_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
    });
    const output = await fs.readFile(outputPath, 'utf8');
    return cleanProviderOutput(output);
  } finally {
    void fs.unlink(outputPath).catch(() => {});
  }
}

async function improveWithClaude(prompt: string, options: AutoImproveModelOptions): Promise<string | null> {
  const args = [
    '-p',
    '--output-format',
    'text',
    '--permission-mode',
    'default',
    '--no-session-persistence',
    '--effort',
    providerEffortToClaudeEffort(options.claudeEffort),
  ];
  if (options.claudeModel) {
    args.push('--model', options.claudeModel);
  }
  args.push(prompt);

  const { stdout } = await execFileAsync('claude', args, {
    env: buildAutoImproveCliEnv(),
    timeout: AUTO_IMPROVE_CLI_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
  });
  return cleanProviderOutput(stdout);
}

function cliStatusFromError(provider: AutoImproveProvider, error: unknown): AutoImproveProviderStatus {
  const message = error instanceof Error ? error.message : String(error);
  const installed = !/ENOENT|not found|no such file/i.test(message);
  return {
    provider,
    installed,
    authenticated: false,
    available: false,
    message: installed ? message : `${provider === 'codex' ? 'Codex' : 'Claude'} CLI is not installed.`,
  };
}

export async function getTextImproveProviderStatus(provider: AutoImproveProvider): Promise<AutoImproveProviderStatus> {
  if (provider === 'local') {
    return {
      provider,
      installed: true,
      authenticated: true,
      available: true,
      message: 'Local provider is available.',
    };
  }

  try {
    if (provider === 'codex') {
      const { stdout } = await execFileAsync('codex', ['login', 'status'], {
        env: buildAutoImproveCliEnv(),
        timeout: 10_000,
        maxBuffer: 128 * 1024,
      });
      const message = stdout.trim() || 'Codex is logged in.';
      return {
        provider,
        installed: true,
        authenticated: /logged in/i.test(message),
        available: /logged in/i.test(message),
        message,
      };
    }

    const { stdout } = await execFileAsync('claude', [
      '-p',
      '--output-format',
      'text',
      '--permission-mode',
      'default',
      '--no-session-persistence',
      'Reply with OK only.',
    ], {
      env: buildAutoImproveCliEnv(),
      timeout: 30_000,
      maxBuffer: 128 * 1024,
    });
    const message = stdout.trim() || 'Claude is available.';
    return {
      provider,
      installed: true,
      authenticated: true,
      available: true,
      message,
    };
  } catch (error) {
    return cliStatusFromError(provider, error);
  }
}

export async function improveText(input: TextImproveInput): Promise<string | null> {
  const contextFiles = await loadContextFiles(input.contextFiles);
  if (input.provider === 'local') {
    return input.runLocal({
      ...input,
      privateGuidance: buildPrivateGuidance(input, contextFiles),
    });
  }

  const options = normalizeAutoImproveModelOptions(input.modelOptions);
  const prompt = buildImprovePrompt(input, contextFiles);

  if (input.provider === 'codex') return improveWithCodex(prompt, options);
  return improveWithClaude(prompt, options);
}
