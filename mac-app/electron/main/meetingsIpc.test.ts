import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MeetingsIPCChannels,
  registerMeetingsIpc,
  type AmbientSettingsSaveResult,
} from './meetingsIpc';
import type { MeetingFileContext } from './meetingManager';
import type { AmbientSettings } from '../shared/ambientSettings';

describe('meetingsIpc', () => {
  let handlers: Map<string, (event: any, ...args: any[]) => unknown>;
  let ipcMain: { handle: ReturnType<typeof vi.fn> };
  let activeContext: MeetingFileContext | null;
  let manager: {
    createMeetingNote: ReturnType<typeof vi.fn>;
    startHere: ReturnType<typeof vi.fn>;
    stopActiveMeeting: ReturnType<typeof vi.fn>;
    cancelActiveMeeting: ReturnType<typeof vi.fn>;
    getActiveSession: ReturnType<typeof vi.fn>;
    summarizeCurrentMeeting: ReturnType<typeof vi.fn>;
  };
  let getAmbientSettings: ReturnType<typeof vi.fn>;
  let saveAmbientSettings: ReturnType<typeof vi.fn>;
  let resetAmbientSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = new Map();
    ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    activeContext = {
      type: 'wiki',
      rootPath: '/tmp/fieldtheory-test/home/.fieldtheory/library',
      relPath: 'Meetings/Planning.md',
      filePath: '/tmp/fieldtheory-test/home/.fieldtheory/library/Meetings/Planning.md',
      title: 'Planning',
    };
    manager = {
      createMeetingNote: vi.fn(async (title?: string) => ({ success: true, title })),
      startHere: vi.fn(async (context?: MeetingFileContext | null) => ({ success: true, context })),
      stopActiveMeeting: vi.fn(async () => ({ success: true, stopped: true })),
      cancelActiveMeeting: vi.fn(async () => ({ success: true, cancelled: true })),
      getActiveSession: vi.fn(() => ({ status: 'recording' })),
      summarizeCurrentMeeting: vi.fn(async (context?: MeetingFileContext | null) => ({ success: true, context })),
    };
    getAmbientSettings = vi.fn(() => ({ instructions: 'Default staffer', accessMode: 'codex-defaults' as const }));
    saveAmbientSettings = vi.fn(async (settings: AmbientSettings) => ({
      success: true,
      settings,
      appliedToActiveTask: true,
    }));
    resetAmbientSettings = vi.fn(async () => ({
      success: true,
      settings: { instructions: 'Default staffer', accessMode: 'codex-defaults' as const },
      appliedToActiveTask: false,
    }));
  });

  function register() {
    registerMeetingsIpc({
      ipcMain: ipcMain as any,
      getMeetingManager: () => manager as any,
      getActiveFileContext: () => activeContext,
      getAmbientSettings: getAmbientSettings as () => AmbientSettings,
      saveAmbientSettings: saveAmbientSettings as (settings: AmbientSettings) => Promise<AmbientSettingsSaveResult>,
      resetAmbientSettings: resetAmbientSettings as () => Promise<AmbientSettingsSaveResult>,
    });
  }

  function handler(channel: string) {
    const registered = handlers.get(channel);
    expect(registered).toBeDefined();
    return registered!;
  }

  it('registers the existing public meeting channel names', () => {
    register();

    expect([...handlers.keys()]).toEqual([
      'meetings:create',
      'meetings:startHere',
      'meetings:stop',
      'meetings:cancel',
      'meetings:getActive',
      'meetings:summarizeCurrent',
      'meetings:getAmbientSettings',
      'meetings:saveAmbientSettings',
      'meetings:resetAmbientSettings',
    ]);
  });

  it('normalizes a non-string create title before calling the manager', async () => {
    register();

    await expect(handler(MeetingsIPCChannels.CREATE)({ sender: {} }, 42)).resolves.toEqual({ success: true, title: undefined });
    expect(manager.createMeetingNote).toHaveBeenCalledWith(undefined);
  });

  it('passes a copied active file context to start and summarize actions', async () => {
    register();

    await expect(handler(MeetingsIPCChannels.START_HERE)({ sender: {} })).resolves.toMatchObject({ success: true, context: activeContext });
    await expect(handler(MeetingsIPCChannels.SUMMARIZE_CURRENT)({ sender: {} })).resolves.toMatchObject({ success: true, context: activeContext });

    expect(manager.startHere).toHaveBeenCalledWith(activeContext);
    expect(manager.summarizeCurrentMeeting).toHaveBeenCalledWith(activeContext);
    expect(manager.startHere.mock.calls[0][0]).not.toBe(activeContext);
  });

  it('passes null when no active file context exists', async () => {
    activeContext = null;
    register();

    await handler(MeetingsIPCChannels.START_HERE)({ sender: {} });

    expect(manager.startHere).toHaveBeenCalledWith(null);
  });

  it('wraps meeting action failures in the existing error shape', async () => {
    manager.stopActiveMeeting.mockRejectedValueOnce(new Error('microphone missing'));
    register();

    await expect(handler(MeetingsIPCChannels.STOP)({ sender: {} })).resolves.toEqual({
      success: false,
      error: 'microphone missing',
    });
  });

  it('returns null when the active session cannot be read', async () => {
    manager.getActiveSession.mockImplementationOnce(() => {
      throw new Error('manager unavailable');
    });
    register();

    expect(handler(MeetingsIPCChannels.GET_ACTIVE)({ sender: {} })).toBeNull();
  });

  it('gets, saves, and resets the exact visible Ambient settings', async () => {
    register();
    const revised = { instructions: 'Research first.\nDo not edit files.', accessMode: 'codex-defaults' as const };

    expect(handler(MeetingsIPCChannels.GET_AMBIENT_SETTINGS)({ sender: {} })).toEqual({
      instructions: 'Default staffer',
      accessMode: 'codex-defaults',
    });
    await expect(handler(MeetingsIPCChannels.SAVE_AMBIENT_SETTINGS)({ sender: {} }, revised))
      .resolves.toMatchObject({ success: true, settings: revised, appliedToActiveTask: true });
    expect(saveAmbientSettings).toHaveBeenCalledWith(revised);
    await handler(MeetingsIPCChannels.RESET_AMBIENT_SETTINGS)({ sender: {} });
    expect(resetAmbientSettings).toHaveBeenCalledOnce();
  });

  it('rejects an unknown Ambient access mode before saving', async () => {
    register();

    await expect(handler(MeetingsIPCChannels.SAVE_AMBIENT_SETTINGS)({ sender: {} }, {
      instructions: 'Prompt',
      accessMode: 'hidden-superuser',
    })).resolves.toMatchObject({ success: false, error: 'Ambient access mode is invalid.' });
    expect(saveAmbientSettings).not.toHaveBeenCalled();
  });
});
