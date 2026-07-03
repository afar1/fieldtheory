#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const envFlagIndex = args.indexOf('--env');
const explicitEnv = envFlagIndex >= 0 ? args[envFlagIndex + 1] : null;
const inlineEnv = args.find((arg) => arg.startsWith('--env='))?.slice('--env='.length) ?? null;

if (envFlagIndex >= 0 && (!explicitEnv || explicitEnv.startsWith('--'))) {
  console.error('Missing value for --env. Use "--env local" or "--env login".');
  process.exit(1);
}

const devEnv = inlineEnv || explicitEnv || (args.includes('--login') ? 'login' : 'local');
const login = devEnv === 'login';
const dryRun = args.includes('--dry-run');
const appDir = process.cwd();
const envPath = path.join(appDir, '.env.local');

if (!['local', 'login'].includes(devEnv)) {
  console.error(`Unknown dev env "${devEnv}". Use "local" or "login".`);
  process.exit(1);
}

function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function hasLoginConfig(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const env = parseEnv(fs.readFileSync(filePath, 'utf8'));
  return Boolean(
    env.VITE_SUPABASE_URL &&
    (env.FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)
  );
}

function candidateLoginEnvPaths() {
  return [
    process.env.FIELD_THEORY_LOGIN_ENV_PATH,
    path.resolve(appDir, '../../fieldtheory/mac-app/.env.local'),
    path.resolve(appDir, '../../fieldtheory/.env.local'),
  ].filter(Boolean);
}

function ensureLoginConfig() {
  if (hasLoginConfig(envPath)) {
    console.log('Account sign-in config: enabled via mac-app/.env.local');
    return;
  }

  for (const candidate of candidateLoginEnvPaths()) {
    if (candidate && candidate !== envPath && hasLoginConfig(candidate)) {
      fs.copyFileSync(candidate, envPath);
      console.log(`Account sign-in config: copied ignored config from ${candidate}`);
      return;
    }
  }

  console.error('Account sign-in config is missing.');
  console.error('Add VITE_SUPABASE_URL and FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY to mac-app/.env.local.');
  console.error('You can also set FIELD_THEORY_LOGIN_ENV_PATH=/path/to/.env.local and rerun npm run dev -- --login.');
  process.exit(1);
}

if (login) ensureLoginConfig();

if (dryRun) {
  console.log(`Dev env: ${devEnv}`);
  process.exit(0);
}

const child = spawn('npm', ['run', 'dev:quiet'], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
