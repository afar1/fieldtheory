import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

export interface XConfig {
  apiKey: string;
  apiSecret: string;
  clientId: string;
  clientSecret: string;
  bearerToken?: string;
  callbackUrl?: string;
}

export function loadEnv(cwd = process.cwd()): void {
  loadDotenv({ path: path.join(cwd, '.env.local') });
  loadDotenv();
}

export function loadXConfig(cwd = process.cwd()): XConfig {
  loadEnv(cwd);

  const apiKey = process.env.X_API_KEY ?? process.env.X_CONSUMER_KEY;
  const apiSecret = process.env.X_API_SECRET ?? process.env.X_SECRET_KEY;
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const bearerToken = process.env.X_BEARER_TOKEN;
  const callbackUrl = process.env.X_CALLBACK_URL ?? 'http://127.0.0.1:3000/callback';

  if (!apiKey || !apiSecret || !clientId || !clientSecret) {
    throw new Error('Missing X configuration. Expected X_API_KEY/X_CONSUMER_KEY, X_API_SECRET/X_SECRET_KEY, X_CLIENT_ID, and X_CLIENT_SECRET in .env.local');
  }

  return {
    apiKey,
    apiSecret,
    clientId,
    clientSecret,
    bearerToken,
    callbackUrl,
  };
}
