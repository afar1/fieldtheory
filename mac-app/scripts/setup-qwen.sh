#!/bin/bash
# Setup Qwen3-ASR-0.6B transcription engine via mlx-audio.
# Creates a venv and installs dependencies. Run from mac-app/ directory.

set -e

VENV_DIR="build-qwen/venv"

if [ -d "$VENV_DIR" ]; then
  echo "Venv already exists at $VENV_DIR"
else
  echo "Creating venv at $VENV_DIR..."
  mkdir -p build-qwen
  python3 -m venv "$VENV_DIR"
fi

echo "Installing mlx-audio..."
"$VENV_DIR/bin/pip" install --upgrade mlx-audio

echo "Pre-downloading model weights (first run only)..."
"$VENV_DIR/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/Qwen3-ASR-0.6B-8bit')"

echo "Done. Test with:"
echo "  $VENV_DIR/bin/python scripts/qwen-transcribe.py --audio /path/to/recording.wav"
