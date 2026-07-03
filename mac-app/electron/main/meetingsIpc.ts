import { ipcMain } from 'electron';
import type { MeetingFileContext, MeetingManager } from './meetingManager';

export const MeetingsIPCChannels = {
  CREATE: 'meetings:create',
  START_HERE: 'meetings:startHere',
  STOP: 'meetings:stop',
  CANCEL: 'meetings:cancel',
  GET_ACTIVE: 'meetings:getActive',
  SUMMARIZE_CURRENT: 'meetings:summarizeCurrent',
} as const;

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
}
