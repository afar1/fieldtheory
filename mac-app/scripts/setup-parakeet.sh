#!/bin/bash
# Setup NVIDIA Parakeet TDT 0.6B transcription engine.
# Creates a Python venv and installs onnx-asr with CPU support.
#
# Usage: bash scripts/setup-parakeet.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_APP_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="${1:-$MAC_APP_DIR/build-parakeet/venv}"

echo "Setting up Parakeet transcription engine..."
echo "  venv: $VENV_DIR"

# Require Python 3.10+
PYTHON_CMD=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" &>/dev/null; then
    version=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "")
    major="${version%%.*}"
    minor="${version#*.}"
    if [[ "$major" -ge 3 && "$minor" -ge 10 ]]; then
      PYTHON_CMD="$candidate"
      break
    fi
  fi
done

if [[ -z "$PYTHON_CMD" ]]; then
  echo "ERROR: Python 3.10+ is required but not found."
  exit 1
fi

echo "  python: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"

# Create or re-use venv.
if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

pip install --upgrade pip --quiet
pip install "onnx-asr[cpu,hub]" --quiet

echo "Parakeet setup complete."
echo "  python: $(which python)"
echo "  onnx-asr: $(python -c 'import onnx_asr; print(onnx_asr.__version__)' 2>/dev/null || echo 'installed')"
