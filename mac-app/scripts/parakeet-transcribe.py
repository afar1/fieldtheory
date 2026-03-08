#!/usr/bin/env python3
"""Transcribe audio using NVIDIA Parakeet TDT 0.6B v2 via onnx-asr.

Runs Parakeet locally on CPU using ONNX Runtime. The model is downloaded
automatically on first use and cached for subsequent calls.
Same stdin/stdout JSON protocol as qwen-transcribe.py and mlx-whisper-transcribe.py.

Usage:
    python parakeet-transcribe.py --audio /path/to/recording.wav
    python parakeet-transcribe.py --server   # persistent server mode
"""

import argparse
import json
import struct
import sys

import numpy as np

MODEL_NAME = "nemo-parakeet-tdt-0.6b-v2"


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


def transcribe(model, audio_path, timestamps=False):
    """Run transcription and return the result string."""
    waveform, sr = read_wav_float32(audio_path)
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
    args = parser.parse_args()

    if not args.server and not args.audio:
        parser.error("Either --audio or --server is required")

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
    print(f"Loading {MODEL_NAME}...", file=sys.stderr)
    model = onnx_asr.load_model(MODEL_NAME, providers=["CPUExecutionProvider"])
    print("Model loaded.", file=sys.stderr)

    if args.server:
        run_server(model)
    else:
        print(transcribe(model, args.audio, args.timestamps))


if __name__ == "__main__":
    main()
