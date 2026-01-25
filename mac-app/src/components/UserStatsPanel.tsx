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

interface QuotaLimits {
  priorityMicMinutes: number;
  autoStackSessions: number;
  textImprovementWords: number;
  verbalCommands: number;
}

/**
 * Format a number for display (e.g., 1234 -> "1,234")
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function UserStatsPanel() {
  const { theme } = useTheme();
  const [data, setData] = useState<MetricsWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<'free' | 'pro'>('free');
  const [limits, setLimits] = useState<QuotaLimits | null>(null);

  // Load metrics and quota info on mount
  useEffect(() => {
    if (!window.metricsAPI) {
      setLoading(false);
      return;
    }

    window.metricsAPI.getMetricsWithStatus()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));

    // Also fetch quota info for Pro indicators
    window.quotaAPI?.getQuotas().then(quotas => {
      if (quotas) {
        setTier(quotas.tier);
      }
    }).catch(console.error);

    window.quotaAPI?.getLimits().then(setLimits).catch(console.error);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '16px', color: theme.textSecondary, fontSize: '13px' }}>
        Loading stats...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '16px', color: theme.textSecondary, fontSize: '13px' }}>
        Stats unavailable
      </div>
    );
  }

  const { metrics } = data;

  // Helper to format quota info for display
  const formatQuota = (limit: number | undefined, unit: string) => {
    if (tier === 'pro') return 'Unlimited';
    if (limit === undefined || limit === Infinity) return 'Unlimited';
    return `${limit.toLocaleString()}/${unit}`;
  };

  // Group metrics for display - compact format
  // Items with quotaInfo show the limit for free users or "Unlimited" for pro
  const sections = [
    {
      title: 'Transcription',
      items: [
        { label: 'Total transcriptions', value: metrics.transcriptions },
        { label: 'Words transcribed', value: metrics.words_transcribed },
        {
          label: 'Priority mic minutes',
          value: metrics.priority_mic_minutes,
          quotaInfo: formatQuota(limits?.priorityMicMinutes, 'mo'),
        },
      ],
    },
    {
      title: 'Voice Commands',
      items: [
        {
          label: 'Verbal commands',
          value: metrics.verbal_commands,
          quotaInfo: formatQuota(limits?.verbalCommands, 'mo'),
        },
        { label: 'Command launcher uses', value: metrics.command_launcher_uses },
      ],
    },
    {
      title: 'Clipboard',
      items: [
        { label: 'Items captured', value: metrics.clipboard_items },
        { label: 'Pastes used', value: metrics.pastes_used },
        { label: 'Stacks created', value: metrics.stacks_created },
        {
          label: 'Autostacks created',
          value: metrics.autostacks_created,
          quotaInfo: formatQuota(limits?.autoStackSessions, 'mo'),
        },
        { label: 'Stacks pasted', value: metrics.stacks_pasted },
        { label: 'Items added to context', value: metrics.items_added_to_context },
      ],
    },
    {
      title: 'Creative',
      items: [
        { label: 'Drawings created', value: metrics.sketches_created },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: 600,
          color: theme.text,
          letterSpacing: '-0.01em'
        }}>
          Stats
        </h3>
        <p style={{
          margin: '4px 0 0 0',
          fontSize: '12px',
          color: theme.textSecondary
        }}>
          The metrics you see are the metrics we see.
        </p>
      </div>

      {/* Stats sections - compact layout */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`
      }}>
        {sections.map((section, sectionIndex) => (
          <div key={section.title}>
            {sectionIndex > 0 && (
              <div style={{
                height: '1px',
                backgroundColor: theme.isDark ? theme.border : '#e5e7eb',
                margin: '8px 0'
              }} />
            )}
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              color: theme.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '4px'
            }}>
              {section.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {section.items.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    lineHeight: '1.4'
                  }}
                >
                  <span style={{ color: theme.text }}>
                    {item.label}
                    {item.quotaInfo && (
                      <span style={{
                        marginLeft: '6px',
                        fontSize: '10px',
                        color: tier === 'pro' ? theme.accent : theme.textSecondary,
                        fontWeight: tier === 'pro' ? 500 : 400,
                      }}>
                        {item.quotaInfo}
                      </span>
                    )}
                  </span>
                  <span style={{
                    color: item.value > 0 ? theme.accent : theme.textSecondary,
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
        color: theme.textSecondary,
        margin: 0,
        lineHeight: 1.4
      }}>
        These are the only metrics we aggregate. We don't track clipboard content,
        transcription text, or anything outside this list.
      </p>
    </div>
  );
}
