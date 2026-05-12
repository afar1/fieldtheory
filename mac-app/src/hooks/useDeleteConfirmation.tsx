import { useCallback, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const DELETE_CONFIRMATION_DISABLED_KEY = 'fieldtheory-delete-confirmation-disabled';

type DeleteConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  force?: boolean;
  onConfirm: () => void | Promise<void>;
};

function shouldShowDeleteConfirmation(): boolean {
  return localStorage.getItem(DELETE_CONFIRMATION_DISABLED_KEY) !== '1';
}

function disableFutureDeleteConfirmations(): void {
  localStorage.setItem(DELETE_CONFIRMATION_DISABLED_KEY, '1');
}

export function useDeleteConfirmation() {
  const { theme } = useTheme();
  const [request, setRequest] = useState<DeleteConfirmationRequest | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const confirmDelete = useCallback((nextRequest: DeleteConfirmationRequest) => {
    if (!nextRequest.force && !shouldShowDeleteConfirmation()) {
      void nextRequest.onConfirm();
      return;
    }
    setDontShowAgain(false);
    setRequest(nextRequest);
  }, []);

  const closeDialog = useCallback(() => {
    setRequest(null);
    setDontShowAgain(false);
  }, []);

  const dialog = request ? (
    <div
      role="presentation"
      onMouseDown={closeDialog}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.36)' : 'rgba(0,0,0,0.18)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: 'min(360px, calc(100vw - 32px))',
          padding: '16px',
          borderRadius: '8px',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.surface2,
          boxShadow: theme.isDark ? '0 18px 48px rgba(0,0,0,0.5)' : '0 18px 48px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: theme.text, marginBottom: '8px' }}>
          {request.title}
        </div>
        <div style={{ fontSize: '12px', lineHeight: 1.45, color: theme.textSecondary, marginBottom: '12px' }}>
          {request.message}
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: theme.textSecondary,
            marginBottom: '14px',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.currentTarget.checked)}
          />
          Do not show this dialog in future
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={closeDialog}
            style={{
              height: '28px',
              padding: '0 10px',
              fontSize: '12px',
              color: theme.text,
              backgroundColor: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const pending = request;
              if (dontShowAgain) disableFutureDeleteConfirmations();
              closeDialog();
              void pending.onConfirm();
            }}
            style={{
              height: '28px',
              padding: '0 10px',
              fontSize: '12px',
              color: '#fff',
              backgroundColor: '#dc2626',
              border: '1px solid #dc2626',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {request.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmDelete, deleteConfirmationDialog: dialog };
}
