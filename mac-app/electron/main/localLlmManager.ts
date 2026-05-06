import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { StdioJsonServer, type ServerEvent, type ServerSendOptions } from './stdioJsonServer';
import { createLogger } from './logger';

const log = createLogger('LocalLLM');

export type LocalLlmModelId = 'gemma-4-E4B-it-Q4_K_M';
export type LocalLlmHarness = 'codex' | 'direct';
export type LocalLlmProgressKind = 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';

export interface LocalLlmProgressEvent {
  kind: LocalLlmProgressKind;
  message: string;
  detail?: string;
  phase?: string;
}

export interface LocalLlmModelInfo {
  name: string;
  filename: string;
  sizeBytes: number;
  description: string;
  license: string;
  sourceUrl: string;
  baseModelUrl: string;
}

export interface LocalLlmHealth {
  status: 'ready' | 'missing' | 'corrupt';
  modelPath: string;
  fileSizeBytes: number | null;
  expectedSizeBytes: number;
  minValidSizeBytes: number;
}

export interface LocalCommandPromptInput {
  commandName: string;
  commandContent: string;
  targetTitle: string;
  targetPath: string;
  targetContent: string;
}

export interface LocalCommandSelectionPromptInput extends LocalCommandPromptInput {
  selectedText: string;
}

export interface LocalLlmRunOptions {
  maxTokens?: number;
  temperature?: number;
  onProgress?: (event: LocalLlmProgressEvent) => void;
}

export interface LocalLlmCommandOptions {
  onProgress?: (event: LocalLlmProgressEvent) => void;
}

type LocalLlmServer = {
  start: () => Promise<void>;
  send: (cmd: Record<string, unknown>, options?: ServerSendOptions) => Promise<{ ok: boolean; text?: string; error?: string }>;
  stop: () => void;
};

export interface LocalLlmManagerOptions {
  userDataPath?: string;
  resourcesPath?: string;
  appPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  serverFactory?: (config: {
    name: string;
    command: string;
    args: string[];
    timeoutMs: number;
    startupTimeoutMs: number;
    env: NodeJS.ProcessEnv;
  }) => LocalLlmServer;
}

const LOCAL_LLM_MODELS: Record<LocalLlmModelId, LocalLlmModelInfo> = {
  'gemma-4-E4B-it-Q4_K_M': {
    name: 'Gemma 4 E4B Instruct Q4_K_M',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    sizeBytes: 5_335_289_824,
    description: 'Offline local command model for Field Theory markdown commands',
    license: 'Apache-2.0',
    sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF',
    baseModelUrl: 'https://huggingface.co/google/gemma-4-E4B-it',
  },
};

export const DEFAULT_LOCAL_LLM_MODEL: LocalLlmModelId = 'gemma-4-E4B-it-Q4_K_M';

export function isLocalLlmModelId(value: unknown): value is LocalLlmModelId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCAL_LLM_MODELS, value);
}

export function resolveLocalLlmHarness(value: unknown): LocalLlmHarness {
  return value === 'direct' ? 'direct' : 'codex';
}

export function stripWholeMarkdownFence(text: string): string {
  const withoutThought = text
    .replace(/^<think>[\s\S]*?<\/think>/i, '')
    .replace(/^<\|channel\|>analysis[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\|>thought[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\>final\n/i, '')
    .replace(/<\|end\|>|<eos>|<\/s>/gi, '');
  const trimmed = withoutThought.trim();
  const match = trimmed.match(/^```(?:markdown|md|json)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

export function buildLocalCommandPrompt(input: LocalCommandPromptInput): string {
  return [
    'You are running a local Field Theory command against a markdown document.',
    '',
    'Rules:',
    '- Use the command markdown as the function instructions.',
    '- Return exactly one JSON object.',
    '- Put the complete replacement Markdown document in replacementMarkdown.',
    '- Do not add explanations before or after the JSON.',
    '- Do not wrap the JSON in a code fence.',
    '- Do not include private reasoning, thinking tags, or status text.',
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- If the source is incomplete, keep it as a clarification task instead of inventing missing intent.',
    '',
    'JSON shape:',
    '{"replacementMarkdown":"<complete replacement Markdown document>","summary":"<one sentence summary>"}',
    '',
    `Command name: ${input.commandName}`,
    '',
    'Command markdown:',
    '```markdown',
    input.commandContent,
    '```',
    '',
    `Document title: ${input.targetTitle}`,
    `Document path: ${input.targetPath}`,
    '',
    'Document markdown:',
    '```markdown',
    input.targetContent,
    '```',
  ].join('\n');
}

export function buildLocalSelectionCommandPrompt(input: LocalCommandSelectionPromptInput): string {
  return [
    'You are running a local Field Theory command against selected markdown text.',
    '',
    'Rules:',
    '- Use the command markdown as the function instructions.',
    '- Return exactly one JSON object.',
    '- Put only the replacement text for the selected markdown in replacementText.',
    '- Do not return the full document.',
    '- Do not add explanations before or after the JSON.',
    '- Do not wrap the JSON in a code fence.',
    '- Do not include private reasoning, thinking tags, or status text.',
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- Preserve surrounding markdown style unless the command explicitly asks to change it.',
    '',
    'JSON shape:',
    '{"replacementText":"<replacement text for the selected markdown>","summary":"<one sentence summary>"}',
    '',
    `Command name: ${input.commandName}`,
    '',
    'Command markdown:',
    '```markdown',
    input.commandContent,
    '```',
    '',
    `Document title: ${input.targetTitle}`,
    `Document path: ${input.targetPath}`,
    '',
    'Selected markdown:',
    '```markdown',
    input.selectedText,
    '```',
    '',
    'Full document context:',
    '```markdown',
    input.targetContent,
    '```',
  ].join('\n');
}

export function parseLocalCommandReplacement(raw: string, replacementField: 'replacementMarkdown' | 'replacementText'): string {
  const cleaned = stripWholeMarkdownFence(raw);
  const parsed = parseJsonObject(cleaned) ?? parseJsonObject(extractJsonObject(cleaned));
  const replacement = parsed?.[replacementField];
  if (typeof replacement === 'string') {
    return stripWholeMarkdownFence(replacement);
  }
  return cleaned;
}

export function parseLocalLlmProgressEvent(event: ServerEvent): LocalLlmProgressEvent | null {
  if (event.event !== 'progress') return null;
  const message = typeof event.message === 'string' ? event.message.trim() : '';
  if (!message) return null;
  const kind = isLocalLlmProgressKind(event.kind) ? event.kind : 'status';
  const detail = typeof event.detail === 'string' && event.detail.trim()
    ? event.detail.trim()
    : undefined;
  const phase = typeof event.phase === 'string' && event.phase.trim()
    ? event.phase.trim()
    : undefined;
  return { kind, message, detail, phase };
}

export class LocalLlmManager {
  private selectedModel: LocalLlmModelId = DEFAULT_LOCAL_LLM_MODEL;
  private server: LocalLlmServer | null = null;
  private serverModelPath: string | null = null;

  constructor(private readonly options: LocalLlmManagerOptions = {}) {}

  getAvailableModels(): Record<LocalLlmModelId, LocalLlmModelInfo> {
    return LOCAL_LLM_MODELS;
  }

  getSelectedModel(): LocalLlmModelId {
    return this.selectedModel;
  }

  getHarness(): LocalLlmHarness {
    return resolveLocalLlmHarness(this.options.env?.FT_LOCAL_LLM_HARNESS ?? process.env.FT_LOCAL_LLM_HARNESS);
  }

  setSelectedModel(model: string): { success: boolean; error?: string } {
    if (!isLocalLlmModelId(model)) {
      return { success: false, error: 'Unsupported local model' };
    }
    if (model !== this.selectedModel) {
      this.stop();
      this.selectedModel = model;
    }
    return { success: true };
  }

  getDownloadStatus(): Record<LocalLlmModelId, boolean> {
    return {
      [DEFAULT_LOCAL_LLM_MODEL]: this.getModelHealth(DEFAULT_LOCAL_LLM_MODEL).status === 'ready',
    };
  }

  getModelHealthMap(): Record<LocalLlmModelId, LocalLlmHealth> {
    return {
      [DEFAULT_LOCAL_LLM_MODEL]: this.getModelHealth(DEFAULT_LOCAL_LLM_MODEL),
    };
  }

  getDefaultInstallPath(model: LocalLlmModelId = this.selectedModel): string {
    return path.join(this.getUserModelsDir(), LOCAL_LLM_MODELS[model].filename);
  }

  getModelHealth(model: LocalLlmModelId = this.selectedModel): LocalLlmHealth {
    const modelInfo = LOCAL_LLM_MODELS[model];
    const minValidSizeBytes = Math.floor(modelInfo.sizeBytes * 0.5);
    const candidates = this.getModelPathCandidates(model);
    const fallbackPath = candidates[0] ?? path.join(this.getUserModelsDir(), modelInfo.filename);

    for (const modelPath of candidates) {
      if (!fs.existsSync(modelPath)) continue;
      try {
        const stats = fs.statSync(modelPath);
        if (stats.size >= minValidSizeBytes) {
          return {
            status: 'ready',
            modelPath,
            fileSizeBytes: stats.size,
            expectedSizeBytes: modelInfo.sizeBytes,
            minValidSizeBytes,
          };
        }
        return {
          status: 'corrupt',
          modelPath,
          fileSizeBytes: stats.size,
          expectedSizeBytes: modelInfo.sizeBytes,
          minValidSizeBytes,
        };
      } catch {
        return {
          status: 'missing',
          modelPath,
          fileSizeBytes: null,
          expectedSizeBytes: modelInfo.sizeBytes,
          minValidSizeBytes,
        };
      }
    }

    return {
      status: 'missing',
      modelPath: fallbackPath,
      fileSizeBytes: null,
      expectedSizeBytes: modelInfo.sizeBytes,
      minValidSizeBytes,
    };
  }

  async generate(prompt: string, options: LocalLlmRunOptions = {}): Promise<string> {
    const health = this.getModelHealth(this.selectedModel);
    if (health.status !== 'ready') {
      throw new Error(`Gemma model is ${health.status}. Open Settings > Local model to download or link ${LOCAL_LLM_MODELS[this.selectedModel].filename}.`);
    }

    const server = this.getServer(health.modelPath);
    await server.start();
    const response = await server.send({
      cmd: 'generate',
      prompt,
      maxTokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.1,
      harness: this.getHarness(),
    }, {
      onEvent: (event) => {
        const progress = parseLocalLlmProgressEvent(event);
        if (progress) options.onProgress?.(progress);
      },
    });
    if (!response.ok || typeof response.text !== 'string') {
      throw new Error(response.error ?? 'Local Gemma generation failed');
    }
    return response.text;
  }

  async runReplacementCommand(input: LocalCommandPromptInput, options: LocalLlmCommandOptions = {}): Promise<string> {
    const prompt = buildLocalCommandPrompt(input);
    const raw = await this.generate(prompt, { maxTokens: 4096, temperature: 0.1, onProgress: options.onProgress });
    return parseLocalCommandReplacement(raw, 'replacementMarkdown');
  }

  async runSelectionCommand(input: LocalCommandSelectionPromptInput, options: LocalLlmCommandOptions = {}): Promise<string> {
    const prompt = buildLocalSelectionCommandPrompt(input);
    const raw = await this.generate(prompt, { maxTokens: 2048, temperature: 0.1, onProgress: options.onProgress });
    return parseLocalCommandReplacement(raw, 'replacementText');
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    this.serverModelPath = null;
  }

  getModelPathCandidates(model: LocalLlmModelId = this.selectedModel): string[] {
    const filename = LOCAL_LLM_MODELS[model].filename;
    const homeDir = this.options.env?.HOME ?? process.env.HOME;
    const reusableModelCandidates = homeDir
      ? [
          path.join(homeDir, '.fieldtheory', 'models', filename),
          path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'unsloth', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf'),
          path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf'),
          path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-E4B-it', 'model.gguf'),
        ]
      : [];
    const candidates = [
      this.options.env?.FT_LOCAL_LLM_MODEL_PATH,
      this.options.env?.FT_GEMMA_MODEL_PATH,
      ...reusableModelCandidates,
      path.join(this.getUserModelsDir(), filename),
      path.join(this.getResourcesPath(), 'models', filename),
      path.join(this.getAppPath(), 'resources', 'models', filename),
      path.join(this.getCwd(), 'resources', 'models', filename),
    ].filter((candidate): candidate is string => Boolean(candidate));

    return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
  }

  private getServer(modelPath: string): LocalLlmServer {
    if (this.server && this.serverModelPath === modelPath) {
      return this.server;
    }
    this.stop();

    const scriptPath = this.getRunnerScriptPath();
    const env = {
      ...process.env,
      ...this.options.env,
      ELECTRON_RUN_AS_NODE: '1',
    };
    const config = {
      name: 'Gemma',
      command: process.execPath,
      args: [scriptPath, '--model', modelPath, '--codex-model', this.selectedModel],
      timeoutMs: 240_000,
      startupTimeoutMs: 120_000,
      env,
    };
    this.server = this.options.serverFactory
      ? this.options.serverFactory(config)
      : new StdioJsonServer(config);
    this.serverModelPath = modelPath;
    return this.server;
  }

  private getRunnerScriptPath(): string {
    const candidates = [
      path.join(this.getResourcesPath(), 'scripts', 'gemma-generate.mjs'),
      path.join(this.getAppPath(), 'scripts', 'gemma-generate.mjs'),
      path.join(this.getCwd(), 'scripts', 'gemma-generate.mjs'),
    ].map(candidate => path.resolve(candidate));

    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (found) return found;

    log.warn('Gemma runner script not found; tried %s', candidates.join(', '));
    return candidates[0];
  }

  private getUserModelsDir(): string {
    const userDataPath = this.options.userDataPath ?? app.getPath('userData');
    return path.join(userDataPath, 'models');
  }

  private getResourcesPath(): string {
    return this.options.resourcesPath ?? process.resourcesPath ?? this.getCwd();
  }

  private getAppPath(): string {
    return this.options.appPath ?? app.getAppPath();
  }

  private getCwd(): string {
    return this.options.cwd ?? process.cwd();
  }
}

function isLocalLlmProgressKind(value: unknown): value is LocalLlmProgressKind {
  return value === 'status'
    || value === 'model_output'
    || value === 'tool_call'
    || value === 'file_change'
    || value === 'error';
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}
