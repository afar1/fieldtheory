import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { fonts } from '../design/tokens';

interface PossibleGraphViewProps {
  onSwitchToClipboard: () => void;
}

type RepoFilter = 'all' | string;

const PLOT_WIDTH = 720;
const PLOT_HEIGHT = 460;
const PLOT_MARGIN = { left: 58, right: 34, top: 34, bottom: 56 };
const TICKS = [0, 25, 50, 75, 100];
const REPO_COLORS = ['#4ba47d', '#5aa3eb', '#d7ae3d', '#d98072', '#9b7cf1', '#5bb8b1'];

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function plotX(score: number): number {
  const innerWidth = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right;
  return PLOT_MARGIN.left + (clampScore(score) / 100) * innerWidth;
}

function plotY(score: number): number {
  const innerHeight = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  return PLOT_MARGIN.top + ((100 - clampScore(score)) / 100) * innerHeight;
}

function truncateLabel(label: string, max = 42): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 3)}...`;
}

function formatBatchLabel(batch: PossibleIdeaBatchSummary): string {
  const created = Date.parse(batch.createdAt);
  const dateLabel = Number.isNaN(created)
    ? batch.createdAt
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(created));
  return `${batch.frameName || batch.frameId || 'Ideas'} - ${dateLabel || batch.id}`;
}

function paragraphBlocks(text: string): string[] {
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
}

function scoreTone(score: number): string {
  if (score >= 70) return 'Strong';
  if (score >= 50) return 'Promising';
  return 'Speculative';
}

function statLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSourceDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function sourceMetaLabel(source: PossibleIdeaBookmarkSource): string {
  const pieces = [
    formatSourceDate(source.postedAt),
    source.domain || source.category,
  ].filter(Boolean);
  return pieces.join(' - ');
}

function QuadrantLabel({
  label,
  x,
  y,
  anchor,
  color,
}: {
  label?: string;
  x: number;
  y: number;
  anchor: 'start' | 'end';
  color: string;
}) {
  if (!label) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize="10"
      fontFamily={fonts.sans}
      fill={color}
      opacity="0.72"
    >
      {truncateLabel(label, 24)}
    </text>
  );
}

export default function PossibleGraphView({ onSwitchToClipboard }: PossibleGraphViewProps) {
  const { theme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [width, setWidth] = useState(0);
  const [batches, setBatches] = useState<PossibleIdeaBatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [batch, setBatch] = useState<PossibleIdeaBatch | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<RepoFilter>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const palette = useMemo(() => ({
    background: theme.isDark ? '#14171d' : '#f6f7f8',
    panel: theme.isDark ? 'rgba(255,255,255,0.048)' : 'rgba(255,255,255,0.92)',
    panelRaised: theme.isDark ? 'rgba(255,255,255,0.072)' : '#ffffff',
    panelMuted: theme.isDark ? 'rgba(255,255,255,0.034)' : 'rgba(0,0,0,0.028)',
    border: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    borderSoft: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.075)',
    text: theme.text,
    muted: theme.textSecondary,
    shadow: theme.isDark ? '0 24px 70px rgba(0,0,0,0.28)' : '0 24px 70px rgba(18,26,38,0.10)',
  }), [theme]);

  useEffect(() => {
    const update = () => setWidth(rootRef.current?.clientWidth ?? 0);
    update();

    const observer = new ResizeObserver(update);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const loadBatch = useCallback(async (batchId?: string) => {
    if (!window.possibleAPI) {
      setError('The Possible ideas API is not available in this window.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextBatch = await window.possibleAPI.getBatch(batchId);
      setBatch(nextBatch);
      setSelectedRepo('all');
      setSelectedNodeId(nextBatch?.nodes[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Possible ideas.');
      setBatch(null);
      setSelectedNodeId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      if (!window.possibleAPI) {
        setError('The Possible ideas API is not available in this window.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const nextBatches = await window.possibleAPI.listBatches();
        if (cancelled) return;

        setBatches(nextBatches);
        const firstBatchId = nextBatches[0]?.id ?? '';
        setSelectedBatchId(firstBatchId);
        const nextBatch = firstBatchId ? await window.possibleAPI.getBatch(firstBatchId) : null;
        if (cancelled) return;

        setBatch(nextBatch);
        setSelectedNodeId(nextBatch?.nodes[0]?.id ?? null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load Possible ideas.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  const repoColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const repos = batch?.repos.length ? batch.repos : Array.from(new Set(batch?.nodes.map((node) => node.repo) ?? []));
    repos.forEach((repo, index) => map.set(repo, REPO_COLORS[index % REPO_COLORS.length]));
    return map;
  }, [batch]);

  const repoOptions = useMemo(() => {
    if (!batch) return [];
    const counts = new Map<string, number>();
    for (const node of batch.nodes) {
      counts.set(node.repo, (counts.get(node.repo) ?? 0) + 1);
    }

    const orderedRepos = batch.repos.length ? batch.repos : Array.from(counts.keys());
    return [
      { repo: 'all' as RepoFilter, label: 'All repos', count: batch.nodes.length },
      ...orderedRepos
        .filter((repo) => counts.has(repo))
        .map((repo) => ({
          repo,
          label: batch.nodes.find((node) => node.repo === repo)?.repoName ?? repo,
          count: counts.get(repo) ?? 0,
        })),
    ];
  }, [batch]);

  const filteredNodes = useMemo(() => {
    if (!batch) return [];
    if (selectedRepo === 'all') return batch.nodes;
    return batch.nodes.filter((node) => node.repo === selectedRepo);
  }, [batch, selectedRepo]);

  useEffect(() => {
    if (filteredNodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    if (!filteredNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(filteredNodes[0].id);
    }
  }, [filteredNodes, selectedNodeId]);

  const selectedNode = filteredNodes.find((node) => node.id === selectedNodeId) ?? filteredNodes[0] ?? null;
  const hoveredNode = filteredNodes.find((node) => node.id === hoveredNodeId) ?? null;
  const labelNode = hoveredNode ?? selectedNode;
  const selectedIndex = selectedNode ? filteredNodes.findIndex((node) => node.id === selectedNode.id) : -1;
  const isNarrow = width < 920;
  const linkedDocumentCount = useMemo(() => {
    const paths = new Set<string>();
    for (const node of batch?.nodes ?? []) {
      for (const link of node.libraryLinks) paths.add(link.relPath);
    }
    return paths.size;
  }, [batch]);
  const bookmarkSourceCount = batch?.bookmarkSources.length ?? 0;
  const visibleBookmarkSources = batch?.bookmarkSources.slice(0, 5) ?? [];
  const quickWinCount = filteredNodes.filter((node) => node.axisAScore >= 50 && node.axisBScore >= 50).length;

  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
    } catch {
      setCopiedLabel('Copy failed');
    }

    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedLabel(null), 1600);
  }, []);

  const moveSelection = useCallback((delta: 1 | -1) => {
    if (!filteredNodes.length) return;
    const currentIndex = selectedIndex === -1 ? 0 : selectedIndex;
    const nextIndex = (currentIndex + delta + filteredNodes.length) % filteredNodes.length;
    setSelectedNodeId(filteredNodes[nextIndex].id);
  }, [filteredNodes, selectedIndex]);

  const openLibraryLink = useCallback((link: PossibleIdeaLibraryLink) => {
    void window.commandsAPI?.openFieldTheoryMarkdown?.({
      kind: 'wiki',
      path: link.relPath,
      contentMode: 'rendered',
    });
  }, []);

  const openBookmarkSource = useCallback((source: PossibleIdeaBookmarkSource) => {
    if (!source.url) return;
    void window.shellAPI?.openExternal(source.url);
  }, []);

  const buttonStyle = (tone: 'primary' | 'secondary' | 'ghost' = 'secondary'): CSSProperties => ({
    minHeight: '30px',
    padding: tone === 'ghost' ? '0 6px' : '0 11px',
    border: tone === 'primary' ? '1px solid transparent' : `1px solid ${palette.border}`,
    borderRadius: '7px',
    backgroundColor: tone === 'primary' ? theme.accent : tone === 'ghost' ? 'transparent' : palette.panelMuted,
    color: tone === 'primary' ? '#fff' : palette.text,
    fontSize: '11px',
    fontWeight: 620,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  const filterButtonStyle = (selected: boolean, color: string): CSSProperties => ({
    minHeight: '32px',
    padding: '0 12px',
    border: `1px solid ${selected ? color : palette.border}`,
    borderRadius: '8px',
    backgroundColor: selected ? color : palette.panelMuted,
    color: selected ? '#fff' : palette.text,
    fontSize: '11px',
    fontWeight: 650,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
  });

  const scoreTile = (label: string, score: number, note: string): JSX.Element => (
    <div style={{
      minWidth: 0,
      border: `1px solid ${palette.borderSoft}`,
      borderRadius: '8px',
      padding: '10px',
      backgroundColor: palette.panelMuted,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ fontSize: '10px', color: palette.muted, fontWeight: 650 }}>{label}</div>
        <div style={{ fontSize: '9px', color: palette.muted, fontWeight: 650 }}>{scoreTone(score)}</div>
      </div>
      <div style={{ marginTop: '5px', fontFamily: fonts.mono, fontSize: '24px', lineHeight: 1, color: palette.text }}>{score}</div>
      <div style={{ marginTop: '7px', fontSize: '10.5px', lineHeight: 1.38, color: palette.muted }}>
        {truncateLabel(note, 118)}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: isNarrow ? '0 12px 12px 12px' : '0 20px 18px 20px',
        color: palette.text,
        fontFamily: fonts.sans,
        backgroundColor: palette.background,
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: isNarrow ? '1fr' : 'minmax(260px, 1fr) auto',
        alignItems: 'end',
        gap: '12px',
        padding: '0 0 12px 0',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
            <div style={{ fontSize: '22px', lineHeight: 1, fontWeight: 760, color: palette.text }}>Possible</div>
            {batch && (
              <div style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '999px',
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 680,
                color: palette.muted,
                backgroundColor: palette.panelMuted,
              }}>
                {batch.frameName || batch.frameId}
              </div>
            )}
          </div>
          <div style={{ marginTop: '6px', fontSize: '11px', lineHeight: 1.4, color: palette.muted }}>
            {batch
              ? `${statLabel(filteredNodes.length, 'idea', 'ideas')} on ${batch.axisB} x ${batch.axisA} - ${statLabel(bookmarkSourceCount, 'bookmark source', 'bookmark sources')} - ${statLabel(linkedDocumentCount, 'Library note', 'Library notes')}`
              : 'No batch loaded'}
          </div>
        </div>

        <select
          value={selectedBatchId}
          disabled={loading || batches.length === 0}
          onChange={(event) => {
            const nextId = event.currentTarget.value;
            setSelectedBatchId(nextId);
            loadBatch(nextId);
          }}
          style={{
            width: isNarrow ? '100%' : '320px',
            height: '36px',
            borderRadius: '8px',
            border: `1px solid ${palette.border}`,
            backgroundColor: palette.panelRaised,
            color: palette.text,
            fontSize: '12px',
            padding: '0 10px',
            outline: 'none',
          }}
        >
          {batches.length === 0 ? (
            <option value="">No batches</option>
          ) : batches.map((item) => (
            <option key={item.id} value={item.id}>{formatBatchLabel(item)}</option>
          ))}
        </select>
      </div>

      {batch && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '12px',
          alignItems: 'center',
        }}>
          {repoOptions.map((option) => {
            const selected = selectedRepo === option.repo;
            const color = option.repo === 'all' ? theme.accent : repoColorMap.get(option.repo) ?? theme.accent;
            return (
              <button
                key={option.repo}
                type="button"
                onClick={() => setSelectedRepo(option.repo)}
                style={filterButtonStyle(selected, color)}
              >
                <span style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: selected ? '#fff' : color,
                  flex: '0 0 auto',
                }} />
                <span>{option.label}</span>
                <span style={{ opacity: selected ? 0.82 : 0.62 }}>{option.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: palette.muted,
          fontSize: '12px',
        }}>
          Loading Possible ideas...
        </div>
      ) : error ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: palette.muted,
          fontSize: '12px',
          textAlign: 'center',
        }}>
          <div>{error}</div>
          <button type="button" onClick={onSwitchToClipboard} style={buttonStyle()}>Back to Fields</button>
        </div>
      ) : !batch || batch.nodes.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: palette.muted,
          fontSize: '12px',
          textAlign: 'center',
        }}>
          <div>No Possible idea nodes were found in ~/.fieldtheory/ideas.</div>
          <button type="button" onClick={onSwitchToClipboard} style={buttonStyle()}>Back to Fields</button>
        </div>
      ) : (
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : 'minmax(340px, 0.78fr) minmax(560px, 1.22fr)',
          gridTemplateRows: isNarrow ? 'minmax(420px, 0.9fr) minmax(560px, 1fr)' : '1fr',
          gap: '14px',
          overflow: 'hidden',
        }}>
          <aside style={{
            order: isNarrow ? 2 : 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${palette.border}`,
            borderRadius: '8px',
            backgroundColor: palette.panel,
            boxShadow: palette.shadow,
            overflow: 'hidden',
          }}>
            {selectedNode ? (
              <>
                <div style={{
                  padding: '16px',
                  borderBottom: `1px solid ${palette.borderSoft}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '13px',
                }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: repoColorMap.get(selectedNode.repo) ?? theme.accent,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: fonts.mono,
                      fontSize: '12px',
                      fontWeight: 760,
                      flex: '0 0 auto',
                      boxShadow: '0 0 0 3px rgba(255,255,255,0.10)',
                    }}>
                      {selectedNode.rank}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '18px', lineHeight: 1.18, fontWeight: 760, color: palette.text }}>
                        {selectedNode.title}
                      </div>
                      <div style={{ marginTop: '7px', fontSize: '11px', lineHeight: 1.35, color: palette.muted }}>
                        {selectedNode.repoName} - {selectedNode.repoSurface || selectedNode.repo}
                      </div>
                    </div>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '9px',
                  }}>
                    {scoreTile(batch.axisA, selectedNode.axisAScore, selectedNode.axisAJustification)}
                    {scoreTile(batch.axisB, selectedNode.axisBScore, selectedNode.axisBJustification)}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => moveSelection(-1)} style={buttonStyle('secondary')}>Prev</button>
                    <button type="button" onClick={() => moveSelection(1)} style={buttonStyle('secondary')}>Next</button>
                    <button
                      type="button"
                      onClick={() => copyText(selectedNode.exportablePrompt || selectedNode.implementationPrompt, 'Prompt copied')}
                      style={{ ...buttonStyle('primary'), marginLeft: 'auto' }}
                    >
                      Copy prompt
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(selectedNode.implementationPrompt, 'Implementation copied')}
                      style={buttonStyle('secondary')}
                    >
                      Copy implementation
                    </button>
                  </div>
                  {copiedLabel && (
                    <div style={{ fontSize: '10px', color: copiedLabel === 'Copy failed' ? theme.error : theme.success }}>
                      {copiedLabel}
                    </div>
                  )}
                </div>

                <div style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '15px 16px 18px 16px',
                }}>
                  <section style={{ marginBottom: '17px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                      Summary
                    </div>
                    <p style={{ margin: '7px 0 0 0', fontSize: '13px', lineHeight: 1.52, color: palette.text }}>
                      {selectedNode.summary}
                    </p>
                  </section>

                  {selectedNode.essay && (
                    <section style={{ marginBottom: '17px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                        Proposal
                      </div>
                      {paragraphBlocks(selectedNode.essay).slice(0, 5).map((block, index) => (
                        <p key={index} style={{ margin: '8px 0 0 0', fontSize: '12.5px', lineHeight: 1.55, color: palette.text }}>
                          {block}
                        </p>
                      ))}
                    </section>
                  )}

                  <section style={{ marginBottom: '17px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                        Bookmark trail
                      </div>
                      <div style={{ fontSize: '10px', color: palette.muted }}>
                        {bookmarkSourceCount}
                      </div>
                    </div>

                    <div style={{
                      border: `1px solid ${palette.borderSoft}`,
                      borderRadius: '8px',
                      backgroundColor: palette.panelMuted,
                      padding: '10px',
                    }}>
                      <div style={{ fontSize: '10px', color: palette.muted, fontWeight: 700 }}>Started from</div>
                      <div style={{ marginTop: '4px', fontSize: '12.5px', lineHeight: 1.36, color: palette.text, fontWeight: 700 }}>
                        {batch.seedTitle || batch.seedId || 'Seed bookmarks'}
                      </div>
                      {batch.seedNotes && (
                        <div style={{ marginTop: '4px', fontSize: '10.5px', lineHeight: 1.4, color: palette.muted }}>
                          {batch.seedNotes}
                        </div>
                      )}
                    </div>

                    {visibleBookmarkSources.length > 0 ? (
                      <div style={{ display: 'grid', gap: '7px', marginTop: '8px' }}>
                        {visibleBookmarkSources.map((source) => {
                          const metaLabel = sourceMetaLabel(source);
                          return (
                            <button
                              key={source.artifactId}
                              type="button"
                              aria-label={`Open bookmark from ${source.title}`}
                              disabled={!source.url}
                              onClick={() => openBookmarkSource(source)}
                              style={{
                                minHeight: '58px',
                                width: '100%',
                                border: `1px solid ${palette.borderSoft}`,
                                borderRadius: '8px',
                                backgroundColor: palette.panelRaised,
                                color: palette.text,
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 1fr) auto',
                                gap: '10px',
                                alignItems: 'center',
                                textAlign: 'left',
                                cursor: source.url ? 'pointer' : 'default',
                                padding: '9px 10px',
                                opacity: source.url ? 1 : 0.78,
                              }}
                            >
                              <span style={{ minWidth: 0 }}>
                                <span style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  minWidth: 0,
                                }}>
                                  <span style={{
                                    minWidth: 0,
                                    fontSize: '11.5px',
                                    fontWeight: 720,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {source.title}
                                  </span>
                                  {metaLabel && (
                                    <span style={{
                                      flex: '0 0 auto',
                                      fontSize: '10px',
                                      color: palette.muted,
                                    }}>
                                      {metaLabel}
                                    </span>
                                  )}
                                </span>
                                <span style={{
                                  display: 'block',
                                  marginTop: '4px',
                                  maxHeight: '32px',
                                  overflow: 'hidden',
                                  fontSize: '10.5px',
                                  lineHeight: 1.45,
                                  color: palette.muted,
                                }}>
                                  {source.excerpt || source.url || source.artifactId}
                                </span>
                              </span>
                              <span style={{ color: palette.muted, fontSize: '12px' }}>Open</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{
                        marginTop: '8px',
                        border: `1px solid ${palette.borderSoft}`,
                        borderRadius: '8px',
                        backgroundColor: palette.panelMuted,
                        padding: '10px',
                        fontSize: '11px',
                        lineHeight: 1.45,
                        color: palette.muted,
                      }}>
                        This batch has no seed bookmark artifacts available.
                      </div>
                    )}

                    {bookmarkSourceCount > visibleBookmarkSources.length && (
                      <div style={{ marginTop: '7px', fontSize: '10px', color: palette.muted }}>
                        +{bookmarkSourceCount - visibleBookmarkSources.length} more seed sources
                      </div>
                    )}
                  </section>

                  {selectedNode.rationale && (
                    <section style={{ marginBottom: '17px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                        Why this surfaced
                      </div>
                      <p style={{ margin: '7px 0 0 0', fontSize: '12px', lineHeight: 1.5, color: palette.muted }}>
                        {selectedNode.rationale}
                      </p>
                    </section>
                  )}

                  <section style={{ marginBottom: '17px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                        Library notes
                      </div>
                      <div style={{ fontSize: '10px', color: palette.muted }}>
                        {selectedNode.libraryLinks.length}
                      </div>
                    </div>

                    {selectedNode.libraryLinks.length > 0 ? (
                      <div style={{ display: 'grid', gap: '7px' }}>
                        {selectedNode.libraryLinks.map((link) => (
                          <button
                            key={link.relPath}
                            type="button"
                            aria-label={`Open Library note ${link.title}`}
                            onClick={() => openLibraryLink(link)}
                            style={{
                              minHeight: '38px',
                              width: '100%',
                              border: `1px solid ${palette.borderSoft}`,
                              borderRadius: '8px',
                              backgroundColor: palette.panelMuted,
                              color: palette.text,
                              display: 'grid',
                              gridTemplateColumns: '1fr auto',
                              gap: '10px',
                              alignItems: 'center',
                              textAlign: 'left',
                              cursor: 'pointer',
                              padding: '8px 10px',
                            }}
                          >
                            <span style={{ minWidth: 0 }}>
                              <span style={{
                                display: 'block',
                                fontSize: '11.5px',
                                fontWeight: 680,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {link.title}
                              </span>
                              <span style={{
                                display: 'block',
                                marginTop: '2px',
                                fontSize: '10px',
                                color: palette.muted,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {link.relPath}
                              </span>
                            </span>
                            <span style={{ color: palette.muted, fontSize: '12px' }}>Open</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{
                        border: `1px solid ${palette.borderSoft}`,
                        borderRadius: '8px',
                        backgroundColor: palette.panelMuted,
                        padding: '10px',
                        fontSize: '11px',
                        lineHeight: 1.45,
                        color: palette.muted,
                      }}>
                        No matching Library note was found for this idea yet.
                      </div>
                    )}
                  </section>

                  {selectedNode.implementationPrompt && (
                    <section>
                      <div style={{ fontSize: '10px', fontWeight: 760, color: palette.muted, textTransform: 'uppercase', letterSpacing: 0 }}>
                        Implementation prompt
                      </div>
                      <pre style={{
                        margin: '8px 0 0 0',
                        padding: '11px',
                        border: `1px solid ${palette.borderSoft}`,
                        borderRadius: '8px',
                        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.035)',
                        color: palette.text,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: '11px',
                        lineHeight: 1.48,
                        fontFamily: fonts.mono,
                      }}>
                        {selectedNode.implementationPrompt}
                      </pre>
                    </section>
                  )}
                </div>
              </>
            ) : (
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: palette.muted,
                fontSize: '12px',
                padding: '24px',
                textAlign: 'center',
              }}>
                Select a plotted node to read its proposal.
              </div>
            )}
          </aside>

          <section style={{
            order: isNarrow ? 1 : 2,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${palette.border}`,
            borderRadius: '8px',
            backgroundColor: palette.panel,
            boxShadow: palette.shadow,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isNarrow ? '1fr' : '1fr auto',
              gap: '10px',
              alignItems: 'start',
              padding: '14px 16px 10px 16px',
              borderBottom: `1px solid ${palette.borderSoft}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 740, color: palette.text }}>Opportunity map</div>
                <div style={{ marginTop: '4px', fontSize: '11px', color: palette.muted }}>
                  {statLabel(quickWinCount, 'idea', 'ideas')} in the high-score quadrant
                </div>
              </div>
              {selectedNode && (
                <div style={{
                  minWidth: isNarrow ? 0 : '230px',
                  border: `1px solid ${palette.borderSoft}`,
                  borderRadius: '8px',
                  backgroundColor: palette.panelMuted,
                  padding: '9px 10px',
                }}>
                  <div style={{ fontSize: '10px', color: palette.muted, fontWeight: 700 }}>Focused idea</div>
                  <div style={{
                    marginTop: '3px',
                    fontSize: '12px',
                    fontWeight: 720,
                    color: palette.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {selectedNode.title}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              flex: '0 0 auto',
              padding: '14px 18px 10px 18px',
            }}>
              <div style={{
                width: '100%',
                aspectRatio: isNarrow ? '1.2 / 1' : '1.55 / 1',
                minHeight: isNarrow ? '330px' : '360px',
                maxHeight: '520px',
              }}>
                <svg
                  viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
                  role="img"
                  aria-label={`Possible ideas plotted by ${batch.axisB} and ${batch.axisA}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                  }}
                >
                  <rect
                    x={PLOT_MARGIN.left}
                    y={PLOT_MARGIN.top}
                    width={PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right}
                    height={PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom}
                    rx="8"
                    fill={theme.isDark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)'}
                    stroke={palette.borderSoft}
                    strokeWidth="1"
                  />

                  {TICKS.map((tick) => {
                    const x = plotX(tick);
                    const y = plotY(tick);
                    const isMid = tick === 50;
                    return (
                      <g key={tick}>
                        <line
                          x1={x}
                          x2={x}
                          y1={PLOT_MARGIN.top}
                          y2={PLOT_HEIGHT - PLOT_MARGIN.bottom}
                          stroke={isMid ? palette.muted : palette.borderSoft}
                          strokeWidth={isMid ? 1.2 : 0.8}
                          opacity={isMid ? 0.62 : 0.55}
                        />
                        <line
                          x1={PLOT_MARGIN.left}
                          x2={PLOT_WIDTH - PLOT_MARGIN.right}
                          y1={y}
                          y2={y}
                          stroke={isMid ? palette.muted : palette.borderSoft}
                          strokeWidth={isMid ? 1.2 : 0.8}
                          opacity={isMid ? 0.62 : 0.55}
                        />
                        <text
                          x={x}
                          y={PLOT_HEIGHT - PLOT_MARGIN.bottom + 21}
                          textAnchor="middle"
                          fontSize="10"
                          fontFamily={fonts.mono}
                          fill={palette.muted}
                        >
                          {tick}
                        </text>
                        <text
                          x={PLOT_MARGIN.left - 14}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="10"
                          fontFamily={fonts.mono}
                          fill={palette.muted}
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  <QuadrantLabel
                    label={batch.frame?.quadrantLabels?.highLow}
                    x={PLOT_MARGIN.left + 14}
                    y={PLOT_MARGIN.top + 20}
                    anchor="start"
                    color={palette.muted}
                  />
                  <QuadrantLabel
                    label={batch.frame?.quadrantLabels?.highHigh}
                    x={PLOT_WIDTH - PLOT_MARGIN.right - 14}
                    y={PLOT_MARGIN.top + 20}
                    anchor="end"
                    color={palette.muted}
                  />
                  <QuadrantLabel
                    label={batch.frame?.quadrantLabels?.lowLow}
                    x={PLOT_MARGIN.left + 14}
                    y={PLOT_HEIGHT - PLOT_MARGIN.bottom - 14}
                    anchor="start"
                    color={palette.muted}
                  />
                  <QuadrantLabel
                    label={batch.frame?.quadrantLabels?.lowHigh}
                    x={PLOT_WIDTH - PLOT_MARGIN.right - 14}
                    y={PLOT_HEIGHT - PLOT_MARGIN.bottom - 14}
                    anchor="end"
                    color={palette.muted}
                  />

                  <text
                    x={(PLOT_MARGIN.left + PLOT_WIDTH - PLOT_MARGIN.right) / 2}
                    y={PLOT_HEIGHT - 15}
                    textAnchor="middle"
                    fontSize="12"
                    fontFamily={fonts.sans}
                    fill={palette.text}
                    fontWeight="700"
                  >
                    {batch.axisB}
                  </text>
                  <text
                    transform={`translate(19 ${(PLOT_MARGIN.top + PLOT_HEIGHT - PLOT_MARGIN.bottom) / 2}) rotate(-90)`}
                    textAnchor="middle"
                    fontSize="12"
                    fontFamily={fonts.sans}
                    fill={palette.text}
                    fontWeight="700"
                  >
                    {batch.axisA}
                  </text>

                  {filteredNodes.map((node) => {
                    const x = plotX(node.axisBScore);
                    const y = plotY(node.axisAScore);
                    const selected = node.id === selectedNode?.id;
                    const color = repoColorMap.get(node.repo) ?? theme.accent;
                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={node.title}
                        onClick={() => setSelectedNodeId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedNodeId(node.id);
                          }
                        }}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId((current) => current === node.id ? null : current)}
                        style={{ cursor: 'pointer', outline: 'none' }}
                      >
                        {selected && (
                          <circle
                            cx={x}
                            cy={y}
                            r="20"
                            fill="none"
                            stroke={palette.text}
                            strokeWidth="2"
                            opacity="0.88"
                          />
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r={selected ? 13 : 10}
                          fill={color}
                          opacity={selected ? 1 : 0.9}
                          stroke={theme.isDark ? '#14171d' : '#ffffff'}
                          strokeWidth={selected ? 1.8 : 1.4}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={21}
                          fill="transparent"
                        />
                        <text
                          x={x}
                          y={y + 3.5}
                          textAnchor="middle"
                          fontSize={selected ? 9.5 : 8.5}
                          fontFamily={fonts.mono}
                          fill="#fff"
                          pointerEvents="none"
                          fontWeight="760"
                        >
                          {node.rank}
                        </text>
                      </g>
                    );
                  })}

                  {labelNode && (
                    <text
                      x={plotX(labelNode.axisBScore) > PLOT_WIDTH - 250 ? plotX(labelNode.axisBScore) - 18 : plotX(labelNode.axisBScore) + 18}
                      y={Math.max(PLOT_MARGIN.top + 18, plotY(labelNode.axisAScore) - 16)}
                      textAnchor={plotX(labelNode.axisBScore) > PLOT_WIDTH - 250 ? 'end' : 'start'}
                      fontSize="11"
                      fontFamily={fonts.sans}
                      fill={palette.text}
                      stroke={theme.isDark ? '#14171d' : '#ffffff'}
                      strokeWidth="4"
                      paintOrder="stroke"
                      fontWeight="720"
                    >
                      {truncateLabel(labelNode.title, 44)}
                    </text>
                  )}
                </svg>
              </div>
            </div>

            <div style={{
              flex: 1,
              minHeight: '136px',
              overflowY: 'auto',
              borderTop: `1px solid ${palette.borderSoft}`,
            }}>
              {filteredNodes.map((node) => {
                const selected = node.id === selectedNode?.id;
                const color = repoColorMap.get(node.repo) ?? theme.accent;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{
                      width: '100%',
                      minHeight: '50px',
                      display: 'grid',
                      gridTemplateColumns: '34px minmax(0, 1fr) auto',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '8px 14px',
                      border: 'none',
                      borderBottom: `1px solid ${palette.borderSoft}`,
                      backgroundColor: selected ? (theme.isDark ? 'rgba(75,164,125,0.18)' : 'rgba(75,164,125,0.11)') : 'transparent',
                      color: palette.text,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      backgroundColor: color,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: fonts.mono,
                      fontSize: '10px',
                      fontWeight: 760,
                    }}>
                      {node.rank}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: selected ? 720 : 610,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {node.title}
                      </span>
                      <span style={{
                        display: 'block',
                        marginTop: '3px',
                        fontSize: '10.5px',
                        color: palette.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {node.repoName} - {node.repoSurface}
                      </span>
                    </span>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontFamily: fonts.mono,
                      fontSize: '10px',
                      color: palette.muted,
                      whiteSpace: 'nowrap',
                    }}>
                      {node.libraryLinks.length > 0 && (
                        <span style={{
                          fontFamily: fonts.sans,
                          fontWeight: 700,
                          color: palette.text,
                        }}>
                          {node.libraryLinks.length} note{node.libraryLinks.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {batch.axisB.slice(0, 1)} {node.axisBScore} / {batch.axisA.slice(0, 1)} {node.axisAScore}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
