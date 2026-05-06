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
  LocalLlmManager,
  stripWholeMarkdownFence,
} from './localLlmManager';

describe('LocalLlmManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-local-llm-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('uses Gemma 4 as the default local command model', () => {
    const manager = new LocalLlmManager({ userDataPath: tempDir });
    const models = manager.getAvailableModels();

    expect(DEFAULT_LOCAL_LLM_MODEL).toBe('gemma-4-E4B-it-Q4_K_M');
    expect(models[DEFAULT_LOCAL_LLM_MODEL]).toEqual(expect.objectContaining({
      name: 'Gemma 4 E4B Instruct Q4_K_M',
      filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
      license: 'Apache-2.0',
      baseModelUrl: 'https://huggingface.co/google/gemma-4-E4B-it',
    }));
  });

  it('builds a replacement prompt from command markdown and target markdown', () => {
    const prompt = buildLocalCommandPrompt({
      commandName: 'tidy',
      commandContent: '# Tidy\nGroup related tasks.',
      targetTitle: 'Scratchpad',
      targetPath: '/tmp/Scratchpad.md',
      targetContent: '- [ ] rough note',
    });

    expect(prompt).toContain('Use the command markdown as the function instructions.');
    expect(prompt).toContain('Return only the complete replacement Markdown document.');
    expect(prompt).toContain('Command name: tidy');
    expect(prompt).toContain('# Tidy\nGroup related tasks.');
    expect(prompt).toContain('Document path: /tmp/Scratchpad.md');
    expect(prompt).toContain('- [ ] rough note');
  });

  it('builds a selected-text prompt that asks for only the replacement text', () => {
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
    expect(prompt).toContain('Do not return the full document.');
    expect(prompt).toContain('Command name: improve');
    expect(prompt).toContain('rough sentence');
    expect(prompt).toContain('Full document context:');
  });

  it('strips whole markdown fences and common reasoning wrappers from model output', () => {
    expect(stripWholeMarkdownFence('```markdown\n# Clean\n```')).toBe('# Clean');
    expect(stripWholeMarkdownFence('<think>hidden</think>\n```md\n# Clean\n```<eos>')).toBe('# Clean');
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
    const sharedModelPath = path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'unsloth', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf');
    const bundledModelPath = path.join(tempDir, 'resources', 'models', 'gemma-4-E4B-it-Q4_K_M.gguf');

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

    expect(manager.getDefaultInstallPath()).toBe(path.join(tempDir, 'models', 'gemma-4-E4B-it-Q4_K_M.gguf'));
    expect(manager.getModelHealthMap()[DEFAULT_LOCAL_LLM_MODEL]).toEqual(expect.objectContaining({
      status: 'missing',
      modelPath: expect.stringContaining('gemma-4-E4B-it-Q4_K_M.gguf'),
    }));
  });

  it('uses an existing shared Gemma model before app-local copies', () => {
    const homeDir = path.join(tempDir, 'home');
    const sharedModelPath = path.join(homeDir, 'Library', 'Application Support', 'Atomic Chat', 'data', 'llamacpp', 'models', 'unsloth', 'gemma-4-E4B-it-Q4_K_M', 'model.gguf');
    fs.mkdirSync(path.dirname(sharedModelPath), { recursive: true });
    fs.closeSync(fs.openSync(sharedModelPath, 'w'));
    fs.truncateSync(sharedModelPath, 3 * 1024 * 1024 * 1024);

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

  it('runs replacement commands through a local stdio server', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-E4B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 3 * 1024 * 1024 * 1024);

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
    expect(server.send).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'generate',
      temperature: 0.1,
    }));
    expect(capturedArgs).toEqual(expect.arrayContaining(['--model', modelPath]));
  });

  it('runs selected-text commands through a local stdio server', async () => {
    const modelPath = path.join(tempDir, 'gemma-4-E4B-it-Q4_K_M.gguf');
    fs.closeSync(fs.openSync(modelPath, 'w'));
    fs.truncateSync(modelPath, 3 * 1024 * 1024 * 1024);

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

    expect(server.send).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'generate',
      maxTokens: 2048,
      temperature: 0.1,
    }));
  });
});
