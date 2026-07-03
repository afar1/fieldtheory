#!/bin/bash
# Download the Gemma 4 GGUF used by the local Field Theory command runner.
#
# Usage: bash scripts/setup-gemma.sh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_APP_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$MAC_APP_DIR/resources/models"
MODEL_ID="${FT_GEMMA_MODEL_ID:-gemma-4-E4B-it-Q4_K_M}"

case "$MODEL_ID" in
  gemma-4-E4B-it-Q4_K_M)
    MODEL_FILENAME="gemma-4-E4B-it-Q4_K_M.gguf"
    DEFAULT_MODEL_URL="https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf?download=true"
    OLLAMA_MODEL_NAME="gemma4"
    OLLAMA_MODEL_TAG="e4b"
    MIN_BYTES=$((4 * 1024 * 1024 * 1024))
    ;;
  gemma-4-12B-it-Q4_K_M)
    MODEL_FILENAME="gemma-4-12B-it-Q4_K_M.gguf"
    DEFAULT_MODEL_URL="https://huggingface.co/ggml-org/gemma-4-12B-it-GGUF/resolve/main/gemma-4-12B-it-Q4_K_M.gguf?download=true"
    OLLAMA_MODEL_NAME="gemma4"
    OLLAMA_MODEL_TAG="12b"
    MIN_BYTES=$((6 * 1024 * 1024 * 1024))
    ;;
  *)
    echo "ERROR: Unsupported Gemma model: $MODEL_ID" >&2
    exit 1
    ;;
esac

DEFAULT_MODEL_PATH="$MODEL_DIR/$MODEL_FILENAME"
MODEL_PATH="${FT_LOCAL_LLM_MODEL_PATH:-${FT_GEMMA_MODEL_PATH:-$DEFAULT_MODEL_PATH}}"
MODEL_URL="${FT_GEMMA_MODEL_URL:-$DEFAULT_MODEL_URL}"
HOME_DIR="${HOME:-}"
CODEX_PROFILE_PATH="${FT_GEMMA_CODEX_PROFILE_PATH:-${HOME_DIR:+$HOME_DIR/.codex/gemma.config.toml}}"

ensure_codex_gemma_profile() {
  [[ "${FT_GEMMA_INSTALL_CODEX_PROFILE:-1}" != "0" ]] || return 0
  [[ -n "$CODEX_PROFILE_PATH" ]] || return 0

  mkdir -p "$(dirname "$CODEX_PROFILE_PATH")"
  if [[ -f "$CODEX_PROFILE_PATH" ]] && ! grep -q 'Field Theory managed Gemma profile' "$CODEX_PROFILE_PATH"; then
    echo "Codex Gemma profile already exists:"
    echo "  $CODEX_PROFILE_PATH"
    return 0
  fi

  cat > "$CODEX_PROFILE_PATH" <<'EOF'
# Field Theory managed Gemma profile.
# Use with: codex -p gemma

[features]
multi_agent = false
memories = false
goals = false
js_repl = false

[plugins."github@openai-curated"]
enabled = false

[plugins."documents@openai-primary-runtime"]
enabled = false

[plugins."spreadsheets@openai-primary-runtime"]
enabled = false

[plugins."presentations@openai-primary-runtime"]
enabled = false

[plugins."gmail@openai-curated"]
enabled = false

[plugins."slack@openai-curated"]
enabled = false

[plugins."google-calendar@openai-curated"]
enabled = false

[plugins."figma@openai-curated"]
enabled = false

[plugins."vercel@openai-curated"]
enabled = false

[plugins."build-ios-apps@openai-curated"]
enabled = false

[plugins."linear@openai-curated"]
enabled = false

[plugins."openai-developers@openai-curated"]
enabled = false

[plugins."google-drive@openai-curated"]
enabled = false

[plugins."field-theory@personal"]
enabled = true

[plugins."compound-engineering@compound-engineering-plugin"]
enabled = false

[plugins."browser@openai-bundled"]
enabled = false

[plugins."chrome@openai-bundled"]
enabled = false
EOF

  echo "Codex Gemma profile ready:"
  echo "  $CODEX_PROFILE_PATH"
}

ensure_codex_gemma_profile

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

find_ollama_model_blob() {
  [[ -n "$HOME_DIR" ]] || return 1
  local manifest_path="$HOME_DIR/.ollama/models/manifests/registry.ollama.ai/library/$OLLAMA_MODEL_NAME/$OLLAMA_MODEL_TAG"
  [[ -f "$manifest_path" ]] || return 1

  local digest
  digest="$(tr -d '\n' < "$manifest_path" | sed -n 's/.*"mediaType":"application\/vnd\.ollama\.image\.model","digest":"sha256:\([0-9a-f][0-9a-f]*\)".*/\1/p')"
  [[ -n "$digest" ]] || return 1

  local blob_path="$HOME_DIR/.ollama/models/blobs/sha256-$digest"
  is_valid_model_file "$blob_path" || return 1
  echo "$blob_path"
}

find_existing_model() {
  local target_path="$1"
  local candidate
  local ollama_model_blob
  local candidates=(
    "${FT_LOCAL_LLM_MODEL_PATH:-}"
    "${FT_GEMMA_MODEL_PATH:-}"
  )
  if [[ -n "$HOME_DIR" ]]; then
    ollama_model_blob="$(find_ollama_model_blob || true)"
    candidates+=("$HOME_DIR/.fieldtheory/models/$MODEL_FILENAME")
    [[ -z "$ollama_model_blob" ]] || candidates+=("$ollama_model_blob")
    case "$MODEL_ID" in
      gemma-4-E4B-it-Q4_K_M)
        candidates+=(
          "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/unsloth/gemma-4-E4B-it-Q4_K_M/model.gguf"
          "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-E4B-it-Q4_K_M/model.gguf"
          "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-E4B-it/model.gguf"
          "$HOME_DIR/.cache/huggingface/hub/models--ggml-org--gemma-4-E4B-it-GGUF/snapshots/"*"/$MODEL_FILENAME"
        )
        ;;
      gemma-4-12B-it-Q4_K_M)
        candidates+=(
          "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-12B-it-Q4_K_M/model.gguf"
          "$HOME_DIR/Library/Application Support/Atomic Chat/data/llamacpp/models/google/gemma-4-12B-it/model.gguf"
          "$HOME_DIR/.cache/huggingface/hub/models--ggml-org--gemma-4-12B-it-GGUF/snapshots/"*"/$MODEL_FILENAME"
        )
        ;;
    esac
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
