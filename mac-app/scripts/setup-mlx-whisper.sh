#!/bin/bash
# Setup mlx-whisper (Whisper large-v3-turbo) transcription engine.
# Creates a venv and installs mlx-whisper. Run from mac-app/ directory.

set -euo pipefail

# Broad PATH so Finder-launched apps can find Homebrew Python.
export PATH="/opt/homebrew/opt/python@3.13/bin:/opt/homebrew/opt/python@3.13/libexec/bin:/opt/homebrew/opt/python@3.12/bin:/opt/homebrew/opt/python@3.12/libexec/bin:/opt/homebrew/opt/python@3.11/bin:/opt/homebrew/opt/python@3.11/libexec/bin:/opt/homebrew/opt/python@3.10/bin:/opt/homebrew/opt/python@3.10/libexec/bin:/usr/local/opt/python@3.13/bin:/usr/local/opt/python@3.13/libexec/bin:/usr/local/opt/python@3.12/bin:/usr/local/opt/python@3.12/libexec/bin:/usr/local/opt/python@3.11/bin:/usr/local/opt/python@3.11/libexec/bin:/usr/local/opt/python@3.10/bin:/usr/local/opt/python@3.10/libexec/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

VENV_DIR="build-mlx-whisper/venv"
MODEL_REPO="mlx-community/whisper-large-v3-turbo"

# Source shared Python-finding logic (same as Qwen setup).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/find-mlx-python.sh"

if ! PYTHON_BIN="$(choose_mlx_python)"; then
  echo "Unable to find a compatible Python runtime for MLX Whisper." >&2
  echo "Requirements: Apple Silicon (arm64), Python >= 3.10 and < 3.14, and access to mlx wheels." >&2
  echo "Try: brew install python@3.12" >&2
  exit 1
fi

echo "Using python: $PYTHON_BIN ($(python_version_string "$PYTHON_BIN"), $(python_machine "$PYTHON_BIN"))"

RECREATE_VENV=0
if [ -d "$VENV_DIR" ]; then
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "Existing venv is incomplete. Recreating..."
    RECREATE_VENV=1
  elif ! python_supports_mlx_range "$VENV_DIR/bin/python"; then
    echo "Existing venv uses unsupported Python. Recreating..."
    RECREATE_VENV=1
  fi
fi

if [ "$RECREATE_VENV" -eq 1 ]; then
  rm -rf "$VENV_DIR"
fi

if [ -d "$VENV_DIR" ]; then
  echo "Venv already exists at $VENV_DIR"
else
  echo "Creating venv at $VENV_DIR..."
  mkdir -p build-mlx-whisper
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "Using venv python: $("$VENV_DIR/bin/python" -V 2>&1)"

echo "Upgrading pip tooling..."
"$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel

echo "Installing mlx-whisper..."
"$VENV_DIR/bin/pip" install --upgrade --extra-index-url "$PYPI_EXTRA_INDEX_URL" --only-binary=:all: "mlx>=0.30.0"
"$VENV_DIR/bin/pip" install --upgrade mlx-whisper

echo "Verifying mlx-whisper runtime..."
if ! "$VENV_DIR/bin/python" -c "import mlx_whisper; print('mlx-whisper ready')"; then
  echo "mlx-whisper import check failed." >&2
  echo "Try: rm -rf \"$VENV_DIR\" && bash scripts/setup-mlx-whisper.sh" >&2
  exit 1
fi

echo "Pre-downloading model weights (first run only, ~1.6 GB)..."
"$VENV_DIR/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('$MODEL_REPO')"

echo "Done. Test with:"
echo "  $VENV_DIR/bin/python scripts/mlx-whisper-transcribe.py --audio /path/to/recording.wav"
