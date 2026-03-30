import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { twitterBookmarksIndexPath } from './paths.js';

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
}

type AnalysisType = 'scan' | 'adopt' | 'pattern' | 'explore';

interface AnalysisJob {
  type: AnalysisType;
  title: string;
  repo: RepoInfo;
  bookmarks: SelectedBookmark[];
  prompt_hint: string;
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
  }));
}

async function buildJobs(repos: RepoInfo[], budget: number): Promise<AnalysisJob[]> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  const jobs: AnalysisJob[] = [];

  const SELECT = `SELECT id, url, text, author_handle, categories, github_urls, links_json FROM bookmarks`;

  try {
    const pick = (limit = repos.length) => repos[Math.floor(Math.random() * Math.min(repos.length, limit))];

    // 1. SCAN: Security bookmarks → random top-3 repo
    const securityBookmarks = queryBookmarks(db,
      `${SELECT} WHERE categories LIKE '%security%' ORDER BY RANDOM() LIMIT 15`
    );
    if (securityBookmarks.length > 0 && repos.length > 0) {
      jobs.push({
        type: 'scan',
        title: 'Security & dependency scan',
        repo: pick(3),
        bookmarks: securityBookmarks,
        prompt_hint: `These bookmarks mention security issues, vulnerabilities, or supply chain risks. Check if any of the mentioned tools, libraries, or vulnerability patterns affect this repo. Be specific: name the dependency, version, file. If nothing applies, say so — don't force a connection.`,
      });
    }

    // 2. ADOPT: Tool bookmarks with GitHub URLs → repos that could use them
    const toolBookmarks = queryBookmarks(db,
      `${SELECT} WHERE categories LIKE '%tool%' AND github_urls IS NOT NULL ORDER BY RANDOM() LIMIT 20`
    );
    if (toolBookmarks.length > 0 && repos.length > 0) {
      jobs.push({
        type: 'adopt',
        title: 'Tool & library adoption',
        repo: pick(repos.length),
        bookmarks: toolBookmarks,
        prompt_hint: `These bookmarks reference open-source tools and repositories. For each one, check: (1) is the developer already using this? (2) does it solve a problem this repo currently has? (3) what would adopting it look like — which files change, what's the migration path? Skip anything that doesn't clearly apply.`,
      });
    }

    // 3. PATTERN: Technique bookmarks → active repos
    const techniqueBookmarks = queryBookmarks(db,
      `${SELECT} WHERE categories LIKE '%technique%' ORDER BY RANDOM() LIMIT 20`
    );
    if (techniqueBookmarks.length > 0 && repos.length > 0) {
      jobs.push({
        type: 'pattern',
        title: 'Pattern & technique transfer',
        repo: pick(repos.length),
        bookmarks: techniqueBookmarks,
        prompt_hint: `These bookmarks describe techniques, architecture patterns, or "how I built X" approaches. Read the repo's code and identify where any of these patterns could concretely improve it. Name the specific file and function. If the repo already does something similar, note that too — sometimes the bookmark version is better, sometimes the repo's approach is fine.`,
      });
    }

    // 4. EXPLORE: Mix of unclassified + launch + research → open-ended
    const exploreBookmarks = queryBookmarks(db,
      `${SELECT} WHERE primary_category IN ('unclassified', 'launch', 'research', 'opinion')
       ORDER BY RANDOM() LIMIT 30`
    );
    if (exploreBookmarks.length > 0 && repos.length > 0) {
      jobs.push({
        type: 'explore',
        title: 'Open exploration',
        repo: pick(repos.length),
        bookmarks: exploreBookmarks,
        prompt_hint: `These are bookmarks that caught the developer's eye — product launches, research papers, interesting takes. Look for the adjacent possible: what does this repo gain access to because these ideas exist? What's one step away that nobody's noticed? This is the open-ended session — follow what's interesting, not what's obviously practical.`,
      });
    }

    // Trim to budget
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

if (!reposJsonPath) {
  console.error('Usage: theories-match.ts <repos.json> [--budget <n>]');
  process.exit(1);
}

const repos: RepoInfo[] = JSON.parse(readFileSync(reposJsonPath, 'utf-8'));
const jobs = await buildJobs(repos, budget);
console.log(JSON.stringify(jobs, null, 2));
