#!/usr/bin/env node
// Goals feed candidate generator - algorithm v0.1.
//
// Stage 1 of 2. This script pairs real bookmarks from the live Field Theory
// bookmark DB (~/.fieldtheory/bookmarks/bookmarks.db) with the hardcoded V1
// projects, scores each pair on eight legible axes, and writes the top
// candidates to candidates.json. Stage 2 (an LLM, see synthesize.md) fills in
// the title / whyNow / goal / firstTest prose for each surviving candidate.
//
// Search itself is NOT reimplemented here: we import searchBookmarks and
// getBookmarkById from the canonical stack in fieldtheory-cli (FTS5 + bm25
// with text/article weighting). Build that repo first if the import fails.
//
// Usage: node generate-candidates.mjs [--per-project 10] [--out candidates.json]

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI_DIR = process.env.FT_CLI_DIR ?? `${process.env.HOME}/dev/fieldtheory-cli`;
let searchBookmarks, getBookmarkById;
try {
  ({ searchBookmarks, getBookmarkById } = await import(join(CLI_DIR, 'dist/bookmarks-db.js')));
} catch (err) {
  console.error(`Could not import the bookmark search stack from ${CLI_DIR}/dist.`);
  console.error('Run `npm run build` in fieldtheory-cli, or set FT_CLI_DIR.');
  console.error(String(err));
  process.exit(1);
}

export const ALGORITHM_VERSION = 'v0.1';

// ---------------------------------------------------------------------------
// Project profiles. Each project gets a handful of FTS5 queries describing
// what it is about, plus the domains it already lives in (a bookmark from a
// different domain earns a small novelty bonus; cross-domain transfer is
// where adjacent-possible ideas come from).
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    project: 'fieldtheory-labs',
    homeDomains: ['ai'],
    queries: [
      'feed ranking OR recommendation algorithm',
      'swipe cards UI',
      'embeddings retrieval rerank',
      'idea generation agent',
      'personal knowledge tools',
      'human feedback model',
    ],
  },
  {
    project: 'fieldtheory',
    homeDomains: ['ai', 'design'],
    queries: [
      'swiftui OR ios app',
      'voice transcription whisper',
      'local first sync',
      'markdown editor notes',
      'reading experience typography',
      'menubar OR electron mac app',
    ],
  },
  {
    project: 'fieldtheory-cli',
    homeDomains: ['ai', 'web-dev'],
    queries: [
      'cli developer tool',
      'sqlite OR full text search',
      'terminal agent coding',
      'bookmarks twitter archive',
      'claude code OR codex workflow',
      'shell scripting automation',
    ],
  },
];

// Categories that are almost never goal material. A bookmark in one of these
// still survives if it carries a GitHub link (concrete artifact beats label).
const JUNK_CATEGORIES = new Set([
  'humor', 'entertainment', 'personal-story', 'commerce',
  'finance', 'health', 'politics',
]);

const PER_PROJECT = intArg('--per-project', 10);
const SEARCH_LIMIT = 40;
const MAX_PER_AUTHOR = 2;

function intArg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? parseInt(process.argv[i + 1], 10) : fallback;
}

// ---------------------------------------------------------------------------
// The eight axes, each 0..1. Deterministic and readable on purpose: v0.1's
// job is to be a legible baseline that human feedback can be measured
// against, not to be clever. `cost` reads inverted (higher = pricier).
// ---------------------------------------------------------------------------

const CATEGORY_ACTIONABILITY = {
  technique: 0.75, tool: 0.7, launch: 0.6, research: 0.55,
  design: 0.5, 'ai-news': 0.4, unclassified: 0.4, opinion: 0.35,
};
const CATEGORY_NOVELTY = {
  research: 0.7, technique: 0.6, design: 0.55, launch: 0.5, tool: 0.45,
};
const CATEGORY_COST = {
  tool: 0.45, technique: 0.4, design: 0.35, launch: 0.5, research: 0.65,
};

function scoreAxes(b, ftsScore, maxFtsScore, profile) {
  const hasGithub = (b.githubUrls ?? []).length > 0;
  const hasArticle = !!b.articleText;
  const hasLinks = (b.linkCount ?? 0) > 0;
  const cat = b.primaryCategory ?? 'unclassified';

  const relevance = maxFtsScore > 0 ? ftsScore / maxFtsScore : 0.5;

  let actionability = CATEGORY_ACTIONABILITY[cat] ?? 0.4;
  if (hasGithub) actionability += 0.15;
  if (hasArticle) actionability += 0.1;

  let novelty = CATEGORY_NOVELTY[cat] ?? 0.4;
  if (b.primaryDomain && !profile.homeDomains.includes(b.primaryDomain)) novelty += 0.15;

  let leverage = (cat === 'technique' || cat === 'research') ? 0.6 : 0.45;
  if (hasGithub) leverage += 0.2;
  if (hasLinks) leverage += 0.1;

  // Freshness with a one-year half-life: a bookmark saved today scores 1,
  // one saved a year ago scores 0.5.
  const ageDays = b.bookmarkedAt
    ? Math.max(0, (Date.now() - Date.parse(b.bookmarkedAt)) / 86_400_000)
    : 365;
  const timing = Math.pow(0.5, ageDays / 365);

  let evidence = 0.25 + 0.25 * Math.min(1, Math.log10(1 + (b.likeCount ?? 0)) / 4);
  if (hasArticle) evidence += 0.2;
  if (hasGithub) evidence += 0.15;
  if (hasLinks) evidence += 0.15;

  let confidence = 0.4;
  if ((b.text ?? '').length > 200) confidence += 0.2;
  if (b.authorHandle) confidence += 0.2;
  if (b.postedAt) confidence += 0.2;

  const cost = CATEGORY_COST[cat] ?? 0.5;

  const clamp = (x) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
  return {
    relevance: clamp(relevance), actionability: clamp(actionability),
    novelty: clamp(novelty), leverage: clamp(leverage),
    timing: clamp(timing), evidence: clamp(evidence),
    confidence: clamp(confidence), cost: clamp(cost),
  };
}

// Ranking weights. Relevance and actionability dominate; cost subtracts.
const WEIGHTS = {
  relevance: 0.25, actionability: 0.2, novelty: 0.15, leverage: 0.1,
  timing: 0.1, evidence: 0.1, confidence: 0.1, cost: -0.15,
};

function composite(s) {
  const value = Object.entries(WEIGHTS).reduce((sum, [axis, w]) => sum + w * s[axis], 0);
  return Math.round(value * 1000) / 1000;
}

function scoreNote(s, matchedQuery, cat) {
  const strongest = ['relevance', 'actionability', 'novelty', 'leverage', 'timing', 'evidence']
    .sort((a, z) => s[z] - s[a]).slice(0, 2);
  return `matched "${matchedQuery}"; strongest axes ${strongest.join(' + ')}; category ${cat}`;
}

// ---------------------------------------------------------------------------
// Pipeline: search per query, dedup, junk-filter, score, take the top slice
// with an author-diversity guard so one prolific account can't fill a feed.
// ---------------------------------------------------------------------------

async function candidatesFor(profile) {
  const hits = new Map(); // id -> { ftsScore, matchedQuery }
  for (const query of profile.queries) {
    const results = await searchBookmarks({ query, limit: SEARCH_LIMIT });
    for (const r of results) {
      const prior = hits.get(r.id);
      if (!prior || r.score > prior.ftsScore) {
        hits.set(r.id, { ftsScore: r.score, matchedQuery: query });
      }
    }
  }

  const maxFtsScore = Math.max(...[...hits.values()].map((h) => h.ftsScore), 0);
  const scored = [];
  for (const [id, { ftsScore, matchedQuery }] of hits) {
    const b = await getBookmarkById(id);
    if (!b) continue;
    const hasGithub = (b.githubUrls ?? []).length > 0;
    if (JUNK_CATEGORIES.has(b.primaryCategory) && !hasGithub) continue;
    if ((b.text ?? '').replace(/https?:\S+/g, '').trim().length < 60) continue;

    const scores = scoreAxes(b, ftsScore, maxFtsScore, profile);
    scored.push({
      id: `${ALGORITHM_VERSION}-${profile.project}-${b.tweetId}`,
      project: profile.project,
      algorithmVersion: ALGORITHM_VERSION,
      source: {
        tweetId: b.tweetId,
        url: b.url,
        authorHandle: b.authorHandle ?? null,
        authorName: b.authorName ?? null,
        postedAt: b.postedAt ?? null,
        excerpt: (b.text ?? '').slice(0, 280),
      },
      // Filled by stage 2 (synthesize.md). Left empty on purpose so the
      // validator can catch unsynthesized cards.
      title: '',
      whyNow: '',
      goal: '',
      firstTest: '',
      scores,
      scoreNote: scoreNote(scores, matchedQuery, b.primaryCategory ?? 'unclassified'),
      composite: composite(scores),
      // Synthesis-only context, stripped from the bundled JSON by validate.
      _synthesisContext: {
        fullText: b.text ?? '',
        articleTitle: b.articleTitle ?? null,
        articleExcerpt: b.articleText ? b.articleText.slice(0, 600) : null,
        githubUrls: b.githubUrls ?? [],
        category: b.primaryCategory ?? 'unclassified',
      },
    });
  }

  scored.sort((a, z) => z.composite - a.composite);
  return scored;
}

// Pick the final set globally, best composite first, so a bookmark that
// matched several projects lands only once in its best-scoring pairing.
// Also caps each author per project so one prolific account can't fill a feed.
const pools = [];
for (const profile of PROJECTS) {
  pools.push(...(await candidatesFor(profile)));
}
pools.sort((a, z) => z.composite - a.composite);

const perProject = new Map();
const perAuthor = new Map();
const usedTweets = new Set();
const usedTexts = new Set(); // reposts share text under different tweet ids
const all = [];
for (const card of pools) {
  const projectCount = perProject.get(card.project) ?? 0;
  const authorKey = `${card.project}:${card.source.authorHandle ?? card.id}`;
  const authorCount = perAuthor.get(authorKey) ?? 0;
  if (projectCount >= PER_PROJECT || authorCount >= MAX_PER_AUTHOR) continue;
  if (usedTweets.has(card.source.tweetId)) continue;
  const textKey = card.source.excerpt.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  if (usedTexts.has(textKey)) continue;
  usedTexts.add(textKey);
  usedTweets.add(card.source.tweetId);
  perProject.set(card.project, projectCount + 1);
  perAuthor.set(authorKey, authorCount + 1);
  all.push(card);
}
all.sort((a, z) => a.project.localeCompare(z.project) || z.composite - a.composite);
for (const profile of PROJECTS) {
  console.error(`${profile.project}: ${perProject.get(profile.project) ?? 0} candidates`);
}

const out = {
  algorithmVersion: ALGORITHM_VERSION,
  generatedAt: new Date().toISOString(),
  cards: all,
};

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex > 0
  ? process.argv[outIndex + 1]
  : join(dirname(fileURLToPath(import.meta.url)), 'candidates.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`Wrote ${all.length} candidates to ${outPath}`);
