import { ipcMain } from 'electron';
import type { MeetingFileContext, MeetingManager } from './meetingManager';
import type { AmbientSettings } from '../shared/ambientSettings';

export const MeetingsIPCChannels = {
  CREATE: 'meetings:create',
  START_HERE: 'meetings:startHere',
  STOP: 'meetings:stop',
  CANCEL: 'meetings:cancel',
  GET_ACTIVE: 'meetings:getActive',
  SUMMARIZE_CURRENT: 'meetings:summarizeCurrent',
  GET_AMBIENT_SETTINGS: 'meetings:getAmbientSettings',
  SAVE_AMBIENT_SETTINGS: 'meetings:saveAmbientSettings',
  RESET_AMBIENT_SETTINGS: 'meetings:resetAmbientSettings',
} as const;

export type AmbientSettingsSaveResult = {
  success: boolean;
  settings: AmbientSettings;
  appliedToActiveTask: boolean;
  error?: string;
};

type MeetingIpcManager = Pick<
  MeetingManager,
  | 'createMeetingNote'
  | 'startHere'
  | 'stopActiveMeeting'
  | 'cancelActiveMeeting'
  | 'getActiveSession'
  | 'summarizeCurrentMeeting'
>;

type MeetingsIpcDependencies = {
  ipcMain?: Pick<typeof ipcMain, 'handle'>;
  getMeetingManager: () => MeetingIpcManager;
  getActiveFileContext: () => MeetingFileContext | null;
  getAmbientSettings: () => AmbientSettings;
  saveAmbientSettings: (settings: AmbientSettings) => Promise<AmbientSettingsSaveResult>;
  resetAmbientSettings: () => Promise<AmbientSettingsSaveResult>;
};

async function runMeetingAction(action: () => Promise<unknown>): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Meeting action failed',
    };
  }
}

export function registerMeetingsIpc({
  ipcMain: targetIpcMain = ipcMain,
  getMeetingManager,
  getActiveFileContext,
  getAmbientSettings,
  saveAmbientSettings,
  resetAmbientSettings,
}: MeetingsIpcDependencies): void {
  targetIpcMain.handle(MeetingsIPCChannels.CREATE, async (_event, rawTitle?: unknown) => runMeetingAction(async () => {
    const title = typeof rawTitle === 'string' ? rawTitle : undefined;
    return getMeetingManager().createMeetingNote(title);
  }));

  targetIpcMain.handle(MeetingsIPCChannels.START_HERE, async () => runMeetingAction(async () => {
    const context = getActiveFileContext();
    return getMeetingManager().startHere(context ? { ...context } : null);
  }));

  targetIpcMain.handle(MeetingsIPCChannels.STOP, async () => runMeetingAction(async () => {
    return getMeetingManager().stopActiveMeeting();
  }));

  targetIpcMain.handle(MeetingsIPCChannels.CANCEL, async () => runMeetingAction(async () => {
    return getMeetingManager().cancelActiveMeeting();
  }));

  targetIpcMain.handle(MeetingsIPCChannels.GET_ACTIVE, () => {
    try {
      return getMeetingManager().getActiveSession();
    } catch {
      return null;
    }
  });

  targetIpcMain.handle(MeetingsIPCChannels.SUMMARIZE_CURRENT, async () => runMeetingAction(async () => {
    const context = getActiveFileContext();
    return getMeetingManager().summarizeCurrentMeeting(context ? { ...context } : null);
  }));

  targetIpcMain.handle(MeetingsIPCChannels.GET_AMBIENT_SETTINGS, () => getAmbientSettings());

  targetIpcMain.handle(MeetingsIPCChannels.SAVE_AMBIENT_SETTINGS, async (_event, rawSettings: unknown) => {
    if (!rawSettings || typeof rawSettings !== 'object') {
      return { success: false, settings: getAmbientSettings(), appliedToActiveTask: false, error: 'Ambient settings are invalid.' };
    }
    const settings = rawSettings as Partial<AmbientSettings>;
    if (typeof settings.instructions !== 'string') {
      return { success: false, settings: getAmbientSettings(), appliedToActiveTask: false, error: 'Ambient instructions must be text.' };
    }
    if (settings.accessMode !== 'codex-defaults') {
      return { success: false, settings: getAmbientSettings(), appliedToActiveTask: false, error: 'Ambient access mode is invalid.' };
    }
    return saveAmbientSettings({ instructions: settings.instructions, accessMode: settings.accessMode });
  });

  targetIpcMain.handle(MeetingsIPCChannels.RESET_AMBIENT_SETTINGS, async () => resetAmbientSettings());
}
