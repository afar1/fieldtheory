#!/usr/bin/env python3
"""Transcribe audio using NVIDIA Parakeet TDT 0.6B models via onnx-asr.

Runs Parakeet locally on CPU using ONNX Runtime. The model is downloaded
automatically on first use and cached for subsequent calls.
Same stdin/stdout JSON protocol as qwen-transcribe.py and mlx-whisper-transcribe.py.

Usage:
    python parakeet-transcribe.py --audio /path/to/recording.wav
    python parakeet-transcribe.py --server   # persistent server mode
"""

import argparse
import json
import os
import struct
import sys

import numpy as np

DEFAULT_MODEL_NAME = "nemo-parakeet-tdt-0.6b-v2"

MIN_SPEECH_DURATION_SECONDS = 0.25
SILENCE_RMS_THRESHOLD = 0.0015
SILENCE_PEAK_THRESHOLD = 0.008
ACTIVE_FRAME_MS = 20
ACTIVE_FRAME_RMS_THRESHOLD = 0.006
ACTIVE_FRAME_PEAK_THRESHOLD = 0.025
ACTIVE_FRAME_RATIO_THRESHOLD = 0.015


def configure_cache_dirs():
    """Route Parakeet/HuggingFace caches into an app-owned location when provided."""
    cache_root = os.environ.get("FIELD_THEORY_PARAKEET_CACHE_DIR")
    if not cache_root:
        return

    hf_home = os.path.join(cache_root, "huggingface")
    hub_cache = os.path.join(hf_home, "hub")
    xdg_cache = os.path.join(cache_root, "xdg")

    os.makedirs(hub_cache, exist_ok=True)
    os.makedirs(xdg_cache, exist_ok=True)

    os.environ.setdefault("HF_HOME", hf_home)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", hub_cache)
    os.environ.setdefault("XDG_CACHE_HOME", xdg_cache)


def read_wav_float32(path):
    """Read a WAV file, handling both integer PCM and IEEE float formats.

    Python's wave module only supports integer PCM (format 1).
    Swift's AVAudioFile writes IEEE float (format 3) WAVs, so we
    parse the header ourselves when needed.
    """
    with open(path, "rb") as f:
        riff = f.read(4)
        if riff != b"RIFF":
            raise ValueError(f"Not a WAV file: {path}")
        f.read(4)  # file size
        wave_id = f.read(4)
        if wave_id != b"WAVE":
            raise ValueError(f"Not a WAV file: {path}")

        fmt_chunk = None
        data_chunk = None

        while True:
            chunk_id = f.read(4)
            if len(chunk_id) < 4:
                break
            chunk_size = struct.unpack("<I", f.read(4))[0]
            if chunk_id == b"fmt ":
                fmt_chunk = f.read(chunk_size)
            elif chunk_id == b"data":
                data_chunk = f.read(chunk_size)
            else:
                f.seek(chunk_size, 1)

    if fmt_chunk is None or data_chunk is None:
        raise ValueError(f"Missing fmt or data chunk: {path}")

    audio_format = struct.unpack("<H", fmt_chunk[0:2])[0]
    num_channels = struct.unpack("<H", fmt_chunk[2:4])[0]
    sample_rate = struct.unpack("<I", fmt_chunk[4:8])[0]
    bits_per_sample = struct.unpack("<H", fmt_chunk[14:16])[0]

    if audio_format == 3:  # IEEE float
        if bits_per_sample == 32:
            samples = np.frombuffer(data_chunk, dtype=np.float32)
        elif bits_per_sample == 64:
            samples = np.frombuffer(data_chunk, dtype=np.float64).astype(np.float32)
        else:
            raise ValueError(f"Unsupported float bit depth: {bits_per_sample}")
    elif audio_format == 1:  # Integer PCM
        if bits_per_sample == 16:
            samples = np.frombuffer(data_chunk, dtype=np.int16).astype(np.float32) / 32768.0
        elif bits_per_sample == 32:
            samples = np.frombuffer(data_chunk, dtype=np.int32).astype(np.float32) / 2147483648.0
        elif bits_per_sample == 8:
            samples = np.frombuffer(data_chunk, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
        else:
            raise ValueError(f"Unsupported PCM bit depth: {bits_per_sample}")
    else:
        raise ValueError(f"Unsupported WAV format: {audio_format}")

    if num_channels > 1:
        samples = samples.reshape(-1, num_channels)[:, 0]

    return samples, sample_rate


def get_audio_activity(waveform, sample_rate):
    """Return simple energy stats used to avoid decoding clear silence."""
    if sample_rate <= 0 or len(waveform) == 0:
        return {
            "duration": 0.0,
            "rms": 0.0,
            "peak": 0.0,
            "active_ratio": 0.0,
        }

    samples = np.nan_to_num(np.asarray(waveform, dtype=np.float32), copy=True)
    duration = len(samples) / float(sample_rate)
    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0

    frame_size = max(1, int(sample_rate * ACTIVE_FRAME_MS / 1000))
    active_frames = 0
    frame_count = 0
    for start in range(0, len(samples), frame_size):
        frame = samples[start:start + frame_size]
        if len(frame) == 0:
            continue
        frame_count += 1
        frame_rms = float(np.sqrt(np.mean(np.square(frame))))
        frame_peak = float(np.max(np.abs(frame)))
        if frame_rms >= ACTIVE_FRAME_RMS_THRESHOLD or frame_peak >= ACTIVE_FRAME_PEAK_THRESHOLD:
            active_frames += 1

    return {
        "duration": duration,
        "rms": rms,
        "peak": peak,
        "active_ratio": active_frames / frame_count if frame_count else 0.0,
    }


def should_skip_for_silence(waveform, sample_rate):
    """Return (skip, reason, stats) for audio that clearly lacks speech."""
    stats = get_audio_activity(waveform, sample_rate)

    if stats["duration"] <= 0:
        return True, "empty", stats

    very_short_and_quiet = (
        stats["duration"] < MIN_SPEECH_DURATION_SECONDS
        and stats["rms"] < ACTIVE_FRAME_RMS_THRESHOLD
        and stats["peak"] < ACTIVE_FRAME_PEAK_THRESHOLD
    )
    if very_short_and_quiet:
        return True, "short-quiet", stats

    quiet_file = (
        stats["rms"] <= SILENCE_RMS_THRESHOLD
        and stats["peak"] <= SILENCE_PEAK_THRESHOLD
    )
    if quiet_file:
        return True, "quiet", stats

    no_active_frames = (
        stats["active_ratio"] <= ACTIVE_FRAME_RATIO_THRESHOLD
        and stats["rms"] <= ACTIVE_FRAME_RMS_THRESHOLD
        and stats["peak"] <= ACTIVE_FRAME_PEAK_THRESHOLD
    )
    if no_active_frames:
        return True, "ambient", stats

    return False, "", stats


def log_silence_skip(reason, stats):
    print(
        "Skipping Parakeet decode for "
        f"{reason} audio "
        f"(duration={stats['duration']:.3f}s, "
        f"rms={stats['rms']:.5f}, "
        f"peak={stats['peak']:.5f}, "
        f"active_ratio={stats['active_ratio']:.3f})",
        file=sys.stderr,
    )


def transcribe(model, audio_path, timestamps=False):
    """Run transcription and return the result string."""
    waveform, sr = read_wav_float32(audio_path)
    skip, reason, stats = should_skip_for_silence(waveform, sr)
    if skip:
        log_silence_skip(reason, stats)
        return ""

    result = model.recognize(waveform, sample_rate=sr)

    if timestamps and hasattr(result, "segments") and result.segments:
        lines = []
        for seg in result.segments:
            start = seg.get("start", 0) or 0
            end = seg.get("end", 0) or 0
            text = seg.get("text", "")
            lines.append(f"[{fmt_timestamp(start)} --> {fmt_timestamp(end)}] {text}")
        return "\n".join(lines)

    # onnx-asr returns a result object with a .text attribute or plain string.
    if hasattr(result, "text"):
        return result.text.strip()
    return str(result).strip()


def fmt_timestamp(t):
    """Format a timestamp in seconds to HH:MM:SS.mmm."""
    if t is None:
        return "99:59:59.999"
    t = float(t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def send(obj):
    """Write a JSON object to stdout and flush."""
    print(json.dumps(obj), flush=True)


def run_server(model):
    """Read JSON commands from stdin, respond on stdout. One object per line."""
    send({"ok": True, "ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            send({"ok": False, "error": f"Invalid JSON: {e}"})
            continue

        action = cmd.get("cmd")

        if action == "ping":
            send({"ok": True})

        elif action == "transcribe":
            audio_path = cmd.get("audio")
            if not audio_path:
                send({"ok": False, "error": "Missing 'audio' field"})
                continue
            timestamps = cmd.get("timestamps", False)
            try:
                text = transcribe(model, audio_path, timestamps)
                send({"ok": True, "text": text})
            except Exception as e:
                send({"ok": False, "error": str(e)})

        else:
            send({"ok": False, "error": f"Unknown command: {action}"})


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with Parakeet")
    parser.add_argument("--audio", help="Path to WAV file")
    parser.add_argument("--timestamps", action="store_true", help="Include timestamps")
    parser.add_argument("--server", action="store_true", help="Persistent server mode")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL_NAME,
        help="onnx-asr model id to load (default: English Parakeet v2)",
    )
    args = parser.parse_args()

    if not args.server and not args.audio:
        parser.error("Either --audio or --server is required")

    configure_cache_dirs()

    try:
        import onnx_asr
    except ImportError as e:
        print(
            f"onnx-asr is not installed ({e}). "
            "Run Parakeet setup from Settings > Transcription. "
            "From source, run: bash scripts/setup-parakeet.sh",
            file=sys.stderr,
        )
        sys.exit(1)

    # Force CPU provider — CoreML fails with "model_path must not be empty"
    # when loading from HuggingFace cache on macOS.
    print(f"Loading {args.model}...", file=sys.stderr)
    try:
        model = onnx_asr.load_model(args.model, providers=["CPUExecutionProvider"])
    except Exception as e:
        print(f"Failed to load {args.model}: {e}", file=sys.stderr)
        sys.exit(1)
    print("Model loaded.", file=sys.stderr)

    if args.server:
        run_server(model)
    else:
        print(transcribe(model, args.audio, args.timestamps))


if __name__ == "__main__":
    main()
