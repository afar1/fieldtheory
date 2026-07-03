import type { CSSProperties, ReactNode } from 'react';

interface ImagePreviewFrameProps {
  src: string;
  alt?: string;
  label?: string | null;
  labelStyle?: CSSProperties;
  maxImageHeight?: string;
  children?: ReactNode;
}

export function ImagePreviewFrame({
  src,
  alt = 'Preview',
  label,
  labelStyle,
  maxImageHeight = 'calc(90vh - 60px)',
  children,
}: ImagePreviewFrameProps) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        cursor: 'default',
      }}
    >
      {label && (
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: '#fff',
            opacity: 0.7,
            padding: '4px 12px',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            ...labelStyle,
          }}
        >
          {label}
        </div>
      )}
      <img
        data-ft-image-preview-img="true"
        src={src}
        alt={alt}
        style={{
          maxWidth: '90vw',
          maxHeight: maxImageHeight,
          objectFit: 'contain',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
      />
      {children}
    </div>
  );
}

interface ImagePreviewOverlayProps extends ImagePreviewFrameProps {
  onDismiss: () => void;
  isClosing?: boolean;
  zIndex?: number;
}

export default function ImagePreviewOverlay({
  onDismiss,
  isClosing = false,
  zIndex = 10000,
  ...frameProps
}: ImagePreviewOverlayProps) {
  return (
    <div
      data-ft-image-preview-overlay="true"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
        cursor: 'pointer',
        animation: isClosing ? 'ftImagePreviewFadeOut 0.15s ease-in forwards' : 'ftImagePreviewFadeIn 0.15s ease-out',
      }}
    >
      <style>{`
        @keyframes ftImagePreviewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes ftImagePreviewFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
      <ImagePreviewFrame {...frameProps} />
    </div>
  );
}
