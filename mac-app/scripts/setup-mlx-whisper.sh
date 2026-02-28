#!/bin/bash
# Setup mlx-whisper (Whisper large-v3-turbo) transcription engine.
# Creates a venv and installs mlx-whisper. Shares the same Python/MLX
# requirements as Qwen setup. Run from mac-app/ directory.

set -euo pipefail

# Finder-launched apps often have a minimal PATH; include common Homebrew
# paths so production builds can find a compatible python3.
export PATH="/opt/homebrew/opt/python@3.13/bin:/opt/homebrew/opt/python@3.13/libexec/bin:/opt/homebrew/opt/python@3.12/bin:/opt/homebrew/opt/python@3.12/libexec/bin:/opt/homebrew/opt/python@3.11/bin:/opt/homebrew/opt/python@3.11/libexec/bin:/opt/homebrew/opt/python@3.10/bin:/opt/homebrew/opt/python@3.10/libexec/bin:/usr/local/opt/python@3.13/bin:/usr/local/opt/python@3.13/libexec/bin:/usr/local/opt/python@3.12/bin:/usr/local/opt/python@3.12/libexec/bin:/usr/local/opt/python@3.11/bin:/usr/local/opt/python@3.11/libexec/bin:/usr/local/opt/python@3.10/bin:/usr/local/opt/python@3.10/libexec/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

VENV_DIR="build-mlx-whisper/venv"
MIN_PYTHON="3.10"
MAX_PYTHON_EXCLUSIVE="3.14"
PYPI_EXTRA_INDEX_URL="https://pypi.org/simple"
MODEL_REPO="mlx-community/whisper-large-v3-turbo"

python_supports_mlx() {
  local py="$1"
  "$py" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)
PY
}

python_version_string() {
  local py="$1"
  "$py" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
PY
}

python_machine() {
  local py="$1"
  "$py" - <<'PY'
import platform
print(platform.machine())
PY
}

python_can_resolve_mlx() {
  local py="$1"
  local tmp_dir
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/fieldtheory-mlx.XXXXXX")"
  if "$py" -m pip download \
    --disable-pip-version-check \
    --no-deps \
    --only-binary=:all: \
    --dest "$tmp_dir" \
    --extra-index-url "$PYPI_EXTRA_INDEX_URL" \
    "mlx>=0.30.0" >/dev/null 2>&1; then
    rm -rf "$tmp_dir"
    return 0
  fi
  rm -rf "$tmp_dir"
  return 1
}

choose_python() {
  local candidate
  for candidate in \
    /opt/homebrew/opt/python@3.13/bin/python3.13 \
    /opt/homebrew/opt/python@3.13/bin/python3 \
    /opt/homebrew/opt/python@3.13/libexec/bin/python3 \
    /opt/homebrew/opt/python@3.12/bin/python3.12 \
    /opt/homebrew/opt/python@3.12/bin/python3 \
    /opt/homebrew/opt/python@3.12/libexec/bin/python3 \
    /opt/homebrew/opt/python@3.11/bin/python3.11 \
    /opt/homebrew/opt/python@3.11/bin/python3 \
    /opt/homebrew/opt/python@3.11/libexec/bin/python3 \
    /opt/homebrew/opt/python@3.10/bin/python3.10 \
    /opt/homebrew/opt/python@3.10/bin/python3 \
    /opt/homebrew/opt/python@3.10/libexec/bin/python3 \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.11 \
    /opt/homebrew/bin/python3.10 \
    /opt/homebrew/bin/python3 \
    /usr/local/opt/python@3.13/bin/python3.13 \
    /usr/local/opt/python@3.13/bin/python3 \
    /usr/local/opt/python@3.13/libexec/bin/python3 \
    /usr/local/opt/python@3.12/bin/python3.12 \
    /usr/local/opt/python@3.12/bin/python3 \
    /usr/local/opt/python@3.12/libexec/bin/python3 \
    /usr/local/opt/python@3.11/bin/python3.11 \
    /usr/local/opt/python@3.11/bin/python3 \
    /usr/local/opt/python@3.11/libexec/bin/python3 \
    /usr/local/opt/python@3.10/bin/python3.10 \
    /usr/local/opt/python@3.10/bin/python3 \
    /usr/local/opt/python@3.10/libexec/bin/python3 \
    /usr/local/bin/python3.13 \
    /usr/local/bin/python3.12 \
    /usr/local/bin/python3.11 \
    /usr/local/bin/python3.10 \
    /usr/local/bin/python3 \
    "$(command -v python3.13 2>/dev/null || true)" \
    "$(command -v python3.12 2>/dev/null || true)" \
    "$(command -v python3.11 2>/dev/null || true)" \
    "$(command -v python3.10 2>/dev/null || true)" \
    "$(command -v python3 2>/dev/null || true)"; do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    python_supports_mlx "$candidate" || continue
    [ "$(python_machine "$candidate")" = "arm64" ] || continue
    python_can_resolve_mlx "$candidate" || continue
    echo "$candidate"
    return 0
  done
  return 1
}

if ! PYTHON_BIN="$(choose_python)"; then
  echo "Unable to find a compatible Python runtime for MLX Whisper." >&2
  echo "Requirements: Apple Silicon (arm64), Python >= $MIN_PYTHON and < $MAX_PYTHON_EXCLUSIVE, and access to mlx wheels." >&2
  echo "Try: brew install python@3.12" >&2
  exit 1
fi

echo "Using python: $PYTHON_BIN ($(python_version_string "$PYTHON_BIN"), $(python_machine "$PYTHON_BIN"))"

RECREATE_VENV=0
if [ -d "$VENV_DIR" ]; then
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "Existing venv is incomplete. Recreating..."
    RECREATE_VENV=1
  elif ! python_supports_mlx "$VENV_DIR/bin/python"; then
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
