import { ipcMain } from 'electron';
import type { MetricsManager, UserMetrics } from './metricsManager';

export const MetricsIPCChannels = {
  GET_METRICS: 'metrics:getMetrics',
  GET_METRICS_WITH_STATUS: 'metrics:getMetricsWithStatus',
  SYNC_TO_SUPABASE: 'metrics:syncToSupabase',
  FETCH_FROM_SUPABASE: 'metrics:fetchFromSupabase',
} as const;

const defaultMetrics: UserMetrics = {
  transcriptions: 0,
  words_transcribed: 0,
  words_improved: 0,
  priority_mic_minutes: 0,
  verbal_commands: 0,
  command_launcher_uses: 0,
  clipboard_items: 0,
  pastes_used: 0,
  stacks_created: 0,
  autostacks_created: 0,
  stacks_pasted: 0,
  items_added_to_context: 0,
  sketches_created: 0,
  screenshots_taken: 0,
  librarian_artifacts_created: 0,
  librarian_artifacts_shared: 0,
  commands_executed: 0,
  commands_contributed: 0,
  feedback_given: 0,
};

type MetricsIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getMetricsManager: () => MetricsManager | null;
};

export function registerMetricsIpc({
  ipcMain: targetIpcMain = ipcMain,
  getMetricsManager,
}: MetricsIpcDependencies): void {
  targetIpcMain.handle(MetricsIPCChannels.GET_METRICS, (): UserMetrics => {
    return getMetricsManager()?.getMetrics() ?? defaultMetrics;
  });

  targetIpcMain.handle(MetricsIPCChannels.GET_METRICS_WITH_STATUS, () => {
    return getMetricsManager()?.getMetricsWithStatus() ?? {
      metrics: defaultMetrics,
      lastSyncedAt: null,
      pendingSync: false,
    };
  });

  targetIpcMain.handle(MetricsIPCChannels.SYNC_TO_SUPABASE, async (): Promise<boolean> => {
    return getMetricsManager()?.syncToSupabase() ?? false;
  });

  targetIpcMain.handle(MetricsIPCChannels.FETCH_FROM_SUPABASE, async (): Promise<boolean> => {
    return getMetricsManager()?.fetchFromSupabase() ?? false;
  });
}
