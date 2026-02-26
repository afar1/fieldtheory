import { useEffect, useMemo, useRef, useState } from 'react';

type OverlaySnapshot = {
  status: {
    enabled: boolean;
    running: boolean;
    cameraAuthorized: boolean;
    targetFps: number;
    reason: string | null;
    lastSampleAtMs: number | null;
  };
  calibration: {
    active: boolean;
    stableForMs: number;
    manualCorrectionCount: number;
    lastCalibratedAtMs: number | null;
    needsRecalibrationPrompt: boolean;
    recalibrationReason: string | null;
    personalOffsets?: {
      horizontalOffset: number;
      verticalOffset: number;
      horizontalGain?: number;
      verticalGain?: number;
    } | null;
  };
  sample: {
    timestampMs: number;
    confidence: number;
    combinedEye: { x: number; y: number };
    calibratedCombinedEye: { x: number; y: number };
    calibrationApplied: boolean;
    headPose: { yaw: number; pitch: number; roll: number };
    gazeVector: { x: number; y: number; z: number };
    faceBounds: { x: number; y: number; width: number; height: number };
    faceSize: number;
    distanceScale: number;
    activeDisplayId?: number | null;
    landmarks?: {
      leftEye: {
        medialCanthus: { x: number; y: number };
        lateralCanthus: { x: number; y: number };
        irisCenter: { x: number; y: number };
      };
      rightEye: {
        medialCanthus: { x: number; y: number };
        lateralCanthus: { x: number; y: number };
        irisCenter: { x: number; y: number };
      };
    } | null;
  } | null;
  updatedAtMs: number;
};

const FRAME_INTERVAL_MS = 1000 / 15;
const REFERENCE_DISTANCE_CM = 55;

export default function GazeDebugOverlay() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const snapshotRef = useRef<OverlaySnapshot | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastRenderAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!window.gazeDebugOverlayAPI) {
      return;
    }
    window.gazeDebugOverlayAPI.onSnapshot((nextSnapshot) => {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    });
    return () => {
      window.gazeDebugOverlayAPI?.removeAllListeners('gaze-debug-overlay:snapshot');
    };
  }, []);

  useEffect(() => {
    if (!window.gazeDebugOverlayAPI?.getSnapshot) {
      return;
    }

    let cancelled = false;
    const pollSnapshot = async () => {
      const nextSnapshot = await window.gazeDebugOverlayAPI?.getSnapshot?.();
      if (!cancelled && nextSnapshot) {
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
      }
    };

    void pollSnapshot();
    const timer = window.setInterval(() => {
      void pollSnapshot();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 15 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : 'Unable to access camera');
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let rafId = 0;

    const draw = (timestamp: number) => {
      if (timestamp - lastRenderAtRef.current < FRAME_INTERVAL_MS) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      lastRenderAtRef.current = timestamp;

      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);
      const activeSnapshot = snapshotRef.current;
      const sample = activeSnapshot?.sample;
      if (!sample) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      // Subtle grid helps users see drift and relative alignment.
      drawGrid(ctx, width, height);

      const faceRect = normalizeFaceRect(sample.faceBounds, width, height);
      ctx.strokeStyle = 'rgba(110, 210, 255, 0.92)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(faceRect.x, faceRect.y, faceRect.width, faceRect.height);

      if (sample.landmarks) {
        drawEyeLandmarks(ctx, width, height, sample.landmarks.leftEye, '#6ef0ff');
        drawEyeLandmarks(ctx, width, height, sample.landmarks.rightEye, '#ffe88a');
      }

      const gazeSource = sample.calibrationApplied ? sample.calibratedCombinedEye : sample.combinedEye;
      const gazeX = gazeSource.x * width;
      const gazeY = (1 - gazeSource.y) * height;
      ctx.strokeStyle = 'rgba(255, 105, 180, 0.96)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gazeX - 8, gazeY);
      ctx.lineTo(gazeX + 8, gazeY);
      ctx.moveTo(gazeX, gazeY - 8);
      ctx.lineTo(gazeX, gazeY + 8);
      ctx.stroke();

      const faceCenterX = faceRect.x + (faceRect.width * 0.5);
      const faceCenterY = faceRect.y + (faceRect.height * 0.5);
      const arrowScale = 72;
      const arrowEndX = faceCenterX + (sample.gazeVector.x * arrowScale);
      const arrowEndY = faceCenterY - (sample.gazeVector.y * arrowScale);
      ctx.strokeStyle = 'rgba(255, 190, 100, 0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(faceCenterX, faceCenterY);
      ctx.lineTo(arrowEndX, arrowEndY);
      ctx.stroke();
      drawArrowHead(ctx, faceCenterX, faceCenterY, arrowEndX, arrowEndY, 'rgba(255, 190, 100, 0.92)');

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const statusLines = useMemo(() => {
    const sample = snapshot?.sample;
    const status = snapshot?.status;
    const distanceCm = sample
      ? Math.round(Math.max(25, Math.min(130, REFERENCE_DISTANCE_CM * sample.distanceScale)))
      : null;
    const calibrationAge = formatCalibrationAge(snapshot?.calibration.lastCalibratedAtMs ?? null);
    const sampleAgeMs = status?.lastSampleAtMs ? Math.max(0, Date.now() - status.lastSampleAtMs) : null;
    const hasStatus = !!status;
    const pipelineStatus = !status
      ? 'Pipeline n/a'
      : !status.enabled
        ? 'Pipeline disabled'
        : status.running
          ? 'Pipeline running'
          : `Pipeline stopped (${status.reason ?? 'unknown'})`;

    return [
      pipelineStatus,
      `Camera ${!hasStatus ? 'n/a' : (status.cameraAuthorized ? 'authorized' : 'permission needed')}`,
      `Last sample ${sampleAgeMs === null ? 'n/a' : `${Math.round(sampleAgeMs)}ms ago`}`,
      `Confidence ${(sample?.confidence ?? 0).toFixed(2)}`,
      `Distance ${distanceCm ? `~${distanceCm}cm` : 'n/a'}`,
      `Screen ${sample?.activeDisplayId ?? 'n/a'}`,
      calibrationAge,
      `Auto-refined ${snapshot?.calibration.manualCorrectionCount ?? 0}x`,
      sample
        ? `Yaw/Pitch/Roll ${sample.headPose.yaw.toFixed(2)} ${sample.headPose.pitch.toFixed(2)} ${sample.headPose.roll.toFixed(2)}`
        : 'Yaw/Pitch/Roll n/a',
      sample
        ? `Raw XY ${sample.combinedEye.x.toFixed(3)}, ${sample.combinedEye.y.toFixed(3)}`
        : 'Raw XY n/a',
      sample && sample.calibrationApplied
        ? `Cal XY ${sample.calibratedCombinedEye.x.toFixed(3)}, ${sample.calibratedCombinedEye.y.toFixed(3)}`
        : 'Cal XY n/a',
      snapshot?.calibration?.personalOffsets
        ? `Gain H/V ${(snapshot.calibration.personalOffsets.horizontalGain ?? 1).toFixed(2)} ${(snapshot.calibration.personalOffsets.verticalGain ?? 1).toFixed(2)}`
        : 'Gain H/V n/a',
      'Pink + = normalized gaze estimate',
      'Gold arrow = head-pose vector',
    ];
  }, [snapshot]);

  return (
    <div style={styles.root}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={styles.video}
      />
      <canvas ref={canvasRef} style={styles.canvas} />
      <div style={styles.statusPanel}>
        {statusLines.map((line) => (
          <div key={line} style={styles.statusLine}>{line}</div>
        ))}
        {cameraError && <div style={{ ...styles.statusLine, color: '#ff9f9f' }}>Camera: {cameraError}</div>}
        {!cameraError && !cameraReady && <div style={styles.statusLine}>Camera: initializing...</div>}
      </div>
    </div>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = 'rgba(160, 210, 255, 0.12)';
  ctx.lineWidth = 1;
  const spacing = 28;
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawEyeLandmarks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  eye: {
    medialCanthus: { x: number; y: number };
    lateralCanthus: { x: number; y: number };
    irisCenter: { x: number; y: number };
  },
  color: string
): void {
  drawDot(ctx, eye.medialCanthus.x * width, (1 - eye.medialCanthus.y) * height, color, 3.2);
  drawDot(ctx, eye.lateralCanthus.x * width, (1 - eye.lateralCanthus.y) * height, color, 3.2);
  const irisX = eye.irisCenter.x * width;
  const irisY = (1 - eye.irisCenter.y) * height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(irisX - 5, irisY);
  ctx.lineTo(irisX + 5, irisY);
  ctx.moveTo(irisX, irisY - 5);
  ctx.lineTo(irisX, irisY + 5);
  ctx.stroke();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  radius: number
): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: string
): void {
  const angle = Math.atan2(endY - startY, endX - startX);
  const size = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - size * Math.cos(angle - Math.PI / 6), endY - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - size * Math.cos(angle + Math.PI / 6), endY - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function normalizeFaceRect(
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x * width,
    y: (1 - (bounds.y + bounds.height)) * height,
    width: bounds.width * width,
    height: bounds.height * height,
  };
}

function formatCalibrationAge(lastCalibratedAtMs: number | null): string {
  if (!lastCalibratedAtMs || !Number.isFinite(lastCalibratedAtMs)) {
    return 'Calibrated never';
  }
  const minutes = Math.max(0, Math.floor((Date.now() - lastCalibratedAtMs) / 60000));
  if (minutes < 1) return 'Calibrated just now';
  if (minutes < 60) return `Calibrated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Calibrated ${hours}h ago`;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'radial-gradient(circle at 25% 20%, rgba(42,73,120,0.55), rgba(8,12,20,0.96))',
    overflow: 'hidden',
  },
  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.72,
    transform: 'scaleX(-1)',
    filter: 'saturate(1.08) contrast(1.06)',
  },
  canvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  statusPanel: {
    position: 'absolute',
    top: 10,
    left: 10,
    padding: '8px 10px',
    background: 'rgba(7, 11, 18, 0.72)',
    border: '1px solid rgba(140, 190, 255, 0.25)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    pointerEvents: 'none',
    maxWidth: '80%',
  },
  statusLine: {
    fontSize: 11,
    lineHeight: 1.2,
    color: '#d9ecff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 0 rgba(0,0,0,0.55)',
  },
};

declare global {
  interface Window {
    gazeDebugOverlayAPI?: {
      onSnapshot: (callback: (snapshot: OverlaySnapshot) => void) => void;
      getSnapshot?: () => Promise<OverlaySnapshot | null>;
      removeAllListeners: (channel: string) => void;
    };
  }
}
