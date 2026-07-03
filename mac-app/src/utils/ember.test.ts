import { describe, expect, it } from 'vitest';
import {
  buildEmberFrontmatterUpdate,
  createEmberPersonContent,
  emberDelayDaysForPreset,
  emberPersonFromPage,
  emberUrgencyProgress,
  sortEmberPeople,
} from './ember';

const NOW = Date.parse('2026-05-15T12:00:00Z');

function page(title: string, content: string): WikiPage {
  return {
    relPath: `Ember/${title}`,
    absPath: `/tmp/Ember/${title}.md`,
    name: title,
    title,
    lastUpdated: NOW,
    content,
    documentVersion: { mtimeMs: NOW, size: content.length, sha256: title },
  };
}

describe('ember utils', () => {
  it('updates timing frontmatter while preserving person notes', () => {
    const content = '---\ntags: [friend]\nember_next_at: 2026-01-01\n---\n\n# Ada\n\nMet at Recurse.\n';

    expect(buildEmberFrontmatterUpdate(content, '60d', NOW)).toBe([
      '---',
      'tags: [friend]',
      '',
      'ember: true',
      'ember_kind: person',
      'ember_frequency: 60d',
      'ember_last_reset_at: 2026-05-15',
      'ember_next_at: 2026-07-14',
      '---',
      '',
      '# Ada',
      '',
      'Met at Recurse.',
      '',
    ].join('\n'));
  });

  it('creates a person markdown record with frontmatter and body room', () => {
    const content = createEmberPersonContent('Ada Lovelace', NOW);

    expect(content).toContain('ember_kind: person');
    expect(content).toContain('ember_next_at: 2026-05-15');
    expect(content).toContain('# Ada Lovelace');
  });

  it('keeps random timing bounded and deterministic when a random source is passed', () => {
    expect(emberDelayDaysForPreset('1w')).toBe(7);
    expect(emberDelayDaysForPreset('2w')).toBe(14);
    expect(emberDelayDaysForPreset('random', () => 0)).toBe(30);
    expect(emberDelayDaysForPreset('random', () => 0.999)).toBe(180);
  });

  it('orders due people first and gives every visible card a unique opacity', () => {
    const people = sortEmberPeople([
      emberPersonFromPage(page('Upcoming', '---\nember_last_reset_at: 2026-05-01\nember_next_at: 2026-06-01\n---\n# Upcoming'), NOW),
      emberPersonFromPage(page('Due', '---\nember_last_reset_at: 2026-04-24\nember_next_at: 2026-05-01\n---\n# Due'), NOW),
      emberPersonFromPage(page('Missing Date', '# Missing Date'), NOW),
    ]);

    expect(people.map((person) => person.title)).toEqual(['Due', 'Missing Date', 'Upcoming']);
    expect(new Set(people.map((person) => person.opacity)).size).toBe(3);
    expect(people[0].due).toBe(true);
    expect(people[2].due).toBe(false);
  });

  it('derives visibility from progress between reset and next reach-out date', () => {
    const start = Date.parse('2026-05-15T00:00:00Z');
    const due = Date.parse('2026-05-22T00:00:00Z');
    const content = '---\nember_frequency: 1w\nember_last_reset_at: 2026-05-15\nember_next_at: 2026-05-22\n---\n# Mom\n';

    const justReset = emberPersonFromPage(page('Mom', content), start);
    const fullyDue = emberPersonFromPage(page('Mom', content), due);

    expect(emberUrgencyProgress(start, due, start)).toBe(0);
    expect(justReset.urgencyProgress).toBe(0);
    expect(justReset.opacity).toBeLessThan(fullyDue.opacity);
    expect(fullyDue.urgencyProgress).toBe(1);
    expect(fullyDue.opacity).toBe(1);
    expect(fullyDue.due).toBe(true);
  });
});
