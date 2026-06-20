import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import RiverPicker, { type RiverPickerTarget } from './RiverPicker';
import { SidebarRiverIcon } from './SidebarIcons';

type SharedFilesClient = NonNullable<Window['sharedFilesAPI']>;
type RiverTarget = Awaited<ReturnType<SharedFilesClient['getTargets']>>[number];
type RiverShareTarget = NonNullable<Parameters<SharedFilesClient['share']>[0]['targets']>[number];

export interface RiverShareLauncherFile {
  filePath: string;
  title: string;
}

export interface RiverShareLauncherProps {
  file: RiverShareLauncherFile;
  loadContent: (filePath: string) => Promise<{ content: string; title?: string | null } | null>;
  onCancel: () => void;
  onShared: (message: string) => void;
}

function toPickerTarget(target: RiverTarget): RiverPickerTarget {
  return {
    id: target.id,
    kind: target.kind,
    label: target.label,
    detail: target.detail,
    callSign: target.callsign,
    initials: target.initials,
    avatarUrl: target.avatarUrl,
    tint: target.tint,
    status: target.status,
  };
}

function targetsForIds(targets: RiverTarget[], ids: readonly string[]): RiverShareTarget[] {
  const byId = new Map(targets.map((target) => [target.id, target]));
  return ids.flatMap((id) => {
    const target = byId.get(id);
    if (!target) return [];
    return [{ id: target.id, kind: target.kind }];
  });
}

export default function RiverShareLauncher({ file, loadContent, onCancel, onShared }: RiverShareLauncherProps) {
  const { theme } = useTheme();
  const [targets, setTargets] = useState<RiverTarget[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [defaultTargetIds, setDefaultTargetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const pickerTargets = useMemo(() => targets.map(toPickerTarget), [targets]);
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setCommitError(null);
    void (window.sharedFilesAPI?.getTargets?.('') ?? Promise.resolve([]))
      .then((nextTargets) => {
        if (cancelled) return;
        const acceptedTargets = (nextTargets ?? []).filter((target) => target.status === 'accepted');
        const defaultIds = acceptedTargets.filter((target) => target.isDefault).map((target) => target.id);
        const initialIds = defaultIds.length ? defaultIds : acceptedTargets.slice(0, 1).map((target) => target.id);
        setTargets(nextTargets ?? []);
        setDefaultTargetIds(defaultIds);
        setSelectedTargetIds(initialIds);
      })
      .catch(() => {
        if (!cancelled) setLoadError('River targets could not load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDefaults = useCallback((ids: string[]) => {
    setDefaultTargetIds(ids);
    const destinations = ids.flatMap((id, index) => {
      const target = targetById.get(id);
      if (!target) return [];
      return [{ kind: target.kind, targetId: target.targetId, position: index }];
    });
    void window.sharedFilesAPI?.setDefaultDestinations?.(destinations).catch(() => {
      setCommitError('River defaults could not be saved.');
    });
  }, [targetById]);

  const commit = useCallback(async (ids: string[]) => {
    if (sharing) return;
    const selectedTargets = targetsForIds(targets, ids);
    if (selectedTargets.length === 0) {
      setCommitError('Choose an approved River destination.');
      return;
    }
    setSharing(true);
    setCommitError(null);
    try {
      const preview = await loadContent(file.filePath);
      if (!preview?.content) {
        setCommitError('This file could not be read for sharing.');
        return;
      }
      const result = await window.sharedFilesAPI?.share?.({
        filePath: file.filePath,
        title: preview.title?.trim() || file.title,
        content: preview.content,
        type: 'document',
        targets: selectedTargets,
      });
      if (!result?.shared) {
        setCommitError(result?.error ?? 'River share failed.');
        return;
      }
      onShared(`Shared ${file.title} to River`);
    } catch {
      setCommitError('River share failed.');
    } finally {
      setSharing(false);
    }
  }, [file.filePath, file.title, loadContent, onShared, sharing, targets]);

  return (
    <div
      data-river-share-launcher="true"
      style={{
        width: '100vw',
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '14px',
        backgroundColor: theme.isDark ? theme.bg : '#e7e5df',
        color: theme.text,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '418px',
          maxWidth: 'calc(100vw - 28px)',
          borderRadius: '15px',
          overflow: 'hidden',
          border: `1px solid ${theme.border}`,
          boxShadow: theme.isDark ? '0 18px 50px rgba(0,0,0,0.32)' : '0 18px 50px rgba(40,36,28,0.20)',
          backgroundColor: theme.surface1,
        }}
      >
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <SidebarRiverIcon color={theme.accent} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 650 }}>Share to River</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, marginTop: '7px' }}>
              <span
                title={file.filePath}
                style={{
                  maxWidth: '300px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  borderRadius: '7px',
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : '#faf9f6',
                  color: theme.text,
                  fontSize: '12px',
                  padding: '4px 8px',
                }}
              >
                {file.title}
              </span>
              <span style={{ color: theme.textSecondary, fontSize: '11px' }}>to River</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel River share"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              border: `1px solid ${theme.border}`,
              backgroundColor: theme.bg,
              color: theme.textSecondary,
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <RiverPicker
          targets={pickerTargets}
          selectedIds={selectedTargetIds}
          defaultIds={defaultTargetIds}
          surface="inline"
          intent="share"
          status={loading ? 'loading' : loadError ? 'error' : 'ready'}
          disabled={sharing}
          commitError={commitError}
          errorMessage={loadError}
          emptyLabel="No River contacts or groups yet."
          placeholder="Search people, groups, or make public..."
          commitLabel={sharing ? 'Sharing...' : selectedTargetIds.length > 1 ? 'Share to Rivers' : 'Share'}
          showSelectAll
          onToggleTarget={(targetId) => {
            setSelectedTargetIds((current) => (
              current.includes(targetId)
                ? current.filter((id) => id !== targetId)
                : [...current, targetId]
            ));
          }}
          onDefaultChange={updateDefaults}
          onCommit={commit}
        />
      </div>
    </div>
  );
}
