import { CSSProperties, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { summarizeGazeTrackingHealth } from '../lib/gazeTrackingDiagnostics';

const PREVIEW_STORAGE_KEY = 'fieldTheoryVisionPreviewEnabled';
type GazeAPI = NonNullable<Window['gazeAPI']>;
type GazeTrackingStatus = Awaited<ReturnType<GazeAPI['getStatus']>>;
type GazeCalibrationState = Awaited<ReturnType<GazeAPI['getCalibrationState']>>;
type GazeSample = NonNullable<Awaited<ReturnType<GazeAPI['getLatestSample']>>>;
type GazeWindowFocusConfig = Awaited<ReturnType<GazeAPI['getFocusConfig']>>;
type GazeDwellEvent = Parameters<Parameters<GazeAPI['onDwellTriggered']>[0]>[0];
type GazeDebugOverlayState = Awaited<ReturnType<GazeAPI['getDebugOverlayState']>>;
type GazeScreenOverlayState = Awaited<ReturnType<GazeAPI['getScreenOverlayState']>>;
type DiagnosticSample = GazeSample & { receivedAtMs?: number };

export default function VisionSettings() {
  const { theme } = useTheme();
  const [status, setStatus] = useState<GazeTrackingStatus | null>(null);
  const [calibration, setCalibration] = useState<GazeCalibrationState | null>(null);
  const [sample, setSample] = useState<GazeSample | null>(null);
  const [focusConfig, setFocusConfig] = useState<GazeWindowFocusConfig | null>(null);
  const [lastDwellEvent, setLastDwellEvent] = useState<GazeDwellEvent | null>(null);
  const [debugOverlayState, setDebugOverlayState] = useState<GazeDebugOverlayState | null>(null);
  const [screenOverlayState, setScreenOverlayState] = useState<GazeScreenOverlayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingFocusConfig, setSavingFocusConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(() => {
    return localStorage.getItem(PREVIEW_STORAGE_KEY) === 'true';
  });
  const [manualAdjustEnabled, setManualAdjustEnabled] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const recentSamplesRef = useRef<DiagnosticSample[]>([]);

  useEffect(() => {
    localStorage.setItem(PREVIEW_STORAGE_KEY, previewEnabled ? 'true' : 'false');
  }, [previewEnabled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!window.gazeAPI) {
        return;
      }

      try {
        const [nextStatus, nextCalibration, nextFocusConfig, nextDebugOverlayState, nextScreenOverlayState] = await Promise.all([
          window.gazeAPI.getStatus(),
          window.gazeAPI.getCalibrationState(),
          window.gazeAPI.getFocusConfig(),
          window.gazeAPI.getDebugOverlayState(),
          window.gazeAPI.getScreenOverlayState(),
        ]);
        if (!isMounted) return;
        setStatus(nextStatus);
        setCalibration(nextCalibration);
        setFocusConfig(nextFocusConfig);
        setDebugOverlayState(nextDebugOverlayState);
        setScreenOverlayState(nextScreenOverlayState);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load vision settings');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();

    const unsubStatus = window.gazeAPI?.onStatusChanged((nextStatus) => {
      if (!isMounted) return;
      setStatus(nextStatus);
    });
    const unsubCalibration = window.gazeAPI?.onCalibrationChanged((nextCalibration) => {
      if (!isMounted) return;
      setCalibration(nextCalibration);
    });
    const unsubSample = window.gazeAPI?.onSample((nextSample) => {
      if (!isMounted) return;
      const receivedAtMs = Date.now();
      const threshold = nextSample.timestampMs - 5000;
      recentSamplesRef.current = [
        ...recentSamplesRef.current.filter((item) => item.timestampMs >= threshold),
        {
          ...nextSample,
          receivedAtMs,
        },
      ];
      setSample(nextSample);
      setStatus((previous) => previous ? { ...previous, lastSampleAtMs: receivedAtMs } : previous);
    });
    const unsubDwell = window.gazeAPI?.onDwellTriggered((event) => {
      if (!isMounted) return;
      setLastDwellEvent(event);
    });
    const unsubDebugOverlayState = window.gazeAPI?.onDebugOverlayStateChanged((state) => {
      if (!isMounted) return;
      setDebugOverlayState(state);
    });
    const unsubScreenOverlayState = window.gazeAPI?.onScreenOverlayStateChanged((state) => {
      if (!isMounted) return;
      setScreenOverlayState(state);
    });

    return () => {
      isMounted = false;
      unsubStatus?.();
      unsubCalibration?.();
      unsubSample?.();
      unsubDwell?.();
      unsubDebugOverlayState?.();
      unsubScreenOverlayState?.();
    };
  }, []);

  const calibrationAgeLabel = useMemo(() => {
    if (!calibration?.lastCalibratedAtMs) return 'Never calibrated';
    const minutes = Math.max(0, Math.floor((Date.now() - calibration.lastCalibratedAtMs) / 60000));
    if (minutes < 1) return 'Calibrated just now';
    if (minutes < 60) return `Calibrated ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `Calibrated ${hours}h ago`;
  }, [calibration?.lastCalibratedAtMs]);

  const runningLabel = useMemo(() => {
    if (!status) return 'Loading...';
    if (!status.enabled) return 'Disabled';
    if (!status.cameraAuthorized) return 'Camera permission required';
    if (!status.running) return status.reason || 'Starting...';
    return 'Running';
  }, [status]);

  const trackingHealth = useMemo(() => {
    return summarizeGazeTrackingHealth({
      status,
      calibration,
      latestSample: sample,
      recentSamples: recentSamplesRef.current,
      nowMs,
    });
  }, [status, calibration, sample, nowMs]);

  const openCameraPrivacySettings = async (): Promise<void> => {
    try {
      await window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open Camera settings');
    }
  };

  const onToggleEnabled = async () => {
    if (!window.gazeAPI || !status) return;
    setBusy(true);
    setError(null);
    try {
      const enabling = !status.enabled;
      const next = await window.gazeAPI.setEnabled(enabling);
      setStatus(next);

      if (enabling && !next.cameraAuthorized) {
        const shouldOpenSettings = window.confirm(
          'Camera access is required for eye tracking. Open Camera privacy settings now?'
        );
        if (shouldOpenSettings) {
          await openCameraPrivacySettings();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle eye tracking');
    } finally {
      setBusy(false);
    }
  };

  const onStartCalibration = async () => {
    if (!window.gazeAPI) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.startCalibration();
      setCalibration(next);
      if (next.active) {
        setPreviewEnabled(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start calibration');
    } finally {
      setBusy(false);
    }
  };

  const onCancelCalibration = async () => {
    if (!window.gazeAPI) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.cancelCalibration();
      setCalibration(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel calibration');
    } finally {
      setBusy(false);
    }
  };

  const onResetData = async () => {
    if (!window.gazeAPI) return;
    if (!window.confirm('Reset all eye tracking data and calibration offsets?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.resetEyeTrackingData();
      setCalibration(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset eye tracking data');
    } finally {
      setBusy(false);
    }
  };

  const onApplyManualCorrection = async (target: { x: number; y: number }) => {
    if (!window.gazeAPI || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.applyManualCorrection(target);
      setCalibration(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply manual correction');
    } finally {
      setBusy(false);
    }
  };

  const onUpdateFocusConfig = async (patch: Partial<GazeWindowFocusConfig>) => {
    if (!window.gazeAPI || !focusConfig) return;
    setSavingFocusConfig(true);
    setError(null);
    try {
      const next = await window.gazeAPI.setFocusConfig(patch);
      setFocusConfig(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dwell settings');
    } finally {
      setSavingFocusConfig(false);
    }
  };

  const onToggleDebugOverlay = async () => {
    if (!window.gazeAPI || !debugOverlayState || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.setDebugOverlayEnabled(!debugOverlayState.enabled);
      setDebugOverlayState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle debug overlay');
    } finally {
      setBusy(false);
    }
  };

  const onToggleScreenOverlay = async () => {
    if (!window.gazeAPI || !screenOverlayState || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.gazeAPI.setScreenOverlayEnabled(!screenOverlayState.enabled);
      setScreenOverlayState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle screen overlay');
    } finally {
      setBusy(false);
    }
  };
  const focusControlsDisabled = busy || savingFocusConfig || !focusConfig;

  if (loading) {
    return <div style={{ color: theme.textSecondary, fontSize: '13px' }}>Loading Vision settings...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={styles.card(theme)}>
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Eye Tracking</span>
            <span style={styles.hint(theme)}>
              {runningLabel}
            </span>
          </div>
          <button
            onClick={onToggleEnabled}
            disabled={busy}
            style={{ ...styles.toggle, backgroundColor: status?.enabled ? theme.accent : '#cbd5e1' }}
          >
            <span style={{ ...styles.toggleKnob, transform: status?.enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        {status?.enabled && !status.cameraAuthorized && (
          <div style={styles.inlineWarning(theme)}>
            <span style={styles.hint(theme)}>
              Camera permission is required before eye tracking can start.
            </span>
            <button onClick={() => { void openCameraPrivacySettings(); }} style={styles.ghostButton(theme)}>
              Open Camera Settings
            </button>
          </div>
        )}

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Calibration</span>
            <span style={styles.hint(theme)}>
              {calibrationAgeLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onStartCalibration}
              disabled={busy}
              style={styles.button(theme)}
            >
              {calibration?.active ? 'Restart' : 'Recalibrate now'}
            </button>
            {calibration?.active && (
              <button
                onClick={onCancelCalibration}
                disabled={busy}
                style={styles.ghostButton(theme)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Vision Preview</span>
            <span style={styles.hint(theme)}>
              Structured particle grid that follows calibrated gaze.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {previewEnabled && (
              <button
                onClick={() => setManualAdjustEnabled((prev) => !prev)}
                style={manualAdjustEnabled ? styles.button(theme) : styles.ghostButton(theme)}
              >
                {manualAdjustEnabled ? 'Drag Adjust On' : 'Enable Drag Adjust'}
              </button>
            )}
            <button
              onClick={() => setPreviewEnabled((prev) => !prev)}
              style={{ ...styles.toggle, backgroundColor: previewEnabled ? theme.accent : '#cbd5e1' }}
            >
              <span style={{ ...styles.toggleKnob, transform: previewEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Debug Overlay Window</span>
            <span style={styles.hint(theme)}>
              Floating mirrored camera panel with live landmarks and gaze telemetry.
            </span>
          </div>
          <button
            onClick={onToggleDebugOverlay}
            disabled={busy}
            style={{ ...styles.toggle, backgroundColor: debugOverlayState?.enabled ? theme.accent : '#cbd5e1' }}
          >
            <span style={{ ...styles.toggleKnob, transform: debugOverlayState?.enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Screen Gaze Overlay</span>
            <span style={styles.hint(theme)}>
              Transparent full-screen pink crosshair at mapped gaze point.
            </span>
          </div>
          <button
            onClick={onToggleScreenOverlay}
            disabled={busy}
            style={{ ...styles.toggle, backgroundColor: screenOverlayState?.enabled ? theme.accent : '#cbd5e1' }}
          >
            <span style={{ ...styles.toggleKnob, transform: screenOverlayState?.enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        <div style={styles.healthCard(theme, trackingHealth.level)}>
          <div style={styles.healthHeader}>
            <span style={styles.label(theme)}>Tracking Health</span>
            <span style={styles.healthBadge(theme, trackingHealth.level)}>{trackingHealth.level.toUpperCase()}</span>
          </div>
          <div style={styles.hint(theme)}>{trackingHealth.headline}</div>
          <div style={styles.healthMetrics}>
            <span style={styles.metric(theme)}>Age {formatSampleAge(trackingHealth.sampleAgeMs)}</span>
            <span style={styles.metric(theme)}>FPS {formatRate(trackingHealth.sampleRateHz)}</span>
            <span style={styles.metric(theme)}>Conf {formatConfidence(trackingHealth.averageConfidence)}</span>
            <span style={styles.metric(theme)}>Landmarks {formatPercent(trackingHealth.landmarkRate)}</span>
            <span style={styles.metric(theme)}>Mapped {trackingHealth.mappedPointAvailable ? 'yes' : 'no'}</span>
          </div>
          {trackingHealth.reasons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {trackingHealth.reasons.slice(0, 3).map((reason) => (
                <span key={reason} style={styles.hint(theme)}>{reason}</span>
              ))}
            </div>
          )}
        </div>

        <div style={styles.sliderGroup}>
          <span style={styles.label(theme)}>Dwell Duration</span>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={200}
              max={2000}
              step={50}
              value={focusConfig?.dwellDurationMs ?? 400}
              disabled={focusControlsDisabled}
              onChange={(event) => {
                void onUpdateFocusConfig({ dwellDurationMs: Number(event.currentTarget.value) });
              }}
              style={styles.slider}
            />
            <span style={styles.metric(theme)}>{focusConfig?.dwellDurationMs ?? 400}ms</span>
          </div>
        </div>

        <div style={styles.sliderGroup}>
          <span style={styles.label(theme)}>Confidence Threshold</span>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={focusConfig?.confidenceThreshold ?? 0.6}
              disabled={focusControlsDisabled}
              onChange={(event) => {
                void onUpdateFocusConfig({ confidenceThreshold: Number(event.currentTarget.value) });
              }}
              style={styles.slider}
            />
            <span style={styles.metric(theme)}>
              {Math.round((focusConfig?.confidenceThreshold ?? 0.6) * 100)}%
            </span>
          </div>
        </div>

        <div style={styles.sliderGroup}>
          <span style={styles.label(theme)}>Dead Zone</span>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={40}
              max={200}
              step={5}
              value={focusConfig?.deadZonePx ?? 80}
              disabled={focusControlsDisabled}
              onChange={(event) => {
                void onUpdateFocusConfig({ deadZonePx: Number(event.currentTarget.value) });
              }}
              style={styles.slider}
            />
            <span style={styles.metric(theme)}>{focusConfig?.deadZonePx ?? 80}px</span>
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.label(theme)}>Dwell Action</span>
            <span style={styles.hint(theme)}>
              Event feed, border highlight signal, or bring target window to front.
            </span>
          </div>
          <select
            value={focusConfig?.dwellAction ?? 'eventOnly'}
            disabled={focusControlsDisabled}
            onChange={(event) => {
              void onUpdateFocusConfig({
                dwellAction: event.currentTarget.value as GazeWindowFocusConfig['dwellAction'],
              });
            }}
            style={styles.select(theme)}
          >
            <option value="eventOnly">Event only</option>
            <option value="highlightBorder">Highlight border</option>
            <option value="bringToFront">Bring to front</option>
          </select>
        </div>

        <div style={styles.hint(theme)}>
          Last dwell: {lastDwellEvent
            ? `${lastDwellEvent.window.ownerName} (${lastDwellEvent.window.title || 'untitled'})`
            : 'No dwell events yet'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span style={styles.hint(theme)}>
            {calibration?.accuracy?.message || 'Run calibration to estimate precision.'}
          </span>
          <button
            onClick={onResetData}
            disabled={busy}
            style={styles.resetButton(theme)}
          >
            Reset all eye tracking data
          </button>
        </div>

        <div style={styles.hint(theme)}>
          Manual refinements this session: {calibration?.manualCorrectionCount ?? 0}
        </div>
      </div>

      {calibration?.needsRecalibrationPrompt && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          border: `1px solid ${theme.warning}`,
          backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)',
          color: theme.text,
          fontSize: '12px',
        }}>
          Recalibration recommended: {calibration.recalibrationReason || 'Environment changed'}
        </div>
      )}

      {calibration?.active && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          color: theme.text,
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>
            Point {Math.min(calibration.currentPointIndex + 1, calibration.totalPoints)} / {calibration.totalPoints}
            {calibration.currentPointId ? ` (${labelPoint(calibration.currentPointId)})` : ''}
          </span>
          <span>
            Stability: {Math.round(calibration.stableForMs)}ms
          </span>
        </div>
      )}

      {previewEnabled && (
        <VisionMatrixPreview
          sample={sample}
          manualAdjustEnabled={manualAdjustEnabled}
          calibrationTarget={calibration?.active ? getCalibrationTarget(calibration.currentPointId) : null}
          onManualCorrection={onApplyManualCorrection}
        />
      )}

      {error && (
        <div style={{ color: theme.warning, fontSize: '12px' }}>{error}</div>
      )}
    </div>
  );
}

function VisionMatrixPreview({
  sample,
  manualAdjustEnabled,
  calibrationTarget,
  onManualCorrection,
}: {
  sample: GazeSample | null;
  manualAdjustEnabled: boolean;
  calibrationTarget: { x: number; y: number } | null;
  onManualCorrection: (target: { x: number; y: number }) => void;
}) {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestSampleRef = useRef<GazeSample | null>(sample);
  const peakRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const lastRenderTimeRef = useRef(0);
  const draggingRef = useRef(false);
  const dragTargetRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    latestSampleRef.current = sample;
  }, [sample]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let rafId = 0;
    const draw = (timestamp: number) => {
      // Throttle to ~30fps so this stays light while still smooth.
      if (timestamp - lastRenderTimeRef.current < 33) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      lastRenderTimeRef.current = timestamp;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const latest = latestSampleRef.current;
      const source = draggingRef.current && dragTargetRef.current
        ? dragTargetRef.current
        : latest
          ? (latest.calibrationApplied ? latest.calibratedCombinedEye : latest.combinedEye)
          : null;
      if (source) {
        const smoothing = draggingRef.current ? 0.4 : 0.25;
        peakRef.current.x += (source.x - peakRef.current.x) * smoothing;
        peakRef.current.y += (source.y - peakRef.current.y) * smoothing;
      }

      const peakX = peakRef.current.x * width;
      const peakY = peakRef.current.y * height;
      const baseColor = theme.isDark ? '64, 208, 255' : '20, 120, 190';
      const sigma = Math.min(width, height) * 0.28;

      context.clearRect(0, 0, width, height);

      const gradient = context.createRadialGradient(
        peakX,
        peakY,
        2,
        peakX,
        peakY,
        Math.min(width, height) * 0.72
      );
      gradient.addColorStop(0, `rgba(${baseColor}, 0.16)`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const spacing = 16;
      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          const dist = Math.hypot(x - peakX, y - peakY);
          const intensity = Math.exp(-(dist * dist) / (2 * sigma * sigma));
          const wobble = 0.5 + 0.5 * Math.sin((x + y) * 0.04 + timestamp * 0.0025);
          const radius = 0.8 + (intensity * 3.0) + (wobble * 0.35);
          const alpha = 0.08 + (intensity * 0.62);

          context.beginPath();
          context.fillStyle = `rgba(${baseColor}, ${alpha.toFixed(3)})`;
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }

      for (let i = 1; i <= 4; i += 1) {
        const ringRadius = i * 24;
        context.beginPath();
        context.strokeStyle = `rgba(${baseColor}, ${(0.18 - (i * 0.03)).toFixed(3)})`;
        context.lineWidth = 1;
        context.arc(peakX, peakY, ringRadius, 0, Math.PI * 2);
        context.stroke();
      }

      context.beginPath();
      context.strokeStyle = `rgba(${baseColor}, 0.85)`;
      context.lineWidth = 1.5;
      context.moveTo(peakX - 8, peakY);
      context.lineTo(peakX + 8, peakY);
      context.moveTo(peakX, peakY - 8);
      context.lineTo(peakX, peakY + 8);
      context.stroke();

      if (manualAdjustEnabled && dragTargetRef.current) {
        const targetX = dragTargetRef.current.x * width;
        const targetY = dragTargetRef.current.y * height;
        context.beginPath();
        context.strokeStyle = `rgba(${baseColor}, 0.95)`;
        context.lineWidth = 1.2;
        context.arc(targetX, targetY, 14, 0, Math.PI * 2);
        context.stroke();
      }

      if (calibrationTarget) {
        const tx = calibrationTarget.x * width;
        const ty = calibrationTarget.y * height;
        const pulse = 0.5 + (0.5 * Math.sin(timestamp * 0.01));
        context.beginPath();
        context.strokeStyle = `rgba(255, 215, 90, ${(0.6 + pulse * 0.35).toFixed(3)})`;
        context.lineWidth = 2;
        context.arc(tx, ty, 12 + (pulse * 4), 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.strokeStyle = 'rgba(255, 230, 150, 0.96)';
        context.lineWidth = 1.5;
        context.moveTo(tx - 7, ty);
        context.lineTo(tx + 7, ty);
        context.moveTo(tx, ty - 7);
        context.lineTo(tx, ty + 7);
        context.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [theme.isDark, calibrationTarget?.x, calibrationTarget?.y]);

  const normalizePointerEvent = (
    event: ReactPointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!manualAdjustEnabled) return;
    const normalized = normalizePointerEvent(event);
    draggingRef.current = true;
    dragTargetRef.current = normalized;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!manualAdjustEnabled || !draggingRef.current) return;
    dragTargetRef.current = normalizePointerEvent(event);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!manualAdjustEnabled || !draggingRef.current) return;
    const normalized = normalizePointerEvent(event);
    dragTargetRef.current = normalized;
    draggingRef.current = false;
    onManualCorrection(normalized);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    dragTargetRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div style={styles.previewContainer(theme)}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          width: '100%',
          height: '220px',
          borderRadius: '12px',
          border: `1px solid ${theme.border}`,
          background: theme.isDark
            ? 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
            : 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.9), rgba(245,251,255,0.95))',
        }}
      />
      <div style={{ fontSize: '11px', color: theme.textSecondary }}>
        Peak tracks {sample?.calibrationApplied ? 'calibrated' : 'raw'} gaze.
        {manualAdjustEnabled ? ' Drag the peak to where you are looking, then release.' : ''}
      </div>
    </div>
  );
}

function labelPoint(pointId: string): string {
  switch (pointId) {
    case 'center':
      return 'Center';
    case 'topLeft':
      return 'Top Left';
    case 'topRight':
      return 'Top Right';
    case 'bottomLeft':
      return 'Bottom Left';
    case 'bottomRight':
      return 'Bottom Right';
    default:
      return pointId;
  }
}

function getCalibrationTarget(pointId: string | null | undefined): { x: number; y: number } | null {
  switch (pointId) {
    case 'center':
      return { x: 0.5, y: 0.5 };
    case 'topLeft':
      return { x: 0.2, y: 0.2 };
    case 'topRight':
      return { x: 0.8, y: 0.2 };
    case 'bottomLeft':
      return { x: 0.2, y: 0.8 };
    case 'bottomRight':
      return { x: 0.8, y: 0.8 };
    default:
      return null;
  }
}

function formatSampleAge(sampleAgeMs: number | null): string {
  if (sampleAgeMs === null || !Number.isFinite(sampleAgeMs)) return 'n/a';
  if (sampleAgeMs < 1000) return `${Math.round(sampleAgeMs)}ms`;
  return `${(sampleAgeMs / 1000).toFixed(1)}s`;
}

function formatRate(rateHz: number | null): string {
  if (rateHz === null || !Number.isFinite(rateHz)) return 'n/a';
  return rateHz.toFixed(1);
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null || !Number.isFinite(confidence)) return 'n/a';
  return confidence.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

const styles = {
  card: (theme: any): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    borderRadius: '10px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  }),
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  } as CSSProperties,
  healthCard: (theme: any, level: 'ok' | 'warning' | 'error'): CSSProperties => {
    const borderColor = level === 'error'
      ? theme.warning
      : level === 'warning'
        ? (theme.isDark ? 'rgba(245, 158, 11, 0.8)' : 'rgba(245, 158, 11, 0.6)')
        : theme.border;
    return {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px 12px',
      borderRadius: '8px',
      border: `1px solid ${borderColor}`,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.7)',
    };
  },
  healthHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  } as CSSProperties,
  inlineWarning: (theme: any): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: `1px solid ${theme.warning}`,
    backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)',
  }),
  healthBadge: (theme: any, level: 'ok' | 'warning' | 'error'): CSSProperties => ({
    fontSize: '10px',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: '#fff',
    borderRadius: '999px',
    padding: '2px 8px',
    backgroundColor: level === 'error'
      ? theme.warning
      : level === 'warning'
        ? (theme.isDark ? '#f59e0b' : '#f97316')
        : theme.accent,
  }),
  healthMetrics: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px',
  } as CSSProperties,
  label: (theme: any): CSSProperties => ({
    color: theme.text,
    fontSize: '13px',
    fontWeight: 600,
  }),
  hint: (theme: any): CSSProperties => ({
    color: theme.textSecondary,
    fontSize: '11px',
    lineHeight: 1.35,
  }),
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  } as CSSProperties,
  sliderWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as CSSProperties,
  slider: {
    flex: 1,
    minWidth: 0,
  } as CSSProperties,
  metric: (theme: any): CSSProperties => ({
    minWidth: '56px',
    textAlign: 'right',
    fontSize: '11px',
    color: theme.textSecondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  select: (theme: any): CSSProperties => ({
    borderRadius: '8px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : '#fff',
    color: theme.text,
    padding: '6px 10px',
    fontSize: '12px',
  }),
  button: (theme: any): CSSProperties => ({
    backgroundColor: theme.accent,
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  }),
  ghostButton: (theme: any): CSSProperties => ({
    backgroundColor: 'transparent',
    color: theme.textSecondary,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  }),
  resetButton: (theme: any): CSSProperties => ({
    backgroundColor: 'transparent',
    color: theme.warning,
    border: `1px solid ${theme.warning}`,
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
  toggle: {
    width: '44px',
    height: '24px',
    borderRadius: '999px',
    border: 'none',
    position: 'relative',
    cursor: 'pointer',
    padding: 0,
  } as CSSProperties,
  toggleKnob: {
    position: 'absolute',
    top: '2px',
    left: 0,
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#fff',
    transition: 'transform 160ms ease',
  } as CSSProperties,
  previewContainer: (theme: any): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    borderRadius: '12px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.7)',
  }),
};
