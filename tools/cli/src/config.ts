import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import { workspaceRoot } from './paths.js';

export interface XApiConfig {
  apiKey: string;
  apiSecret: string;
  clientId: string;
  clientSecret: string;
  bearerToken?: string;
  callbackUrl?: string;
}

export interface ChromeSessionConfig {
  chromeUserDataDir: string;
  chromeProfileDirectory?: string;
}

export function loadEnv(cwd = process.cwd()): void {
  const cliRoot = workspaceRoot(cwd);
  const repoRoot = path.resolve(cliRoot, '..', '..');
  const candidatePaths = [
    path.join(cwd, '.env.local'),
    path.join(cwd, '.env'),
    path.join(cliRoot, '.env.local'),
    path.join(cliRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'mac-app', '.env.local'),
    path.join(repoRoot, 'mac-app', '.env'),
  ];

  for (const envPath of candidatePaths) {
    loadDotenv({ path: envPath, quiet: true });
  }
}

function detectChromeUserDataDir(): string | undefined {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'linux') return path.join(home, '.config', 'google-chrome');
  if (platform === 'win32') return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  return undefined;
}

export function loadChromeSessionConfig(cwd = process.cwd()): ChromeSessionConfig {
  loadEnv(cwd);
  const dir = process.env.FT_CHROME_USER_DATA_DIR ?? detectChromeUserDataDir();
  if (!dir) {
    throw new Error(
      'Could not detect Chrome user-data directory.\n' +
      'Set FT_CHROME_USER_DATA_DIR in .env.local or pass --chrome-user-data-dir.'
    );
  }
  return {
    chromeUserDataDir: dir,
    chromeProfileDirectory: process.env.FT_CHROME_PROFILE_DIRECTORY ?? 'Default',
  };
}

export function loadXApiConfig(cwd = process.cwd()): XApiConfig {
  loadEnv(cwd);

  const apiKey = process.env.X_API_KEY ?? process.env.X_CONSUMER_KEY;
  const apiSecret = process.env.X_API_SECRET ?? process.env.X_SECRET_KEY;
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const bearerToken = process.env.X_BEARER_TOKEN;
  const callbackUrl = process.env.X_CALLBACK_URL ?? 'http://127.0.0.1:3000/callback';

  if (!apiKey || !apiSecret || !clientId || !clientSecret) {
    throw new Error(
      'Missing X API credentials for API sync.\n' +
      'Set X_API_KEY, X_API_SECRET, X_CLIENT_ID, and X_CLIENT_SECRET in .env.local.\n' +
      'These are only needed for --api mode. Default bookmark sync already pulls the latest bookmarks incrementally.'
    );
  }

  return { apiKey, apiSecret, clientId, clientSecret, bearerToken, callbackUrl };
}
