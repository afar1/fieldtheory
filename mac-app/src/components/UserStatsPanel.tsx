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
  words_improved: number;
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
function formatNumber(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString();
}

// Quota status for checking if at limit
interface QuotaStatus {
  used: number;
  limit: number;
  allowed: boolean;
  percentUsed: number;
}

interface FullQuotas {
  tier: 'free' | 'pro';
  priorityMic: QuotaStatus;
  autoStack: QuotaStatus;
  textImprove: QuotaStatus;
  verbalCommands: QuotaStatus;
}

// Clipboard cumulative stats (authoritative for transcription metrics)
interface ClipboardStats {
  stacks: number;
  transcriptions: number;
  screenshots: number;
  words: number;
  improved: number;
}

export default function UserStatsPanel() {
  const { theme } = useTheme();
  const [data, setData] = useState<MetricsWithStatus | null>(null);
  const [clipboardStats, setClipboardStats] = useState<ClipboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<'free' | 'pro'>('free');
  const [limits, setLimits] = useState<QuotaLimits | null>(null);
  const [quotas, setQuotas] = useState<FullQuotas | null>(null);

  // Load metrics and quota info on mount
  useEffect(() => {
    let metricsLoaded = false;
    let clipboardLoaded = false;

    const checkDone = () => {
      if (metricsLoaded && clipboardLoaded) {
        setLoading(false);
      }
    };

    // Load from metricsAPI (user-metrics.json) for non-transcription stats
    if (window.metricsAPI) {
      window.metricsAPI.getMetricsWithStatus()
        .then(setData)
        .catch(console.error)
        .finally(() => { metricsLoaded = true; checkDone(); });
    } else {
      metricsLoaded = true;
    }

    // Load from clipboardAPI (clipboard.db cumulative_stats) for transcription stats
    // This is the authoritative source - same as footer stats
    if (window.clipboardAPI?.getAllTimeStats) {
      window.clipboardAPI.getAllTimeStats()
        .then(setClipboardStats)
        .catch(console.error)
        .finally(() => { clipboardLoaded = true; checkDone(); });
    } else {
      clipboardLoaded = true;
    }

    checkDone();

    // Fetch full quota info for tier and at-limit states
    window.quotaAPI?.getQuotas().then(q => {
      if (q) {
        setTier(q.tier);
        setQuotas(q as FullQuotas);
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
  // Shows actual limit regardless of tier (Pro has limits on some features like text improvement)
  const formatQuota = (limit: number | undefined, unit: string) => {
    if (limit === undefined || limit === Infinity || limit >= Number.MAX_SAFE_INTEGER) return 'Unlimited';
    return `${limit.toLocaleString()}/${unit}`;
  };

  // Check if a quota is at or over limit
  const isAtQuota = (status: QuotaStatus | undefined) => {
    if (!status) return false;
    return !status.allowed || status.percentUsed >= 100;
  };

  // Group metrics for display - compact format
  // Items with quotaInfo show the limit, atQuota shows red when at limit
  // Use clipboardStats (from clipboard.db) as authoritative source for transcription metrics
  // This matches the footer stats and persists across sessions
  const sections = [
    {
      title: 'Transcription',
      items: [
        { label: 'Total transcriptions', value: clipboardStats?.transcriptions ?? metrics.transcriptions },
        { label: 'Words transcribed', value: clipboardStats?.words ?? metrics.words_transcribed },
        {
          label: 'Words improved',
          value: clipboardStats?.improved ?? metrics.words_improved,
          quotaInfo: formatQuota(limits?.textImprovementWords, 'mo'),
          atQuota: isAtQuota(quotas?.textImprove),
        },
        {
          label: 'Priority mic minutes',
          value: metrics.priority_mic_minutes,
          quotaInfo: formatQuota(limits?.priorityMicMinutes, 'mo'),
          atQuota: isAtQuota(quotas?.priorityMic),
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
          atQuota: isAtQuota(quotas?.verbalCommands),
        },
        { label: 'Command launcher uses', value: metrics.command_launcher_uses },
      ],
    },
    {
      title: 'Clipboard',
      items: [
        { label: 'Items captured', value: metrics.clipboard_items },
        { label: 'Pastes used', value: metrics.pastes_used },
        { label: 'Stacks created', value: clipboardStats?.stacks ?? metrics.stacks_created },
        {
          label: 'Autostacks created',
          value: metrics.autostacks_created,
          quotaInfo: formatQuota(limits?.autoStackSessions, 'mo'),
          atQuota: isAtQuota(quotas?.autoStack),
        },
        { label: 'Stacks pasted', value: metrics.stacks_pasted },
        { label: 'Items added to context', value: metrics.items_added_to_context },
      ],
    },
    {
      title: 'Creative',
      items: [
        { label: 'Drawings created', value: metrics.sketches_created },
        { label: 'Screenshots taken', value: clipboardStats?.screenshots ?? metrics.screenshots_taken },
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
          fontSize: '11px',
          color: theme.textSecondary,
          lineHeight: 1.4
        }}>
          These are the only metrics we aggregate. We don't track clipboard content,
          transcription text, or anything outside this list.
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
                        color: item.atQuota ? theme.error : (tier === 'pro' ? theme.accent : theme.textSecondary),
                        fontWeight: item.atQuota ? 600 : (tier === 'pro' ? 500 : 400),
                      }}>
                        {item.atQuota ? 'Limit reached' : item.quotaInfo}
                      </span>
                    )}
                  </span>
                  <span style={{
                    color: item.atQuota ? theme.error : (item.value > 0 ? theme.accent : theme.textSecondary),
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
    </div>
  );
}
