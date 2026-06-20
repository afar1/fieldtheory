import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SidebarRiverIcon } from './SidebarIcons';

type SharedFilesClient = NonNullable<Window['sharedFilesAPI']>;
type RiverTimelineItem = Awaited<ReturnType<SharedFilesClient['getTimeline']>>[number];
type RiverTimelineScope = Parameters<SharedFilesClient['getTimeline']>[0]['scope'];
type RiverTarget = Awaited<ReturnType<SharedFilesClient['getTargets']>>[number];

interface RiverReaderProps {
  active?: boolean;
  onOpenItem?: (item: RiverTimelineItem) => void;
  onActionFeedback?: (message: string) => void;
}

function formatRiverTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const delta = Date.now() - time;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}h`;
  return `${Math.max(1, Math.floor(delta / 86_400_000))}d`;
}

function sourceLabel(item: RiverTimelineItem): string {
  if (item.sourceLabel) return item.sourceLabel;
  if (item.sourceKind === 'public') return 'Public';
  if (item.sourceKind === 'mine') return 'Mine';
  if (item.sourceKind === 'group') return 'Group';
  if (item.sourceKind === 'person') return 'Person';
  return 'River';
}

function sourceDotColor(item: RiverTimelineItem, accent: string): string {
  if (item.sourceKind === 'public') return '#6fa6a0';
  if (item.sourceKind === 'group') return '#79a585';
  if (item.sourceKind === 'person') return '#6f8fb0';
  if (item.sourceKind === 'mine') return accent;
  return '#c2a05c';
}

function targetFilterLabel(target: RiverTarget): string {
  if (target.kind === 'public') return 'Public';
  if (target.kind === 'group') return target.label;
  return target.callsign ?? target.label;
}

function authorInitials(item: RiverTimelineItem): string {
  const raw = item.authorInitials || item.authorCallsign || 'R';
  const letters = raw.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return letters || 'R';
}

function authorLabel(item: RiverTimelineItem): string {
  if (item.authorCallsign) return item.authorCallsign;
  if (item.authorInitials) return item.authorInitials;
  return 'River';
}

export default function RiverReader({ active = true, onOpenItem, onActionFeedback }: RiverReaderProps) {
  const { theme } = useTheme();
  const [scope, setScope] = useState<RiverTimelineScope>('private');
  const [items, setItems] = useState<RiverTimelineItem[]>([]);
  const [targets, setTargets] = useState<RiverTarget[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSourceSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const sourceTargets = useMemo(() => (
    targets.filter((target) => target.status === 'accepted' && target.kind !== 'public')
  ), [targets]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      window.sharedFilesAPI?.getTimeline?.({ scope, sourceIds: selectedSourceIds, limit: 50 }) ?? Promise.resolve([]),
      window.sharedFilesAPI?.getTargets?.('') ?? Promise.resolve([]),
    ])
      .then(([nextItems, nextTargets]) => {
        if (cancelled) return;
        setItems(nextItems ?? []);
        setTargets(nextTargets ?? []);
      })
      .catch((err) => {
        console.warn('[RiverReader] timeline load failed:', err);
        if (!cancelled) {
          setItems([]);
          setError('River timeline could not load. Cached River files remain available in the sidebar.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, scope, selectedSourceIds]);

  const toggleSource = (targetId: string) => {
    setSelectedSourceIds((current) => (
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId]
    ));
  };

  const copyItem = async (item: RiverTimelineItem) => {
    const text = [item.title, item.excerpt].filter(Boolean).join('\n\n');
    try {
      const nativeResult = await window.clipboardAPI?.writeText?.(text);
      if (nativeResult && nativeResult.success === false) throw new Error(nativeResult.error ?? 'Copy failed');
      if (!nativeResult) await navigator.clipboard?.writeText(text);
      onActionFeedback?.('Copied River item');
    } catch {
      onActionFeedback?.('River copy failed');
    }
  };

  const pinItem = async (item: RiverTimelineItem) => {
    if (!item.cachePath) {
      onActionFeedback?.('Open the cached River file before pinning');
      return;
    }
    const result = await window.sharedFilesAPI?.setPinned?.(item.cachePath, !item.pinned);
    if (result?.ok) {
      setItems((current) => current.map((candidate) => (
        candidate.documentId === item.documentId
          ? { ...candidate, pinned: result.pinned ?? !item.pinned }
          : candidate
      )));
      onActionFeedback?.(result.pinned ? 'Bookmarked in River' : 'Removed River bookmark');
    } else {
      onActionFeedback?.(result?.error ?? 'River bookmark failed');
    }
  };

  return (
    <div
      data-ft-river-reader="true"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.bg,
        color: theme.text,
      }}
    >
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px 24px 36px',
        }}
      >
        <div style={{ width: 'min(100%, 620px)', margin: '0 auto', position: 'relative' }}>
          <button
            type="button"
            aria-label="Edit River sources"
            onClick={() => setFiltersOpen((current) => !current)}
            style={{
              position: 'absolute',
              top: '2px',
              right: 0,
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              border: `1px solid ${theme.border}`,
              backgroundColor: theme.surface1 ?? theme.bg,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#cdbce0', border: `1.5px solid ${theme.surface1 ?? theme.bg}` }} />
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#bcd0d8', border: `1.5px solid ${theme.surface1 ?? theme.bg}`, marginLeft: '-5px' }} />
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#c9d6c4', border: `1.5px solid ${theme.surface1 ?? theme.bg}`, marginLeft: '-5px' }} />
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: theme.accent, marginBottom: '6px' }}>
            <SidebarRiverIcon color={theme.accent} />
          </div>
          <h1
            style={{
              margin: 0,
              textAlign: 'center',
              fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif',
              fontSize: '29px',
              lineHeight: 1.12,
              fontWeight: 500,
            }}
          >
            River
          </h1>

          <div
            role="tablist"
            aria-label="River timeline scope"
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '24px',
              marginTop: '14px',
              borderBottom: `1px solid ${theme.border}`,
            }}
          >
            {([
              ['private', 'Private'],
              ['public', 'Public'],
            ] as const).map(([id, label]) => {
              const selected = scope === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setScope(id)}
                  style={{
                    border: 'none',
                    borderBottom: `2px solid ${selected ? theme.accent : 'transparent'}`,
                    backgroundColor: 'transparent',
                    color: selected ? theme.text : theme.textSecondary,
                    cursor: 'pointer',
                    fontSize: '13.5px',
                    fontWeight: 650,
                    padding: '0 0 10px',
                    marginBottom: '-1px',
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected="false"
              aria-disabled="true"
              disabled
              style={{
                border: 'none',
                borderBottom: '2px solid transparent',
                backgroundColor: 'transparent',
                color: theme.textSecondary,
                opacity: 0.42,
                cursor: 'not-allowed',
                fontSize: '13.5px',
                fontWeight: 650,
                padding: '0 0 10px',
              }}
            >
              For You
            </button>
          </div>

          {scope === 'private' && sourceTargets.length > 0 && filtersOpen && (
            <div
              aria-label="River source filters"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '14px 0 0',
                overflowX: 'auto',
              }}
            >
              <button
                type="button"
                aria-pressed={selectedSourceIds.length === 0}
                onClick={() => setSelectedSourceIds([])}
                style={{
                  height: '29px',
                  padding: '0 11px',
                  borderRadius: '999px',
                  border: `1px solid ${selectedSourceIds.length === 0 ? theme.accent : theme.border}`,
                  backgroundColor: selectedSourceIds.length === 0 ? (theme.surface1 ?? theme.bg) : 'transparent',
                  color: selectedSourceIds.length === 0 ? theme.text : theme.textSecondary,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                All private
              </button>
              {sourceTargets.map((target) => {
                const selected = selectedSourceSet.has(target.id);
                return (
                  <button
                    key={target.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleSource(target.id)}
                    style={{
                      height: '29px',
                      padding: '0 11px',
                      borderRadius: '999px',
                      border: `1px solid ${selected ? theme.accent : theme.border}`,
                      backgroundColor: selected ? (theme.surface1 ?? theme.bg) : 'transparent',
                      color: selected ? theme.text : theme.textSecondary,
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {targetFilterLabel(target)}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '15px' }}>
            {loading ? (
              <div style={{ color: theme.textSecondary, fontSize: '13px', padding: '18px 0' }}>Loading River...</div>
            ) : error ? (
              <div role="alert" style={{ color: theme.textSecondary, fontSize: '13px', padding: '18px 0' }}>{error}</div>
            ) : items.length === 0 ? (
              <div style={{ color: theme.textSecondary, fontSize: '13px', padding: '18px 0' }}>
                {scope === 'public' ? 'No public River items yet.' : 'No private River items yet.'}
              </div>
            ) : (
              <div>
                {items.map((item) => (
                  <article
                    key={item.documentId}
                    style={{
                      display: 'flex',
                      gap: '11px',
                      padding: '18px 0',
                      borderBottom: `1px solid ${theme.border}`,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: theme.surface2 ?? theme.bg,
                        color: theme.textSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        flex: '0 0 auto',
                      }}
                    >
                      {authorInitials(item)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                            <span style={{ fontSize: '13px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorLabel(item)}</span>
                            {item.authorCallsign && (
                              <span
                                style={{
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  fontSize: '9.5px',
                                  color: theme.isDark ? 'rgba(255,255,255,0.66)' : '#79766d',
                                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : '#ece9e2',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  flex: '0 0 auto',
                                }}
                              >
                                {item.authorCallsign}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.textSecondary, fontSize: '12px', marginTop: '3px' }}>
                            <span aria-hidden="true" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: sourceDotColor(item, theme.accent), flex: '0 0 auto' }} />
                            <span>{sourceLabel(item)} · {formatRiverTime(item.sharedAt)}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: theme.textSecondary, fontSize: '12px', flex: '0 0 auto' }}>
                          <button type="button" aria-label={`Copy ${item.title}`} onClick={() => void copyItem(item)} style={{ border: 'none', background: 'transparent', color: theme.textSecondary, cursor: 'pointer', fontSize: '12px', padding: 0 }}>Copy</button>
                          <button type="button" aria-label={`Open ${item.title}`} disabled={!item.cachePath} onClick={() => onOpenItem?.(item)} style={{ border: 'none', background: 'transparent', color: theme.textSecondary, cursor: item.cachePath ? 'pointer' : 'not-allowed', fontSize: '12px', padding: 0 }}>Open</button>
                          <button type="button" aria-label={`${item.pinned ? 'Remove bookmark for' : 'Bookmark'} ${item.title}`} disabled={!item.cachePath} onClick={() => void pinItem(item)} style={{ border: 'none', background: 'transparent', color: item.pinned ? theme.accent : theme.textSecondary, cursor: item.cachePath ? 'pointer' : 'not-allowed', fontSize: '12px', padding: 0 }}>
                            {item.pinned ? 'Bookmarked' : 'Bookmark'}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(item)}
                        style={{
                          display: 'block',
                          width: '100%',
                          marginTop: '10px',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: theme.text,
                          textAlign: 'left',
                          cursor: item.cachePath ? 'pointer' : 'default',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif',
                            fontSize: '21px',
                            lineHeight: 1.25,
                            fontWeight: 500,
                          }}
                        >
                          {item.title}
                        </div>
                        <div style={{ marginTop: '6px', color: theme.textSecondary, fontSize: '13.5px', lineHeight: 1.62 }}>
                          {item.excerpt || 'No preview available.'}
                        </div>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
