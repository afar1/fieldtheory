#!/usr/bin/env python3
"""Transcribe audio using Whisper large-v3-turbo via mlx-whisper.

Runs Whisper natively on Apple Silicon through MLX, keeping the model
resident in unified memory for fast chunk-by-chunk transcription.
Same stdin/stdout JSON protocol as qwen-transcribe.py.

Usage:
    python mlx-whisper-transcribe.py --audio /path/to/recording.wav
    python mlx-whisper-transcribe.py --audio /path/to/recording.wav --timestamps
    python mlx-whisper-transcribe.py --server   # persistent server mode
"""

import argparse
import json
import sys

MODEL_NAME = "mlx-community/whisper-large-v3-turbo"


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


def transcribe(audio_path, timestamps=False):
    """Run transcription and return the result string."""
    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo=MODEL_NAME,
        language="en",
        word_timestamps=timestamps,
    )

    if timestamps and "segments" in result and result["segments"]:
        lines = []
        for seg in result["segments"]:
            start = seg.get("start", 0) or 0
            end = seg.get("end", 0) or 0
            text = seg.get("text", "")
            lines.append(f"[{fmt_timestamp(start)} --> {fmt_timestamp(end)}] {text}")
        return "\n".join(lines)
    else:
        return (result.get("text") or "").strip()


def send(obj):
    """Write a JSON object to stdout and flush."""
    print(json.dumps(obj), flush=True)


def run_server():
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
                text = transcribe(audio_path, timestamps)
                send({"ok": True, "text": text})
            except Exception as e:
                send({"ok": False, "error": str(e)})

        else:
            send({"ok": False, "error": f"Unknown command: {action}"})


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with mlx-whisper")
    parser.add_argument("--audio", help="Path to WAV file")
    parser.add_argument("--timestamps", action="store_true", help="Include timestamps")
    parser.add_argument("--server", action="store_true", help="Persistent server mode")
    args = parser.parse_args()

    if not args.server and not args.audio:
        parser.error("Either --audio or --server is required")

    try:
        import mlx_whisper  # noqa: F401
    except ImportError as e:
        print(
            f"mlx-whisper is not installed ({e}). "
            "Run MLX Whisper setup from Settings > Transcription. "
            "From source, run: bash scripts/setup-mlx-whisper.sh",
            file=sys.stderr,
        )
        sys.exit(1)

    # Warm up: run a tiny transcription to force model download and loading.
    # mlx-whisper lazy-loads the model on first call to transcribe(), so we
    # trigger it here so the server is truly ready before signaling.
    print(f"Loading {MODEL_NAME}...", file=sys.stderr)
    import mlx_whisper
    import numpy as np
    import tempfile, wave, os

    warmup_path = os.path.join(tempfile.gettempdir(), "ft_mlxw_warmup.wav")
    with wave.open(warmup_path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(np.zeros(1600, dtype=np.int16).tobytes())

    mlx_whisper.transcribe(warmup_path, path_or_hf_repo=MODEL_NAME, language="en")
    os.remove(warmup_path)
    print("Model loaded.", file=sys.stderr)

    if args.server:
        run_server()
    else:
        print(transcribe(args.audio, args.timestamps))


if __name__ == "__main__":
    main()
