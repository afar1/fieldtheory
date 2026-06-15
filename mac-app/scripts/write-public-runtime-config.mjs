#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const requireAuthConfig = args.has('--require-auth-config');
const checkOnly = args.has('--check-only');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDir, 'electron-dist', 'main', 'public-runtime-config.json');

function parseEnv(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readLocalEnv() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, 'utf8'));
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

const localEnv = readLocalEnv();
const config = {
  supabaseUrl: firstValue(process.env.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_URL),
  supabasePublishableKey: firstValue(
    process.env.FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
    localEnv.FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY,
    localEnv.VITE_SUPABASE_ANON_KEY,
  ),
};

if (requireAuthConfig && (!config.supabaseUrl || !config.supabasePublishableKey)) {
  console.error('Public auth config is required for production packaging.');
  console.error('Set VITE_SUPABASE_URL and FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY in mac-app/.env.local.');
  process.exit(1);
}

if (checkOnly) {
  console.log(`Public auth config: ${config.supabaseUrl && config.supabasePublishableKey ? 'present' : 'missing'}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(`${outputPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
fs.renameSync(`${outputPath}.tmp`, outputPath);

console.log(`Wrote public runtime config (${config.supabaseUrl && config.supabasePublishableKey ? 'auth enabled' : 'auth disabled'})`);
