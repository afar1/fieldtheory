import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJson, ensureDir, pathExists } from './fs.js';

const FINDING_SECTIONS = ['BOOKMARKS', 'WHAT WE FOUND', 'WHAT TO DO', 'CONFIDENCE'] as const;
const DEFAULT_RUNTIME: { email: string; engine: 'auto' | 'codex' | 'claude'; turns: number; budget: number } = {
  email: '',
  engine: 'auto',
  turns: 4,
  budget: 4,
};
const DEFAULT_PROMPTS: {
  custom_instructions: string[];
  include_tweet_urls: boolean;
  finding_sections: string[];
  system_prompt_append: string;
} = {
  custom_instructions: [],
  include_tweet_urls: true,
  finding_sections: [...FINDING_SECTIONS],
  system_prompt_append: '',
};

export const theoriesConfigSchema = z.object({
  runtime: z.object({
    email: z.string().default(''),
    engine: z.enum(['auto', 'codex', 'claude']).default('auto'),
    turns: z.number().int().min(1).max(20).default(4),
    budget: z.number().int().min(1).max(20).default(4),
  }).default(DEFAULT_RUNTIME),
  prompts: z.object({
    custom_instructions: z.array(z.string()).default([]),
    include_tweet_urls: z.boolean().default(true),
    finding_sections: z.array(z.string()).default([...FINDING_SECTIONS]),
    system_prompt_append: z.string().default(''),
  }).default(DEFAULT_PROMPTS),
});

export type TheoriesConfig = z.infer<typeof theoriesConfigSchema>;

export function theoriesConfigPath(): string {
  return path.join(os.homedir(), '.fieldtheory', 'theories.json');
}

export interface Lens {
  name: string;
  title: string;
  category_filter: string;
  domain_filter: boolean;
  prompt_hint: string;
  system_prompt: 'analyst' | 'explorer';
  repo_pick: 'top3' | 'any';
  limit: number;
}

export const BUILT_IN_LENSES: Lens[] = [
  {
    name: 'scan',
    title: 'Security & dependency scan',
    category_filter: 'security',
    domain_filter: false,
    prompt_hint: 'These bookmarks mention security issues, vulnerabilities, or supply chain risks. Check if any of the mentioned tools, libraries, or vulnerability patterns affect this repo. Be specific: name the dependency, version, file. If nothing applies, say so — don\'t force a connection.',
    system_prompt: 'analyst',
    repo_pick: 'top3',
    limit: 15,
  },
  {
    name: 'adopt',
    title: 'Tool & library adoption',
    category_filter: 'tool',
    domain_filter: true,
    prompt_hint: 'These bookmarks reference open-source tools and repositories. For each one, check: (1) is the developer already using this? (2) does it solve a problem this repo currently has? (3) what would adopting it look like — which files change, what\'s the migration path? Skip anything that doesn\'t clearly apply.',
    system_prompt: 'analyst',
    repo_pick: 'any',
    limit: 20,
  },
  {
    name: 'pattern',
    title: 'Pattern & technique transfer',
    category_filter: 'technique',
    domain_filter: true,
    prompt_hint: 'These bookmarks describe techniques, architecture patterns, or "how I built X" approaches. Read the repo\'s code and identify where any of these patterns could concretely improve it. Name the specific file and function. If the repo already does something similar, note that too — sometimes the bookmark version is better, sometimes the repo\'s approach is fine.',
    system_prompt: 'analyst',
    repo_pick: 'any',
    limit: 20,
  },
  {
    name: 'explore',
    title: 'Open exploration',
    category_filter: 'launch,research,opinion',
    domain_filter: false,
    prompt_hint: 'These are bookmarks that caught the developer\'s eye — product launches, research papers, interesting takes. Look for the adjacent possible: what does this repo gain access to because these ideas exist? What\'s one step away that nobody\'s noticed? This is the open-ended session — follow what\'s interesting, not what\'s obviously practical.',
    system_prompt: 'explorer',
    repo_pick: 'any',
    limit: 30,
  },
];

export const DEFAULTS: TheoriesConfig = {
  runtime: { ...DEFAULT_RUNTIME },
  prompts: { ...DEFAULT_PROMPTS },
};

// ── Lens management ─────────────────────────────────────────────────────

export async function loadLenses(): Promise<Lens[]> {
  const configPath = theoriesConfigPath();
  try {
    if (await pathExists(configPath)) {
      const raw = await readJson<Record<string, any>>(configPath);
      const custom: Lens[] = Array.isArray(raw.lenses) ? raw.lenses : [];
      return [...BUILT_IN_LENSES, ...custom];
    }
  } catch { /* use defaults */ }
  return [...BUILT_IN_LENSES];
}

export async function loadCustomLenses(): Promise<Lens[]> {
  const configPath = theoriesConfigPath();
  try {
    if (await pathExists(configPath)) {
      const raw = await readJson<Record<string, any>>(configPath);
      return Array.isArray(raw.lenses) ? raw.lenses : [];
    }
  } catch { /* empty */ }
  return [];
}

async function saveCustomLenses(lenses: Lens[]): Promise<void> {
  const configPath = theoriesConfigPath();
  await ensureDir(path.dirname(configPath));
  let raw: Record<string, any> = {};
  try {
    if (await pathExists(configPath)) {
      raw = await readJson<Record<string, any>>(configPath);
    }
  } catch { /* start fresh */ }
  raw.lenses = lenses;
  await writeJson(configPath, raw);
}

export async function addLens(lens: Lens): Promise<void> {
  const custom = await loadCustomLenses();
  const builtInNames = BUILT_IN_LENSES.map(l => l.name);
  if (builtInNames.includes(lens.name)) {
    throw new Error(`Cannot override built-in lens "${lens.name}"`);
  }
  const existing = custom.findIndex(l => l.name === lens.name);
  if (existing >= 0) {
    custom[existing] = lens;
  } else {
    custom.push(lens);
  }
  await saveCustomLenses(custom);
}

export async function removeLens(name: string): Promise<boolean> {
  const builtInNames = BUILT_IN_LENSES.map(l => l.name);
  if (builtInNames.includes(name)) {
    throw new Error(`Cannot remove built-in lens "${name}"`);
  }
  const custom = await loadCustomLenses();
  const filtered = custom.filter(l => l.name !== name);
  if (filtered.length === custom.length) return false;
  await saveCustomLenses(filtered);
  return true;
}

// ── Config ──────────────────────────────────────────────────────────────

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
