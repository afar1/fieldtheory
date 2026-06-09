import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/fieldtheory-local-llm-tests'),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  buildLocalCommandPrompt,
  buildLocalSelectionCommandPrompt,
  DEFAULT_LOCAL_LLM_MODEL,
  getLocalLlmPromptLimitChars,
  LocalLlmManager,
  parseLocalLlmProgressEvent,
  parseLocalCommandReplacement,
  parseSimpleLocalCommandReplacement,
  looksLikeStandaloneFieldTheoryFigurePath,
  resolveLocalLlmHarness,
  stripWholeMarkdownFence,
} from './localLlmManager';

describe('LocalLlmManager', () => {
  let tempDir: string;
  const dogfoodIt = process.env.FT_RUN_LOCAL_LLM_DOGFOOD === '1' ? it : it.skip;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-local-llm-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('uses Gemma 4 12B as the default local command model', () => {
    const manager = new LocalLlmManager({ userDataPath: tempDir });
    const models = manager.getAvailableModels();

    expect(DEFAULT_LOCAL_LLM_MODEL).toBe('gemma-4-12B-it-Q4_K_M');
    expect(models[DEFAULT_LOCAL_LLM_MODEL]).toEqual(expect.objectContaining({
      name: 'Gemma 4 12B Instruct Q4_K_M',
      filename: 'gemma-4-12B-it-Q4_K_M.gguf',
      license: 'Apache-2.0',
      baseModelUrl: 'https://huggingface.co/google/gemma-4-12B-it',
      ollamaTag: 'gemma4:12b',
    }));
    expect(models['gemma-4-E4B-it-Q4_K_M']).toEqual(expect.objectContaining({
      name: 'Gemma 4 E4B Instruct Q4_K_M',
      filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
      sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF',
      baseModelUrl: 'https://huggingface.co/google/gemma-4-E4B-it',
      ollamaTag: 'gemma4:e4b',
    }));
  });

  it('uses the direct local runner by default and keeps the Codex harness opt-in', () => {
    const manager = new LocalLlmManager({ userDataPath: tempDir });
    const codexManager = new LocalLlmManager({
      userDataPath: tempDir,
      env: { FT_LOCAL_LLM_HARNESS: 'codex' },
    });

    expect(resolveLocalLlmHarness(undefined)).toBe('direct');
    expect(resolveLocalLlmHarness('direct')).toBe('direct');
    expect(resolveLocalLlmHarness('codex')).toBe('codex');
    expect(manager.getHarness()).toBe('direct');
    expect(codexManager.getHarness()).toBe('codex');
  });

  it('derives a conservative prompt limit from the local context size', () => {
    expect(getLocalLlmPromptLimitChars({ FT_GEMMA_CONTEXT_SIZE: '4096' }, 2048)).toBe(6144);
    expect(getLocalLlmPromptLimitChars({ FT_GEMMA_CONTEXT_SIZE: 'not-a-number' }, 4096)).toBe(112640);
  });

  it('builds a simple replacement prompt from command markdown and target markdown', () => {
    const prompt = buildLocalCommandPrompt({
      commandName: 'tidy',
      commandContent: '# Tidy\nGroup related tasks.',
      targetTitle: 'Scratchpad',
      targetPath: '/tmp/Scratchpad.md',
      targetContent: '- [ ] rough note',
    });

    expect(prompt).toContain('Use the command markdown as the function instructions.');
    expect(prompt).toContain('Return only the complete replacement Markdown document.');
    expect(prompt).not.toContain('replacementMarkdown');
    expect(prompt).toContain('Command name: tidy');
    expect(prompt).toContain('# Tidy\nGroup related tasks.');
    expect(prompt).toContain('Document path: /tmp/Scratchpad.md');
    expect(prompt).toContain('- [ ] rough note');
  });

  it('includes Maxwell memory only when a run has a memory snapshot', () => {
    const prompt = buildLocalCommandPrompt({
      commandName: 'tidy',
      commandContent: '# Tidy\nGroup related tasks.',
      targetTitle: 'Scratchpad',
      targetPath: '/tmp/Scratchpad.md',
      targetContent: '- [ ] rough note',
      memorySnapshot: 'Prefer terse task groups.',
    });

    expect(prompt).toContain('Use the Maxwell memory snapshot only when it is directly relevant to the command.');
    expect(prompt).toContain('Maxwell memory snapshot:');
    expect(prompt).toContain('Prefer terse task groups.');
  });

  it('can build a structured replacement prompt for the Codex harness', () => {
    const prompt = buildLocalCommandPrompt({
      commandName: 'tidy',
      commandContent: '# Tidy\nGroup related tasks.',
      targetTitle: 'Scratchpad',
      targetPath: '/tmp/Scratchpad.md',
      targetContent: '- [ ] rough note',
    }, 'json');

    expect(prompt).toContain('Return exactly one JSON object.');
    expect(prompt).toContain('replacementMarkdown');
    expect(prompt).toContain('Do not emit tool calls');
    expect(prompt).toContain('Field Theory will apply it');
  });

  it('builds a simple selected-text prompt that asks for only the replacement text', () => {
    const prompt = buildLocalSelectionCommandPrompt({
      commandName: 'improve',
      commandContent: 'Make this clearer.',
      targetTitle: 'Draft',
      targetPath: '/tmp/Draft.md',
      targetContent: 'Before\nrough sentence\nAfter',
      selectedText: 'rough sentence',
    });

    expect(prompt).toContain('selected markdown text');
    expect(prompt).toContain('Return only the replacement text for the selected markdown.');
    expect(prompt).not.toContain('replacementText');
    expect(prompt).toContain('Do not return the full document.');
    expect(prompt).toContain('Treat the full document context as read-only context.');
    expect(prompt).toContain('Do not return paths, filenames, screenshots, or figure references from the context unless they were in the selected markdown.');
    expect(prompt).toContain('Command name: improve');
    expect(prompt).toContain('rough sentence');
    expect(prompt).toContain('Full document context:');
  });

  it('recognizes standalone Field Theory figure paths', () => {
    expect(looksLikeStandaloneFieldTheoryFigurePath(
      '`~/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png`',
    )).toBe(true);
    expect(looksLikeStandaloneFieldTheoryFigurePath(
      '![Screenshot](~/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png)',
    )).toBe(false);
    expect(looksLikeStandaloneFieldTheoryFigurePath('clearer prose')).toBe(false);
  });

  it('includes Maxwell memory in selected-text prompts', () => {
    const prompt = buildLocalSelectionCommandPrompt({
      commandName: 'improve',
      commandContent: 'Make this clearer.',
      targetTitle: 'Draft',
      targetPath: '/tmp/Draft.md',
      targetContent: 'Before\nrough sentence\nAfter',
      selectedText: 'rough sentence',
      memorySnapshot: 'Prefer direct wording.',
    });

    expect(prompt).toContain('Maxwell memory snapshot:');
    expect(prompt).toContain('Prefer direct wording.');
    expect(prompt).toContain('Selected markdown:');
  });

  it('can build a structured selected-text prompt for the Codex harness', () => {
    const prompt = buildLocalSelectionCommandPrompt({
      commandName: 'improve',
      commandContent: 'Make this clearer.',
      targetTitle: 'Draft',
      targetPath: '/tmp/Draft.md',
      targetContent: 'Before\nrough sentence\nAfter',
      selectedText: 'rough sentence',
    }, 'json');

    expect(prompt).toContain('Return exactly one JSON object.');
    expect(prompt).toContain('replacementText');
  });

  it('strips whole markdown fences and common reasoning wrappers from model output', () => {
    expect(stripWholeMarkdownFence('```markdown\n# Clean\n```')).toBe('# Clean');
    expect(stripWholeMarkdownFence('```json\n{"replacementText":"clean"}\n```')).toBe('{"replacementText":"clean"}');
    expect(stripWholeMarkdownFence('<think>hidden</think>\n```md\n# Clean\n```<eos>')).toBe('# Clean');
    expect(stripWholeMarkdownFence('<|channel|>final\n# Clean<|end|>')).toBe('# Clean');
  });

  it('extracts structured replacement fields from local harness output', () => {
    expect(parseLocalCommandReplacement(
      JSON.stringify({ replacementMarkdown: '# Clean\n\nBody', summary: 'Cleaned up.' }),
      'replacementMarkdown',
    )).toBe('# Clean\n\nBody');
    expect(parseLocalCommandReplacement(
      'Here is the result:\n```json\n{"replacementText":"clean sentence"}\n```',
      'replacementText',
    )).toBe('clean sentence');
  });

  it('accepts plain markdown for the simple local runner and rejects envelopes', () => {
    expect(parseSimpleLocalCommandReplacement('```markdown\n# Clean\n```')).toBe('# Clean');
    expect(() => parseSimpleLocalCommandReplacement(
      'I see you want me to clean up the provided markdown document now.',
    )).toThrow('assistant text');
    expect(() => parseSimpleLocalCommandReplacement(
      JSON.stringify({ replacementMarkdown: '# Clean' }),
    )).toThrow('structured output');
    expect(() => parseSimpleLocalCommandReplacement(
      '*** Begin Patch\n*** Update File: /tmp/Note.md\n@@\n- mess\n+ clean',
    )).toThrow('tool-call output');
  });

  it('normalizes local runner progress events', () => {
    expect(parseLocalLlmProgressEvent({
      event: 'progress',
      kind: 'model_output',
      message: 'Gemma is generating locally',
      detail: ' gemma-4 ',
      phase: 'model',
    })).toEqual({
      kind: 'model_output',
      message: 'Gemma is generating locally',
      detail: 'gemma-4',
      phase: 'model',
    });
    expect(parseLocalLlmProgressEvent({ event: 'progress', message: '' })).toBeNull();
  });

  it('rejects non-JSON local harness output instead of treating it as a replacement', () => {
    expect(() => parseLocalCommandReplacement(
      'I see you want me to clean up the provided markdown document now.',
      'replacementMarkdown',
    )).toThrow('expected JSON with replacementMarkdown');
    expect(() => parseLocalCommandReplacement(
      '```markdown\n# Clean\n```',
      'replacementMarkdown',
    )).toThrow('expected JSON with replacementMarkdown');
    expect(() => parseLocalCommandReplacement(
      'I will edit the file.\n<|tool_call|>call:apply_patch{command:["apply_patch","*** Begin Patch"]}<tool_call|>',
      'replacementMarkdown',
    )).toThrow('tool-call output');
  });

  it('resolves model paths from explicit env before bundled paths', () => {
    const modelPath = path.join(tempDir, 'model.gguf');
    const homeDir = path.join(tempDir, 'home');
    const manager = new LocalLlmManager({
      userDataPath: path.join(tempDir, 'userData'),
      resourcesPath: path.join(tempDir, 'resources'),
      appPath: path.join(tempDir, 'app'),
      cwd: tempDir,
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath, HOME: homeDir },
    });
    const candidates = manager.getModelPathCandidates();
    const sharedModelPath = path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-12B-it-Q4_K_M', 'model.gguf');
    const bundledModelPath = path.join(tempDir, 'resources', 'models', 'gemma-4-12B-it-Q4_K_M.gguf');

    expect(candidates[0]).toBe(modelPath);
    expect(candidates).toContain(sharedModelPath);
    expect(candidates.indexOf(sharedModelPath)).toBeLessThan(candidates.indexOf(bundledModelPath));
    expect(manager.getModelHealth().status).toBe('missing');
  });

  it('reports the default user install path for settings installs', () => {
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: path.join(tempDir, 'resources'),
      appPath: path.join(tempDir, 'app'),
      cwd: tempDir,
      env: { HOME: path.join(tempDir, 'home') },
    });

    expect(manager.getDefaultInstallPath()).toBe(path.join(tempDir, 'models', 'gemma-4-12B-it-Q4_K_M.gguf'));
    expect(manager.getModelHealthMap()[DEFAULT_LOCAL_LLM_MODEL]).toEqual(expect.objectContaining({
      status: 'missing',
      modelPath: expect.stringContaining('gemma-4-12B-it-Q4_K_M.gguf'),
    }));
    expect(manager.getModelHealthMap()['gemma-4-12B-it-Q4_K_M']).toEqual(expect.objectContaining({
      status: 'missing',
      modelPath: expect.stringContaining('gemma-4-12B-it-Q4_K_M.gguf'),
    }));
  });

  it('uses 12B model metadata after selecting the 12B Gemma model', () => {
    const homeDir = path.join(tempDir, 'home');
    const manager = new LocalLlmManager({
      userDataPath: path.join(tempDir, 'userData'),
      resourcesPath: path.join(tempDir, 'resources'),
      appPath: path.join(tempDir, 'app'),
      cwd: tempDir,
      env: { HOME: homeDir },
    });

    expect(manager.setSelectedModel('gemma-4-12B-it-Q4_K_M')).toEqual({ success: true });

    const sharedModelPath = path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-12B-it-Q4_K_M', 'model.gguf');
    const bundledModelPath = path.join(tempDir, 'resources', 'models', 'gemma-4-12B-it-Q4_K_M.gguf');
    const candidates = manager.getModelPathCandidates();

    expect(manager.getSelectedModel()).toBe('gemma-4-12B-it-Q4_K_M');
    expect(manager.getDefaultInstallPath()).toBe(path.join(tempDir, 'userData', 'models', 'gemma-4-12B-it-Q4_K_M.gguf'));
    expect(candidates).toContain(sharedModelPath);
    expect(candidates.indexOf(sharedModelPath)).toBeLessThan(candidates.indexOf(bundledModelPath));
    expect(manager.getModelHealth()).toEqual(expect.objectContaining({
      status: 'missing',
      expectedSizeBytes: 7_381_382_048,
    }));
  });

  it('recognizes Ollama-downloaded Gemma models from their manifest blobs', () => {
    const homeDir = path.join(tempDir, 'home');
    const digest = '5cf8a1f2fc4268b3fd628743675910cf1d8137c4742d0be401c3e885f605023a';
    const manifestPath = path.join(homeDir, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library', 'gemma4', '12b');
    const blobPath = path.join(homeDir, '.ollama', 'models', 'blobs', `sha256-${digest}`);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(blobPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({
      layers: [
        { mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${digest}`, size: 7_381_382_048 },
      ],
    }));
    fs.closeSync(fs.openSync(blobPath, 'w'));
    fs.truncateSync(blobPath, 4 * 1024 * 1024 * 1024);

    const manager = new LocalLlmManager({
      userDataPath: path.join(tempDir, 'userData'),
      resourcesPath: path.join(tempDir, 'resources'),
      appPath: path.join(tempDir, 'app'),
      cwd: tempDir,
      env: { HOME: homeDir },
    });
    manager.setSelectedModel('gemma-4-12B-it-Q4_K_M');

    expect(manager.getModelPathCandidates()).toContain(blobPath);
    expect(manager.getModelHealth()).toEqual(expect.objectContaining({
      status: 'ready',
      modelPath: blobPath,
    }));
  });

  it('uses an existing shared Gemma model before app-local copies', () => {
    const homeDir = path.join(tempDir, 'home');
    const sharedModelPath = path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'google', 'gemma-4-12B-it-Q4_K_M', 'model.gguf');
    fs.mkdirSync(path.dirname(sharedModelPath), { recursive: true });
    fs.closeSync(fs.openSync(sharedModelPath, 'w'));
    fs.truncateSync(sharedModelPath, 4 * 1024 * 1024 * 1024);

    const manager = new LocalLlmManager({
      userDataPath: path.join(tempDir, 'userData'),
      resourcesPath: path.join(tempDir, 'resources'),
      appPath: path.join(tempDir, 'app'),
      cwd: tempDir,
      env: { HOME: homeDir },
    });

    expect(manager.getModelHealth()).toEqual(expect.objectContaining({
      status: 'ready',
      modelPath: sharedModelPath,
    }));
  });

  it('runs replacement commands through the simple local runner by default', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    let capturedArgs: string[] = [];
    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true, text: '```markdown\n# Clean\n```' })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: (config) => {
        capturedArgs = config.args;
        return server;
      },
    });

    await expect(manager.runReplacementCommand({
      commandName: 'tidy',
      commandContent: 'Clean this up.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'mess',
    })).resolves.toBe('# Clean');

    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'generate',
        harness: 'direct',
        temperature: 0.1,
      }),
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
    expect(capturedArgs).toEqual(expect.arrayContaining(['--model', modelPath, '--codex-model', DEFAULT_LOCAL_LLM_MODEL]));
  });

  it('reports active generation while a local model request is in flight', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    let resolveSend!: (value: { ok: boolean; text: string }) => void;
    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(() => new Promise<{ ok: boolean; text: string }>((resolve) => {
        resolveSend = resolve;
      })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: () => server,
    });

    const run = manager.generate('hello');
    await vi.waitFor(() => expect(manager.isRunning()).toBe(true));
    resolveSend({ ok: true, text: '# Clean' });
    await expect(run).resolves.toBe('# Clean');
    expect(manager.isRunning()).toBe(false);
  });

  it('refuses oversized prompts before starting the local model server', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const serverFactory = vi.fn(() => ({
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true, text: '# Clean' })),
      stop: vi.fn(),
    }));
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath, FT_GEMMA_CONTEXT_SIZE: '4096' },
      serverFactory,
    });

    await expect(manager.runReplacementCommand({
      commandName: 'tidy',
      commandContent: 'Clean this up.',
      targetTitle: 'Huge Note',
      targetPath: '/tmp/Huge.md',
      targetContent: 'x'.repeat(8_000),
    })).rejects.toThrow('Local command prompt is too large for Gemma');
    expect(serverFactory).not.toHaveBeenCalled();
  });

  it('runs replacement commands through the Codex harness when enabled', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true, text: JSON.stringify({ replacementMarkdown: '# Clean' }) })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath, FT_LOCAL_LLM_HARNESS: 'codex' },
      serverFactory: () => server,
    });

    await expect(manager.runReplacementCommand({
      commandName: 'tidy',
      commandContent: 'Clean this up.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'mess',
    })).resolves.toBe('# Clean');

    expect(server.send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'generate',
        harness: 'codex',
      }),
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
  });

  it('forwards local runner progress events while running commands', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async (_cmd: Record<string, unknown>, options?: { onEvent?: (event: Record<string, unknown>) => void }) => {
        options?.onEvent?.({
          event: 'progress',
          kind: 'status',
          message: 'Codex local harness started',
          detail: 'Gemma 4',
          phase: 'codex',
        });
        return { ok: true, text: '# Clean' };
      }),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: () => server,
    });
    const events: unknown[] = [];

    await expect(manager.runReplacementCommand({
      commandName: 'tidy',
      commandContent: 'Clean this up.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'mess',
    }, {
      onProgress: (event) => events.push(event),
    })).resolves.toBe('# Clean');

    expect(events).toEqual([{
      kind: 'status',
      message: 'Codex local harness started',
      detail: 'Gemma 4',
      phase: 'codex',
    }]);
  });

  it('rejects simple replacement command runs when the model returns status text', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({
        ok: true,
        text: 'I see you want me to clean up a messy set of notes into a structured Field Theory task list using the `tidy` command logic.',
      })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: () => server,
    });

    await expect(manager.runReplacementCommand({
      commandName: 'tidy',
      commandContent: 'Clean this up.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'mess',
    })).rejects.toThrow('assistant text');
  });

  it('runs selected-text commands through a local stdio server', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true, text: '```markdown\nclean sentence\n```' })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: () => server,
    });

    await expect(manager.runSelectionCommand({
      commandName: 'improve',
      commandContent: 'Improve this.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'rough sentence',
      selectedText: 'rough sentence',
    })).resolves.toBe('clean sentence');

    expect(server.send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'generate',
        maxTokens: 2048,
        temperature: 0.1,
      }),
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
  });

  it('rejects selected-text commands that return a standalone figure path for prose', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-12B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 4 * 1024 * 1024 * 1024);

    const server = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => ({
        ok: true,
        text: '`~/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png`',
      })),
      stop: vi.fn(),
    };
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: tempDir,
      appPath: tempDir,
      cwd: process.cwd(),
      env: { FT_LOCAL_LLM_MODEL_PATH: modelPath },
      serverFactory: () => server,
    });

    await expect(manager.runSelectionCommand({
      commandName: 'improve',
      commandContent: 'Improve this.',
      targetTitle: 'Note',
      targetPath: '/tmp/Note.md',
      targetContent: 'rough sentence\n\n![Screenshot](./figures/Screenshot 1.png)',
      selectedText: 'rough sentence',
    })).rejects.toThrow('figure path instead of replacement text');
  });

  dogfoodIt('dogfoods the real Codex harness against the local Gemma runner', async () => {
    const manager = new LocalLlmManager({
      userDataPath: tempDir,
      resourcesPath: path.join(process.cwd(), 'resources'),
      appPath: process.cwd(),
      cwd: process.cwd(),
      env: {
        FT_LOCAL_LLM_HARNESS: 'codex',
        FT_LOCAL_LLM_ALLOW_DIRECT_FALLBACK: '0',
        FT_CODEX_LOCAL_TIMEOUT_MS: '180000',
      },
    });

    try {
      await expect(manager.runReplacementCommand({
        commandName: 'dogfood',
        commandContent: 'Return the same markdown with the checkbox marked done. Return no extra prose.',
        targetTitle: 'Maxwell Dogfood',
        targetPath: '/tmp/maxwell-dogfood.md',
        targetContent: '- [ ] verify Maxwell dogfood',
      })).resolves.toEqual(expect.stringContaining('[x] verify Maxwell dogfood'));
    } finally {
      manager.stop();
    }
  }, 240_000);
});
