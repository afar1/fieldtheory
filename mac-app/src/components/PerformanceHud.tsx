import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type LoadLevel = 'Light' | 'Moderate' | 'Heavy';

interface BaselineSnapshot {
  cpuSystemPercent: number;
  memoryUsedMb: number;
}

interface ProcessPerformanceSnapshot {
  timestampMs: number;
  cpuPercent: number;
  cpuCoresUsed: number;
  cpuSystemPercent: number;
  totalCores: number;
  memoryUsedMb: number;
  memorySystemPercent: number;
  totalMemoryGb: number;
}

const POLL_INTERVAL_MS = 1000;
const HISTORY_SIZE = 30;
const BASELINE_SAMPLE_COUNT = 10;
const COMMON_REFRESH_RATES = [30, 60, 75, 90, 100, 120, 144, 165, 240];
const HUD_COLLAPSED_STORAGE_KEY = 'fieldTheoryPerformanceHudCollapsed';

function appendSample(values: number[], next: number): number[] {
  const normalized = Number.isFinite(next) ? next : 0;
  if (values.length < HISTORY_SIZE) {
    return [...values, normalized];
  }
  return [...values.slice(1), normalized];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function closestRefreshRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 60;
  let closest = COMMON_REFRESH_RATES[0];
  let minDistance = Math.abs(value - closest);
  for (const rate of COMMON_REFRESH_RATES) {
    const distance = Math.abs(value - rate);
    if (distance < minDistance) {
      minDistance = distance;
      closest = rate;
    }
  }
  return closest;
}

function getCpuLevel(cpuSystemPercent: number): LoadLevel {
  if (cpuSystemPercent >= 35) return 'Heavy';
  if (cpuSystemPercent >= 15) return 'Moderate';
  return 'Light';
}

function getMemoryLevel(memorySystemPercent: number): LoadLevel {
  if (memorySystemPercent >= 18) return 'Heavy';
  if (memorySystemPercent >= 8) return 'Moderate';
  return 'Light';
}

function getFpsLevel(fpsPercentOfTarget: number): LoadLevel {
  if (fpsPercentOfTarget < 75) return 'Heavy';
  if (fpsPercentOfTarget < 90) return 'Moderate';
  return 'Light';
}

function getLevelRank(level: LoadLevel): number {
  if (level === 'Heavy') return 2;
  if (level === 'Moderate') return 1;
  return 0;
}

function maxLevel(levels: LoadLevel[]): LoadLevel {
  let strongest: LoadLevel = 'Light';
  for (const level of levels) {
    if (getLevelRank(level) > getLevelRank(strongest)) {
      strongest = level;
    }
  }
  return strongest;
}

interface PerformanceHudProps {
  enabled: boolean;
}

interface MetricRowProps {
  label: string;
  value: string;
  detail: string;
  relative: string;
  level: LoadLevel;
  levelColor: string;
  textColor: string;
  subtextColor: string;
}

function MetricRow({ label, value, detail, relative, level, levelColor, textColor, subtextColor }: MetricRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: textColor }}>{label}</span>
          <span style={{ fontSize: '9px', color: levelColor }}>{level}</span>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color: textColor }}>{value}</span>
      </div>
      <span style={{ fontSize: '10px', color: subtextColor }}>{detail}</span>
      <span style={{ fontSize: '10px', color: subtextColor }}>{relative}</span>
    </div>
  );
}

export default function PerformanceHud({ enabled }: PerformanceHudProps) {
  const { theme } = useTheme();

  const [snapshot, setSnapshot] = useState<ProcessPerformanceSnapshot | null>(null);
  const [fps, setFps] = useState<{ current: number; target: number }>({ current: 0, target: 60 });
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(HUD_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null);
  const baselineAccumulator = useRef<{ cpu: number[]; memory: number[] }>({ cpu: [], memory: [] });

  useEffect(() => {
    try {
      localStorage.setItem(HUD_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {
      // Ignore storage failures.
    }
  }, [collapsed]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setCpuHistory([]);
      setMemoryHistory([]);
      setFpsHistory([]);
      setBaseline(null);
      baselineAccumulator.current = { cpu: [], memory: [] };
      return;
    }

    let stopped = false;

    const pollSnapshot = async () => {
      try {
        const next = await window.clipboardAPI?.getPerformanceSnapshot?.();
        if (!stopped && next) {
          setSnapshot(next);
        }
      } catch {
        // Ignore transient polling failures and keep HUD responsive.
      }
    };

    pollSnapshot();
    const intervalId = setInterval(pollSnapshot, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !snapshot) return;

    setCpuHistory(prev => appendSample(prev, snapshot.cpuSystemPercent));
    setMemoryHistory(prev => appendSample(prev, snapshot.memorySystemPercent));

    if (baseline) return;

    baselineAccumulator.current.cpu.push(snapshot.cpuSystemPercent);
    baselineAccumulator.current.memory.push(snapshot.memoryUsedMb);

    if (baselineAccumulator.current.cpu.length >= BASELINE_SAMPLE_COUNT) {
      setBaseline({
        cpuSystemPercent: Math.max(0.1, average(baselineAccumulator.current.cpu)),
        memoryUsedMb: Math.max(1, average(baselineAccumulator.current.memory)),
      });
    }
  }, [enabled, snapshot, baseline]);

  useEffect(() => {
    if (!enabled) {
      setFps({ current: 0, target: 60 });
      setFpsHistory([]);
      return;
    }

    let rafId = 0;
    let frameCount = 0;
    let sampleStart = performance.now();
    let lastFrame = sampleStart;
    let deltaSum = 0;
    let deltaCount = 0;

    const sampleFps = (now: number) => {
      frameCount += 1;

      const frameDelta = now - lastFrame;
      lastFrame = now;
      if (frameDelta > 0 && frameDelta < 1000) {
        deltaSum += frameDelta;
        deltaCount += 1;
      }

      if (now - sampleStart >= POLL_INTERVAL_MS) {
        const elapsedMs = now - sampleStart;
        const current = elapsedMs > 0 ? Math.round((frameCount * 1000) / elapsedMs) : 0;
        const detectedRefresh = deltaCount > 0 ? 1000 / (deltaSum / deltaCount) : 60;
        const target = closestRefreshRate(detectedRefresh);

        setFps({ current, target });
        setFpsHistory(prev => appendSample(prev, current));

        frameCount = 0;
        sampleStart = now;
        deltaSum = 0;
        deltaCount = 0;
      }

      rafId = requestAnimationFrame(sampleFps);
    };

    rafId = requestAnimationFrame(sampleFps);
    return () => cancelAnimationFrame(rafId);
  }, [enabled]);

  const cpuLevel = useMemo(() => getCpuLevel(snapshot?.cpuSystemPercent ?? 0), [snapshot?.cpuSystemPercent]);
  const memoryLevel = useMemo(() => getMemoryLevel(snapshot?.memorySystemPercent ?? 0), [snapshot?.memorySystemPercent]);
  const fpsPercentOfTarget = useMemo(() => {
    if (!fps.target) return 0;
    return (fps.current / fps.target) * 100;
  }, [fps.current, fps.target]);
  const fpsLevel = useMemo(() => getFpsLevel(fpsPercentOfTarget), [fpsPercentOfTarget]);
  const overallLevel = useMemo(() => maxLevel([cpuLevel, memoryLevel, fpsLevel]), [cpuLevel, memoryLevel, fpsLevel]);

  if (!enabled || !snapshot) {
    return null;
  }

  const cpuBaselineRatio = baseline ? snapshot.cpuSystemPercent / baseline.cpuSystemPercent : null;
  const memoryBaselineRatio = baseline ? snapshot.memoryUsedMb / baseline.memoryUsedMb : null;
  const baselineStatus = baseline ? null : `Calibrating baseline (${baselineAccumulator.current.cpu.length}/${BASELINE_SAMPLE_COUNT})`;

  const cpuRelative = baselineStatus
    ? baselineStatus
    : `${cpuBaselineRatio ? cpuBaselineRatio.toFixed(1) : '1.0'}x startup baseline`;
  const memoryRelative = baselineStatus
    ? baselineStatus
    : `${memoryBaselineRatio ? memoryBaselineRatio.toFixed(1) : '1.0'}x startup baseline`;
  const fpsRelative = `${fpsPercentOfTarget.toFixed(0)}% of ${fps.target}fps target`;

  const levelColor = overallLevel === 'Heavy'
    ? theme.error
    : overallLevel === 'Moderate'
      ? theme.warning
      : theme.success;

  const averageCpu = average(cpuHistory);
  const averageMemory = average(memoryHistory);
  const averageFps = average(fpsHistory);

  if (collapsed) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '12px',
          right: '12px',
          zIndex: 9000,
          pointerEvents: 'none',
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          style={{
            pointerEvents: 'auto',
            borderRadius: '999px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.surface1,
            color: theme.text,
            padding: '5px 10px',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: theme.shadowMd,
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
          title="Show performance HUD"
        >
          Performance HUD
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        zIndex: 9000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: '280px',
          borderRadius: '10px',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.surface1,
          color: theme.text,
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: theme.shadowMd,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.2px' }}>Performance</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: levelColor,
                border: `1px solid ${levelColor}`,
                borderRadius: '999px',
                padding: '1px 7px',
              }}
            >
              {overallLevel}
            </span>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            style={{
              border: `1px solid ${theme.border}`,
              backgroundColor: 'transparent',
              color: theme.textSecondary,
              fontSize: '10px',
              lineHeight: 1,
              borderRadius: '4px',
              padding: '3px 6px',
              cursor: 'pointer',
            }}
            title="Hide performance HUD"
          >
            Hide
          </button>
        </div>

        <MetricRow
          label="CPU"
          value={`${snapshot.cpuPercent.toFixed(0)}%`}
          detail={`${snapshot.cpuCoresUsed.toFixed(2)} / ${snapshot.totalCores} cores (${snapshot.cpuSystemPercent.toFixed(1)}% system)`}
          relative={cpuRelative}
          level={cpuLevel}
          levelColor={levelColor}
          textColor={theme.text}
          subtextColor={theme.textSecondary}
        />

        <MetricRow
          label="RAM"
          value={`${snapshot.memoryUsedMb.toFixed(0)} MB`}
          detail={`${snapshot.memorySystemPercent.toFixed(1)}% of ${snapshot.totalMemoryGb.toFixed(1)} GB system RAM`}
          relative={memoryRelative}
          level={memoryLevel}
          levelColor={levelColor}
          textColor={theme.text}
          subtextColor={theme.textSecondary}
        />

        <MetricRow
          label="FPS"
          value={`${fps.current}/${fps.target}`}
          detail={`Current vs refresh target`}
          relative={fpsRelative}
          level={fpsLevel}
          levelColor={levelColor}
          textColor={theme.text}
          subtextColor={theme.textSecondary}
        />

        <div style={{
          marginTop: '2px',
          paddingTop: '6px',
          borderTop: `1px solid ${theme.border}`,
          fontSize: '9px',
          color: theme.textSecondary,
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>30s avg CPU {averageCpu.toFixed(1)}%</span>
          <span>RAM {averageMemory.toFixed(1)}%</span>
          <span>FPS {averageFps.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
