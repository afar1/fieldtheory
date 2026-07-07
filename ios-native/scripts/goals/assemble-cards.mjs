#!/usr/bin/env node
// Stage 3: merge candidates.json + synthesis.json into the bundled card set,
// validate the full contract, and write FieldTheory/Resources/goals-cards.json.
// Fails loudly on any contract violation so a bad card set can't ship silently.
//
// Usage: node assemble-cards.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(readFileSync(join(here, 'candidates.json'), 'utf8'));
const synthesis = JSON.parse(readFileSync(join(here, 'synthesis.json'), 'utf8'));

const AXES = ['relevance', 'actionability', 'novelty', 'leverage', 'timing', 'evidence', 'confidence', 'cost'];
const PROJECTS = new Set(['fieldtheory-labs', 'fieldtheory', 'fieldtheory-cli']);
const errors = [];

const cards = candidates.cards.map((c) => {
  const prose = synthesis[c.id];
  if (!prose) {
    errors.push(`${c.id}: no synthesis entry`);
    return null;
  }
  const { _synthesisContext, ...card } = c;
  Object.assign(card, {
    title: prose.title, whyNow: prose.whyNow, goal: prose.goal, firstTest: prose.firstTest,
  });
  return card;
}).filter(Boolean);

// Contract checks for every field the iOS GoalCard model requires.
const ids = new Set();
for (const c of cards) {
  const where = c.id ?? '(missing id)';
  if (ids.has(c.id)) errors.push(`${where}: duplicate id`);
  ids.add(c.id);
  if (!PROJECTS.has(c.project)) errors.push(`${where}: bad project ${c.project}`);
  if (c.algorithmVersion !== candidates.algorithmVersion) errors.push(`${where}: version mismatch`);
  for (const field of ['title', 'whyNow', 'goal', 'firstTest', 'scoreNote']) {
    if (typeof c[field] !== 'string' || c[field].length < 10) errors.push(`${where}: ${field} missing or too short`);
  }
  for (const field of ['tweetId', 'url', 'excerpt']) {
    if (!c.source?.[field]) errors.push(`${where}: source.${field} missing`);
  }
  for (const axis of AXES) {
    const v = c.scores?.[axis];
    if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`${where}: score ${axis} out of range (${v})`);
  }
  if (typeof c.composite !== 'number') errors.push(`${where}: composite missing`);
  if (c.goal && !/\d|percent|under|least/.test(c.goal)) errors.push(`${where}: goal has no empirical metric`);
}
if (cards.length < 20 || cards.length > 50) errors.push(`card count ${cards.length} outside 20-50`);

const orphans = Object.keys(synthesis).filter((id) => !candidates.cards.some((c) => c.id === id));
if (orphans.length) errors.push(`synthesis entries with no candidate: ${orphans.join(', ')}`);

if (errors.length) {
  console.error('Contract violations:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const out = {
  algorithmVersion: candidates.algorithmVersion,
  generatedAt: candidates.generatedAt,
  cards,
};
const outPath = join(here, '..', '..', 'FieldTheory', 'Resources', 'goals-cards.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`Wrote ${cards.length} validated cards to ${outPath}`);
