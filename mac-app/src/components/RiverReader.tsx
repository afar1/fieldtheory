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

function targetFilterLabel(target: RiverTarget): string {
  if (target.kind === 'public') return 'Public';
  if (target.kind === 'group') return target.label;
  return target.callsign ?? target.label;
}

export default function RiverReader({ active = true, onOpenItem, onActionFeedback }: RiverReaderProps) {
  const { theme } = useTheme();
  const [scope, setScope] = useState<RiverTimelineScope>('private');
  const [items, setItems] = useState<RiverTimelineItem[]>([]);
  const [targets, setTargets] = useState<RiverTarget[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
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
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '18px 24px 12px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <SidebarRiverIcon color={theme.accent} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '16px', lineHeight: 1.2, fontWeight: 700 }}>River</div>
            <div style={{ color: theme.textSecondary, fontSize: '12px', marginTop: '2px' }}>Timeline</div>
          </div>
        </div>
        <div role="tablist" aria-label="River timeline scope" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                  height: '30px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: `1px solid ${selected ? theme.accent : theme.border}`,
                  backgroundColor: selected ? (theme.surface2 ?? theme.bg) : 'transparent',
                  color: selected ? theme.text : theme.textSecondary,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 650,
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
              height: '30px',
              padding: '0 10px',
              borderRadius: '6px',
              border: `1px solid ${theme.border}`,
              backgroundColor: 'transparent',
              color: theme.textSecondary,
              opacity: 0.52,
              cursor: 'not-allowed',
              fontSize: '12px',
              fontWeight: 650,
            }}
          >
            For You
          </button>
        </div>
      </div>

      {scope === 'private' && sourceTargets.length > 0 && (
        <div
          aria-label="River source filters"
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 24px',
            borderBottom: `1px solid ${theme.border}`,
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            aria-pressed={selectedSourceIds.length === 0}
            onClick={() => setSelectedSourceIds([])}
            style={{
              height: '26px',
              padding: '0 9px',
              borderRadius: '999px',
              border: `1px solid ${selectedSourceIds.length === 0 ? theme.accent : theme.border}`,
              backgroundColor: selectedSourceIds.length === 0 ? (theme.surface2 ?? theme.bg) : 'transparent',
              color: selectedSourceIds.length === 0 ? theme.text : theme.textSecondary,
              cursor: 'pointer',
              fontSize: '11px',
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
                  height: '26px',
                  padding: '0 9px',
                  borderRadius: '999px',
                  border: `1px solid ${selected ? theme.accent : theme.border}`,
                  backgroundColor: selected ? (theme.surface2 ?? theme.bg) : 'transparent',
                  color: selected ? theme.text : theme.textSecondary,
                  cursor: 'pointer',
                  fontSize: '11px',
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

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 32px' }}>
        {loading ? (
          <div style={{ color: theme.textSecondary, fontSize: '13px' }}>Loading River...</div>
        ) : error ? (
          <div role="alert" style={{ color: theme.textSecondary, fontSize: '13px' }}>{error}</div>
        ) : items.length === 0 ? (
          <div style={{ color: theme.textSecondary, fontSize: '13px' }}>
            {scope === 'public' ? 'No public River items yet.' : 'No private River items yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '760px' }}>
            {items.map((item) => (
              <article
                key={item.documentId}
                style={{
                  borderRadius: '7px',
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.surface1 ?? theme.bg,
                  padding: '12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenItem?.(item)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: theme.text,
                    padding: 0,
                    textAlign: 'left',
                    cursor: item.cachePath ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.28 }}>{item.title}</div>
                  <div style={{ marginTop: '5px', color: theme.textSecondary, fontSize: '12px', lineHeight: 1.45 }}>
                    {item.excerpt || 'No preview available.'}
                  </div>
                </button>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginTop: '10px',
                    color: theme.textSecondary,
                    fontSize: '11px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[item.authorCallsign ?? item.authorInitials, sourceLabel(item), formatRiverTime(item.sharedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <button type="button" onClick={() => void copyItem(item)} style={{ border: 'none', background: 'transparent', color: theme.textSecondary, cursor: 'pointer', fontSize: '11px' }}>Copy</button>
                    <button type="button" disabled={!item.cachePath} onClick={() => void pinItem(item)} style={{ border: 'none', background: 'transparent', color: item.pinned ? theme.accent : theme.textSecondary, cursor: item.cachePath ? 'pointer' : 'not-allowed', fontSize: '11px' }}>
                      {item.pinned ? 'Bookmarked' : 'Bookmark'}
                    </button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
