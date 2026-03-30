/**
 * Bookmark classification — tags each bookmark by type so the theories
 * system can match intelligently instead of random-sampling.
 *
 * Categories (non-exclusive, a bookmark can have multiple):
 *   tool       — GitHub repos, CLI tools, npm packages, open-source projects
 *   security   — CVEs, vulnerabilities, supply chain, exploits
 *   technique  — tutorials, demos, code patterns, "how I built X"
 *   launch     — product launches, announcements, "just shipped"
 *   research   — arxiv papers, studies, academic findings
 *   opinion    — takes, analysis, commentary, threads
 *   commerce   — products, shopping, physical goods
 *
 * The classifier is rule-based (fast, predictable, no LLM cost).
 * It runs over the full corpus in <1s and stores results in the SQLite index.
 */

import type { BookmarkRecord } from './types.js';

export type BookmarkCategory =
  | 'tool'
  | 'security'
  | 'technique'
  | 'launch'
  | 'research'
  | 'opinion'
  | 'commerce';

interface ClassifyResult {
  categories: BookmarkCategory[];
  /** Primary category (highest confidence match, or first if tied) */
  primary: BookmarkCategory | 'unclassified';
  /** Extracted URLs from tweet text (t.co links excluded) */
  extractedUrls: string[];
  /** GitHub repo URLs if any */
  githubUrls: string[];
}

// ── Pattern sets ─────────────────────────────────────────────────────────

const TOOL_PATTERNS = [
  /github\.com\/[\w-]+\/[\w-]+/i,
  /\bnpm\s+(install|i)\b/i,
  /\bpip\s+install\b/i,
  /\bcargo\s+add\b/i,
  /\bbrew\s+install\b/i,
  /\bopen[\s-]?source\b/i,
  /\bcli\b.*\btool\b/i,
  /\btool\b.*\bcli\b/i,
  /\brust\s+crate\b/i,
  /\bvscode\s+extension\b/i,
  /\bnpx\s+/i,
  /\brepo\b.*\bgithub\b/i,
  /\bgithub\b.*\brepo\b/i,
  /\bself[\s-]?hosted\b/i,
  /\bopen[\s-]?sourced?\b/i,
];

const SECURITY_PATTERNS = [
  /\bcve[-\s]?\d{4}/i,
  /\bvulnerabilit/i,
  /\bexploit/i,
  /\bmalware\b/i,
  /\bransomware\b/i,
  /\bsupply[\s-]?chain\s+attack/i,
  /\bsecurity\s+(flaw|bug|issue|patch|advisory|update|breach)/i,
  /\bbreach\b/i,
  /\bbackdoor\b/i,
  /\bzero[\s-]?day\b/i,
  /\bremote\s+code\s+execution\b/i,
  /\brce\b/i,
  /\bprivilege\s+escalation\b/i,
  /\bcompromised?\b/i,
];

const TECHNIQUE_PATTERNS = [
  /\bhow\s+(I|we|to)\b/i,
  /\btutorial\b/i,
  /\bwalkthrough\b/i,
  /\bstep[\s-]?by[\s-]?step\b/i,
  /\bbuilt\s+(with|using|this|a|an|my)\b/i,
  /\bhere'?s?\s+how\b/i,
  /\bcode\s+(pattern|example|snippet|sample)\b/i,
  /\barchitecture\b.*\b(of|for|behind)\b/i,
  /\bimplemented?\b.*\bfrom\s+scratch\b/i,
  /\bunder\s+the\s+hood\b/i,
  /\bdeep[\s-]?dive\b/i,
  /\btechnique\b/i,
  /\bpattern\b.*\b(for|in|to)\b/i,
];

const LAUNCH_PATTERNS = [
  /\bjust\s+(launched|shipped|released|dropped|published)\b/i,
  /\bwe('re|\s+are)\s+(launching|shipping|releasing)\b/i,
  /\bannouncing\b/i,
  /\bintroduc(ing|es?)\b/i,
  /\bnow\s+(available|live|in\s+beta)\b/i,
  /\bv\d+\.\d+/i,
  /\b(alpha|beta)\s+(release|launch|is\s+here)\b/i,
  /\bproduct\s+hunt\b/i,
  /🚀.*\b(launch|ship|live)\b/i,
  /\bcheck\s+it\s+out\b/i,
];

const RESEARCH_PATTERNS = [
  /arxiv\.org/i,
  /\bpaper\b.*\b(new|our|this|the)\b/i,
  /\b(new|our|this)\b.*\bpaper\b/i,
  /\bstudy\b.*\b(finds?|shows?|reveals?)\b/i,
  /\bfindings?\b/i,
  /\bpeer[\s-]?review/i,
  /\bpreprint\b/i,
  /\bresearch\b.*\b(from|by|at|shows?)\b/i,
  /\bpublished\s+in\b/i,
  /\bjournal\b/i,
  /\bstate[\s-]?of[\s-]?the[\s-]?art\b/i,
];

const OPINION_PATTERNS = [
  /\bthread\b.*👇/i,
  /\bunpopular\s+opinion\b/i,
  /\bhot\s+take\b/i,
  /\bhere'?s?\s+(why|what|my\s+take)\b/i,
  /\bi\s+think\b.*\b(about|that)\b/i,
  /\bcontroversial\b/i,
  /\boverrated\b/i,
  /\bunderrated\b/i,
  /\blessons?\s+(learned|from)\b/i,
  /\bmistakes?\s+(I|we)\b/i,
];

const COMMERCE_PATTERNS = [
  /\bamazon\.com\b/i,
  /\bshop\s+(here|now)\b/i,
  /\bbuy\s+(now|here|this)\b/i,
  /\bdiscount\b/i,
  /\bcoupon\b/i,
  /\baffiliate\b/i,
  /\bgeni\.us\b/i,
  /\ba\.co\//i,
  /\$\d+(\.\d{2})?\s*(off|USD|discount)/i,
];

const GITHUB_URL_RE = /github\.com\/[\w.-]+\/[\w.-]+/gi;
const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const TCO_RE = /https?:\/\/t\.co\/\w+/gi;

// ── Domains that indicate tool/project bookmarks ─────────────────────────
const TOOL_DOMAINS = new Set([
  'github.com',
  'gitlab.com',
  'huggingface.co',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'pkg.go.dev',
]);

const RESEARCH_DOMAINS = new Set([
  'arxiv.org',
  'scholar.google.com',
  'semanticscholar.org',
  'biorxiv.org',
  'medrxiv.org',
  'nature.com',
  'science.org',
]);

const COMMERCE_DOMAINS = new Set([
  'amazon.com',
  'www.amazon.com',
  'a.co',
  'store.steampowered.com',
  'geni.us',
  'ebay.com',
]);

// ── Classify a single bookmark ───────────────────────────────────────────

export function classifyBookmark(bookmark: BookmarkRecord): ClassifyResult {
  const text = bookmark.text ?? '';
  const allLinks = [...(bookmark.links ?? [])];

  // Extract URLs from tweet text (excluding t.co shortlinks)
  const textUrls = (text.match(URL_RE) ?? []).filter((u) => !TCO_RE.test(u));
  const extractedUrls = [...new Set([...allLinks, ...textUrls])];

  // Extract GitHub URLs
  const githubMatches = text.match(GITHUB_URL_RE) ?? [];
  const githubFromLinks = allLinks.filter((l) => /github\.com/i.test(l));
  const githubUrls = [...new Set([...githubMatches.map((m) => `https://${m}`), ...githubFromLinks])];

  // Get domains from all URLs
  const domains = extractedUrls
    .map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  const categories: BookmarkCategory[] = [];

  // Pattern matching
  const matchesAny = (patterns: RegExp[]) => patterns.some((p) => p.test(text));

  if (matchesAny(SECURITY_PATTERNS)) categories.push('security');
  if (matchesAny(TOOL_PATTERNS) || githubUrls.length > 0 || domains.some((d) => TOOL_DOMAINS.has(d)))
    categories.push('tool');
  if (matchesAny(TECHNIQUE_PATTERNS)) categories.push('technique');
  if (matchesAny(LAUNCH_PATTERNS)) categories.push('launch');
  if (matchesAny(RESEARCH_PATTERNS) || domains.some((d) => RESEARCH_DOMAINS.has(d)))
    categories.push('research');
  if (matchesAny(OPINION_PATTERNS)) categories.push('opinion');
  if (matchesAny(COMMERCE_PATTERNS) || domains.some((d) => COMMERCE_DOMAINS.has(d)))
    categories.push('commerce');

  // Primary = first match (ordered by priority above: security > tool > technique > ...)
  const primary: BookmarkCategory | 'unclassified' = categories[0] ?? 'unclassified';

  return { categories, primary, extractedUrls, githubUrls };
}

// ── Classify entire corpus ───────────────────────────────────────────────

export interface ClassificationSummary {
  total: number;
  classified: number;
  unclassified: number;
  byCategoryCount: Record<string, number>;
}

export function classifyCorpus(bookmarks: BookmarkRecord[]): {
  results: Map<string, ClassifyResult>;
  summary: ClassificationSummary;
} {
  const results = new Map<string, ClassifyResult>();
  const counts: Record<string, number> = {};
  let unclassified = 0;

  for (const b of bookmarks) {
    const result = classifyBookmark(b);
    results.set(b.id, result);
    if (result.categories.length === 0) {
      unclassified++;
    }
    for (const cat of result.categories) {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }

  return {
    results,
    summary: {
      total: bookmarks.length,
      classified: bookmarks.length - unclassified,
      unclassified,
      byCategoryCount: counts,
    },
  };
}

// ── Format summary for CLI output ────────────────────────────────────────

export function formatClassificationSummary(summary: ClassificationSummary): string {
  const lines = [
    `Classified ${summary.classified}/${summary.total} bookmarks (${summary.unclassified} unclassified)`,
    '',
  ];
  const sorted = Object.entries(summary.byCategoryCount).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    const pct = ((count / summary.total) * 100).toFixed(1);
    lines.push(`  ${cat.padEnd(12)} ${String(count).padStart(5)}  (${pct}%)`);
  }
  return lines.join('\n');
}
