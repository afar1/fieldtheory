import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJson, ensureDir, pathExists } from './fs.js';

const FINDING_SECTIONS = ['BOOKMARKS', 'WHAT WE FOUND', 'WHAT TO DO', 'CONFIDENCE'] as const;

export const theoriesConfigSchema = z.object({
  runtime: z.object({
    email: z.string().default(''),
    engine: z.enum(['auto', 'codex', 'claude']).default('auto'),
    turns: z.number().int().min(1).max(20).default(4),
    budget: z.number().int().min(1).max(20).default(4),
  }).default({}),
  prompts: z.object({
    custom_instructions: z.array(z.string()).default([]),
    include_tweet_urls: z.boolean().default(true),
    finding_sections: z.array(z.string()).default([...FINDING_SECTIONS]),
    system_prompt_append: z.string().default(''),
  }).default({}),
});

export type TheoriesConfig = z.infer<typeof theoriesConfigSchema>;

export function theoriesConfigPath(): string {
  return path.join(os.homedir(), '.fieldtheory', 'theories.json');
}

export const DEFAULTS: TheoriesConfig = {
  runtime: { email: '', engine: 'auto', turns: 4, budget: 4 },
  prompts: {
    custom_instructions: [],
    include_tweet_urls: true,
    finding_sections: ['BOOKMARKS', 'WHAT WE FOUND', 'WHAT TO DO', 'CONFIDENCE'],
    system_prompt_append: '',
  },
};

export async function loadTheoriesConfig(): Promise<TheoriesConfig> {
  const configPath = theoriesConfigPath();
  try {
    if (await pathExists(configPath)) {
      const raw = await readJson<Record<string, any>>(configPath);
      return {
        runtime: { ...DEFAULTS.runtime, ...raw.runtime },
        prompts: { ...DEFAULTS.prompts, ...raw.prompts },
      };
    }
  } catch { /* invalid or missing — use defaults */ }
  return { ...DEFAULTS };
}

export async function saveTheoriesConfig(config: TheoriesConfig): Promise<string> {
  const configPath = theoriesConfigPath();
  await ensureDir(path.dirname(configPath));
  const validated = theoriesConfigSchema.parse(config);
  await writeJson(configPath, validated);
  return configPath;
}

export async function setTheoriesConfigValue(keyPath: string, value: string): Promise<TheoriesConfig> {
  const config = await loadTheoriesConfig() as Record<string, any>;
  const parts = keyPath.split('.');

  let target: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in target)) throw new Error(`Unknown config key: ${keyPath}`);
    target = target[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in target)) throw new Error(`Unknown config key: ${keyPath}`);

  const current = target[leaf];
  if (typeof current === 'number') target[leaf] = Number(value);
  else if (typeof current === 'boolean') target[leaf] = value === 'true';
  else if (Array.isArray(current)) target[leaf] = value.split(',').map(s => s.trim());
  else target[leaf] = value;

  const validated = theoriesConfigSchema.parse(config);
  await saveTheoriesConfig(validated);
  return validated;
}
