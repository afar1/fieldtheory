import { BrowserWindow, ipcMain } from 'electron';
import type { QuotaFeature, QuotaManager } from './quotaManager';

export const QuotaIPCChannels = {
  GET_QUOTAS: 'quota:getQuotas',
  CHECK_QUOTA: 'quota:checkQuota',
  GET_FORMATTED_USAGE: 'quota:getFormattedUsage',
  GET_RESET_DATE: 'quota:getResetDate',
  GET_DAYS_UNTIL_RESET: 'quota:getDaysUntilReset',
  GET_LIMITS: 'quota:getLimits',
  REFRESH_TIER: 'quota:refreshTier',
} as const;

export type RendererQuotaFeature = 'priorityMic' | 'autoStack' | 'textImprove' | 'portableCommands';

const rendererFeatureMap: Record<RendererQuotaFeature, QuotaFeature> = {
  priorityMic: 'priority_mic_seconds',
  autoStack: 'auto_stack_sessions',
  textImprove: 'text_improve_words',
  portableCommands: 'portable_commands',
};

type QuotaIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getQuotaManager: () => QuotaManager | null;
  broadcastTierChanged?: (tier: string) => void;
  logError?: (message: string, error: unknown) => void;
};

export function registerQuotaIpc({
  ipcMain: targetIpcMain = ipcMain,
  getQuotaManager,
  broadcastTierChanged = (tier: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('tier:changed', tier);
      }
    });
  },
  logError = () => {},
}: QuotaIpcDependencies): void {
  targetIpcMain.handle(QuotaIPCChannels.GET_QUOTAS, async () => {
    return getQuotaManager()?.getQuotas() ?? null;
  });

  targetIpcMain.handle(QuotaIPCChannels.CHECK_QUOTA, async (_event, feature: RendererQuotaFeature) => {
    const quotaManager = getQuotaManager();
    if (!quotaManager) {
      return { allowed: true, used: 0, limit: Infinity, remaining: Infinity, percentUsed: 0 };
    }

    return quotaManager.getFeatureStatus(rendererFeatureMap[feature]);
  });

  targetIpcMain.handle(QuotaIPCChannels.GET_FORMATTED_USAGE, async () => {
    const quotaManager = getQuotaManager();
    if (!quotaManager) {
      return { priorityMic: 'Unlimited', autoStack: 'Unlimited', textImprove: 'Unlimited', portableCommands: 'Unlimited' };
    }

    return {
      priorityMic: quotaManager.formatPriorityMicUsage(),
      autoStack: quotaManager.formatAutoStackUsage(),
      textImprove: quotaManager.formatTextImproveUsage(),
      portableCommands: quotaManager.formatPortableCommandsUsage(),
    };
  });

  targetIpcMain.handle(QuotaIPCChannels.GET_RESET_DATE, async () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  });

  targetIpcMain.handle(QuotaIPCChannels.GET_DAYS_UNTIL_RESET, async () => {
    return getQuotaManager()?.getDaysUntilReset() ?? 0;
  });

  targetIpcMain.handle(QuotaIPCChannels.GET_LIMITS, async () => {
    const quotaManager = getQuotaManager();
    if (!quotaManager) {
      return {
        priorityMicMinutes: Infinity,
        autoStackSessions: Infinity,
        textImprovementWords: Infinity,
        portableCommands: Infinity,
      };
    }

    const raw = quotaManager.getLimits();
    return {
      priorityMicMinutes: raw.priority_mic_seconds === Infinity ? Infinity : Math.floor(raw.priority_mic_seconds / 60),
      autoStackSessions: raw.auto_stack_sessions,
      textImprovementWords: raw.text_improve_words,
      portableCommands: raw.portable_commands,
    };
  });

  targetIpcMain.handle(QuotaIPCChannels.REFRESH_TIER, async () => {
    const quotaManager = getQuotaManager();
    if (!quotaManager) {
      return { tier: 'free', error: 'Not initialized' };
    }

    try {
      await quotaManager.syncFromServer();
      const tier = quotaManager.getCachedTier();
      broadcastTierChanged(tier);
      return { tier, error: null };
    } catch (err) {
      logError('Error refreshing tier:', err);
      return { tier: quotaManager.getCachedTier(), error: String(err) };
    }
  });
}
