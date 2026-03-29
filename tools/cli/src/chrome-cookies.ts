import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { pbkdf2Sync, createDecipheriv, randomUUID } from 'node:crypto';

export interface ChromeCookieResult {
  csrfToken: string;
  cookieHeader: string;
}

function getMacOSChromeKey(): Buffer {
  let password: string;
  try {
    password = execSync(
      'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    throw new Error(
      'Could not read Chrome Safe Storage password from macOS Keychain.\n' +
      'This is needed to decrypt Chrome cookies.\n' +
      'Fix: Make sure Google Chrome is installed and has been opened at least once.'
    );
  }
  // Chrome on macOS uses PBKDF2 with 1003 iterations, 16-byte key
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

export function decryptCookieValue(encryptedValue: Buffer, key: Buffer): string {
  if (encryptedValue.length === 0) return '';

  if (encryptedValue[0] === 0x76 && encryptedValue[1] === 0x31 && encryptedValue[2] === 0x30) {
    const iv = Buffer.alloc(16, 0x20); // 16 spaces
    const ciphertext = encryptedValue.subarray(3);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  return encryptedValue.toString('utf8');
}

interface RawCookie {
  name: string;
  encrypted_value_hex: string;
  value: string;
}

function queryCookies(dbPath: string, domain: string, names: string[]): RawCookie[] {
  if (!existsSync(dbPath)) {
    throw new Error(
      `Chrome Cookies database not found at: ${dbPath}\n` +
      'Fix: Make sure Google Chrome is installed and has been opened at least once.\n' +
      'If you use a non-default Chrome profile, pass --chrome-profile-directory <name>.'
    );
  }

  const safeDomain = domain.replace(/'/g, "''");
  const nameList = names.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
  const sql = `SELECT name, hex(encrypted_value) as encrypted_value_hex, value FROM cookies WHERE host_key LIKE '%${safeDomain}' AND name IN (${nameList});`;

  const tryQuery = (path: string): string =>
    execSync(`sqlite3 -json "${path}" "${sql}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();

  let output: string;
  try {
    output = tryQuery(dbPath);
  } catch {
    const tmpDb = join(tmpdir(), `ft-cookies-${randomUUID()}.db`);
    try {
      copyFileSync(dbPath, tmpDb);
      output = tryQuery(tmpDb);
    } catch (e2: any) {
      throw new Error(
        `Could not read Chrome Cookies database.\n` +
        `Path: ${dbPath}\n` +
        `Error: ${e2.message}\n` +
        'Fix: If Chrome is open, close it and retry. The database may be locked.'
      );
    } finally {
      try { unlinkSync(tmpDb); } catch {}
    }
  }

  if (!output || output === '[]') return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

export function extractChromeXCookies(
  chromeUserDataDir: string,
  profileDirectory = 'Default'
): ChromeCookieResult {
  const os = platform();
  if (os !== 'darwin') {
    throw new Error(
      `Direct cookie extraction is currently supported on macOS only.\n` +
      `Detected platform: ${os}\n` +
      'Fix: Pass --csrf-token and --cookie-header directly, or contribute Linux/Windows support.'
    );
  }

  const dbPath = join(chromeUserDataDir, profileDirectory, 'Cookies');
  const key = getMacOSChromeKey();

  let cookies = queryCookies(dbPath, '.x.com', ['ct0', 'auth_token']);
  if (cookies.length === 0) {
    cookies = queryCookies(dbPath, '.twitter.com', ['ct0', 'auth_token']);
  }

  const decrypted = new Map<string, string>();
  for (const cookie of cookies) {
    const hexVal = cookie.encrypted_value_hex;
    if (hexVal && hexVal.length > 0) {
      const buf = Buffer.from(hexVal, 'hex');
      decrypted.set(cookie.name, decryptCookieValue(buf, key));
    } else if (cookie.value) {
      decrypted.set(cookie.name, cookie.value);
    }
  }

  const ct0 = decrypted.get('ct0');
  const authToken = decrypted.get('auth_token');

  if (!ct0) {
    throw new Error(
      'No ct0 CSRF cookie found for x.com in Chrome.\n' +
      'This means you are not logged into X in Chrome.\n\n' +
      'Fix:\n' +
      '  1. Open Google Chrome\n' +
      '  2. Go to https://x.com and log in\n' +
      '  3. Re-run this command\n\n' +
      (profileDirectory !== 'Default'
        ? `Using Chrome profile: "${profileDirectory}"\n`
        : 'Using the Default Chrome profile. If your X login is in a different profile,\n' +
          'pass --chrome-profile-directory <name> (e.g., "Profile 1").\n')
    );
  }

  const cookieParts = [`ct0=${ct0}`];
  if (authToken) cookieParts.push(`auth_token=${authToken}`);
  const cookieHeader = cookieParts.join('; ');

  return { csrfToken: ct0, cookieHeader };
}
