import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ContentToolbar from './ContentToolbar';

type SharedFilesClient = NonNullable<Window['sharedFilesAPI']>;
type RiverTimelineItem = Awaited<ReturnType<SharedFilesClient['getTimeline']>>[number];
type RiverTimelineScope = Parameters<SharedFilesClient['getTimeline']>[0]['scope'];
type RiverTarget = Awaited<ReturnType<SharedFilesClient['getTargets']>>[number];
type SharedFilesAvailability = Awaited<ReturnType<SharedFilesClient['getAvailability']>>;
const OLD_RIVER_SOURCE_ID = 'legacy:old-river';
const OLD_RIVER_TARGET: RiverTarget = {
  id: OLD_RIVER_SOURCE_ID,
  kind: 'group',
  targetId: 'old-river',
  label: 'Old River',
  detail: 'Legacy team docs',
  status: 'accepted',
  committable: false,
  recipientUserIds: [],
  tint: '#9b7a4f',
};

type RiverReaderColors = {
  bg: string;
  body: string;
  chrome: string;
  faint: string;
  line: string;
  muted: string;
  panel: string;
  panelTint: string;
  text: string;
};

interface RiverReaderProps {
  active?: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  isFullScreen?: boolean;
  onOpenItem?: (item: RiverTimelineItem) => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onToggleFullScreen?: () => void;
  onActionFeedback?: (message: string) => void;
  onNavigateToSignIn?: () => void;
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
  if (item.sourceKind === 'legacy') return 'Old River';
  if (item.sourceKind === 'public') return 'Public';
  if (item.sourceKind === 'mine') return 'Mine';
  if (item.sourceKind === 'group') return 'Group';
  if (item.sourceKind === 'person') return 'Person';
  return 'River';
}

function sourceDotColor(item: RiverTimelineItem, accent: string): string {
  if (item.sourceKind === 'legacy') return '#9b7a4f';
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

function targetFilterDetail(target: RiverTarget): string | null {
  if (target.kind === 'group') return target.detail ?? 'Group';
  if (target.kind === 'person') return target.detail ?? target.callsign ?? null;
  return target.detail ?? null;
}

function authorInitials(item: RiverTimelineItem): string {
  const raw = item.authorInitials || item.authorCallsign || 'R';
  const letters = raw.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return letters || 'R';
}

function authorLabel(item: RiverTimelineItem): string {
  if (item.authorInitials) return item.authorInitials;
  if (item.authorCallsign) return item.authorCallsign;
  return 'River';
}

function itemBodyText(item: RiverTimelineItem): string {
  const content = item.content?.trim();
  if (content) return content;
  return item.excerpt?.trim() || 'No preview available.';
}

function shouldClampBody(item: RiverTimelineItem): boolean {
  const body = itemBodyText(item);
  return body.length > 260 || body.split(/\n/).length > 4;
}

function normalizeRiverToken(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function targetMatchesTimelineItem(target: RiverTarget, item: RiverTimelineItem): boolean {
  if (target.id === OLD_RIVER_SOURCE_ID) return item.sourceKind === 'legacy';
  if (target.kind === 'public') return item.public;
  if (target.kind === 'person') {
    if (item.authorUserId && (item.authorUserId === target.targetId || target.recipientUserIds.includes(item.authorUserId))) {
      return true;
    }
    const targetCallsign = normalizeRiverToken(target.callsign);
    const itemCallsign = normalizeRiverToken(item.authorCallsign);
    if (targetCallsign && itemCallsign && targetCallsign === itemCallsign) return true;
    const targetInitials = normalizeRiverToken(target.initials);
    const itemInitials = normalizeRiverToken(item.authorInitials);
    if (targetInitials && itemInitials && targetInitials === itemInitials) return true;
    const targetText = normalizeRiverToken(`${target.label} ${target.detail ?? ''}`);
    return Boolean(itemCallsign.length >= 3 && targetText.includes(itemCallsign));
  }
  const targetLabel = normalizeRiverToken(target.label);
  const source = normalizeRiverToken(item.sourceLabel);
  return Boolean(targetLabel && source && (targetLabel === source || targetLabel.includes(source) || source.includes(targetLabel)));
}

function riverActionStyle(color: string): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: 1,
    padding: 0,
  };
}

function sourceAccent(target: RiverTarget, fallback: string): string {
  if (target.tint) return target.tint;
  if (target.kind === 'group') return '#79a585';
  if (target.kind === 'person') return '#6f8fb0';
  return fallback;
}

function sourceInitials(target: RiverTarget): string {
  const raw = target.initials || target.callsign || target.label || '?';
  const letters = raw.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return letters || '?';
}

function RiverNavigationButton({
  label,
  disabled,
  onClick,
  direction,
  textSecondary,
}: {
  label: string;
  disabled: boolean;
  onClick?: () => void;
  direction: 'back' | 'forward';
  textSecondary: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: '22px',
        height: '24px',
        padding: 0,
        color: textSecondary,
        backgroundColor: 'transparent',
        border: 'none',
        borderRadius: '4px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.32 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        {direction === 'back' ? (
          <path d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" />
        ) : (
          <path d="M5.646 3.146a.5.5 0 0 0 0 .708L9.793 8l-4.147 4.146a.5.5 0 0 0 .708.708l4.5-4.5a.5.5 0 0 0 0-.708l-4.5-4.5a.5.5 0 0 0-.708 0z" />
        )}
      </svg>
    </button>
  );
}

function BookmarkActionIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path
        d="M4.25 2.75h7.5v10.5L8 10.9l-3.75 2.35V2.75z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RiverSourceRow({
  accent,
  colors,
  included,
  isDark,
  target,
  onToggle,
}: {
  accent: string;
  colors: RiverReaderColors;
  included: boolean;
  isDark: boolean;
  target: RiverTarget;
  onToggle: (targetId: string) => void;
}) {
  const isPerson = target.kind === 'person';
  return (
    <button
      type="button"
      onClick={() => onToggle(target.id)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        border: 'none',
        borderRadius: '7px',
        backgroundColor: 'transparent',
        color: included ? colors.text : colors.faint,
        cursor: 'pointer',
        opacity: included ? 1 : 0.48,
        padding: isPerson ? '6px 8px' : '7px 8px',
        textAlign: 'left',
      }}
    >
      {isPerson ? (
        <span
          aria-hidden="true"
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: included ? '#e9e5f2' : '#efeee8',
            color: included ? '#5a4b86' : colors.faint,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '9.5px',
            fontWeight: 700,
            flex: '0 0 auto',
          }}
        >
          {sourceInitials(target)}
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: included ? sourceAccent(target, accent) : 'transparent',
            border: included ? 'none' : `1.5px solid ${colors.faint}`,
            flex: '0 0 auto',
          }}
        />
      )}
      <span style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13.5px' }}>
        {isPerson ? (target.label || target.callsign || 'River contact') : targetFilterLabel(target)}
      </span>
      {isPerson && target.callsign ? (
        <span style={{
          borderRadius: '4px',
          backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : '#ece9e2',
          color: included ? (isDark ? 'rgba(255,255,255,0.66)' : '#79766d') : colors.faint,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '9.5px',
          padding: '1px 6px',
          flex: '0 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {target.callsign}
        </span>
      ) : targetFilterDetail(target) ? (
        <span style={{ color: included ? colors.muted : colors.faint, fontSize: '11px', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {targetFilterDetail(target)}
        </span>
      ) : null}
    </button>
  );
}

function RiverSourceRail({
  accent,
  activeSourceSet,
  colors,
  groups,
  isDark,
  people,
  onClose,
  onToggleSource,
}: {
  accent: string;
  activeSourceSet: ReadonlySet<string>;
  colors: RiverReaderColors;
  groups: RiverTarget[];
  isDark: boolean;
  people: RiverTarget[];
  onClose: () => void;
  onToggleSource: (targetId: string) => void;
}) {
  const sections = [
    ['GROUPS', groups],
    ['PEOPLE', people],
  ] as const;

  return (
    <aside
      aria-label="River source filters"
      style={{
        position: 'sticky',
        top: '8px',
        borderLeft: `1px solid ${colors.line}`,
        backgroundColor: colors.panelTint,
        padding: '28px 0 28px 20px',
        minHeight: '420px',
        width: 'min(100%, 340px)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
        <div style={{ fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif', fontSize: '15px', color: colors.body }}>
          Showing
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            backgroundColor: 'transparent',
            color: accent,
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 650,
            padding: 0,
          }}
        >
          Done
        </button>
      </div>
      <div style={{ color: colors.muted, fontSize: '12px', lineHeight: 1.45, marginBottom: '14px' }}>
        Click a source to include or hide it from your private River.
      </div>

      <RiverSourceRow
        accent={accent}
        colors={colors}
        included={activeSourceSet.has(OLD_RIVER_SOURCE_ID)}
        isDark={isDark}
        target={OLD_RIVER_TARGET}
        onToggle={onToggleSource}
      />

      {sections.map(([label, sectionTargets]) => sectionTargets.length > 0 && (
        <div key={label} style={{ marginTop: label === 'PEOPLE' ? '15px' : 0 }}>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '10px', letterSpacing: '0.12em', color: colors.muted, padding: '0 0 7px' }}>
            {label}
          </div>
          {sectionTargets.map((target) => (
            <RiverSourceRow
              key={target.id}
              accent={accent}
              colors={colors}
              included={activeSourceSet.has(target.id)}
              isDark={isDark}
              target={target}
              onToggle={onToggleSource}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}

export default function RiverReader({
  active = true,
  canNavigateBack = false,
  canNavigateForward = false,
  isFullScreen = false,
  onOpenItem,
  onNavigateBack,
  onNavigateForward,
  onToggleFullScreen,
  onActionFeedback,
  onNavigateToSignIn,
}: RiverReaderProps) {
  const { theme } = useTheme();
  const [scope, setScope] = useState<RiverTimelineScope>('private');
  const [membershipRevision, setMembershipRevision] = useState(0);
  const [items, setItems] = useState<RiverTimelineItem[]>([]);
  const [targets, setTargets] = useState<RiverTarget[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<SharedFilesAvailability | null>(null);
  const hasLoadedRef = useRef(false);
  const requestSequence = useRef(0);

  const sourceTargets = useMemo(() => (
    targets.filter((target) => target.status === 'accepted' && target.kind !== 'public')
  ), [targets]);
  const filterTargets = useMemo(() => (
    [...sourceTargets, OLD_RIVER_TARGET]
  ), [sourceTargets]);
  const activeSourceIds = useMemo(() => (
    selectedSourceIds.length === 0 ? filterTargets.map((target) => target.id) : selectedSourceIds
  ), [filterTargets, selectedSourceIds]);
  const activeSourceSet = useMemo(() => new Set(activeSourceIds), [activeSourceIds]);
  const groupedSourceTargets = useMemo(() => ({
    groups: sourceTargets.filter((target) => target.kind === 'group'),
    people: sourceTargets.filter((target) => target.kind === 'person'),
  }), [sourceTargets]);
  const visibleItems = useMemo(() => {
    if (scope !== 'private' || selectedSourceIds.length === 0) return items;
    const hiddenTargets = filterTargets.filter((target) => !activeSourceSet.has(target.id));
    if (hiddenTargets.length === 0) return items;
    return items.filter((item) => hiddenTargets.every((target) => !targetMatchesTimelineItem(target, item)));
  }, [activeSourceSet, filterTargets, items, scope, selectedSourceIds.length]);
  const privateSourceSummary = useMemo(() => {
    if (scope === 'public') return 'Public timeline';
    if (filterTargets.length === 0) return 'All private';
    if (selectedSourceIds.length === 0) return `${visibleItems.length} documents · all private sources`;
    return `${visibleItems.length} documents · ${selectedSourceIds.length} of ${filterTargets.length} sources`;
  }, [filterTargets.length, scope, selectedSourceIds.length, visibleItems.length]);
  const timelineSourceIds = useMemo(() => (
    scope === 'private' ? selectedSourceIds : []
  ), [scope, selectedSourceIds]);
  const riverColors = theme.isDark
    ? {
      bg: theme.bg,
      body: theme.textSecondary,
      chrome: theme.surface1 ?? theme.bg,
      faint: theme.textSecondary,
      line: theme.border,
      muted: theme.textSecondary,
      panel: theme.surface1 ?? theme.bg,
      panelTint: 'rgba(255,255,255,0.04)',
      text: theme.text,
    }
    : {
      bg: '#faf9f6',
      body: '#4a4842',
      chrome: '#f3f1ea',
      faint: '#b4b1a8',
      line: '#eceae3',
      muted: '#8c897f',
      panel: '#fbfbfa',
      panelTint: '#f6f4ee',
      text: '#1d1c1a',
    };

  useEffect(() => {
    const invalidate = () => {
      // Invalidate before React renders again, so a response already queued on
      // the old account or membership cannot restore its cards.
      requestSequence.current += 1;
      hasLoadedRef.current = false;
      setItems([]);
      setTargets([]);
      setAvailability(null);
      setSelectedSourceIds([]);
      setExpandedItemIds([]);
      setError(null);
      setMembershipRevision((revision) => revision + 1);
    };
    const unsubscribeTeam = window.teamAPI?.onTeamChanged?.(invalidate);
    const unsubscribeAuth = window.authAPI?.onSessionChanged?.(invalidate);
    return () => {
      requestSequence.current += 1;
      unsubscribeTeam?.();
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    if (availability?.publicAllowed !== true && scope === 'public') setScope('private');
  }, [availability?.publicAllowed, scope]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const sequence = ++requestSequence.current;
    let loadingTimeline = false;
    let queued = false;
    const refresh = async () => {
      if (cancelled || sequence !== requestSequence.current) return;
      if (loadingTimeline) { queued = true; return; }
      loadingTimeline = true;
      try {
        do {
          queued = false;
          const nextItems = await window.sharedFilesAPI?.getTimeline?.({ scope, sourceIds: timelineSourceIds, limit: 50 });
          if (cancelled || sequence !== requestSequence.current) return;
          setItems(nextItems ?? []);
          hasLoadedRef.current = true;
          setError(null);
          setLoading(false);
        } while (queued && !cancelled);
      } catch (err) {
        if (!cancelled && sequence === requestSequence.current) {
          console.warn('[RiverReader] timeline load failed:', err);
          setError('River timeline could not load. Cached River files remain available in the sidebar.');
          setLoading(false);
        }
      } finally {
        loadingTimeline = false;
      }
    };
    // Subscribe before the initial read so a share arriving during it is not lost.
    const unsubscribe = window.sharedFilesAPI?.onTimelineChanged?.(() => { void refresh(); });
    const unsubscribePins = window.sharedFilesAPI?.onPinsChanged?.(() => { void refresh(); });
    setLoading(!hasLoadedRef.current);
    void refresh();
    return () => {
      cancelled = true;
      unsubscribe?.();
      unsubscribePins?.();
    };
  }, [active, scope, timelineSourceIds, membershipRevision]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const sequence = requestSequence.current;
    // Destination/account metadata must never hold up the document stream.
    void window.sharedFilesAPI?.getTargets?.('').then((next) => {
      if (!cancelled && sequence === requestSequence.current) setTargets(next ?? []);
    }).catch((err) => console.warn('[RiverReader] targets load failed:', err));
    void window.sharedFilesAPI?.getAvailability?.().then((next) => {
      if (!cancelled && sequence === requestSequence.current) setAvailability(next);
    }).catch((err) => console.warn('[RiverReader] availability load failed:', err));
    return () => { cancelled = true; };
  }, [active, membershipRevision]);

  const toggleSource = (targetId: string) => {
    const allSourceIds = filterTargets.map((target) => target.id);
    setSelectedSourceIds((current) => {
      const next = (current.length === 0
        ? allSourceIds.filter((id) => id !== targetId)
        : current.includes(targetId)
          ? current.filter((id) => id !== targetId)
          : [...current, targetId]
      ).filter((id, index, ids) => ids.indexOf(id) === index);
      return next.length === 0 || next.length === allSourceIds.length ? [] : next;
    });
  };

  const toggleExpanded = (documentId: string) => {
    setExpandedItemIds((current) => (
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    ));
  };

  const copyItem = async (item: RiverTimelineItem) => {
    const text = [item.title, itemBodyText(item)].filter(Boolean).join('\n\n');
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

  const shouldShowSignInPrompt = scope === 'private'
    && visibleItems.length === 0
    && availability?.available === false
    && availability.reason === 'not_authenticated';

  return (
    <div
      data-ft-river-reader="true"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: riverColors.bg,
        color: riverColors.text,
      }}
    >
      <div
        data-fieldtheory-river-toolbar="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 30px 10px 44px',
          backgroundColor: riverColors.chrome,
          borderBottom: `1px solid ${riverColors.line}`,
          flexShrink: 0,
          minHeight: '46px',
        }}
      >
        <div
          aria-label="River location"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
            <RiverNavigationButton
              label="Back"
              disabled={!canNavigateBack}
              onClick={onNavigateBack}
              direction="back"
              textSecondary={theme.textSecondary}
            />
            <RiverNavigationButton
              label="Forward"
              disabled={!canNavigateForward}
              onClick={onNavigateForward}
              direction="forward"
              textSecondary={theme.textSecondary}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              fontSize: '11px',
              color: riverColors.muted,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: riverColors.text, fontWeight: 600 }}>River</span>
          </div>
        </div>
        {onToggleFullScreen && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <ContentToolbar
            isFullScreen={isFullScreen}
            onToggleFullScreen={onToggleFullScreen}
            forceVisibleActions={['immersive']}
            dragSpacer={false}
            showCopy={false}
            showFolder={false}
            showDelete={false}
          />
        </div>
        )}
      </div>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '40px clamp(28px, 6vw, 76px) 52px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '1180px',
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '34px',
            justifyContent: 'center',
            alignItems: 'start',
          }}
        >
          <section style={{ flex: '1 1 680px', maxWidth: '780px', minWidth: 0, position: 'relative' }}>
          <button
            type="button"
            aria-label="Edit River sources"
            onClick={() => setFiltersOpen((current) => !current)}
            style={{
              position: 'absolute',
              top: '8px',
              right: 0,
              height: '32px',
              padding: '0 12px',
              borderRadius: '10px',
              border: `1px solid ${riverColors.line}`,
              backgroundColor: riverColors.panel,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: riverColors.body,
              fontSize: '12.5px',
              fontWeight: 650,
            }}
          >
            Sources
          </button>

          <h1
            style={{
              margin: 0,
              textAlign: 'center',
              fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif',
              fontSize: '46px',
              lineHeight: 1.04,
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
              gap: '26px',
              marginTop: '22px',
              borderBottom: `1px solid ${riverColors.line}`,
            }}
          >
            {([
              ['private', 'Private'],
              ['public', 'Public'],
            ] as const).filter(([id]) => id !== 'public' || availability?.publicAllowed === true).map(([id, label]) => {
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
                    color: selected ? riverColors.text : riverColors.muted,
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
          </div>

          <div style={{ textAlign: 'center', color: riverColors.muted, fontSize: '12.5px', marginTop: '14px' }}>
            {privateSourceSummary}
          </div>

          <div style={{ marginTop: '18px' }}>
            {loading ? (
              <div style={{ color: riverColors.muted, fontSize: '13px', padding: '28px 0', textAlign: 'center' }}>Loading River...</div>
            ) : error ? (
              <div role="alert" style={{ color: riverColors.muted, fontSize: '13px', padding: '28px 0', textAlign: 'center' }}>{error}</div>
            ) : shouldShowSignInPrompt ? (
              <div
                style={{
                  color: riverColors.muted,
                  fontSize: '13px',
                  padding: '30px 0',
                  textAlign: 'center',
                }}
              >
                <div style={{ color: riverColors.text, fontSize: '15px', fontWeight: 650, marginBottom: '8px' }}>
                  Sign in to sync River
                </div>
                <div style={{ maxWidth: '360px', margin: '0 auto 16px', lineHeight: 1.5 }}>
                  Cached River files remain available in the sidebar. Sign in to load your private River timeline and sources.
                </div>
                <button
                  type="button"
                  onClick={onNavigateToSignIn}
                  style={{
                    height: '34px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    border: `1px solid ${theme.accent}`,
                    backgroundColor: theme.accent,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '12.5px',
                    fontWeight: 650,
                  }}
                >
                  Sign in
                </button>
              </div>
            ) : visibleItems.length === 0 ? (
              <div style={{ color: riverColors.muted, fontSize: '13px', padding: '28px 0', textAlign: 'center' }}>
                {scope === 'public' ? 'No public River items yet.' : 'No private River items yet.'}
              </div>
            ) : (
              <div>
                {visibleItems.map((item) => (
                  <article
                    key={item.documentId}
                    style={{
                      display: 'flex',
                      gap: '13px',
                      padding: '28px 0',
                      borderBottom: `1px solid ${riverColors.line}`,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '50%',
                        backgroundColor: theme.isDark ? (theme.surface2 ?? theme.bg) : '#e9e5f2',
                        color: theme.isDark ? theme.textSecondary : '#5a4b86',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10.5px',
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
                            <span style={{ fontSize: '14px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorLabel(item)}</span>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: riverColors.muted, fontSize: '12.5px', marginTop: '4px' }}>
                            <span aria-hidden="true" style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: sourceDotColor(item, theme.accent), flex: '0 0 auto' }} />
                            <span>{sourceLabel(item)} · {formatRiverTime(item.sharedAt)}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: riverColors.muted, fontSize: '12px', flex: '0 0 auto' }}>
                          <button type="button" title="Copy" aria-label={`Copy ${item.title}`} onClick={() => void copyItem(item)} style={riverActionStyle(riverColors.muted)}>⧉</button>
                          <button type="button" title="Open" aria-label={`Open ${item.title}`} disabled={!item.cachePath} onClick={() => onOpenItem?.(item)} style={{ ...riverActionStyle(riverColors.muted), cursor: item.cachePath ? 'pointer' : 'not-allowed', opacity: item.cachePath ? 1 : 0.42 }}>↗</button>
                          <button type="button" aria-label={`${item.pinned ? 'Remove bookmark for' : 'Bookmark'} ${item.title}`} disabled={!item.cachePath} onClick={() => void pinItem(item)} style={{ border: 'none', background: 'transparent', color: item.pinned ? theme.accent : riverColors.muted, cursor: item.cachePath ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                            <BookmarkActionIcon filled={Boolean(item.pinned)} />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(item)}
                        style={{
                          display: 'block',
                          width: '100%',
                          marginTop: '12px',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: riverColors.text,
                          textAlign: 'left',
                          cursor: item.cachePath ? 'pointer' : 'default',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: '"Newsreader", "Iowan Old Style", Georgia, serif',
                            fontSize: '27px',
                            lineHeight: 1.2,
                            fontWeight: 500,
                          }}
                        >
                          {item.title}
                        </div>
                        <div
                          style={{
                            marginTop: '8px',
                            color: riverColors.body,
                            fontSize: '15px',
                            lineHeight: 1.65,
                            display: expandedItemIds.includes(item.documentId) ? 'block' : '-webkit-box',
                            WebkitLineClamp: expandedItemIds.includes(item.documentId) ? undefined : 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            whiteSpace: expandedItemIds.includes(item.documentId) ? 'pre-wrap' : 'normal',
                          }}
                        >
                          {expandedItemIds.includes(item.documentId) ? itemBodyText(item) : (item.excerpt || itemBodyText(item))}
                        </div>
                      </button>
                      {shouldClampBody(item) && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.documentId)}
                          style={{
                            marginTop: '9px',
                            border: 'none',
                            background: 'transparent',
                            color: theme.accent,
                            cursor: 'pointer',
                            fontSize: '12.5px',
                            padding: 0,
                          }}
                        >
                          {expandedItemIds.includes(item.documentId) ? 'Collapse ▴' : 'Show more ▾'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          </section>
          {filtersOpen && scope === 'private' && sourceTargets.length > 0 && (
            <RiverSourceRail
              accent={theme.accent}
              activeSourceSet={activeSourceSet}
              colors={riverColors}
              groups={groupedSourceTargets.groups}
              isDark={theme.isDark}
              people={groupedSourceTargets.people}
              onClose={() => setFiltersOpen(false)}
              onToggleSource={toggleSource}
            />
          )}
        </div>
      </main>
    </div>
  );
}
