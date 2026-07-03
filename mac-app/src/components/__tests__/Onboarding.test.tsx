import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Onboarding from '../Onboarding';

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: null } })),
  },
  from: vi.fn(),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      text: '#111111',
      textSecondary: '#666666',
      error: '#ef4444',
      errorBg: '#fef2f2',
      border: '#d1d5db',
      accent: '#0f766e',
      info: '#2563eb',
      warning: '#d97706',
      success: '#16a34a',
      selectedBg: '#f3f4f6',
      isDark: false,
      surface1: '#f3f4f6',
    },
  }),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: supabaseMock,
}));

function makeOnboardingApi(overrides: Partial<Window['onboardingAPI']> = {}) {
  return {
    getPermissionStatus: vi.fn(async () => ({
      microphone: 'granted' as const,
      accessibility: true,
      screenRecording: true,
    })),
    requestMicrophone: vi.fn(async () => true),
    openAccessibilitySettings: vi.fn(async () => true),
    openScreenRecordingSettings: vi.fn(async () => true),
    triggerScreenRecordingPrompt: vi.fn(async () => true),
    getState: vi.fn(async () => ({
      isComplete: false,
      currentStep: 2,
      permissions: {
        microphone: 'granted' as const,
        accessibility: true,
        screenRecording: true,
      },
      modelDownloaded: true,
    })),
    setStep: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    completeLocalSetup: vi.fn(async () => true),
    skip: vi.fn(async () => true),
    reset: vi.fn(async () => true),
    checkModelStatus: vi.fn(async () => ({ downloaded: true })),
    showSignIn: vi.fn(async () => true),
    ...overrides,
  };
}

function makeTranscribeApi(overrides: Partial<Window['transcribeAPI']> = {}) {
  return {
    getSelectedModel: vi.fn(async () => 'small'),
    getModelDownloadStatus: vi.fn(async () => ({ small: true })),
    setSelectedModel: vi.fn(async () => undefined),
    getDownloadingModels: vi.fn(async () => []),
    getTranscriptionEngine: vi.fn(async () => 'parakeet'),
    setTranscriptionEngine: vi.fn(async () => undefined),
    getParakeetStatus: vi.fn(async () => null),
    onModelDownloadProgress: vi.fn(() => () => {}),
    onParakeetSetupProgress: vi.fn(() => () => {}),
    ...overrides,
  };
}

describe('Onboarding local setup', () => {
  beforeEach(() => {
    window.location.hash = '#/onboarding?step=2';
    (window as any).onboardingAPI = makeOnboardingApi();
    (window as any).transcribeAPI = makeTranscribeApi();
    (window as any).authAPI = {
      isConfigured: vi.fn(async () => true),
      getSession: vi.fn(async () => null),
      requestOtp: vi.fn(async () => ({ error: null })),
    };
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabaseMock.from.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
    delete (window as any).onboardingAPI;
    delete (window as any).transcribeAPI;
    delete (window as any).authAPI;
    delete (window as any).clipboardAPI;
    delete (window as any).shellAPI;
  });

  it('lets users finish local setup without requesting account auth', async () => {
    render(<Onboarding />);

    const localSetup = await screen.findByRole('link', { name: 'local setup' });

    await act(async () => {
      localSetup.click();
    });

    await waitFor(() => {
      expect(window.transcribeAPI?.setTranscriptionEngine).toHaveBeenCalledWith('parakeet');
      expect(window.onboardingAPI?.completeLocalSetup).toHaveBeenCalled();
    });
    expect(window.authAPI?.requestOtp).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('uses local setup when account auth is not configured', async () => {
    (window as any).authAPI = {
      ...window.authAPI,
      isConfigured: vi.fn(async () => false),
    };

    render(<Onboarding />);

    const localSetup = await screen.findByRole('button', { name: 'Continue with local setup' });

    expect(screen.queryByRole('button', { name: 'Send Verification Code' })).toBeNull();

    await act(async () => {
      localSetup.click();
    });

    await waitFor(() => {
      expect(window.onboardingAPI?.completeLocalSetup).toHaveBeenCalled();
    });
    expect(window.authAPI?.requestOtp).not.toHaveBeenCalled();
  });

  it('does not ask returning users to re-enter a session display name', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { callsign: 'AF', full_name: null },
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    supabaseMock.from.mockReturnValue({ select });

    (window as any).authAPI = {
      ...window.authAPI,
      prepareForNewLogin: vi.fn(async () => undefined),
      verifyOtp: vi.fn(async () => ({
        error: null,
        session: {
          authenticated: true,
          expires_at: null,
          expiresAt: null,
          tier: 'pro',
          callsign: 'AF',
          displayName: 'Andrew Farah',
          user: {
            id: 'user-1',
            email: 'andrew@example.com',
            user_metadata: { full_name: 'Andrew Farah' },
          },
        },
      })),
      updateFullName: vi.fn(async () => ({ error: null })),
    };

    render(<Onboarding />);

    const emailInput = await screen.findByPlaceholderText('Enter your email');
    fireEvent.change(emailInput, { target: { value: 'andrew@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));

    const codeInput = await screen.findByPlaceholderText('Enter code');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));

    expect(await screen.findByText('Welcome Back')).toBeTruthy();
    expect(screen.queryByText('Add your name below, or skip to continue.')).toBeNull();
    expect(window.authAPI?.updateFullName).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(window.onboardingAPI?.complete).toHaveBeenCalled();
    });
  });
});
