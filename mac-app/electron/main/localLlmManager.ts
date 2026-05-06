import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { StdioJsonServer } from './stdioJsonServer';
import { createLogger } from './logger';

const log = createLogger('LocalLLM');

export type LocalLlmModelId = 'gemma-4-E4B-it-Q4_K_M';

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
  }) => Pick<StdioJsonServer, 'start' | 'send' | 'stop'>;
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

export function stripWholeMarkdownFence(text: string): string {
  const withoutThought = text
    .replace(/^<think>[\s\S]*?<\/think>/i, '')
    .replace(/^<\|channel\|>analysis[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\|>thought[\s\S]*?<\|channel\|>final/i, '')
    .replace(/^<\|channel\>final\n/i, '')
    .replace(/<\|end\|>|<eos>|<\/s>/gi, '');
  const trimmed = withoutThought.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

export function buildLocalCommandPrompt(input: LocalCommandPromptInput): string {
  return [
    'You are running a local Field Theory command against a markdown document.',
    '',
    'Rules:',
    '- Use the command markdown as the function instructions.',
    '- Return only the complete replacement Markdown document.',
    '- Do not add explanations before or after the Markdown.',
    '- Do not wrap the answer in a code fence.',
    '- Do not include private reasoning, thinking tags, JSON metadata, or status text.',
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- If the source is incomplete, keep it as a clarification task instead of inventing missing intent.',
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
    '- Return only the replacement text for the selected markdown.',
    '- Do not return the full document.',
    '- Do not add explanations before or after the replacement.',
    '- Do not wrap the answer in a code fence.',
    '- Do not include private reasoning, thinking tags, JSON metadata, or status text.',
    '- Preserve the user intent, file paths, links, screenshots, and visible checkbox state.',
    '- Preserve surrounding markdown style unless the command explicitly asks to change it.',
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


export class LocalLlmManager {
  private selectedModel: LocalLlmModelId = DEFAULT_LOCAL_LLM_MODEL;
  private server: Pick<StdioJsonServer, 'start' | 'send' | 'stop'> | null = null;
  private serverModelPath: string | null = null;

  constructor(private readonly options: LocalLlmManagerOptions = {}) {}

  getAvailableModels(): Record<LocalLlmModelId, LocalLlmModelInfo> {
    return LOCAL_LLM_MODELS;
  }

  getSelectedModel(): LocalLlmModelId {
    return this.selectedModel;
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

  async generate(prompt: string, options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
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
    });
    if (!response.ok || typeof response.text !== 'string') {
      throw new Error(response.error ?? 'Local Gemma generation failed');
    }
    return response.text;
  }

  async runReplacementCommand(input: LocalCommandPromptInput): Promise<string> {
    const prompt = buildLocalCommandPrompt(input);
    const raw = await this.generate(prompt, { maxTokens: 4096, temperature: 0.1 });
    return stripWholeMarkdownFence(raw);
  }

  async runSelectionCommand(input: LocalCommandSelectionPromptInput): Promise<string> {
    const prompt = buildLocalSelectionCommandPrompt(input);
    const raw = await this.generate(prompt, { maxTokens: 2048, temperature: 0.1 });
    return stripWholeMarkdownFence(raw);
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

  private getServer(modelPath: string): Pick<StdioJsonServer, 'start' | 'send' | 'stop'> {
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
      args: [scriptPath, '--model', modelPath],
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
