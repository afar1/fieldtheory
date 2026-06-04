import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { StdioJsonServer, type ServerEvent, type ServerSendOptions } from './stdioJsonServer';
import { createLogger } from './logger';

const log = createLogger('LocalLLM');
const DEFAULT_CONTEXT_TOKENS = 32768;
const PROMPT_TOKEN_HEADROOM = 512;
const APPROX_CHARS_PER_TOKEN = 4;

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
  ollamaTag?: string;
  reusableModelPaths?: readonly string[];
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
  memorySnapshot?: string | null;
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

const LOCAL_LLM_MODELS = {
  'gemma-4-E4B-it-Q4_K_M': {
    name: 'Gemma 4 E4B Instruct Q4_K_M',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    sizeBytes: 5_335_289_824,
    description: 'Offline local command model for Field Theory markdown commands',
    license: 'Apache-2.0',
    sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF',
    baseModelUrl: 'https://huggingface.co/google/gemma-4-E4B-it',
    ollamaTag: 'gemma4:e4b',
    reusableModelPaths: [
      path.join('Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'unsloth', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf'),
      path.join('Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf'),
      path.join('Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-E4B-it', 'model.gguf'),
    ],
  },
  'gemma-4-12B-it-Q4_K_M': {
    name: 'Gemma 4 12B Instruct Q4_K_M',
    filename: 'gemma-4-12B-it-Q4_K_M.gguf',
    sizeBytes: 7_381_382_048,
    description: 'Offline local command model for Field Theory markdown commands',
    license: 'Apache-2.0',
    sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-12B-it-GGUF',
    baseModelUrl: 'https://huggingface.co/google/gemma-4-12B-it',
    ollamaTag: 'gemma4:12b',
    reusableModelPaths: [
      path.join('Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-12B-it-Q4_K_M', 'model.gguf'),
      path.join('Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-12B-it', 'model.gguf'),
    ],
  },
} as const satisfies Record<string, LocalLlmModelInfo>;

export type LocalLlmModelId = keyof typeof LOCAL_LLM_MODELS;
const LOCAL_LLM_MODEL_IDS = Object.keys(LOCAL_LLM_MODELS) as LocalLlmModelId[];

export const DEFAULT_LOCAL_LLM_MODEL: LocalLlmModelId = 'gemma-4-E4B-it-Q4_K_M';

export function isLocalLlmModelId(value: unknown): value is LocalLlmModelId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCAL_LLM_MODELS, value);
}

export function resolveLocalLlmHarness(value: unknown): LocalLlmHarness {
  return value === 'codex' ? 'codex' : 'direct';
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getLocalLlmPromptLimitChars(env: NodeJS.ProcessEnv, maxOutputTokens: number): number {
  const contextTokens = parseBoundedInteger(env.FT_GEMMA_CONTEXT_SIZE, DEFAULT_CONTEXT_TOKENS, 4096, 131072);
  const availablePromptTokens = Math.max(PROMPT_TOKEN_HEADROOM, contextTokens - maxOutputTokens - PROMPT_TOKEN_HEADROOM);
  return availablePromptTokens * APPROX_CHARS_PER_TOKEN;
}

export function assertLocalLlmPromptFits(prompt: string, env: NodeJS.ProcessEnv, maxOutputTokens: number): void {
  const limit = getLocalLlmPromptLimitChars(env, maxOutputTokens);
  if (prompt.length <= limit) return;
  throw new Error(`Local command prompt is too large for Gemma (${prompt.length} characters, limit ${limit}). Select a smaller section or use a shorter command.`);
}

export function stripWholeMarkdownFence(text: string): string {
  const withoutThought = text
    .replace(/^<think>[\s\S]*?<\/think>/i, '')
    .replace(/^<\|channel\|>analysis[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\|>thought[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\|>final\n/i, '')
    .replace(/<\|end\|>|<eos>|<\/s>/gi, '');
  const trimmed = withoutThought.trim();
  const match = trimmed.match(/^```(?:markdown|md|json)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

type LocalCommandOutputMode = 'markdown' | 'json';

export function buildLocalCommandPrompt(input: LocalCommandPromptInput, outputMode: LocalCommandOutputMode = 'markdown'): string {
  const outputRules = outputMode === 'json'
    ? [
        '- Return exactly one JSON object.',
        '- Put the complete replacement Markdown document in replacementMarkdown.',
        '- Do not add explanations before or after the JSON.',
        '- Do not wrap the JSON in a code fence.',
        '- Do not include private reasoning, thinking tags, or status text.',
        '- Do not emit tool calls, apply_patch blocks, diffs, shell commands, or file operation text.',
      ]
    : [
        '- Return only the complete replacement Markdown document.',
        '- Do not add explanations before or after the Markdown.',
        '- Do not wrap the answer in a code fence.',
        '- Do not include private reasoning, thinking tags, JSON metadata, or status text.',
        '- Do not emit tool calls, apply_patch blocks, diffs, shell commands, or file operation text.',
      ];
  return [
    'You are running a local Field Theory command against a markdown document.',
    '',
    'Rules:',
    '- Use the command markdown as the function instructions.',
    ...outputRules,
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- If the source is incomplete, keep it as a clarification task instead of inventing missing intent.',
    ...(input.memorySnapshot
      ? [
          '- Use the Maxwell memory snapshot only when it is directly relevant to the command.',
          '- Do not mention the memory snapshot unless the command asks for provenance.',
        ]
      : []),
    ...(outputMode === 'json'
      ? [
          '',
          'JSON shape:',
          '{"replacementMarkdown":"<complete replacement Markdown document>","summary":"<one sentence summary>"}',
        ]
      : []),
    '',
    `Command name: ${input.commandName}`,
    ...(input.memorySnapshot
      ? [
          '',
          'Maxwell memory snapshot:',
          '```markdown',
          input.memorySnapshot,
          '```',
        ]
      : []),
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
    '',
    'Final output contract:',
    outputMode === 'json'
      ? 'Return only the JSON object. Field Theory will apply it. Do not call tools or describe saving.'
      : 'Return only the replacement Markdown. Field Theory will apply it. Do not call tools or describe saving.',
  ].join('\n');
}

export function buildLocalSelectionCommandPrompt(input: LocalCommandSelectionPromptInput, outputMode: LocalCommandOutputMode = 'markdown'): string {
  const outputRules = outputMode === 'json'
    ? [
        '- Return exactly one JSON object.',
        '- Put only the replacement text for the selected markdown in replacementText.',
        '- Do not return the full document.',
        '- Do not add explanations before or after the JSON.',
        '- Do not wrap the JSON in a code fence.',
        '- Do not include private reasoning, thinking tags, or status text.',
        '- Do not emit tool calls, apply_patch blocks, diffs, shell commands, or file operation text.',
      ]
    : [
        '- Return only the replacement text for the selected markdown.',
        '- Do not return the full document.',
        '- Do not add explanations before or after the replacement.',
        '- Do not wrap the answer in a code fence.',
        '- Do not include private reasoning, thinking tags, JSON metadata, or status text.',
        '- Do not emit tool calls, apply_patch blocks, diffs, shell commands, or file operation text.',
      ];
  return [
    'You are running a local Field Theory command against selected markdown text.',
    '',
    'Rules:',
    '- Use the command markdown as the function instructions.',
    ...outputRules,
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- Preserve surrounding markdown style unless the command explicitly asks to change it.',
    '- Treat the full document context as read-only context. Replace only the selected markdown.',
    '- Do not return paths, filenames, screenshots, or figure references from the context unless they were in the selected markdown.',
    ...(input.memorySnapshot
      ? [
          '- Use the Maxwell memory snapshot only when it is directly relevant to the command.',
          '- Do not mention the memory snapshot unless the command asks for provenance.',
        ]
      : []),
    ...(outputMode === 'json'
      ? [
          '',
          'JSON shape:',
          '{"replacementText":"<replacement text for the selected markdown>","summary":"<one sentence summary>"}',
        ]
      : []),
    '',
    `Command name: ${input.commandName}`,
    ...(input.memorySnapshot
      ? [
          '',
          'Maxwell memory snapshot:',
          '```markdown',
          input.memorySnapshot,
          '```',
        ]
      : []),
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
    '',
    'Final output contract:',
    outputMode === 'json'
      ? 'Return only the JSON object. Field Theory will apply it. Do not call tools or describe saving.'
      : 'Return only the replacement text. Field Theory will apply it. Do not call tools or describe saving.',
  ].join('\n');
}

export function parseLocalCommandReplacement(raw: string, replacementField: 'replacementMarkdown' | 'replacementText'): string {
  const cleaned = stripWholeMarkdownFence(raw);
  if (looksLikeToolCallOutput(cleaned)) {
    throw new Error(`Local command returned tool-call output instead of ${replacementField}. No changes were saved.`);
  }
  const parsed = parseJsonObject(cleaned) ?? parseJsonObject(extractJsonObject(cleaned));
  const replacement = parsed?.[replacementField];
  if (typeof replacement === 'string') {
    return stripWholeMarkdownFence(replacement);
  }
  throw new Error(`Local command returned invalid output; expected JSON with ${replacementField}. No changes were saved.`);
}

export function parseSimpleLocalCommandReplacement(raw: string): string {
  const cleaned = stripWholeMarkdownFence(raw);
  if (looksLikeToolCallOutput(cleaned)) {
    throw new Error('Local command returned tool-call output instead of replacement markdown. No changes were saved.');
  }
  if (/^\s*\{/.test(cleaned) || /"replacement(?:Markdown|Text)"\s*:/.test(cleaned)) {
    throw new Error('Local command returned structured output in simple mode. No changes were saved.');
  }
  if (/^\s*(?:i(?:'|’)ll|i will|i see|here(?:'|’)s|here is|sure|okay|great)\b/i.test(cleaned)) {
    throw new Error('Local command returned assistant text instead of replacement Markdown. No changes were saved.');
  }
  return cleaned;
}

export function looksLikeStandaloneFieldTheoryFigurePath(text: string): boolean {
  const normalized = stripWholeMarkdownFence(text)
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^file:\/\//i, '');
  return /^(?:~|\/Users\/[^/]+)\/Library\/Application Support\/fieldtheory-mac\/users\/[^/]+\/figures\/[^`]+?\.(?:png|jpe?g|gif|webp)$/i.test(normalized);
}

export function assertSelectionReplacementMatchesSelection(input: LocalCommandSelectionPromptInput, replacement: string): void {
  if (
    looksLikeStandaloneFieldTheoryFigurePath(replacement)
    && !looksLikeStandaloneFieldTheoryFigurePath(input.selectedText)
  ) {
    throw new Error('Local command returned a figure path instead of replacement text. No changes were saved.');
  }
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
  private activeRunCount = 0;

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

  isRunning(): boolean {
    return this.activeRunCount > 0;
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
    return Object.fromEntries(
      LOCAL_LLM_MODEL_IDS.map(model => [model, this.getModelHealth(model).status === 'ready']),
    ) as Record<LocalLlmModelId, boolean>;
  }

  getModelHealthMap(): Record<LocalLlmModelId, LocalLlmHealth> {
    return Object.fromEntries(
      LOCAL_LLM_MODEL_IDS.map(model => [model, this.getModelHealth(model)]),
    ) as Record<LocalLlmModelId, LocalLlmHealth>;
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
    this.activeRunCount += 1;
    try {
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
    } finally {
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
    }
  }

  async runReplacementCommand(input: LocalCommandPromptInput, options: LocalLlmCommandOptions = {}): Promise<string> {
    const harness = this.getHarness();
    const prompt = buildLocalCommandPrompt(input, harness === 'codex' ? 'json' : 'markdown');
    const maxTokens = 4096;
    assertLocalLlmPromptFits(prompt, this.getEffectiveEnv(), maxTokens);
    const raw = await this.generate(prompt, { maxTokens, temperature: 0.1, onProgress: options.onProgress });
    return harness === 'codex'
      ? parseLocalCommandReplacement(raw, 'replacementMarkdown')
      : parseSimpleLocalCommandReplacement(raw);
  }

  async runSelectionCommand(input: LocalCommandSelectionPromptInput, options: LocalLlmCommandOptions = {}): Promise<string> {
    const harness = this.getHarness();
    const prompt = buildLocalSelectionCommandPrompt(input, harness === 'codex' ? 'json' : 'markdown');
    const maxTokens = 2048;
    assertLocalLlmPromptFits(prompt, this.getEffectiveEnv(), maxTokens);
    const raw = await this.generate(prompt, { maxTokens, temperature: 0.1, onProgress: options.onProgress });
    const replacement = harness === 'codex'
      ? parseLocalCommandReplacement(raw, 'replacementText')
      : parseSimpleLocalCommandReplacement(raw);
    assertSelectionReplacementMatchesSelection(input, replacement);
    return replacement;
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    this.serverModelPath = null;
  }

  getModelPathCandidates(model: LocalLlmModelId = this.selectedModel): string[] {
    const modelInfo = LOCAL_LLM_MODELS[model];
    const filename = modelInfo.filename;
    const homeDir = this.options.env?.HOME ?? process.env.HOME;
    const reusableModelCandidates = homeDir
      ? [
          path.join(homeDir, '.fieldtheory', 'models', filename),
          ...this.getOllamaModelPathCandidates(modelInfo, homeDir),
          ...(modelInfo.reusableModelPaths ?? []).map(candidate => path.join(homeDir, candidate)),
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

  private getOllamaModelPathCandidates(modelInfo: LocalLlmModelInfo, homeDir: string): string[] {
    if (!modelInfo.ollamaTag) return [];

    const [name, tag] = modelInfo.ollamaTag.split(':');
    if (!name || !tag) return [];

    const manifestPath = path.join(homeDir, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library', name, tag);
    if (!fs.existsSync(manifestPath)) return [];

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        layers?: Array<{ mediaType?: string; digest?: string }>;
      };
      const modelLayer = manifest.layers?.find(layer => layer.mediaType === 'application/vnd.ollama.image.model');
      const digest = modelLayer?.digest?.startsWith('sha256:')
        ? modelLayer.digest.slice('sha256:'.length)
        : null;
      return digest
        ? [path.join(homeDir, '.ollama', 'models', 'blobs', `sha256-${digest}`)]
        : [];
    } catch {
      return [];
    }
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

  private getEffectiveEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.options.env };
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

function looksLikeToolCallOutput(text: string): boolean {
  return /<\|tool_call\|>|<tool_call\|>|call:apply_patch|\*\*\* Begin Patch|\n@@\s/.test(text);
}
