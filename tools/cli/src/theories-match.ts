import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from './db.js';
import { twitterBookmarksIndexPath } from './paths.js';
import { BUILT_IN_LENSES } from './theories-config.js';
import type { Lens } from './theories-config.js';

interface RepoInfo {
  name: string;
  path: string;
  lastMessage: string;
  recentCommits: number;
  description: string;
}

interface SelectedBookmark {
  id: string;
  url: string;
  text: string;
  author: string;
  categories: string;
  github_urls?: string;
  links?: string;
  domains?: string;
}

interface AnalysisJob {
  type: string;
  title: string;
  repo: RepoInfo;
  bookmarks: SelectedBookmark[];
  prompt_hint: string;
  system_prompt: 'analyst' | 'explorer';
}

function queryBookmarks(db: any, sql: string, params: any[] = []): SelectedBookmark[] {
  const rows = db.exec(sql, params);
  if (!rows.length) return [];
  return rows[0].values.map((r: any[]) => ({
    id: r[0] as string,
    url: r[1] as string,
    text: r[2] as string,
    author: (r[3] as string) ?? 'unknown',
    categories: (r[4] as string) ?? '',
    github_urls: (r[5] as string) ?? undefined,
    links: (r[6] as string) ?? undefined,
    domains: (r[7] as string) ?? undefined,
  }));
}

function inferRepoDomains(repo: RepoInfo): string[] {
  const text = `${repo.name} ${repo.description} ${repo.lastMessage}`.toLowerCase();
  const DOMAIN_KEYWORDS: Record<string, string[]> = {
    'ai': ['ai', 'machine learning', 'llm', 'neural', 'model', 'transformer', 'gpt', 'claude', 'openai', 'anthropic', 'whisper', 'transcri'],
    'web-dev': ['react', 'vue', 'next.js', 'frontend', 'css', 'html', 'webpack', 'vite', 'electron'],
    'devops': ['docker', 'kubernetes', 'ci/cd', 'deploy', 'terraform', 'helm'],
    'crypto': ['blockchain', 'ethereum', 'solana', 'defi', 'web3'],
    'finance': ['trading', 'market', 'stock', 'fintech', 'payment', 'stripe'],
    'audio': ['audio', 'sound', 'microphone', 'recording', 'whisper', 'transcri'],
    'productivity': ['clipboard', 'automation', 'workflow', 'hotkey'],
  };
  const domains: string[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) domains.push(domain);
  }
  return domains;
}

function loadAllLenses(): Lens[] {
  // Read custom lenses from config file
  const configPath = path.join(os.homedir(), '.fieldtheory', 'theories.json');
  let custom: Lens[] = [];
  try {
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (Array.isArray(raw.lenses)) custom = raw.lenses;
    }
  } catch { /* use built-ins only */ }
  return [...BUILT_IN_LENSES, ...custom];
}

async function buildJobs(repos: RepoInfo[], budget: number): Promise<AnalysisJob[]> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  const jobs: AnalysisJob[] = [];
  const lenses = loadAllLenses();

  const SELECT = `SELECT id, url, text, author_handle, categories, github_urls, links_json, domains FROM bookmarks`;

  try {
    const pick = (limit = repos.length) => repos[Math.floor(Math.random() * Math.min(repos.length, limit))];

    const domainQuery = (baseWhere: string, repo: RepoInfo, limit: number): SelectedBookmark[] => {
      const domains = inferRepoDomains(repo);
      if (domains.length > 0) {
        const domainWhere = domains.map(() => `domains LIKE ?`).join(' OR ');
        const filtered = queryBookmarks(db,
          `${SELECT} WHERE ${baseWhere} AND (${domainWhere}) ORDER BY RANDOM() LIMIT ${limit}`,
          domains.map(d => `%${d}%`)
        );
        if (filtered.length >= 5) return filtered;
      }
      return queryBookmarks(db, `${SELECT} WHERE ${baseWhere} ORDER BY RANDOM() LIMIT ${limit}`);
    };

    for (const lens of lenses) {
      if (repos.length === 0) break;

      const repo = lens.repo_pick === 'top3' ? pick(3) : pick(repos.length);

      // Build WHERE clause from category filter
      const categories = lens.category_filter.split(',').map(c => c.trim());
      const catWhere = categories.map(c => `categories LIKE '%${c}%'`).join(' OR ');
      // adopt lens requires github_urls
      const extraWhere = lens.name === 'adopt' ? ' AND github_urls IS NOT NULL' : '';
      const baseWhere = `(${catWhere})${extraWhere}`;

      const bookmarks = lens.domain_filter
        ? domainQuery(baseWhere, repo, lens.limit)
        : queryBookmarks(db, `${SELECT} WHERE ${baseWhere} ORDER BY RANDOM() LIMIT ${lens.limit}`);

      if (bookmarks.length > 0) {
        jobs.push({
          type: lens.name,
          title: lens.title,
          repo,
          bookmarks,
          prompt_hint: lens.prompt_hint,
          system_prompt: lens.system_prompt,
        });
      }
    }

    return jobs.slice(0, budget);
  } finally {
    db.close();
  }
}

// ── CLI entry ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const reposJsonPath = args[0];
const budgetIdx = args.indexOf('--budget');
const budget = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 4;
const typeIdx = args.indexOf('--type');
const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : undefined;

if (!reposJsonPath) {
  console.error('Usage: theories-match.ts <repos.json> [--budget <n>] [--type <lens-name>]');
  process.exit(1);
}

const repos: RepoInfo[] = JSON.parse(readFileSync(reposJsonPath, 'utf-8'));
let jobs = await buildJobs(repos, budget + 3);
if (typeFilter) {
  jobs = jobs.filter(j => j.type === typeFilter);
}
jobs = jobs.slice(0, budget);
console.log(JSON.stringify(jobs, null, 2));
