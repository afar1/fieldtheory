#!/bin/bash
# Shared helper: find a Python 3.10-3.13 ARM64 installation that can resolve
# MLX wheels. Sourced by setup-qwen.sh.
#
# Usage:
#   source scripts/find-mlx-python.sh
#   PYTHON_BIN="$(choose_mlx_python)" || exit 1
#
# Functions exported:
#   python_supports_mlx_range   - version range check
#   python_version_string       - e.g. "3.12.1"
#   python_machine              - e.g. "arm64"
#   python_can_resolve_mlx      - pip download probe
#   choose_mlx_python           - find best candidate, print path

PYPI_EXTRA_INDEX_URL="${PYPI_EXTRA_INDEX_URL:-https://pypi.org/simple}"

python_supports_mlx_range() {
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

choose_mlx_python() {
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
    python_supports_mlx_range "$candidate" || continue
    [ "$(python_machine "$candidate")" = "arm64" ] || continue
    python_can_resolve_mlx "$candidate" || continue
    echo "$candidate"
    return 0
  done
  return 1
}
