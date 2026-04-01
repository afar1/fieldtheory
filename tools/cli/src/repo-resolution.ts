import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { pathExists } from './fs.js';

export interface ResolvedRepoReference {
  repoName: string | null;
  repoPath: string | null;
  githubRepo: string | null;
}

const localRepoPathCache = new Map<string, string | null>();
const remoteRepoCache = new Map<string, string | null>();

function normalizeRepoName(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  return trimmed ? trimmed : null;
}

function parseGitHubRepoSlug(input: string | null | undefined): string | null {
  const trimmed = normalizeRepoName(input);
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\.git$/i, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

export function parseGitHubRepoFromUrl(input: string): string | null {
  const normalized = input.trim().replace(/^git@github\.com:/, 'https://github.com/');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com') return null;
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return `${owner}/${repo.replace(/\.git$/i, '')}`;
}

function extractGitHubRepoFromText(input: string | null | undefined): string | null {
  if (!input) return null;
  const matches = input.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/g) ?? [];
  for (const match of matches) {
    const repo = parseGitHubRepoFromUrl(match);
    if (repo) return repo;
  }
  return null;
}

export function inferGitHubRepoFromRemote(repoPath: string): string | null {
  const normalized = path.resolve(repoPath);
  if (remoteRepoCache.has(normalized)) {
    return remoteRepoCache.get(normalized) ?? null;
  }

  const result = spawnSync('git', ['-C', normalized, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
  });
  const repo = result.status === 0 ? parseGitHubRepoFromUrl(result.stdout.trim()) : null;
  remoteRepoCache.set(normalized, repo);
  return repo;
}

export async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  if (!(await pathExists(path.join(current, '.git')))) {
    current = path.dirname(current);
  }

  while (true) {
    if (await pathExists(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function extractLocalMarkdownPaths(value: string): string[] {
  return [...value.matchAll(/\((\/[^)#\s]+)(?:#L\d+(?:C\d+)?)?\)/g)]
    .map((match) => match[1]?.trim())
    .filter((entry): entry is string => Boolean(entry));
}

export async function inferLocalRepoPath(repoName: string | null): Promise<string | null> {
  const normalized = normalizeRepoName(repoName);
  if (!normalized) return null;
  if (localRepoPathCache.has(normalized)) {
    return localRepoPathCache.get(normalized) ?? null;
  }

  const homeDev = path.join(os.homedir(), 'dev');
  const candidates = [...new Set([normalized, normalized.split('/').at(-1) ?? normalized])];

  for (const candidateName of candidates) {
    const directCandidate = path.join(homeDev, candidateName);
    if (await pathExists(path.join(directCandidate, '.git'))) {
      localRepoPathCache.set(normalized, directCandidate);
      return directCandidate;
    }
  }

  if (await pathExists(homeDev)) {
    const topLevel = await readdir(homeDev, { withFileTypes: true });
    for (const entry of topLevel) {
      if (!entry.isDirectory()) continue;
      for (const candidateName of candidates) {
        const nestedCandidate = path.join(homeDev, entry.name, candidateName);
        if (await pathExists(path.join(nestedCandidate, '.git'))) {
          localRepoPathCache.set(normalized, nestedCandidate);
          return nestedCandidate;
        }
      }
    }
  }

  localRepoPathCache.set(normalized, null);
  return null;
}

export async function inferRepoPathFromText(
  input: string | null | undefined,
  repoName: string | null,
): Promise<string | null> {
  if (input) {
    for (const candidate of extractLocalMarkdownPaths(input)) {
      const repoRoot = await findGitRoot(candidate);
      if (repoRoot) return repoRoot;
    }
  }
  return inferLocalRepoPath(repoName);
}

export async function resolveRepoReference(options: {
  repoName?: string | null;
  repoPath?: string | null;
  text?: string | null;
}): Promise<ResolvedRepoReference> {
  const repoName = normalizeRepoName(options.repoName);
  let repoPath = normalizeRepoName(options.repoPath);

  if (!repoPath) {
    repoPath = await inferRepoPathFromText(options.text, repoName);
  }

  const githubRepo = (
    repoPath ? inferGitHubRepoFromRemote(repoPath) : null
  ) ?? parseGitHubRepoSlug(repoName) ?? extractGitHubRepoFromText(options.text);

  return {
    repoName,
    repoPath,
    githubRepo,
  };
}
