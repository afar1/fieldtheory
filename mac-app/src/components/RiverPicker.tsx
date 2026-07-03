import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getRiverPickerTokens, type RiverPickerTokens } from './RiverTokens';

export type RiverPickerSurface = 'palette' | 'popover' | 'inline';
export type RiverPickerIntent = 'share' | 'source' | 'defaults';
export type RiverPickerStatus = 'ready' | 'loading' | 'offline' | 'error';
export type RiverPickerFooterMode = 'commit' | 'none';
export type RiverPickerTargetKind = 'public' | 'group' | 'person';
export type RiverPickerTargetStatus = 'accepted' | 'pending' | 'unavailable';

export interface RiverPickerTarget {
  id: string;
  kind: RiverPickerTargetKind;
  label: string;
  detail?: string | null;
  callSign?: string | null;
  initials?: string | null;
  avatarUrl?: string | null;
  tint?: string | null;
  status?: RiverPickerTargetStatus;
}

export interface RiverPickerProps {
  targets: readonly RiverPickerTarget[];
  selectedIds: readonly string[];
  defaultIds?: readonly string[];
  staleDefaultIds?: readonly string[];
  surface?: RiverPickerSurface;
  intent?: RiverPickerIntent;
  status?: RiverPickerStatus;
  footerMode?: RiverPickerFooterMode;
  disabled?: boolean;
  commitError?: string | null;
  errorMessage?: string | null;
  emptyLabel?: string;
  loadingLabel?: string;
  offlineLabel?: string;
  pendingOnlyLabel?: string;
  placeholder?: string;
  commitLabel?: string;
  showSelectAll?: boolean;
  onToggleTarget: (targetId: string, target: RiverPickerTarget) => void;
  onCommit?: (targetIds: string[]) => void;
  onDefaultChange?: (targetIds: string[]) => void;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function targetIsAccepted(target: RiverPickerTarget): boolean {
  return (target.status ?? 'accepted') === 'accepted';
}

function targetMatches(target: RiverPickerTarget, query: string): boolean {
  if (!query) return true;
  const haystack = [
    target.label,
    target.detail,
    target.callSign,
    target.initials,
    target.kind,
  ].map(normalize).join(' ');
  return haystack.includes(query);
}

function optionId(baseId: string, targetId: string): string {
  return `${baseId}-${targetId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function targetKindPriority(kind: RiverPickerTargetKind): number {
  if (kind === 'group') return 0;
  if (kind === 'person') return 1;
  return 2;
}

function defaultLabelForIntent(intent: RiverPickerIntent): string {
  if (intent === 'source') return 'Save sources';
  if (intent === 'defaults') return 'Save defaults';
  return 'Share to River';
}

function statusLabelForTarget(target: RiverPickerTarget): string {
  const status = target.status ?? 'accepted';
  if (status === 'pending') return 'Pending';
  if (status === 'unavailable') return 'Unavailable';
  if (target.kind === 'public') return target.detail ?? 'Visible to entitled users';
  return target.detail ?? '';
}

function getInitials(target: RiverPickerTarget): string {
  if (target.kind === 'public') return 'PB';
  if (target.initials?.trim()) return target.initials.trim().slice(0, 3).toUpperCase();
  return target.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

function getStyles(tokens: RiverPickerTokens, surface: RiverPickerSurface) {
  const compact = surface === 'inline';
  return {
    shell: {
      width: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
      padding: surface === 'palette' ? '0' : surface === 'popover' ? '0' : '0',
      borderRadius: surface === 'inline' ? '0' : surface === 'palette' ? '14px' : '12px',
      border: surface === 'inline' ? 'none' : `1px solid ${tokens.border}`,
      backgroundColor: surface === 'inline' ? 'transparent' : tokens.surface,
      boxShadow: surface === 'palette' ? tokens.shadow : 'none',
      overflow: surface === 'inline' ? 'visible' : 'hidden',
      boxSizing: 'border-box' as const,
    },
    searchHeader: {
      minHeight: compact ? '44px' : '52px',
      display: 'flex',
      alignItems: 'center',
      gap: compact ? '8px' : '10px',
      padding: surface === 'popover' ? '12px 14px' : compact ? '8px 0' : '15px 16px',
      borderBottom: surface === 'inline' ? 'none' : `1px solid ${tokens.subtleBorder}`,
      boxSizing: 'border-box' as const,
    },
    glyph: {
      color: tokens.accent,
      fontSize: compact ? '14px' : '15px',
      lineHeight: 1,
      flex: '0 0 auto',
    },
    input: {
      height: '24px',
      width: '100%',
      border: 'none',
      backgroundColor: 'transparent',
      color: tokens.text,
      padding: 0,
      fontSize: surface === 'popover' ? '13.5px' : '15px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    },
    selectAllButton: {
      border: 'none',
      background: 'transparent',
      color: tokens.accent,
      cursor: 'pointer',
      fontSize: '11.5px',
      padding: 0,
      whiteSpace: 'nowrap' as const,
    },
    banner: {
      margin: surface === 'inline' ? '0 0 8px' : '8px 12px 0',
      borderRadius: '8px',
      padding: '8px 10px',
      border: `1px solid ${tokens.subtleBorder}`,
      backgroundColor: tokens.softBackground,
      color: tokens.mutedText,
      fontSize: '12px',
      lineHeight: 1.4,
    },
    errorBanner: {
      borderColor: tokens.danger,
      backgroundColor: tokens.dangerBackground,
      color: tokens.danger,
    },
    list: {
      minHeight: compact ? '48px' : '96px',
      maxHeight: surface === 'palette' ? '292px' : '280px',
      overflowY: 'auto' as const,
      backgroundColor: tokens.surface,
      padding: surface === 'inline' ? '0' : surface === 'popover' ? '6px 10px' : '8px',
    },
    empty: {
      padding: '14px',
      color: tokens.mutedText,
      fontSize: '12px',
      lineHeight: 1.4,
    },
    row: {
      width: '100%',
      minHeight: compact ? '38px' : '42px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: compact ? '8px' : '11px',
      padding: compact ? '6px 7px' : '8px 9px',
      border: 'none',
      borderRadius: '9px',
      textAlign: 'left' as const,
      color: tokens.text,
      backgroundColor: 'transparent',
      cursor: 'pointer',
      boxSizing: 'border-box' as const,
    },
    identity: {
      minWidth: 0,
      display: 'flex',
      alignItems: 'center',
      gap: compact ? '8px' : '11px',
    },
    avatar: {
      width: compact ? '23px' : '24px',
      height: compact ? '23px' : '24px',
      flex: compact ? '0 0 23px' : '0 0 24px',
      borderRadius: '999px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: tokens.accent,
      backgroundColor: tokens.groupBackground,
      fontSize: '9px',
      fontWeight: 700,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      overflow: 'hidden',
    },
    labelStack: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '2px',
    },
    labelLine: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minWidth: 0,
    },
    label: {
      fontSize: compact ? '13px' : '14px',
      fontWeight: 500,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    detail: {
      fontSize: '11.5px',
      color: tokens.mutedText,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    badge: {
      flexShrink: 0,
      borderRadius: '4px',
      border: 'none',
      backgroundColor: tokens.badgeBackground,
      color: tokens.mutedText,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: '9.5px',
      fontWeight: 500,
      padding: '1px 6px',
      lineHeight: 1.4,
    },
    actions: {
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    checkbox: {
      width: surface === 'popover' ? '18px' : '19px',
      height: surface === 'popover' ? '18px' : '19px',
      borderRadius: '6px',
      border: `1.5px solid ${tokens.checkboxBorder}`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '10px',
      fontWeight: 700,
      boxSizing: 'border-box' as const,
    },
    defaultButton: {
      borderRadius: '5px',
      border: 'none',
      backgroundColor: tokens.accentSoft,
      color: tokens.accent,
      fontSize: '10px',
      fontWeight: 500,
      padding: '1px 7px',
      cursor: 'pointer',
    },
    footer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '14px',
      minHeight: compact ? '34px' : '42px',
      padding: surface === 'inline' ? '8px 0 0' : surface === 'popover' ? '9px 14px 10px' : '9px 16px',
      borderTop: surface === 'inline' ? 'none' : `1px solid ${tokens.subtleBorder}`,
      boxSizing: 'border-box' as const,
    },
    footerHint: {
      color: tokens.mutedText,
      fontSize: '11.5px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexWrap: 'wrap' as const,
    },
    kbd: {
      borderRadius: '4px',
      border: `1px solid ${tokens.subtleBorder}`,
      color: tokens.keyText,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: '11px',
      padding: '1px 5px',
      lineHeight: 1.35,
    },
    commitHint: {
      marginLeft: 'auto',
      color: tokens.accent,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      whiteSpace: 'nowrap' as const,
    },
    commitButton: {
      height: '32px',
      borderRadius: '9px',
      border: `1px solid ${tokens.accent}`,
      backgroundColor: tokens.accent,
      color: tokens.accentText,
      padding: '0 12px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: 650,
    },
  };
}

export default function RiverPicker({
  targets,
  selectedIds,
  defaultIds = [],
  staleDefaultIds = [],
  surface = 'popover',
  intent = 'share',
  status = 'ready',
  footerMode = 'commit',
  disabled = false,
  commitError = null,
  errorMessage = null,
  emptyLabel = 'No River targets yet.',
  loadingLabel = 'Loading River targets...',
  offlineLabel = 'Offline. Cached River content stays readable, but new commits are disabled.',
  pendingOnlyLabel = 'No accepted River targets are available yet.',
  placeholder = 'Search River targets',
  commitLabel,
  showSelectAll = false,
  onToggleTarget,
  onCommit,
  onDefaultChange,
}: RiverPickerProps) {
  const { theme } = useTheme();
  const tokens = getRiverPickerTokens(theme);
  const styles = getStyles(tokens, surface);
  const reactId = useId();
  const baseId = `river-picker-${reactId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const defaultSet = useMemo(() => new Set(defaultIds), [defaultIds]);
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const normalizedQuery = normalize(query);
  const visibleTargets = useMemo(
    () => targets
      .filter((target) => targetMatches(target, normalizedQuery))
      .slice()
      .sort((a, b) => (
        targetKindPriority(a.kind) - targetKindPriority(b.kind)
        || Number(!targetIsAccepted(a)) - Number(!targetIsAccepted(b))
        || a.label.localeCompare(b.label)
      )),
    [targets, normalizedQuery],
  );
  const acceptedSelectedIds = selectedIds.filter((id) => {
    const target = targetById.get(id);
    return target ? targetIsAccepted(target) : false;
  });
  const acceptedTargets = targets.filter(targetIsAccepted);
  const acceptedVisibleTargets = visibleTargets.filter(targetIsAccepted);
  const staleIds = useMemo(() => {
    const ids = [...staleDefaultIds, ...defaultIds.filter((id) => !targetById.has(id))];
    return Array.from(new Set(ids));
  }, [defaultIds, staleDefaultIds, targetById]);
  const activeTarget = visibleTargets.find((target) => target.id === activeId) ?? null;
  const commitDisabled = disabled || status !== 'ready' || acceptedSelectedIds.length === 0 || !onCommit;

  useEffect(() => {
    const firstVisible = visibleTargets[0] ?? null;
    setActiveId((current) => {
      if (current && visibleTargets.some((target) => target.id === current)) return current;
      return firstVisible?.id ?? null;
    });
  }, [visibleTargets]);

  const toggleTarget = (target: RiverPickerTarget) => {
    if (disabled || !targetIsAccepted(target)) return;
    onToggleTarget(target.id, target);
  };

  const commit = () => {
    if (commitDisabled) return;
    onCommit?.(acceptedSelectedIds);
  };

  const moveActive = (direction: 1 | -1) => {
    if (visibleTargets.length === 0) return;
    const currentIndex = Math.max(0, visibleTargets.findIndex((target) => target.id === activeId));
    const nextIndex = Math.min(visibleTargets.length - 1, Math.max(0, currentIndex + direction));
    setActiveId(visibleTargets[nextIndex]?.id ?? null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey || (!normalizedQuery && acceptedSelectedIds.length > 0)) {
        commit();
        return;
      }
      if (activeTarget) toggleTarget(activeTarget);
    }
  };

  const handleDefaultClick = (event: MouseEvent<HTMLButtonElement>, target: RiverPickerTarget) => {
    event.stopPropagation();
    if (!onDefaultChange || !targetIsAccepted(target)) return;
    const nextIds = defaultSet.has(target.id)
      ? defaultIds.filter((id) => id !== target.id)
      : [...defaultIds, target.id];
    onDefaultChange(nextIds);
  };

  const selectAllVisible = () => {
    if (disabled || acceptedVisibleTargets.length === 0) return;
    for (const target of acceptedVisibleTargets) {
      if (!selectedSet.has(target.id)) onToggleTarget(target.id, target);
    }
  };

  const sectionLabelForTarget = (target: RiverPickerTarget): string => (
    target.kind === 'group' ? 'GROUPS' : 'PEOPLE / PUBLIC'
  );

  const renderIdentity = (target: RiverPickerTarget) => {
    const avatarStyle: CSSProperties = {
      ...styles.avatar,
      color: target.kind === 'public' ? '#3a6b65' : target.kind === 'group' ? (target.tint ?? tokens.accent) : tokens.accent,
      backgroundColor: target.kind === 'public' ? '#dff0ee' : target.kind === 'person' ? tokens.successBackground : tokens.groupBackground,
    };

    if (target.avatarUrl) {
      return (
        <span style={avatarStyle}>
          <img src={target.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </span>
      );
    }

    return <span style={avatarStyle}>{target.kind === 'public' ? '🌐' : getInitials(target)}</span>;
  };

  const renderRow = (target: RiverPickerTarget) => {
    const accepted = targetIsAccepted(target);
    const selected = selectedSet.has(target.id);
    const isDefault = defaultSet.has(target.id);
    const active = target.id === activeId;
    const rowStyle: CSSProperties = {
      ...styles.row,
      backgroundColor: active ? tokens.accentSoft : selected ? tokens.softBackground : 'transparent',
      color: accepted ? tokens.text : tokens.mutedText,
      cursor: accepted && !disabled ? 'pointer' : 'not-allowed',
      opacity: accepted ? 1 : 0.68,
    };
    const checkboxStyle: CSSProperties = {
      ...styles.checkbox,
      borderColor: selected ? tokens.accent : tokens.border,
      backgroundColor: selected ? tokens.accent : 'transparent',
      color: tokens.accentText,
    };

    return (
      <div
        key={target.id}
        id={optionId(baseId, target.id)}
        role="option"
        aria-selected={selected}
        aria-disabled={!accepted}
        onMouseEnter={() => setActiveId(target.id)}
        onClick={() => toggleTarget(target)}
        style={rowStyle}
      >
        <span style={styles.identity}>
          {renderIdentity(target)}
          <span style={styles.labelStack}>
            <span style={styles.labelLine}>
              <span style={styles.label}>{target.label}</span>
              {target.callSign && <span style={styles.badge}>{target.callSign}</span>}
            </span>
            {statusLabelForTarget(target) && <span style={styles.detail}>{statusLabelForTarget(target)}</span>}
          </span>
        </span>
        <span style={styles.actions}>
          <button
            type="button"
            aria-label={isDefault ? `Remove ${target.label} default` : `Make ${target.label} default`}
            disabled={!accepted || !onDefaultChange}
            onClick={(event) => handleDefaultClick(event, target)}
            style={{
              ...styles.defaultButton,
              color: isDefault ? tokens.accent : tokens.mutedText,
              cursor: accepted && onDefaultChange ? 'pointer' : 'not-allowed',
              opacity: accepted && onDefaultChange ? 1 : 0.5,
            }}
          >
            {isDefault ? 'default' : 'set default'}
          </button>
          <span aria-hidden="true" style={checkboxStyle}>{selected ? '✓' : ''}</span>
          {!accepted && <span style={styles.badge}>{target.status === 'pending' ? 'pending' : 'unavailable'}</span>}
        </span>
      </div>
    );
  };

  const renderRows = () => {
    let previousSection: string | null = null;
    return visibleTargets.flatMap((target) => {
      const section = sectionLabelForTarget(target);
      const nodes = [];
      if (section !== previousSection) {
        previousSection = section;
        nodes.push(
          <div
            key={`section-${section}-${target.id}`}
            aria-hidden="true"
            style={{
              fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
              fontSize: '9.5px',
              letterSpacing: '0.13em',
              color: tokens.mutedText,
              padding: '8px 9px 4px',
            }}
          >
            {section}
          </div>
        );
      }
      nodes.push(renderRow(target));
      return nodes;
    });
  };

  const renderBody = () => {
    if (status === 'loading') return <div style={styles.empty}>{loadingLabel}</div>;
    if (visibleTargets.length === 0) {
      return <div style={styles.empty}>{normalizedQuery ? 'No River targets match.' : emptyLabel}</div>;
    }
    return renderRows();
  };

  return (
    <div style={styles.shell} data-river-picker-surface={surface} data-river-picker-intent={intent}>
      <div style={styles.searchHeader}>
        <span aria-hidden="true" style={styles.glyph}>≈</span>
        <input
          type="search"
          role="searchbox"
          aria-label="Search River targets"
          aria-controls={`${baseId}-listbox`}
          aria-activedescendant={activeId ? optionId(baseId, activeId) : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || status === 'loading'}
          style={styles.input}
        />
        {showSelectAll && (
          <button
            type="button"
            onClick={selectAllVisible}
            disabled={disabled || acceptedVisibleTargets.length === 0}
            style={{
              ...styles.selectAllButton,
              opacity: disabled || acceptedVisibleTargets.length === 0 ? 0.45 : 1,
              cursor: disabled || acceptedVisibleTargets.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Select all
          </button>
        )}
      </div>

      {staleIds.length > 0 && (
        <div role="status" style={styles.banner}>
          {staleIds.length === 1 ? 'A default River target is stale.' : `${staleIds.length} default River targets are stale.`}
        </div>
      )}
      {status === 'offline' && <div role="status" style={styles.banner}>{offlineLabel}</div>}
      {status === 'error' && (
        <div role="alert" style={{ ...styles.banner, ...styles.errorBanner }}>
          {errorMessage ?? 'Could not load River targets.'}
        </div>
      )}
      {commitError && (
        <div role="alert" style={{ ...styles.banner, ...styles.errorBanner }}>
          {commitError}
        </div>
      )}
      {status === 'ready' && targets.length > 0 && acceptedTargets.length === 0 && (
        <div role="status" style={styles.banner}>{pendingOnlyLabel}</div>
      )}

      <div
        id={`${baseId}-listbox`}
        role="listbox"
        aria-label="River targets"
        aria-activedescendant={activeId ? optionId(baseId, activeId) : undefined}
        style={styles.list}
      >
        {renderBody()}
      </div>

      {footerMode === 'commit' && (
        <div style={styles.footer}>
          <span style={styles.footerHint}>
            <span><span style={styles.kbd}>↵</span> {normalizedQuery ? 'select' : 'share default'}</span>
            <span><span style={styles.kbd}>↑↓</span> navigate</span>
            <span style={styles.commitHint}><span style={{ ...styles.kbd, color: tokens.accent, borderColor: tokens.accent }}>⌘↵</span> {acceptedSelectedIds.length > 1 ? 'Add to Rivers' : 'Add to River'}</span>
          </span>
          <button
            type="button"
            disabled={commitDisabled}
            onClick={commit}
            style={{
              ...styles.commitButton,
              backgroundColor: commitDisabled ? tokens.disabledBackground : tokens.accent,
              borderColor: commitDisabled ? tokens.border : tokens.accent,
              color: commitDisabled ? tokens.mutedText : tokens.accentText,
              cursor: commitDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {commitLabel ?? defaultLabelForIntent(intent)}
          </button>
        </div>
      )}
    </div>
  );
}
