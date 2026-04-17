#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const homeDir = os.homedir();
const wikiRoot = path.join(process.env.FT_DATA_DIR ?? path.join(homeDir, '.ft-bookmarks'), 'md');
const debatesDir = path.join(wikiRoot, 'debates');
const councilRoot = path.join(homeDir, 'council-transcripts');
const consensusDir = path.join(councilRoot, '.council-bg');
const limit = Number.parseInt(process.argv[2] ?? '10', 10) || 10;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'against', 'at', 'by', 'for', 'from', 'how', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 's', 'should', 'that', 'the', 'their',
  'this', 'to', 'vs', 'we', 'what', 'where', 'with', 'your',
]);
const DROPWORDS = new Set([
  'council', 'debate', 'consensus', 'summary', 'transcript', 'raw', 'finalizing',
]);
const SLUG_ALIASES = [
  {
    date: '2026-04-15',
    pattern: /extending the ft wiki with agent-authored entries/i,
    slug: '2026-04-15-wiki-entries-initial-debate',
  },
  {
    date: '2026-04-15',
    pattern: /wiki entries .*karpathy/i,
    slug: '2026-04-15-wiki-entries-karpathy-refinement',
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function listConsensusFiles() {
  if (!fs.existsSync(consensusDir)) return [];
  return fs.readdirSync(consensusDir)
    .filter((name) => name.endsWith('.consensus.md'))
    .sort()
    .slice(-limit)
    .map((name) => path.join(consensusDir, name));
}

function extractHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractTopic(content) {
  const match = content.match(/^\*\*Topic\*\*:\s*(.+)$/m);
  if (!match) return null;
  return cleanTopic(match[1]);
}

function cleanTopic(value) {
  return value
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(value) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function keywords(value) {
  const seen = new Set();
  const out = [];
  for (const word of normalizeWords(value)) {
    if (STOPWORDS.has(word) || DROPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

function makeShortSlug(title) {
  const keyWords = keywords(title);
  const words = keyWords.length > 0 ? keyWords : normalizeWords(title);
  return words.slice(0, 6).join('-') || 'debate';
}

function parseFrontmatterTitle(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return extractHeading(readFile(filePath));
}

function existingDebates() {
  if (!fs.existsSync(debatesDir)) return [];
  return fs.readdirSync(debatesDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => {
      const slug = name.replace(/\.md$/, '');
      const absPath = path.join(debatesDir, name);
      return {
        slug,
        absPath,
        date: slug.slice(0, 10),
        title: parseFrontmatterTitle(absPath) ?? slug,
      };
    });
}

function similarityScore(a, b) {
  const left = new Set(keywords(a));
  const right = new Set(keywords(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function chooseSlug(date, title, existing, usedSlugs, claimedExistingSlugs) {
  for (const alias of SLUG_ALIASES) {
    if (alias.date === date && alias.pattern.test(title)) {
      claimedExistingSlugs.add(alias.slug);
      return alias.slug;
    }
  }

  const sameDate = existing.filter((item) => item.date === date);
  let best = null;
  let bestScore = 0;
  for (const item of sameDate) {
    if (claimedExistingSlugs.has(item.slug)) continue;
    const score = similarityScore(item.title, title);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.35) {
    claimedExistingSlugs.add(best.slug);
    return best.slug;
  }

  const baseSlug = `${date}-${makeShortSlug(title)}`;
  let slug = baseSlug;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function stripConsensusWrapper(content) {
  let body = content.replace(/^#\s+Council Consensus Summary\s*\n+/, '');
  body = body.replace(/^\*\*Topic\*\*:\s*.+\n/m, '');
  body = body.replace(/^\*\*Date\*\*:\s*.+\n/m, '');
  body = body.replace(/^\*\*Rounds\*\*:\s*.+\n/m, '');
  body = body.replace(/^\*\*Outcome\*\*:\s*.+\n/m, '');
  body = body.replace(/^\s*---\s*\n/, '');

  const sectionMatch = body.match(/^##\s+.*\b(Consensus|Recommendation|Recommended|Plan|Decision|Decisions|Answers?|Architecture|Implementation|Agreed)\b.*$/m);
  if (sectionMatch?.index != null) {
    body = body.slice(sectionMatch.index);
  } else {
    const firstSectionIndex = body.search(/^##\s+/m);
    if (firstSectionIndex >= 0) {
      body = body.slice(firstSectionIndex);
    }
  }

  return body.trim();
}

function stripTranscriptWrapper(content) {
  let body = content.replace(/^#\s+Council Debate\s*\n+/, '');
  body = body.replace(/^\*\*Topic\*\*:\s*.+\n/m, '');
  body = body.replace(/^\s*---\s*\n/, '');
  return body.trim();
}

function consensusFrontmatter(date) {
  return `---\ntags: [ft/entry, ft/debate, ft/decision]\nsource_type: authored\nlast_updated: ${date}\n---\n`;
}

function transcriptFrontmatter(date) {
  return `---\ntags: [ft/entry, ft/debate, ft/transcript]\nsource_type: transcript\nlast_updated: ${date}\n---\n`;
}

function buildConsensusPage({ date, slug, title, content }) {
  const body = stripConsensusWrapper(content);
  const transcriptLink = `[View raw debate transcript](wiki://debates/_${slug}-transcript)`;
  return `${consensusFrontmatter(date)}\n# ${title}\n\n${body}\n\n---\n\n${transcriptLink}\n`;
}

function buildTranscriptPage({ date, slug, title, content }) {
  const body = stripTranscriptWrapper(content);
  const backLink = `[Back to debate consensus](wiki://debates/${slug})`;
  return `${transcriptFrontmatter(date)}\n# ${title} - raw transcript\n\n${backLink}\n\n${body}\n`;
}

function main() {
  ensureDir(debatesDir);

  const consensusFiles = listConsensusFiles();
  if (consensusFiles.length === 0) {
    console.error(`No consensus files found in ${consensusDir}`);
    process.exit(1);
  }

  const existing = existingDebates();
  const usedSlugs = new Set(existing.map((item) => item.slug));
  const claimedExistingSlugs = new Set();
  const written = [];

  for (const consensusPath of consensusFiles) {
    const baseName = path.basename(consensusPath, '.consensus.md');
    const transcriptPath = path.join(councilRoot, `${baseName}.md`);
    if (!fs.existsSync(transcriptPath)) {
      console.warn(`Skipping ${baseName}: missing transcript ${transcriptPath}`);
      continue;
    }

    const consensusContent = readFile(consensusPath);
    const transcriptContent = readFile(transcriptPath);
    const date = baseName.slice(0, 10);
    const title = extractTopic(consensusContent) ?? extractTopic(transcriptContent) ?? extractHeading(consensusContent) ?? baseName;
    const slug = chooseSlug(date, title, existing, usedSlugs, claimedExistingSlugs);
    const consensusOut = path.join(debatesDir, `${slug}.md`);
    const transcriptOut = path.join(debatesDir, `_${slug}-transcript.md`);

    writeFile(consensusOut, buildConsensusPage({ date, slug, title, content: consensusContent }));
    writeFile(transcriptOut, buildTranscriptPage({ date, slug, title, content: transcriptContent }));

    usedSlugs.add(slug);
    written.push({ title, consensusOut, transcriptOut });
  }

  for (const item of written) {
    console.log(`${item.title}\n  consensus: ${item.consensusOut}\n  transcript: ${item.transcriptOut}`);
  }
}

main();
