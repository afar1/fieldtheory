#!/bin/bash
# Download the Gemma 4 GGUF used by the local Field Theory command runner.
#
# Usage: bash scripts/setup-gemma.sh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_APP_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$MAC_APP_DIR/resources/models"
MODEL_FILENAME="gemma-4-E4B-it-Q4_K_M.gguf"
DEFAULT_MODEL_PATH="$MODEL_DIR/$MODEL_FILENAME"
MODEL_PATH="${FT_LOCAL_LLM_MODEL_PATH:-${FT_GEMMA_MODEL_PATH:-$DEFAULT_MODEL_PATH}}"
MODEL_URL="${FT_GEMMA_MODEL_URL:-https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf?download=true}"
MIN_BYTES=$((4 * 1024 * 1024 * 1024))
HOME_DIR="${HOME:-}"

file_size() {
  stat -L -f%z "$1" 2>/dev/null || stat -Lc%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

is_valid_model_file() {
  local model_file="$1"
  [[ -f "$model_file" ]] && [[ "$(file_size "$model_file")" -ge "$MIN_BYTES" ]]
}

same_file() {
  [[ -e "$1" && -e "$2" ]] && [[ "$1" -ef "$2" ]]
}

find_existing_model() {
  local target_path="$1"
  local candidate
  local candidates=(
    "${FT_LOCAL_LLM_MODEL_PATH:-}"
    "${FT_GEMMA_MODEL_PATH:-}"
  )
  if [[ -n "$HOME_DIR" ]]; then
    candidates+=(
      "$HOME_DIR/.fieldtheory/models/$MODEL_FILENAME"
      "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/unsloth/gemma-4-E4B-it-Q4_K_M/model.gguf"
      "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-E4B-it-Q4_K_M/model.gguf"
      "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-E4B-it/model.gguf"
      "$HOME_DIR/.cache/huggingface/hub/models--ggml-org--gemma-4-E4B-it-GGUF/snapshots/"*"/$MODEL_FILENAME"
    )
  fi

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    [[ "$candidate" != *"*"* ]] || continue
    if is_valid_model_file "$candidate" && ! same_file "$candidate" "$target_path"; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

LLAMA_SERVER_BIN="$(command -v llama-server || true)"
if [[ -z "$LLAMA_SERVER_BIN" && -x "/opt/homebrew/bin/llama-server" ]]; then
  LLAMA_SERVER_BIN="/opt/homebrew/bin/llama-server"
fi
if [[ -z "$LLAMA_SERVER_BIN" && -x "/usr/local/bin/llama-server" ]]; then
  LLAMA_SERVER_BIN="/usr/local/bin/llama-server"
fi

if [[ -n "$LLAMA_SERVER_BIN" ]]; then
  echo "llama.cpp server found: $LLAMA_SERVER_BIN"
elif command -v brew >/dev/null 2>&1; then
  echo "Installing llama.cpp runtime with Homebrew..."
  brew install llama.cpp
else
  echo "ERROR: llama-server is required to run Gemma 4 locally." >&2
  echo "Install llama.cpp or set FT_LLAMA_SERVER_PATH to a llama-server binary." >&2
  exit 1
fi

mkdir -p "$(dirname "$MODEL_PATH")"

if [[ "${FT_GEMMA_REUSE_EXISTING:-1}" != "0" ]]; then
  existing_model="$(find_existing_model "$MODEL_PATH" || true)"
  if [[ -n "$existing_model" ]]; then
    if [[ "$MODEL_PATH" == "$DEFAULT_MODEL_PATH" ]]; then
      if [[ -e "$MODEL_PATH" || -L "$MODEL_PATH" ]]; then
        echo "Replacing app-local Gemma 4 copy with link to existing model:"
      else
        echo "Linking app-local Gemma 4 path to existing model:"
      fi
      rm -f "$MODEL_PATH"
      ln -s "$existing_model" "$MODEL_PATH"
      echo "  $MODEL_PATH -> $existing_model"
      exit 0
    fi
    if [[ ! -e "$MODEL_PATH" ]] || ! is_valid_model_file "$MODEL_PATH"; then
      echo "Linking requested Gemma 4 path to existing model:"
      rm -f "$MODEL_PATH"
      ln -s "$existing_model" "$MODEL_PATH"
      echo "  $MODEL_PATH -> $existing_model"
      exit 0
    fi
  fi
fi

if is_valid_model_file "$MODEL_PATH"; then
  echo "Gemma 4 model already present:"
  echo "  $MODEL_PATH"
  exit 0
fi

if [[ -f "$MODEL_PATH" ]]; then
  current_size="$(file_size "$MODEL_PATH")"
  if [[ "$current_size" -ge "$MIN_BYTES" ]]; then
    echo "Gemma 4 model already present:"
    echo "  $MODEL_PATH"
    exit 0
  fi
  echo "Found incomplete Gemma 4 model; resuming download:"
  echo "  $MODEL_PATH"
else
  echo "Downloading Gemma 4 model:"
  echo "  $MODEL_PATH"
fi

curl --location --fail --continue-at - --output "$MODEL_PATH" "$MODEL_URL"

final_size="$(file_size "$MODEL_PATH")"
if [[ "$final_size" -lt "$MIN_BYTES" ]]; then
  echo "ERROR: Gemma 4 model download is too small: $final_size bytes" >&2
  exit 1
fi

echo "Gemma 4 setup complete:"
echo "  $MODEL_PATH"
