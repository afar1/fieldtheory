#!/bin/bash
# Setup NVIDIA Parakeet TDT 0.6B transcription engine.
# Creates a Python venv and installs onnx-asr with CPU support.
#
# Usage: bash scripts/setup-parakeet.sh

set -euo pipefail

# Finder-launched apps often have a minimal PATH; include common Homebrew paths
# so packaged builds can find python3.
export PATH="/opt/homebrew/opt/python@3.13/bin:/opt/homebrew/opt/python@3.13/libexec/bin:/opt/homebrew/opt/python@3.12/bin:/opt/homebrew/opt/python@3.12/libexec/bin:/opt/homebrew/opt/python@3.11/bin:/opt/homebrew/opt/python@3.11/libexec/bin:/opt/homebrew/opt/python@3.10/bin:/opt/homebrew/opt/python@3.10/libexec/bin:/usr/local/opt/python@3.13/bin:/usr/local/opt/python@3.13/libexec/bin:/usr/local/opt/python@3.12/bin:/usr/local/opt/python@3.12/libexec/bin:/usr/local/opt/python@3.11/bin:/usr/local/opt/python@3.11/libexec/bin:/usr/local/opt/python@3.10/bin:/usr/local/opt/python@3.10/libexec/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_APP_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="${1:-$MAC_APP_DIR/build-parakeet/venv}"

echo "Setting up Parakeet transcription engine..."
echo "  venv: $VENV_DIR"

# Require Python 3.10+
PYTHON_CMD="${FT_PARAKEET_PYTHON:-}"
if [[ -n "$PYTHON_CMD" ]]; then
  version=$("$PYTHON_CMD" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "")
  minor=0
  if [[ "$version" =~ ^3\.([0-9]+)$ ]]; then
    minor="${BASH_REMATCH[1]}"
  fi
  if [[ "$minor" -lt 10 ]]; then
    echo "ERROR: FT_PARAKEET_PYTHON points to unsupported Python: $PYTHON_CMD ($("$PYTHON_CMD" --version 2>&1 || echo unknown))"
    exit 1
  fi
else
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
      version=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "")
      minor=0
      if [[ "$version" =~ ^3\.([0-9]+)$ ]]; then
        minor="${BASH_REMATCH[1]}"
      fi
      if [[ "$minor" -ge 10 ]]; then
        PYTHON_CMD="$candidate"
        break
      fi
    fi
  done
fi

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
