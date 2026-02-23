#!/bin/bash
# Setup Qwen3-ASR-0.6B transcription engine via mlx-audio.
# Creates a venv and installs dependencies. Run from mac-app/ directory.

set -euo pipefail

# Finder-launched apps often have a minimal PATH; include common Homebrew paths
# and keg-only python@3.x locations so production builds can find python3.12/3.13
# even when `python3` points to an incompatible version.
export PATH="/opt/homebrew/opt/python@3.13/bin:/opt/homebrew/opt/python@3.13/libexec/bin:/opt/homebrew/opt/python@3.12/bin:/opt/homebrew/opt/python@3.12/libexec/bin:/opt/homebrew/opt/python@3.11/bin:/opt/homebrew/opt/python@3.11/libexec/bin:/opt/homebrew/opt/python@3.10/bin:/opt/homebrew/opt/python@3.10/libexec/bin:/usr/local/opt/python@3.13/bin:/usr/local/opt/python@3.13/libexec/bin:/usr/local/opt/python@3.12/bin:/usr/local/opt/python@3.12/libexec/bin:/usr/local/opt/python@3.11/bin:/usr/local/opt/python@3.11/libexec/bin:/usr/local/opt/python@3.10/bin:/usr/local/opt/python@3.10/libexec/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

VENV_DIR="build-qwen/venv"
MIN_PYTHON="3.10"
MAX_PYTHON_EXCLUSIVE="3.14"
PYPI_EXTRA_INDEX_URL="https://pypi.org/simple"

python_supports_qwen() {
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
    python_supports_qwen "$candidate" || continue
    [ "$(python_machine "$candidate")" = "arm64" ] || continue
    python_can_resolve_mlx "$candidate" || continue
    echo "$candidate"
    return 0
  done
  return 1
}

if ! PYTHON_BIN="$(choose_python)"; then
  CURRENT_PYTHON="$(command -v python3 2>/dev/null || true)"
  CURRENT_VERSION=""
  CURRENT_MACHINE=""
  if [ -n "$CURRENT_PYTHON" ] && [ -x "$CURRENT_PYTHON" ]; then
    CURRENT_VERSION="$(python_version_string "$CURRENT_PYTHON" || echo "unknown")"
    CURRENT_MACHINE="$(python_machine "$CURRENT_PYTHON" || echo "unknown")"
    echo "Found python3 at $CURRENT_PYTHON ($CURRENT_VERSION, $CURRENT_MACHINE)." >&2
  else
    echo "python3 is required for Qwen setup." >&2
  fi

  if [ -n "$CURRENT_PYTHON" ] && [ -x "$CURRENT_PYTHON" ]; then
    if python_supports_qwen "$CURRENT_PYTHON" && [ "$CURRENT_MACHINE" = "arm64" ] && ! python_can_resolve_mlx "$CURRENT_PYTHON"; then
      echo "Detected compatible Python version/architecture, but pip could not resolve an MLX wheel." >&2
      echo "This is likely an MLX wheel/index/network issue, not a Python version-range issue." >&2
      echo "Try the following:" >&2
      echo "  1) Check internet/DNS access to pypi.org and files.pythonhosted.org." >&2
      echo "  2) Upgrade pip tooling: $CURRENT_PYTHON -m pip install --upgrade pip setuptools wheel" >&2
      echo "  3) Probe MLX manually: $CURRENT_PYTHON -m pip download --no-deps --only-binary=:all: \"mlx>=0.30.0\"" >&2
      echo "  4) If still failing, install Homebrew Python 3.12 and rerun setup." >&2
    fi
  fi

  echo "Unable to find a compatible Python runtime for Qwen." >&2
  echo "Requirements: Apple Silicon (arm64), Python >= $MIN_PYTHON and < $MAX_PYTHON_EXCLUSIVE, and access to mlx wheels." >&2
  echo "Try: brew install python@3.12" >&2
  exit 1
fi

echo "Using python: $PYTHON_BIN ($(python_version_string "$PYTHON_BIN"), $(python_machine "$PYTHON_BIN"))"

RECREATE_VENV=0
if [ -d "$VENV_DIR" ]; then
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "Existing Qwen venv is incomplete. Recreating..."
    RECREATE_VENV=1
  elif ! python_supports_qwen "$VENV_DIR/bin/python"; then
    echo "Existing Qwen venv uses unsupported Python (requires >= $MIN_PYTHON and < $MAX_PYTHON_EXCLUSIVE). Recreating..."
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
  mkdir -p build-qwen
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "Using venv python: $("$VENV_DIR/bin/python" -V 2>&1)"

echo "Upgrading pip tooling..."
"$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel

echo "Installing MLX dependencies..."
"$VENV_DIR/bin/pip" install --upgrade --extra-index-url "$PYPI_EXTRA_INDEX_URL" --only-binary=:all: "mlx>=0.30.0"
"$VENV_DIR/bin/pip" install --upgrade --extra-index-url "$PYPI_EXTRA_INDEX_URL" "mlx-audio>=0.3.1"

echo "Verifying MLX + STT runtime..."
if ! "$VENV_DIR/bin/python" - <<'PY'
import importlib.util
import mlx.core as mx  # noqa: F401 - crashes here if runtime is incompatible
import mlx_audio.stt as stt

ok = hasattr(stt, "load_model")
if not ok:
    ok = importlib.util.find_spec("mlx_audio.stt.utils") is not None

if not ok:
    raise SystemExit("mlx-audio STT API not found")

print("mlx core + stt ready")
PY
then
  echo "MLX runtime check failed while importing mlx/mlx-audio in the new venv." >&2
  echo "In Field Theory, rerun Qwen setup from Settings > Transcription to rebuild the runtime." >&2
  echo "If you are running from source, rebuild manually with Homebrew Python 3.12:" >&2
  echo "  rm -rf \"$VENV_DIR\"" >&2
  echo "  brew install python@3.12" >&2
  echo "  bash scripts/setup-qwen.sh" >&2
  exit 1
fi

echo "Pre-downloading model weights (first run only)..."
"$VENV_DIR/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/Qwen3-ASR-0.6B-8bit')"

echo "Done. Test with:"
echo "  $VENV_DIR/bin/python scripts/qwen-transcribe.py --audio /path/to/recording.wav"
