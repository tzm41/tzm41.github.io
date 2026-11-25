#!/usr/bin/env bash
# Local daily briefing updater — run manually, via cron, or via macOS launchd.
# Uses Gemini CLI (signed in with your Google account / AI Pro or Ultra quota)
# when available so you can leverage stronger Gemini Pro models without API billing.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

RAW_BUNDLE="$TMP_DIR/raw_bundle.json"
SYNTHESIS_JSON="$TMP_DIR/synthesis.json"

echo "[local_update] Syncing latest repository state..."
git pull --rebase origin master

if command -v gemini >/dev/null 2>&1; then
  echo "[local_update] Using Gemini CLI (Google account / Pro model quota)..."
  "$PYTHON_BIN" -m scripts.briefing.run --fetch-only "$RAW_BUNDLE"

  PROMPT_FILE="$TMP_DIR/prompt.txt"
  "$PYTHON_BIN" -c '
import json, sys
b = json.load(open(sys.argv[1]))
print("Return ONLY raw valid JSON matching this JSON Schema (no markdown fences, no commentary):")
print(json.dumps(b["synthesis_schema"]))
print("\n---\n")
print(b["prompt"])
' "$RAW_BUNDLE" > "$PROMPT_FILE"

  # Set GEMINI_CLI_MODEL (e.g. gemini-2.5-pro or default) if desired
  if [ -n "${GEMINI_CLI_MODEL:-}" ]; then
    gemini -m "$GEMINI_CLI_MODEL" -p "$(cat "$PROMPT_FILE")" > "$SYNTHESIS_JSON"
  else
    gemini -p "$(cat "$PROMPT_FILE")" > "$SYNTHESIS_JSON"
  fi

  "$PYTHON_BIN" -m scripts.briefing.run --apply-synthesis "$RAW_BUNDLE" "$SYNTHESIS_JSON"
else
  echo "[local_update] Gemini CLI not found — running standard pipeline (GEMINI_API_KEY / fallback)..."
  "$PYTHON_BIN" -m scripts.briefing.run
fi

git add briefing/data/
if git diff --cached --quiet; then
  echo "[local_update] No data changes to commit."
  exit 0
fi

git commit -m "chore(briefing): update daily briefing ($(date -u +%Y-%m-%d))"
git push origin master
echo "[local_update] Published updated briefing to GitHub Pages."
