import React from 'react';
import { resolveUpdaterStatusTransition, type UpdateStatus } from '../../electron/shared/updaterState';
import MaxwellHistoryPopover from './MaxwellHistoryPopover';

export type LibraryFooterLocalCommandStatus = {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  eventKind?: 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';
  commandName?: string;
  filePath?: string;
  mode?: 'document' | 'selection';
  runId?: string;
  phase?: string;
  changedLines?: number;
  changedBytes?: number;
  error?: string;
  updatedAt?: number;
};

const LOCAL_COMMAND_ACTIVITY_FRAMES = ['|', '/', '-', '\\'] as const;

type LibraryFooterTheme = {
  accent: string;
  bgSecondary: string;
  border: string;
  error: string;
  success?: string;
  text?: string;
  textSecondary: string;
  isDark: boolean;
  glassEnabled?: boolean;
};

function compactFooterStatusDetail(value: string | undefined, maxLength = 96): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

export function formatFooterLocalCommandStatus(status: LibraryFooterLocalCommandStatus, activityFrame?: string): string {
  const detail = compactFooterStatusDetail(status.detail);
  const message = status.status === 'running' && activityFrame
    ? `[${activityFrame}] ${status.message}`
    : status.message;
  return detail ? `${message} - ${detail}` : message;
}

export function useLibraryFooterLocalCommandStatus() {
  const [localCommandStatus, setLocalCommandStatus] = React.useState<LibraryFooterLocalCommandStatus | null>(null);
  const [localCommandActivityFrameIndex, setLocalCommandActivityFrameIndex] = React.useState(0);

  React.useEffect(() => {
    return window.commandsAPI?.onLocalCommandStatus?.((status) => {
      setLocalCommandStatus(status as LibraryFooterLocalCommandStatus);
    });
  }, []);

  React.useEffect(() => {
    if (localCommandStatus?.status !== 'running') {
      setLocalCommandActivityFrameIndex(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setLocalCommandActivityFrameIndex((index) => (index + 1) % LOCAL_COMMAND_ACTIVITY_FRAMES.length);
    }, 180);
    return () => window.clearInterval(interval);
  }, [localCommandStatus?.status]);

  React.useEffect(() => {
    if (!localCommandStatus) return undefined;
    const timeoutMs = localCommandStatus.status === 'running'
      ? 300000
      : localCommandStatus.status === 'error'
        ? 9000
        : 3500;
    const timeout = window.setTimeout(() => setLocalCommandStatus(null), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [localCommandStatus]);

  const cancelLocalCommandRun = React.useCallback(async () => {
    const status = localCommandStatus;
    const runId = status?.runId;
    if (!runId || !window.commandsAPI?.cancelMaxwellRun) return;
    const showCancelError = (message: string) => {
      setLocalCommandStatus({
        status: 'error',
        message,
        commandName: status.commandName,
        filePath: status.filePath,
        mode: status.mode,
        runId,
        error: message,
        updatedAt: Date.now(),
      });
    };
    try {
      const result = await window.commandsAPI.cancelMaxwellRun(runId);
      if (!result?.success) {
        showCancelError(result?.error ?? 'Could not cancel Maxwell run');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not cancel Maxwell run';
      showCancelError(message);
    }
  }, [localCommandStatus]);

  const localCommandActivityFrame = LOCAL_COMMAND_ACTIVITY_FRAMES[localCommandActivityFrameIndex] ?? LOCAL_COMMAND_ACTIVITY_FRAMES[0];
  const footerStatusLabel = localCommandStatus
    ? formatFooterLocalCommandStatus(
      localCommandStatus,
      localCommandStatus.status === 'running' ? localCommandActivityFrame : undefined,
    )
    : null;

  return {
    localCommandStatus,
    setLocalCommandStatus,
    footerStatusLabel,
    cancelLocalCommandRun,
  };
}

export function LibraryFooterSidebarToggle(props: {
  theme: LibraryFooterTheme;
  collapsed: boolean;
  enabled: boolean;
  onToggle: () => void;
  shortcutLabel?: string;
}) {
  const { theme, collapsed, enabled, onToggle, shortcutLabel = '⌘,' } = props;
  const title = enabled
    ? `${collapsed ? 'Show sidebar' : 'Hide sidebar'} (${shortcutLabel})`
    : 'Sidebar toggle';
  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      disabled={!enabled}
      title={title}
      aria-label="Toggle sidebar"
      style={{
        width: '20px',
        height: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        background: 'transparent',
        color: theme.textSecondary,
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.5,
        transition: 'background 0.15s ease, opacity 0.15s ease',
      }}
      onMouseEnter={(event) => {
        if (!enabled) return;
        event.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform: enabled && collapsed ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s ease',
        }}
      >
        <path d="M10 4L6 8l4 4" />
      </svg>
    </button>
  );
}

export function LibraryFooterMaxwellHistoryButton(props: {
  theme: LibraryFooterTheme;
  open: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
}) {
  const { theme, open, onToggle, style } = props;
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Maxwell history"
      aria-label="Maxwell history"
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: open ? theme.accent : 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        flexShrink: 0,
        ...style,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={open ? '#fff' : theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v6h6" />
        <path d="M12 7v5l3 2" />
      </svg>
    </button>
  );
}

export function LibraryFooterKeyboardShortcutsButton(props: {
  theme: LibraryFooterTheme;
  open: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
}) {
  const { theme, open, onToggle, style } = props;
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Keyboard shortcuts (Shift+?)"
      aria-label="Keyboard shortcuts"
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: open ? theme.accent : 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        color: open ? '#fff' : theme.textSecondary,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        flexShrink: 0,
        ...style,
      }}
    >
      <span style={{ fontSize: '11px', lineHeight: '16px', fontWeight: 650 }}>?</span>
    </button>
  );
}

export function LibraryFooterMaxwellCancelButton(props: {
  theme: LibraryFooterTheme;
  onCancel: () => void;
}) {
  const { theme, onCancel } = props;
  return (
    <button
      type="button"
      onClick={onCancel}
      title="Cancel Maxwell run"
      aria-label="Cancel Maxwell run"
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        color: theme.textSecondary,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  );
}

export function LibraryFooterLocalCommandStatusControls(props: {
  theme: LibraryFooterTheme;
  status: LibraryFooterLocalCommandStatus | null;
  label: string | null;
  onCancel: () => void;
}) {
  const { theme, status, label, onCancel } = props;
  if (!status || !label) return null;
  return (
    <>
      <span style={{ fontWeight: 500 }}>Local model:</span>
      <span
        style={{
          color: status.status === 'error' ? theme.error : theme.textSecondary,
          opacity: 0.85,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {status.status === 'running' && status.runId ? (
        <LibraryFooterMaxwellCancelButton theme={theme} onCancel={onCancel} />
      ) : null}
    </>
  );
}

export function LibraryFooterLogo(props: {
  theme: LibraryFooterTheme;
}) {
  const { theme } = props;
  return (
    <img
      src={theme.isDark ? '/fieldtheory-logo-white.png' : '/fieldtheory-logo-black.png'}
      alt=""
      aria-label="Field Theory"
      style={{
        height: '18px',
        maxWidth: '132px',
        width: 'auto',
        objectFit: 'contain',
        opacity: 0.72,
        display: 'block',
      }}
    />
  );
}

export function LibraryFooterThemeToggleButton(props: {
  theme: LibraryFooterTheme;
  onToggle: () => void;
}) {
  const { theme, onToggle } = props;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} (⇧⌘L)`}
      aria-label={theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      style={{
        width: '18px',
        height: '18px',
        padding: 0,
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
      }}
    >
      {theme.isDark ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill={theme.textSecondary} stroke="none">
          <circle cx="12" cy="12" r="4" />
          <rect x="11" y="1" width="2" height="4" rx="1" />
          <rect x="11" y="19" width="2" height="4" rx="1" />
          <rect x="19" y="11" width="4" height="2" rx="1" />
          <rect x="1" y="11" width="4" height="2" rx="1" />
          <rect x="17.5" y="4.1" width="2" height="4" rx="1" transform="rotate(45 18.5 6.1)" />
          <rect x="4.5" y="15.9" width="2" height="4" rx="1" transform="rotate(45 5.5 17.9)" />
          <rect x="15.9" y="17.5" width="4" height="2" rx="1" transform="rotate(45 17.9 18.5)" />
          <rect x="4.1" y="4.5" width="4" height="2" rx="1" transform="rotate(45 6.1 5.5)" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function LibraryFooterStatusOverlay(props: {
  theme: LibraryFooterTheme;
  label: string | null;
  status: LibraryFooterLocalCommandStatus | null;
}) {
  const { theme, label, status } = props;
  if (!label) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '14px',
        transform: 'translateX(-50%)',
        zIndex: 24,
        maxWidth: 'min(620px, calc(100% - 48px))',
        padding: '4px 8px',
        borderRadius: '4px',
        backgroundColor: theme.isDark ? 'rgba(20, 23, 29, 0.76)' : 'rgba(255, 255, 255, 0.86)',
        border: `1px solid ${theme.border}`,
        color: status?.status === 'error' ? theme.error : theme.textSecondary,
        fontSize: '10px',
        lineHeight: 1.35,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: 'none',
        opacity: 0.9,
        transition: 'opacity 160ms ease',
        animation: status && status.status !== 'running'
          ? `localStatusFadeOut ${status.status === 'error' ? 9 : 3.5}s ease forwards`
          : undefined,
      }}
    >
      {label}
    </div>
  );
}

function FooterFpsCounter(props: {
  active: boolean;
  color: string;
}) {
  const { active, color } = props;
  const [fps, setFps] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!active) {
      setFps(null);
      return undefined;
    }

    let cancelled = false;
    let frameCount = 0;
    let lastSampleAt = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      frameCount += 1;
      const elapsed = now - lastSampleAt;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        lastSampleAt = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [active]);

  return (
    <span
      title={fps === null ? undefined : `${fps} frames per second`}
      style={{
        color,
        fontSize: '9px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontStyle: 'italic',
        minWidth: '30px',
        textAlign: 'right',
      }}
    >
      {fps === null ? '--fps' : `${fps}fps`}
    </span>
  );
}

export function useLibraryFooterUpdaterStatus() {
  const [appVersion, setAppVersion] = React.useState(() => window.updaterAPI?.getVersion?.() || '0.0.0');
  const [updaterEnabled] = React.useState(() => window.updaterAPI?.isEnabled?.() ?? true);
  const [updateStatus, setUpdateStatus] = React.useState<UpdateStatus>('idle');
  const [updateError, setUpdateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAppVersion(window.updaterAPI?.getVersion?.() || '0.0.0');
    void window.updaterAPI?.getStatus?.().then((status) => {
      if (!status) return;
      if (typeof status.version === 'string' && status.version) setAppVersion(status.version);
      if (status.status) setUpdateStatus(status.status);
    });

    const unsubscribers = [
      window.updaterAPI?.onCheckingForUpdate?.(() => {
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'checking'));
      }),
      window.updaterAPI?.onUpdateAvailable?.((info) => {
        if (info?.version) setAppVersion(info.version);
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'available'));
      }),
      window.updaterAPI?.onUpdateNotAvailable?.(() => {
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'uptodate'));
      }),
      window.updaterAPI?.onDownloadProgress?.(() => {
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'downloading'));
      }),
      window.updaterAPI?.onUpdateDownloaded?.((info) => {
        if (info?.version) setAppVersion(info.version);
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'ready'));
      }),
      window.updaterAPI?.onInstalling?.(() => {
        setUpdateError(null);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'installing'));
      }),
      window.updaterAPI?.onError?.((message) => {
        setUpdateError(message);
        setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'error'));
      }),
    ].filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === 'function');

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  const dismissUpdate = React.useCallback(() => {
    void window.updaterAPI?.dismissUpdate?.();
    setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'idle', { force: true }));
  }, []);

  const downloadUpdate = React.useCallback(() => {
    setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'downloading'));
    void window.updaterAPI?.downloadUpdate?.();
  }, []);

  const installUpdate = React.useCallback(() => {
    setUpdateStatus((current) => resolveUpdaterStatusTransition(current, 'installing'));
    void window.updaterAPI?.installUpdate?.();
  }, []);

  return {
    appVersion,
    updaterEnabled,
    updateStatus,
    updateError,
    checkForUpdates: () => window.updaterAPI?.checkForUpdates?.(),
    dismissUpdate,
    downloadUpdate,
    installUpdate,
  };
}

export function LibraryFooterUpdaterStatus(props: {
  theme: LibraryFooterTheme;
  appVersion: string;
  updaterEnabled: boolean;
  updateStatus: UpdateStatus;
  updateError: string | null;
  isOnline: boolean;
  fpsActive?: boolean;
  callsign?: string | null;
  onCheckForUpdates: () => void;
  onDismissUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  const {
    theme,
    appVersion,
    updaterEnabled,
    updateStatus,
    updateError,
    isOnline,
    fpsActive = false,
    callsign = null,
    onCheckForUpdates,
    onDismissUpdate,
    onDownloadUpdate,
    onInstallUpdate,
  } = props;
  const [versionHovered, setVersionHovered] = React.useState(false);
  const successColor = theme.success ?? theme.textSecondary;
  const textColor = theme.text ?? theme.textSecondary;

  if (updateStatus !== 'idle' && updateStatus !== 'uptodate' && updateStatus !== 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            overflow: 'hidden',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          <span style={{ fontSize: '9px', color: textColor }}>
            {updateStatus === 'checking'
              ? 'Checking...'
              : updateStatus === 'downloading'
                ? 'Downloading...'
                : updateStatus === 'ready'
                  ? 'Update ready'
                  : updateStatus === 'installing'
                    ? 'Installing...'
                    : 'Update available'}
          </span>
        </div>
        {updateStatus !== 'checking' && updateStatus !== 'downloading' && updateStatus !== 'installing' ? (
          <>
            <button
              type="button"
              onClick={onDismissUpdate}
              style={{
                padding: '2px 5px',
                fontSize: '9px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                opacity: 0.6,
              }}
            >
              Later
            </button>
            <button
              type="button"
              onClick={updateStatus === 'ready' ? onInstallUpdate : onDownloadUpdate}
              style={{
                padding: '2px 6px',
                fontSize: '9px',
                color: '#fff',
                backgroundColor: theme.accent,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {updateStatus === 'ready' ? 'Install' : 'Update'}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <div
        onMouseEnter={() => setVersionHovered(true)}
        onMouseLeave={() => setVersionHovered(false)}
        style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
      >
        {versionHovered && updaterEnabled ? (
          updateStatus === 'uptodate' ? (
            <span style={{ color: successColor, fontSize: '9px' }}>
              Up to date ✓
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (isOnline) onCheckForUpdates();
              }}
              disabled={!isOnline}
              title={!isOnline ? 'No internet connection' : undefined}
              style={{
                cursor: isOnline ? 'pointer' : 'not-allowed',
                color: theme.textSecondary,
                fontSize: '9px',
                background: 'none',
                border: 'none',
                padding: 0,
                opacity: isOnline ? 1 : 0.5,
              }}
            >
              Check for updates
            </button>
          )
        ) : (
          <>
            <FooterFpsCounter active={fpsActive} color={theme.textSecondary} />
            {callsign ? (
              <span style={{ color: theme.textSecondary, fontSize: '9px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', letterSpacing: '0.5px' }}>
                {callsign}
              </span>
            ) : null}
            <span style={{ color: updateStatus === 'uptodate' ? successColor : theme.textSecondary, fontSize: '9px', fontStyle: 'italic' }}>
              {updateStatus === 'uptodate' ? 'Up to date ✓' : `v${appVersion}`}
            </span>
            {updateError && updateStatus === 'error' ? (
              <span title={updateError} style={{ color: theme.textSecondary, fontSize: '10px', opacity: 0.65 }}>
                !
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function LibraryFooterMaxwellHistoryPopover(props: {
  open: boolean;
  onClose: () => void;
  footerRef: React.RefObject<HTMLElement | null>;
  hidden?: boolean;
}) {
  const { open, onClose, footerRef, hidden = false } = props;
  return (
    <MaxwellHistoryPopover
      open={open && !hidden}
      onClose={onClose}
      footerRef={footerRef}
    />
  );
}
