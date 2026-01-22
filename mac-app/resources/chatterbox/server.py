#!/usr/bin/env python3
"""
Chatterbox TTS Sidecar Server

HTTP API for text-to-speech synthesis using the Chatterbox model.
Designed for Field Theory's Librarian narration system.

Usage:
    python server.py [--port PORT] [--preload]
"""

import argparse
import json
import logging
import os
import signal
import socket
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional

# Lazy imports for heavy dependencies
torch = None
torchaudio = None
ChatterboxTTS = None

# Configure logging
log_dir = Path(__file__).parent / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_dir / 'sidecar.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Global state
model: Optional[object] = None
model_lock = threading.Lock()
model_loading = False
model_sample_rate = 24000
last_request_time = time.time()
shutdown_event = threading.Event()

# Idle timeout (5 minutes)
IDLE_TIMEOUT_SECONDS = 300

# Voice profile parameters (librarian_v1)
# The Librarian from Snow Crash - measured, confident, slightly British.
# Imparts knowledge with authority but never pompous or overbearing.
LIBRARIAN_V1_PARAMS = {
    'exaggeration': 0.20,  # Low for measured, calm delivery
    'cfg_weight': 0.45,    # Higher for consistent authority
}


def lazy_import():
    """Import heavy dependencies lazily."""
    global torch, torchaudio, ChatterboxTTS
    if torch is None:
        import torch as _torch
        import torchaudio as _torchaudio
        from chatterbox.tts import ChatterboxTTS as _ChatterboxTTS
        torch = _torch
        torchaudio = _torchaudio
        ChatterboxTTS = _ChatterboxTTS


def check_apple_silicon() -> bool:
    """Check if running on Apple Silicon."""
    import platform
    return platform.machine() == 'arm64' and platform.system() == 'Darwin'


def load_model():
    """Load the Chatterbox model with MPS acceleration."""
    global model, model_loading, model_sample_rate

    with model_lock:
        if model is not None:
            return
        if model_loading:
            return
        model_loading = True

    try:
        logger.info("Loading Chatterbox model...")
        lazy_import()

        # Use MPS on Apple Silicon, CPU otherwise
        if check_apple_silicon() and torch.backends.mps.is_available():
            device = "mps"
            logger.info("Using MPS (Apple Silicon) acceleration")
        else:
            device = "cpu"
            logger.info("Using CPU (no MPS available)")

        loaded_model = ChatterboxTTS.from_pretrained(device=device)
        model_sample_rate = loaded_model.sr

        with model_lock:
            model = loaded_model
            model_loading = False

        logger.info(f"Model loaded successfully (sample rate: {model_sample_rate})")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        with model_lock:
            model_loading = False
        raise


def unload_model():
    """Unload the model to free GPU memory."""
    global model

    with model_lock:
        if model is not None:
            del model
            model = None
            if torch is not None and hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
                torch.mps.empty_cache()
            logger.info("Model unloaded")


def idle_monitor():
    """Monitor for idle timeout and unload model if inactive."""
    global last_request_time

    while not shutdown_event.is_set():
        time.sleep(30)  # Check every 30 seconds

        with model_lock:
            if model is not None:
                idle_time = time.time() - last_request_time
                if idle_time > IDLE_TIMEOUT_SECONDS:
                    logger.info(f"Idle for {idle_time:.0f}s, unloading model")
                    unload_model()


class TTSHandler(BaseHTTPRequestHandler):
    """HTTP request handler for TTS operations."""

    def log_message(self, format, *args):
        logger.debug(f"{self.address_string()} - {format % args}")

    def send_json(self, data: dict, status: int = 200):
        response = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self):
        if self.path == '/health':
            self.handle_health()
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        if self.path == '/synthesize':
            self.handle_synthesize()
        elif self.path == '/shutdown':
            self.handle_shutdown()
        else:
            self.send_json({'error': 'Not found'}, 404)

    def handle_health(self):
        """Return health status."""
        global model, model_loading

        with model_lock:
            if model is not None:
                status = 'ready'
            elif model_loading:
                status = 'loading'
            else:
                status = 'idle'

        self.send_json({
            'status': status,
            'model_loaded': model is not None,
            'device': 'mps' if check_apple_silicon() else 'cpu',
            'sample_rate': model_sample_rate,
        })

    def handle_synthesize(self):
        """Synthesize text to audio."""
        global last_request_time

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({'error': 'Empty request body'}, 400)
                return

            body = self.rfile.read(content_length)
            request = json.loads(body)

            text = request.get('text', '')
            output_path = request.get('output_path', '')
            params = request.get('params', LIBRARIAN_V1_PARAMS)
            voice_ref = request.get('voice_ref')

            if not text:
                self.send_json({'error': 'Missing text'}, 400)
                return
            if not output_path:
                self.send_json({'error': 'Missing output_path'}, 400)
                return

            # Update activity timestamp
            last_request_time = time.time()

            # Ensure model is loaded
            load_model()

            with model_lock:
                if model is None:
                    self.send_json({'error': 'Model not available'}, 503)
                    return

                logger.info(f"Synthesizing {len(text)} chars to {output_path}")
                start_time = time.time()

                # Generate audio
                # Voice ref is optional - if not provided, uses default voice
                if voice_ref and os.path.exists(voice_ref):
                    wav = model.generate(
                        text,
                        audio_prompt_path=voice_ref,
                        exaggeration=params.get('exaggeration', 0.35),
                        cfg_weight=params.get('cfg_weight', 0.30),
                    )
                else:
                    wav = model.generate(
                        text,
                        exaggeration=params.get('exaggeration', 0.35),
                        cfg_weight=params.get('cfg_weight', 0.30),
                    )

                # Save as WAV using soundfile (torchaudio.save requires torchcodec in newer versions)
                import soundfile as sf
                # Convert tensor to numpy: shape is (1, samples), soundfile expects (samples,) or (samples, channels)
                wav_np = wav.squeeze().cpu().numpy()
                sf.write(output_path, wav_np, model.sr)

                # Calculate duration
                duration_ms = int(wav.shape[1] / model.sr * 1000)
                synthesis_time = time.time() - start_time

                logger.info(f"Synthesis complete: {duration_ms}ms audio in {synthesis_time:.2f}s")

            self.send_json({
                'audio_path': output_path,
                'duration_ms': duration_ms,
                'sample_rate': model.sr,
                'synthesis_time_ms': int(synthesis_time * 1000),
            })

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            self.send_json({'error': f'Invalid JSON: {e}'}, 400)
        except Exception as e:
            logger.error(f"Synthesis failed: {e}")
            self.send_json({'error': str(e)}, 500)

    def handle_shutdown(self):
        """Graceful shutdown."""
        logger.info("Shutdown requested")
        self.send_json({'status': 'shutting_down'})
        shutdown_event.set()


def find_available_port(start_port: int = 31337, max_attempts: int = 10) -> int:
    """Find an available port starting from start_port."""
    for i in range(max_attempts):
        port = start_port + i
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(('127.0.0.1', port))
            sock.close()
            return port
        except OSError:
            continue

    raise RuntimeError(f"Could not find available port after {max_attempts} attempts")


def write_pid_file(pid_path: Path):
    """Write PID file for orphan detection."""
    pid_path.write_text(str(os.getpid()))


def remove_pid_file(pid_path: Path):
    """Remove PID file on shutdown."""
    try:
        pid_path.unlink()
    except FileNotFoundError:
        pass


def main():
    parser = argparse.ArgumentParser(description='Chatterbox TTS Sidecar')
    parser.add_argument('--port', type=int, default=31337, help='Starting port to try')
    parser.add_argument('--preload', action='store_true', help='Preload model on startup')
    args = parser.parse_args()

    # Check Apple Silicon
    if not check_apple_silicon():
        logger.warning("Not running on Apple Silicon - performance may be limited")

    # Find available port
    try:
        port = find_available_port(args.port)
    except RuntimeError as e:
        logger.error(str(e))
        sys.exit(1)

    # Write PID file
    pid_path = Path(__file__).parent / 'sidecar.pid'
    write_pid_file(pid_path)

    # Signal to parent process that we're ready
    # CRITICAL: This line must be printed exactly as-is for Node.js to parse
    print(f"SIDECAR_READY:{port}", flush=True)

    # Start idle monitor thread
    monitor_thread = threading.Thread(target=idle_monitor, daemon=True)
    monitor_thread.start()

    # Optionally preload model
    if args.preload:
        threading.Thread(target=load_model, daemon=True).start()

    # Create HTTP server
    server = HTTPServer(('127.0.0.1', port), TTSHandler)
    server.timeout = 1  # Check for shutdown every second

    logger.info(f"Sidecar listening on port {port}")

    def shutdown_handler(signum, frame):
        logger.info(f"Received signal {signum}")
        shutdown_event.set()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        while not shutdown_event.is_set():
            server.handle_request()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt")
    finally:
        unload_model()
        remove_pid_file(pid_path)
        logger.info("Sidecar shutdown complete")


if __name__ == '__main__':
    main()
