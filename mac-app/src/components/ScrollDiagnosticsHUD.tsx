/**
 * ScrollDiagnosticsHUD — floating panel that surfaces scroll-perf metrics
 * captured by `utils/scrollDiagnostics.ts`. Visible only when the user has
 * opted in via `window.ftDebugScroll.enable()`.
 */
import { useEffect, useState } from 'react';
import {
  subscribeScrollDiagnostics,
  setScrollDiagnosticsEnabled,
  type ScrollDiagnosticsSnapshot,
} from '../utils/scrollDiagnostics';

const PANEL_WIDTH = 248;

function fpsColor(fps: number): string {
  if (fps === 0) return '#9ca3af';
  if (fps >= 55) return '#22c55e';
  if (fps >= 40) return '#eab308';
  return '#ef4444';
}

export default function ScrollDiagnosticsHUD() {
  const [snap, setSnap] = useState<ScrollDiagnosticsSnapshot | null>(null);

  useEffect(() => subscribeScrollDiagnostics(setSnap), []);

  if (!snap || !snap.enabled) return null;

  const longTaskTotal = snap.longTasks.reduce((sum, t) => sum + t.duration, 0);
  const longestTask = snap.longTasks.reduce(
    (max, t) => Math.max(max, t.duration),
    0,
  );

  return (
    <div
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: 9999,
        width: `${PANEL_WIDTH}px`,
        padding: '8px 10px',
        borderRadius: '8px',
        backgroundColor: 'rgba(20,20,20,0.92)',
        color: '#f5f5f5',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '10.5px',
        lineHeight: 1.4,
        boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <strong style={{ fontSize: '11px' }}>scroll diag</strong>
        <button
          type="button"
          onClick={() => setScrollDiagnosticsEnabled(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: '10px',
            padding: 0,
          }}
          title="Hide HUD (window.ftDebugScroll.enable() to show again)"
        >
          ×
        </button>
      </div>

      <div style={{ marginBottom: '4px' }}>
        <div style={{ color: '#9ca3af', fontSize: '9.5px' }}>scroll fps (last burst)</div>
        {Object.entries(snap.scrollByLastSource).length === 0 && (
          <div style={{ color: '#6b7280' }}>—</div>
        )}
        {Object.entries(snap.scrollByLastSource).map(([source, rec]) => (
          <div key={source} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{source}</span>
            <span>
              <span style={{ color: fpsColor(rec.fps) }}>{rec.fps}fps</span>
              {' '}
              <span style={{ color: '#9ca3af' }}>worst {Math.round(rec.longestFrameMs)}ms</span>
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '4px' }}>
        <div style={{ color: '#9ca3af', fontSize: '9.5px' }}>long tasks (&gt;50ms)</div>
        <div>
          count {snap.longTasks.length}
          {' · '}
          total {Math.round(longTaskTotal)}ms
          {' · '}
          peak {Math.round(longestTask)}ms
        </div>
      </div>
    </div>
  );
}
