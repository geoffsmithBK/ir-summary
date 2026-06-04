#!/usr/bin/env bash
# Convenience wrapper for ir_average.py — activates the venv (creating it on
# first run) and forwards all arguments to the tool. Run from anywhere.
#
# Examples:
#   ./run-average.sh --dir "Newer IRs/SOME CAB" --filter "Cap Edge" -o "out - AVG.wav" --plot
#   ./run-average.sh "a.wav" "b.wav" -o "out - AVG.wav"
#   ./run-average.sh --help
set -euo pipefail

# Resolve the directory this script lives in (the archive root), so paths work
# regardless of the caller's current directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.ir-tools-venv"
SCRIPT="$ROOT/ir_average.py"

if [[ ! -f "$SCRIPT" ]]; then
  echo "error: ir_average.py not found at $SCRIPT" >&2
  exit 1
fi

# Create the venv + deps on first run if it's missing.
if [[ ! -d "$VENV" ]]; then
  echo "First run: creating venv at $VENV ..." >&2
  if command -v uv >/dev/null 2>&1; then
    uv venv "$VENV"
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
    uv pip install --quiet numpy scipy soundfile matplotlib
  else
    python3 -m venv "$VENV"
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
    pip install --quiet numpy scipy soundfile matplotlib
  fi
else
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
fi

exec python3 "$SCRIPT" "$@"
