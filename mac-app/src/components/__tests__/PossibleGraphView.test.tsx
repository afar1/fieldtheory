import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PossibleGraphView from '../PossibleGraphView';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#3f936f',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      surface1: '#ffffff',
      surface2: '#f9fafb',
      inputBg: '#ffffff',
      selectedBg: '#eef2ff',
      error: '#dc2626',
      success: '#16a34a',
      isDark: false,
    },
  }),
}));

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe('PossibleGraphView', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    });

    const batchSummary: PossibleIdeaBatchSummary = {
      id: 'batch-1',
      batchPath: '/tmp/batch-1.md',
      createdAt: '2026-05-03T19:21:26.593Z',
      seedId: 'seed-1',
      seedArtifactIds: ['bookmark-artifact-1'],
      frameId: 'novelty-feasibility',
      frameName: 'Novelty x Feasibility',
      depth: 'standard',
      model: 'claude',
      nodeTarget: 1,
      totalDotCount: 1,
      considerationIds: ['run-1'],
      repos: ['/repo/fieldtheory'],
    };
    const batch: PossibleIdeaBatch = {
      ...batchSummary,
      axisA: 'Novelty',
      axisB: 'Feasibility',
      frame: null,
      seedTitle: 'Agent workflow seed',
      seedNotes: 'strategy=search',
      bookmarkSources: [{
        artifactId: 'bookmark-artifact-1',
        bookmarkId: 'bookmark-1',
        authorHandle: 'karrisaarinen',
        url: 'https://x.com/karrisaarinen/status/bookmark-1',
        postedAt: '2026-05-03T12:00:00.000Z',
        bookmarkedAt: '',
        category: 'agent-workflows',
        domain: 'tools',
        title: '@karrisaarinen',
        excerpt: 'Use documents instead of endless chat streams.',
        artifactPath: '/Users/afar/.fieldtheory/ideas/adjacent/artifacts/bookmark-artifact-1.md',
      }],
      nodes: [{
        id: 'dot-1',
        title: 'Linked Possible Idea',
        summary: 'A focused idea summary.',
        essay: 'A focused proposal.',
        rationale: 'It is related to the seed context.',
        repoSurface: 'src/example.ts',
        effortEstimate: 'hours',
        axisAScore: 70,
        axisAJustification: 'Novel enough to matter.',
        axisBScore: 80,
        axisBJustification: 'Small enough to ship.',
        exportablePrompt: 'Prompt text',
        implementationPrompt: 'Implementation text',
        repo: '/repo/fieldtheory',
        repoName: 'fieldtheory',
        runId: 'run-1',
        artifactPath: '/tmp/dot-1.md',
        rank: 1,
        libraryLinks: [{
          title: 'Linked Note',
          relPath: 'Possible/Linked Note.md',
          path: '/Users/afar/.fieldtheory/library/Possible/Linked Note.md',
        }],
      }],
    };

    Object.defineProperty(window, 'possibleAPI', {
      configurable: true,
      value: {
        listBatches: vi.fn(async () => [batchSummary]),
        getBatch: vi.fn(async () => batch),
      },
    });
    Object.defineProperty(window, 'commandsAPI', {
      configurable: true,
      value: {
        openFieldTheoryMarkdown: vi.fn(async () => ({ success: true })),
      },
    });
    Object.defineProperty(window, 'shellAPI', {
      configurable: true,
      value: {
        openExternal: vi.fn(async () => undefined),
      },
    });
  });

  it('shows the bookmark trail and opens sources and Library notes', async () => {
    render(<PossibleGraphView onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findAllByText('Linked Possible Idea')).not.toHaveLength(0);
    expect(screen.getByText('Agent workflow seed')).toBeTruthy();
    expect(screen.getByText('@karrisaarinen')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Open bookmark from @karrisaarinen'));

    await waitFor(() => {
      expect(window.shellAPI?.openExternal).toHaveBeenCalledWith('https://x.com/karrisaarinen/status/bookmark-1');
    });

    expect(screen.getByText('Linked Note')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Open Library note Linked Note'));

    await waitFor(() => {
      expect(window.commandsAPI?.openFieldTheoryMarkdown).toHaveBeenCalledWith({
        kind: 'wiki',
        path: 'Possible/Linked Note.md',
        contentMode: 'rendered',
      });
    });
  });
});
