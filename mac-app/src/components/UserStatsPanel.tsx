/**
 * UserStatsPanel - Display user's own usage metrics.
 *
 * Philosophy: "The metrics you see are the metrics we see."
 * Shows users their Field Theory stats. These same metrics are aggregated
 * (no content, just counts) to understand which features provide value.
 */

import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SETTINGS_CARD_GAP, SettingsSectionHeading } from './settings/SettingsPrimitives';

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
  portableCommands: number;
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
  portableCommands: QuotaStatus;
}

interface StatItem {
  label: string;
  value: number;
  quotaInfo?: string;
  atQuota?: boolean;
}

interface StatSection {
  title: string;
  items: StatItem[];
  quotaInfo?: string;
  atQuota?: boolean;
}

interface SummaryStat {
  label: string;
  value: number;
  detail: string;
  quotaInfo?: string;
  atQuota?: boolean;
}

export default function UserStatsPanel() {
  const { theme } = useTheme();
  const [data, setData] = useState<MetricsWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<'free' | 'pro'>('free');
  const [limits, setLimits] = useState<QuotaLimits | null>(null);
  const [quotas, setQuotas] = useState<FullQuotas | null>(null);

  // Load metrics and quota info on mount.
  // MetricsManager is the single source of truth for all stats (synced to Supabase).
  useEffect(() => {
    if (window.metricsAPI) {
      window.metricsAPI.getMetricsWithStatus()
        .then(setData)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

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

  const quotaColor = (atQuota?: boolean) => {
    if (atQuota) return theme.error;
    return tier === 'pro' ? theme.accent : theme.textSecondary;
  };

  const summaryStats: SummaryStat[] = [
    {
      label: 'Transcriptions',
      value: metrics.transcriptions,
      detail: `${formatNumber(metrics.words_transcribed)} words captured`,
    },
    {
      label: 'Words improved',
      value: metrics.words_improved,
      detail: 'Text improvement',
      quotaInfo: formatQuota(limits?.textImprovementWords, 'mo'),
      atQuota: isAtQuota(quotas?.textImprove),
    },
    {
      label: 'Clipboard items',
      value: metrics.clipboard_items,
      detail: `${formatNumber(metrics.pastes_used)} pastes used`,
    },
    {
      label: 'Commands run',
      value: metrics.commands_executed,
      detail: `${formatNumber(metrics.verbal_commands)} voice commands`,
      quotaInfo: formatQuota(limits?.portableCommands, 'mo'),
      atQuota: isAtQuota(quotas?.portableCommands),
    },
  ];

  // Group metrics for display.
  // Items with quotaInfo show the limit, atQuota shows red when at limit.
  // All stats come from MetricsManager (single source of truth, synced to Supabase).
  const sections: StatSection[] = [
    {
      title: 'Voice & Transcription',
      items: [
        { label: 'Total transcriptions', value: metrics.transcriptions },
        { label: 'Words transcribed', value: metrics.words_transcribed },
        {
          label: 'Words improved',
          value: metrics.words_improved,
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
      title: 'Commands',
      quotaInfo: formatQuota(limits?.portableCommands, 'mo'),
      atQuota: isAtQuota(quotas?.portableCommands),
      items: [
        { label: 'Portable commands', value: metrics.commands_executed },
        { label: 'Command launcher opens', value: metrics.command_launcher_uses },
        { label: 'Voice commands', value: metrics.verbal_commands },
        { label: 'Commands contributed', value: metrics.commands_contributed },
      ],
    },
    {
      title: 'Clipboard & Context',
      items: [
        { label: 'Items captured', value: metrics.clipboard_items },
        { label: 'Pastes used', value: metrics.pastes_used },
        { label: 'Stacks created', value: metrics.stacks_created },
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
        { label: 'Screenshots taken', value: metrics.screenshots_taken },
      ],
    },
    {
      title: 'Librarian & Community',
      items: [
        { label: 'Artifacts created', value: metrics.librarian_artifacts_created },
        { label: 'Artifacts shared', value: metrics.librarian_artifacts_shared },
        { label: 'Feedback given', value: metrics.feedback_given },
      ],
    },
  ];

  const syncLabel = data.pendingSync
    ? 'Sync pending'
    : data.lastSyncedAt
      ? `Last synced ${new Date(data.lastSyncedAt).toLocaleDateString()}`
      : 'Not synced yet';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_CARD_GAP }}>
      <SettingsSectionHeading
        theme={theme}
        title="Stats"
        description="These are the only metrics we aggregate. We do not track clipboard content, transcription text, or anything outside this list."
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(142px, 1fr))',
        gap: '10px',
      }}>
        {summaryStats.map((stat) => (
          <div
            key={stat.label}
            style={{
              background: theme.isDark ? theme.surface1 : '#ffffff',
              border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
              borderRadius: '6px',
              padding: '14px 14px 12px',
              minWidth: 0,
            }}
          >
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              color: theme.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: 0,
            }}>
              {stat.label}
            </div>
            <div style={{
              color: stat.atQuota ? theme.error : theme.text,
              fontSize: '26px',
              lineHeight: 1.1,
              fontWeight: 520,
              fontVariantNumeric: 'tabular-nums',
              marginTop: '6px',
            }}>
              {formatNumber(stat.value)}
            </div>
            <div style={{
              color: stat.atQuota ? theme.error : theme.textSecondary,
              fontSize: '11px',
              lineHeight: 1.35,
              marginTop: '6px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {stat.atQuota ? 'Limit reached' : stat.quotaInfo ?? stat.detail}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '10px',
      }}>
        {sections.map((section) => (
          <div
            key={section.title}
            style={{
              background: theme.isDark ? theme.surface1 : '#ffffff',
              border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
              borderRadius: '6px',
              padding: '12px 14px',
              minWidth: 0,
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 650,
                color: theme.text,
              }}>
                {section.title}
              </div>
              {section.quotaInfo && (
                <div style={{
                  color: quotaColor(section.atQuota),
                  border: `1px solid ${section.atQuota ? theme.error : (theme.isDark ? theme.border : '#e5e7eb')}`,
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: section.atQuota ? 650 : (tier === 'pro' ? 550 : 450),
                  lineHeight: 1,
                  padding: '4px 7px',
                  whiteSpace: 'nowrap',
                }}>
                  {section.atQuota ? 'Limit reached' : section.quotaInfo}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {section.items.map((item, itemIndex) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    borderTop: itemIndex === 0 ? '0' : `1px solid ${theme.isDark ? theme.border : '#eef0f2'}`,
                    padding: itemIndex === 0 ? '0 0 7px' : '7px 0',
                    fontSize: '12px',
                    lineHeight: 1.35,
                  }}
                >
                  <span style={{
                    color: theme.textSecondary,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.label}
                  </span>
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: item.atQuota ? theme.error : (item.value > 0 ? theme.text : theme.textSecondary),
                    fontWeight: 520,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.quotaInfo && (
                      <span style={{
                        color: quotaColor(item.atQuota),
                        fontSize: '10px',
                        fontWeight: item.atQuota ? 650 : (tier === 'pro' ? 550 : 450),
                      }}>
                        {item.atQuota ? 'Limit reached' : item.quotaInfo}
                      </span>
                    )}
                    {formatNumber(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        color: theme.textSecondary,
        fontSize: '11px',
        lineHeight: 1.35,
      }}>
        {syncLabel}
      </div>
    </div>
  );
}
