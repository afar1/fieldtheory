import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface BrowserPageApp {
  bundleId: string;
  name: string;
}

export interface ActiveBrowserPage {
  url: string;
  title: string;
  bundleId: string;
  appName: string;
}

type BrowserAutomationKind = 'safari' | 'chromium';

type ExecFileForAppleScript = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => void;

const SAFARI_BUNDLE_IDS = new Set([
  'com.apple.safari',
  'com.apple.safaritechnologypreview',
]);

const CHROMIUM_BUNDLE_IDS = new Set([
  'app.zen-browser.zen',
  'com.brave.browser',
  'com.google.chrome',
  'com.google.chrome.beta',
  'com.google.chrome.canary',
  'com.microsoft.edgemac',
  'com.microsoft.edgemac.beta',
  'com.microsoft.edgemac.canary',
  'com.operasoftware.opera',
  'com.vivaldi.vivaldi',
  'company.thebrowser.browser',
  'org.chromium.chromium',
]);

function safeBundleId(bundleId: string): string | null {
  const trimmed = bundleId.trim();
  return /^[A-Za-z0-9.-]+$/.test(trimmed) ? trimmed : null;
}

function isAtlasApp(appInfo: BrowserPageApp | null | undefined): boolean {
  const bundleId = appInfo?.bundleId?.trim().toLowerCase() ?? '';
  const name = appInfo?.name?.trim().toLowerCase() ?? '';
  return bundleId === 'com.openai.atlas' || bundleId === 'com.openai.chatgpt.atlas' || name.includes('atlas');
}

export function browserAutomationKindForApp(appInfo: BrowserPageApp | null | undefined): BrowserAutomationKind | null {
  const bundleId = appInfo?.bundleId?.trim().toLowerCase();
  const name = appInfo?.name?.trim().toLowerCase() ?? '';
  if (!bundleId) return null;
  if (isAtlasApp(appInfo)) return null;

  if (SAFARI_BUNDLE_IDS.has(bundleId) || name === 'safari' || name.includes('safari technology preview')) {
    return 'safari';
  }

  if (
    CHROMIUM_BUNDLE_IDS.has(bundleId) ||
    name === 'arc' ||
    name === 'brave browser' ||
    name === 'google chrome' ||
    name === 'microsoft edge' ||
    name.includes('arc') ||
    name.includes('brave') ||
    name.includes('chrome') ||
    name.includes('chromium') ||
    name.includes('edge') ||
    name.includes('vivaldi') ||
    name.includes('opera')
  ) {
    return 'chromium';
  }

  return null;
}

export function buildActiveBrowserPageScript(appInfo: BrowserPageApp): string | null {
  const bundleId = safeBundleId(appInfo.bundleId);
  if (!bundleId) return null;

  const kind = browserAutomationKindForApp(appInfo);
  if (kind === 'safari') {
    return [
      `tell application id "${bundleId}"`,
      '  if (count of documents) = 0 then return ""',
      '  set pageUrl to URL of front document',
      '  set pageTitle to name of front document',
      '  return pageUrl & linefeed & pageTitle',
      'end tell',
    ].join('\n');
  }

  if (kind === 'chromium') {
    return [
      `tell application id "${bundleId}"`,
      '  if (count of windows) = 0 then return ""',
      '  set activeTab to active tab of front window',
      '  set pageUrl to URL of activeTab',
      '  set pageTitle to title of activeTab',
      '  return pageUrl & linefeed & pageTitle',
      'end tell',
    ].join('\n');
  }

  return null;
}

export function parseActiveBrowserPageOutput(output: string, appInfo: BrowserPageApp): ActiveBrowserPage | null {
  const [rawUrl, ...titleLines] = output.trim().split(/\r?\n/);
  const url = rawUrl?.trim() ?? '';
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    url,
    title: titleLines.join('\n').trim(),
    bundleId: appInfo.bundleId,
    appName: appInfo.name,
  };
}

function runAppleScript(script: string, execFileImpl: ExecFileForAppleScript): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileImpl('osascript', ['-e', script], { timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        const details = Buffer.isBuffer(stderr) ? stderr.toString('utf-8') : stderr;
        reject(new Error(details.trim() || error.message));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout.toString('utf-8') : stdout);
    });
  });
}

function sanitizeSessionUrl(rawUrl: string): string | null {
  let cleaned = rawUrl.replace(/[\u0000-\u001f\u007f]+/g, '').replace(/[<>"'\\]+$/g, '');
  while (cleaned && /[),.;\]]$/.test(cleaned)) {
    try {
      return new URL(cleaned).toString();
    } catch {
      cleaned = cleaned.slice(0, -1);
    }
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractLastHttpUrlFromChromiumSession(data: Buffer | string): string | null {
  const text = Buffer.isBuffer(data) ? data.toString('latin1') : data;
  const matches = text.match(/https?:\/\/[^\s\u0000<>"'\\]+/g) ?? [];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const url = sanitizeSessionUrl(matches[index]);
    if (url) return url;
  }
  return null;
}

function collectAtlasSessionFiles(dir: string, depth = 0): string[] {
  if (depth > 8) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAtlasSessionFiles(fullPath, depth + 1));
      continue;
    }
    if (entry.isFile() && /[/\\]Sessions[/\\]/.test(fullPath) && /^(Session|Tabs)_/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

export function findAtlasSessionPage(appInfo: BrowserPageApp, homeDir = os.homedir()): ActiveBrowserPage | null {
  const atlasDataDir = path.join(homeDir, 'Library', 'Application Support', 'com.openai.atlas');
  const files = collectAtlasSessionFiles(atlasDataDir)
    .map((filePath) => {
      try {
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files) {
    try {
      const url = extractLastHttpUrlFromChromiumSession(fs.readFileSync(file.filePath));
      if (!url) continue;
      return {
        url,
        title: '',
        bundleId: appInfo.bundleId,
        appName: appInfo.name,
      };
    } catch {}
  }

  return null;
}

export interface BrowserPageLookupOptions {
  execFileImpl?: ExecFileForAppleScript;
  homeDir?: string;
}

function normalizeLookupOptions(options?: ExecFileForAppleScript | BrowserPageLookupOptions): Required<BrowserPageLookupOptions> {
  if (typeof options === 'function') {
    return { execFileImpl: options, homeDir: os.homedir() };
  }
  return {
    execFileImpl: options?.execFileImpl ?? (execFile as unknown as ExecFileForAppleScript),
    homeDir: options?.homeDir ?? os.homedir(),
  };
}

export async function getActiveBrowserPage(
  appInfo: BrowserPageApp | null | undefined,
  options?: ExecFileForAppleScript | BrowserPageLookupOptions,
): Promise<ActiveBrowserPage | null> {
  if (!appInfo) return null;
  const lookupOptions = normalizeLookupOptions(options);
  if (isAtlasApp(appInfo)) {
    return findAtlasSessionPage(appInfo, lookupOptions.homeDir);
  }

  const script = buildActiveBrowserPageScript(appInfo);
  if (!script) return null;

  const output = await runAppleScript(script, lookupOptions.execFileImpl);
  return parseActiveBrowserPageOutput(output, appInfo);
}
