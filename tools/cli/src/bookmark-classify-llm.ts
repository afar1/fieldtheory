/**
 * LLM-based bookmark classification — uses `claude -p` or `codex exec`
 * (whichever the user has via their Max/Pro subscription) to classify
 * bookmarks that the regex classifier couldn't categorize.
 *
 * No API keys needed. No local models. Just a logged-in Claude or Codex CLI.
 */

import { execFileSync, execSync } from 'node:child_process';
import { openDb, saveDb } from './db.js';
import { twitterBookmarksIndexPath } from './paths.js';

const BATCH_SIZE = 50;

interface UnclassifiedBookmark {
  id: string;
  text: string;
  authorHandle: string | null;
  links: string | null;
}

interface LlmClassification {
  id: string;
  categories: string[];
  primary: string;
}

// ── Engine detection (same pattern as theories-v2.sh) ───────────────────

type Engine = 'claude' | 'codex';

function detectEngine(): Engine | null {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return 'claude';
  } catch { /* not found */ }
  try {
    execSync('which codex', { stdio: 'ignore' });
    return 'codex';
  } catch { /* not found */ }
  return null;
}

function invokeEngine(engine: Engine, prompt: string): string {
  const bin = engine === 'claude' ? 'claude' : 'codex';
  const args = engine === 'claude'
    ? ['-p', '--output-format', 'text', prompt]
    : ['exec', '--full-auto', prompt];

  return execFileSync(bin, args, {
    encoding: 'utf-8',
    timeout: 120_000, // 2 minutes per batch
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();
}

// ── Prompt construction ─────────────────────────────────────────────────

function buildPrompt(bookmarks: UnclassifiedBookmark[]): string {
  const items = bookmarks.map((b, i) => {
    const links = b.links ? ` | Links: ${b.links}` : '';
    return `[${i}] id=${b.id} @${b.authorHandle ?? 'unknown'}: ${b.text.slice(0, 300)}${links}`;
  }).join('\n');

  return `Classify each bookmark into one or more categories. Return ONLY a JSON array, no other text.

Known categories:
- tool: GitHub repos, CLI tools, npm packages, open-source projects, developer tools
- security: CVEs, vulnerabilities, exploits, supply chain attacks, breaches, hacking
- technique: tutorials, "how I built X", code patterns, architecture deep dives, demos
- launch: product launches, announcements, "just shipped", new releases
- research: academic papers, arxiv, studies, scientific findings
- opinion: hot takes, commentary, threads, "lessons learned", analysis
- commerce: products for sale, shopping, affiliate links, physical goods

You may create new categories if a bookmark clearly doesn't fit the above. Use short lowercase slugs (e.g. "health", "design", "career", "culture", "ai-news", "personal-story"). Prefer existing categories when they fit.

Rules:
- A bookmark can have multiple categories (e.g. a security tool is both "security" and "tool")
- "primary" is the single best-fit category
- If nothing fits well, create an appropriate new category rather than forcing a bad fit
- Return valid JSON only: [{"id":"...","categories":["..."],"primary":"..."},...]

Bookmarks:
${items}`;
}

// ── Parse and validate response ─────────────────────────────────────────

function parseResponse(raw: string, batchIds: Set<string>): LlmClassification[] {
  // Extract JSON array from response (model might add markdown fences or commentary)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array found in response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Response is not an array');

  const results: LlmClassification[] = [];
  for (const item of parsed) {
    if (!item.id || !batchIds.has(item.id)) continue;

    const categories = (Array.isArray(item.categories) ? item.categories : [])
      .filter((c: string) => typeof c === 'string' && c.length > 0)
      .map((c: string) => c.toLowerCase().trim());
    const primary = (typeof item.primary === 'string' && item.primary.length > 0)
      ? item.primary.toLowerCase().trim()
      : categories[0];

    if (categories.length > 0 && primary) {
      results.push({ id: item.id, categories, primary });
    }
  }
  return results;
}

// ── Main classification pipeline ────────────────────────────────────────

export interface LlmClassifyResult {
  engine: Engine;
  totalUnclassified: number;
  classified: number;
  failed: number;
  batches: number;
}

export async function classifyWithLlm(
  cwd = process.cwd(),
  options: { onBatch?: (done: number, total: number) => void } = {},
): Promise<LlmClassifyResult> {
  const engine = detectEngine();
  if (!engine) {
    throw new Error('Neither claude nor codex found. Install Claude Code or Codex CLI and log in.');
  }

  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);

  try {
    // Fetch unclassified bookmarks
    const rows = db.exec(
      `SELECT id, text, author_handle, links_json FROM bookmarks
       WHERE primary_category = 'unclassified' OR primary_category IS NULL
       ORDER BY RANDOM()`
    );

    if (!rows.length || !rows[0].values.length) {
      return { engine, totalUnclassified: 0, classified: 0, failed: 0, batches: 0 };
    }

    const unclassified: UnclassifiedBookmark[] = rows[0].values.map(r => ({
      id: r[0] as string,
      text: r[1] as string,
      authorHandle: r[2] as string | null,
      links: r[3] as string | null,
    }));

    const totalUnclassified = unclassified.length;
    let classified = 0;
    let failed = 0;
    let batchCount = 0;

    // Process in batches
    for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
      const batch = unclassified.slice(i, i + BATCH_SIZE);
      const batchIds = new Set(batch.map(b => b.id));
      batchCount++;

      options.onBatch?.(i, totalUnclassified);

      try {
        const prompt = buildPrompt(batch);
        const raw = invokeEngine(engine, prompt);
        const results = parseResponse(raw, batchIds);

        // Update SQLite
        const stmt = db.prepare(
          `UPDATE bookmarks SET categories = ?, primary_category = ? WHERE id = ?`
        );
        for (const r of results) {
          stmt.run([r.categories.join(','), r.primary, r.id]);
        }
        stmt.free();

        classified += results.length;
        failed += batch.length - results.length;

        // Save after each batch in case of interruption
        saveDb(db, dbPath);
      } catch (err) {
        failed += batch.length;
        process.stderr.write(`  Batch ${batchCount} failed: ${(err as Error).message}\n`);
      }
    }

    return { engine, totalUnclassified, classified, failed, batches: batchCount };
  } finally {
    db.close();
  }
}
