import React, { useCallback, useEffect, useState } from 'react';

type TrialState = 'pro' | 'trial' | 'expired';

interface TrialInfo {
  state: TrialState;
  trialEndsAt: string | null;
  nextTrialResetAt: string | null;
}

interface TrialGateProps {
  children: React.ReactNode;
  // Banners are noisy in tiny popup windows (e.g. command launcher); opt out per-surface.
  showBanner?: boolean;
  // Fires when the paywall first renders. The command launcher uses this to resize
  // its tiny popup window so the paywall is visible.
  onPaywallMount?: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

async function openUpgradeLink(): Promise<void> {
  const paymentLink = window.stripeConfig?.paymentLink ?? '';
  if (!paymentLink) return;
  const session = await window.authAPI?.getSession?.();
  const userId: string | undefined = session?.user?.id;
  const email: string | undefined = session?.user?.email;
  const url = userId
    ? `${paymentLink}?client_reference_id=${userId}&prefilled_email=${encodeURIComponent(email ?? '')}`
    : paymentLink;
  window.shellAPI?.openExternal(url);
}

export default function TrialGate({ children, showBanner = true, onPaywallMount }: TrialGateProps) {
  const [info, setInfo] = useState<TrialInfo | null>(null);

  const refresh = useCallback(async () => {
    const quotas = await window.quotaAPI?.getQuotas?.();
    if (quotas) {
      setInfo({
        state: (quotas.state ?? 'pro') as TrialState,
        trialEndsAt: quotas.trialEndsAt ?? null,
        nextTrialResetAt: quotas.nextTrialResetAt ?? null,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = window.quotaAPI?.onStateChanged?.(() => { refresh(); });
    return () => { unsub?.(); };
  }, [refresh]);

  // Permissive while we haven't loaded yet — never lock out before we've confirmed state.
  if (!info) return <>{children}</>;

  if (info.state === 'expired') {
    return (
      <ExpiredPaywall
        nextTrialResetAt={info.nextTrialResetAt}
        onRefresh={refresh}
        onMount={onPaywallMount}
      />
    );
  }

  if (info.state === 'trial' && showBanner) {
    return (
      <>
        <TrialBanner trialEndsAt={info.trialEndsAt} />
        {children}
      </>
    );
  }

  return <>{children}</>;
}

// =============================================================================
// Expired paywall — full-screen takeover when state === 'expired'.
// =============================================================================

function ExpiredPaywall({
  nextTrialResetAt,
  onRefresh,
  onMount,
}: {
  nextTrialResetAt: string | null;
  onRefresh: () => Promise<void>;
  onMount?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const days = daysUntil(nextTrialResetAt);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <div style={styles.paywallRoot}>
      <div style={styles.paywallCard}>
        <h1 style={styles.headline}>Your trial has ended</h1>
        <p style={styles.body}>
          Upgrade to Pro for $10/mo to keep using Field Theory, or come back in{' '}
          <strong>{days} day{days === 1 ? '' : 's'}</strong> for another 14-day trial.
        </p>
        <div style={styles.buttonRow}>
          <button style={styles.primaryButton} onClick={openUpgradeLink}>
            Upgrade to Pro
          </button>
          <button style={styles.secondaryButton} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Checking…' : 'I just paid'}
          </button>
        </div>
        <p style={styles.footnote}>
          Your local data stays on disk while expired — only the viewer is locked.
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Trial banner — small persistent badge during the 14-day active window.
// Only renders in the last few days to avoid badge fatigue.
// =============================================================================

function TrialBanner({ trialEndsAt }: { trialEndsAt: string | null }) {
  const days = daysUntil(trialEndsAt);
  if (days > 3) return null;

  return (
    <div style={styles.banner}>
      <span>
        Trial ends in <strong>{days} day{days === 1 ? '' : 's'}</strong>
      </span>
      <button style={styles.bannerButton} onClick={openUpgradeLink}>
        Upgrade
      </button>
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  paywallRoot: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 15, 20, 0.96)',
    color: '#f5f5f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '24px',
  },
  paywallCard: {
    maxWidth: 440,
    width: '100%',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  headline: {
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  body: {
    fontSize: 14,
    lineHeight: 1.5,
    color: '#c8c8d0',
    margin: 0,
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginTop: '8px',
  },
  primaryButton: {
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 500,
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '8px 14px',
    fontSize: 13,
    background: 'transparent',
    color: '#c8c8d0',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  footnote: {
    fontSize: 11,
    color: '#888',
    margin: 0,
    marginTop: '4px',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    background: 'rgba(245, 158, 11, 0.12)',
    color: '#f5f5f7',
    fontSize: 11,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
  },
  bannerButton: {
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    background: '#f59e0b',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
};
