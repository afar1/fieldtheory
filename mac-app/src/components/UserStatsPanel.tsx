/**
 * UserStatsPanel - Display user's own usage metrics.
 *
 * Philosophy: "The metrics you see are the metrics we see."
 * Shows users their Field Theory stats. These same metrics are aggregated
 * (no content, just counts) to understand which features provide value.
 */

import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface UserMetrics {
  transcriptions: number;
  words_transcribed: number;
  priority_mic_minutes: number;
  verbal_commands: number;
  command_launcher_uses: number;
  clipboard_items: number;
  pastes_used: number;
  stacks_created: number;
  autostacks_created: number;
  stacks_pasted: number;
  items_added_to_context: number;
  sketches_created: number;
  screenshots_taken: number;
  librarian_artifacts_created: number;
  librarian_artifacts_shared: number;
  commands_executed: number;
  commands_contributed: number;
  feedback_given: number;
}

interface MetricsWithStatus {
  metrics: UserMetrics;
  lastSyncedAt: string | null;
  pendingSync: boolean;
}

/**
 * Format a number for display (e.g., 1234 -> "1,234")
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format timestamp for display
 */
function formatSyncTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hr ago`;
  return date.toLocaleDateString();
}

export default function UserStatsPanel() {
  const { theme } = useTheme();
  const [data, setData] = useState<MetricsWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Load metrics on mount
  useEffect(() => {
    if (!window.metricsAPI) {
      setLoading(false);
      return;
    }

    window.metricsAPI.getMetricsWithStatus()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Manual sync handler
  const handleSync = async () => {
    if (!window.metricsAPI || syncing) return;
    setSyncing(true);
    try {
      await window.metricsAPI.syncToSupabase();
      const newData = await window.metricsAPI.getMetricsWithStatus();
      setData(newData);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const isDark = theme === 'dark';
  const textColor = isDark ? '#e5e5e5' : '#1f2937';
  const mutedColor = isDark ? '#9ca3af' : '#6b7280';
  const borderColor = isDark ? '#374151' : '#e5e7eb';
  const bgColor = isDark ? '#1f2937' : '#f9fafb';
  const accentColor = '#8b5cf6'; // Violet accent

  if (loading) {
    return (
      <div style={{ padding: '16px', color: mutedColor, fontSize: '13px' }}>
        Loading stats...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '16px', color: mutedColor, fontSize: '13px' }}>
        Stats unavailable
      </div>
    );
  }

  const { metrics, lastSyncedAt, pendingSync } = data;

  // Group metrics for display
  const sections = [
    {
      title: 'Transcription',
      items: [
        { label: 'Total transcriptions', value: metrics.transcriptions },
        { label: 'Words transcribed', value: metrics.words_transcribed },
        { label: 'Priority mic minutes', value: metrics.priority_mic_minutes },
      ],
    },
    {
      title: 'Voice Commands',
      items: [
        { label: 'Verbal commands', value: metrics.verbal_commands },
        { label: 'Command launcher uses', value: metrics.command_launcher_uses },
      ],
    },
    {
      title: 'Clipboard',
      items: [
        { label: 'Items captured', value: metrics.clipboard_items },
        { label: 'Pastes used', value: metrics.pastes_used },
        { label: 'Stacks created', value: metrics.stacks_created },
        { label: 'Autostacks created', value: metrics.autostacks_created },
        { label: 'Stacks pasted', value: metrics.stacks_pasted },
        { label: 'Items added to context', value: metrics.items_added_to_context },
      ],
    },
    {
      title: 'Creative',
      items: [
        { label: 'Sketches created', value: metrics.sketches_created },
        { label: 'Screenshots taken', value: metrics.screenshots_taken },
      ],
    },
    {
      title: 'Librarian',
      items: [
        { label: 'Artifacts created', value: metrics.librarian_artifacts_created },
        { label: 'Artifacts shared', value: metrics.librarian_artifacts_shared },
      ],
    },
    {
      title: 'Commands',
      items: [
        { label: 'Commands executed', value: metrics.commands_executed },
        { label: 'Commands contributed', value: metrics.commands_contributed },
      ],
    },
    {
      title: 'Community',
      items: [
        { label: 'Feedback given', value: metrics.feedback_given },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '4px'
      }}>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: '14px',
            fontWeight: 600,
            color: textColor,
            letterSpacing: '-0.01em'
          }}>
            Your Stats
          </h3>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: '12px',
            color: mutedColor
          }}>
            The metrics you see are the metrics we see.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: syncing ? mutedColor : accentColor,
            backgroundColor: 'transparent',
            border: `1px solid ${syncing ? borderColor : accentColor}`,
            borderRadius: '6px',
            cursor: syncing ? 'default' : 'pointer',
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>

      {/* Sync status */}
      <div style={{
        fontSize: '11px',
        color: mutedColor,
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span>Last synced: {formatSyncTime(lastSyncedAt)}</span>
        {pendingSync && (
          <span style={{
            color: '#f59e0b',
            fontWeight: 500
          }}>
            (changes pending)
          </span>
        )}
      </div>

      {/* Stats sections */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        backgroundColor: bgColor,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${borderColor}`
      }}>
        {sections.map((section, sectionIndex) => (
          <div key={section.title}>
            {sectionIndex > 0 && (
              <div style={{
                height: '1px',
                backgroundColor: borderColor,
                margin: '8px 0 12px 0'
              }} />
            )}
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              color: mutedColor,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px'
            }}>
              {section.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {section.items.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px'
                  }}
                >
                  <span style={{ color: textColor }}>{item.label}</span>
                  <span style={{
                    color: item.value > 0 ? accentColor : mutedColor,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {formatNumber(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Privacy note */}
      <p style={{
        fontSize: '11px',
        color: mutedColor,
        margin: '4px 0 0 0',
        lineHeight: 1.4
      }}>
        These are the only metrics we aggregate. We don't track clipboard content,
        transcription text, or anything outside this list.
      </p>
    </div>
  );
}
