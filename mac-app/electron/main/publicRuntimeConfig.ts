import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface PublicRuntimeConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

const PUBLIC_RUNTIME_CONFIG_FILE = 'public-runtime-config.json';

function cleanValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizePublicRuntimeConfig(value: unknown): PublicRuntimeConfig {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return {
    supabaseUrl: cleanValue(record.supabaseUrl),
    supabasePublishableKey: cleanValue(record.supabasePublishableKey),
  };
}

export function getPublicRuntimeConfigPaths(): string[] {
  const paths = [
    path.join(__dirname, PUBLIC_RUNTIME_CONFIG_FILE),
  ];

  try {
    paths.push(
      path.join(app.getAppPath(), 'electron-dist', 'main', PUBLIC_RUNTIME_CONFIG_FILE),
      path.join(app.getAppPath(), PUBLIC_RUNTIME_CONFIG_FILE),
    );
  } catch {
    // app may not be available in unit tests.
  }

  return [...new Set(paths)];
}

export function loadGeneratedPublicRuntimeConfig(paths = getPublicRuntimeConfigPaths()): PublicRuntimeConfig {
  for (const configPath of paths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
      const config = normalizePublicRuntimeConfig(parsed);
      if (config.supabaseUrl || config.supabasePublishableKey) {
        return config;
      }
    } catch {
      // Ignore malformed generated config and continue to the next candidate.
    }
  }

  return {};
}
