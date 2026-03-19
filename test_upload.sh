#!/usr/bin/env bash
# test_upload.sh — Upload an audio file and run the full pipeline (Step 1 + Step 2).
#
# Pipeline:
#   1. AssemblyAI transcription + diarisation  (Step 1)
#   2. LangGraph LLM analysis loop             (Step 2 — intention / sentiment / issues)
#   3. Final report generation                 (synthesis + improvement axes)
#
# Usage:
#   ./test_upload.sh                           # uses kick-off.mp3 next to this script
#   ./test_upload.sh /path/to/audio.mp3
#   ./test_upload.sh audio.mp3 5              # 5 participants expected
#   ./test_upload.sh audio.mp3 5 fr           # 5 participants, French audio
#   ./test_upload.sh audio.mp3 "" fr          # auto-count participants, French audio
#
# Arguments:
#   $1  Path to audio file (default: kick-off.mp3 next to this script)
#   $2  speakers_expected — known participant count (optional, improves diarisation)
#   $3  language_code — BCP-47 code e.g. "fr", "en" (optional)
#
# Output files (written to results/ next to this script):
#   results/<basename>_<session_id>.txt          — plain-text transcript with analysis
#   results/<basename>_<session_id>.json         — utterances JSON array (with analysis)
#   results/<basename>_<session_id>_report.json  — full structured report JSON

set -euo pipefail

API="http://localhost:8000"
AUDIO_FILE="${1:-"$(dirname "$0")/kick-off.mp3"}"
SPEAKERS="${2:-}"
LANGUAGE="${3:-}"
POLL_INTERVAL=10
RESULTS_DIR="$(dirname "$0")/results"

# ── Resolve absolute path ─────────────────────────────────────────────────────
AUDIO_FILE="$(realpath "$AUDIO_FILE")"

if [[ ! -f "$AUDIO_FILE" ]]; then
  echo "❌  File not found: $AUDIO_FILE"
  echo "    Usage: $0 /path/to/audio.mp3"
  exit 1
fi

mkdir -p "$RESULTS_DIR"

echo "🎙  Audio file : $AUDIO_FILE"
echo "🌐  API        : $API"
[[ -n "$SPEAKERS" ]] && echo "👥  Speakers   : $SPEAKERS"
[[ -n "$LANGUAGE" ]] && echo "🌍  Language   : $LANGUAGE"
echo ""

# ── Step 1: Create session ────────────────────────────────────────────────────
echo "▶  Creating session..."
TITLE="$(basename "$AUDIO_FILE")"
BASENAME="${TITLE%.*}"

RESPONSE=$(curl -sf -X POST "$API/sessions" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\"}")

SESSION_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "✔  Session created : $SESSION_ID"
echo ""

# ── Step 2: Upload audio ──────────────────────────────────────────────────────
echo "▶  Uploading $TITLE..."
UPLOAD_URL="$API/sessions/$SESSION_ID/audio"
SEP="?"
if [[ -n "$SPEAKERS" ]]; then
  UPLOAD_URL="${UPLOAD_URL}${SEP}speakers_expected=${SPEAKERS}"
  SEP="&"
fi
[[ -n "$LANGUAGE" ]] && UPLOAD_URL="${UPLOAD_URL}${SEP}language_code=${LANGUAGE}"
curl -sf -X POST "$UPLOAD_URL" -F "file=@$AUDIO_FILE" > /dev/null
echo "✔  Upload accepted — full pipeline started (AssemblyAI → LLM analysis → report)"
echo ""

# ── Step 3: Poll until pipeline complete ─────────────────────────────────────
# status == 'done' means the full pipeline has finished:
#   transcription + per-utterance LLM analysis + final report generation
echo "⏳  Polling every ${POLL_INTERVAL}s — this may take 2–5 min (Ctrl+C to abort)..."
echo ""

ELAPSED=0
while true; do
  RESULT=$(curl -sf "$API/sessions/$SESSION_ID")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

  printf "    [%3ds]  status = %s\n" "$ELAPSED" "$STATUS"

  if [[ "$STATUS" == "done" ]]; then
    echo ""
    echo "✅  Pipeline complete!"
    break
  fi

  if [[ "$STATUS" == "error" ]]; then
    echo ""
    echo "❌  Pipeline failed — check uvicorn logs for details."
    exit 1
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# ── Step 4: Fetch the final report ───────────────────────────────────────────
echo ""
echo "▶  Fetching report..."
REPORT=$(curl -sf "$API/reports/$SESSION_ID")
echo "✔  Report received"

# ── Step 5: Write output files ────────────────────────────────────────────────
TXT_FILE="$RESULTS_DIR/${BASENAME}_${SESSION_ID}.txt"
JSON_FILE="$RESULTS_DIR/${BASENAME}_${SESSION_ID}.json"
REPORT_FILE="$RESULTS_DIR/${BASENAME}_${SESSION_ID}_report.json"

# Write report JSON to a temp file — avoids pipe-vs-heredoc stdin conflicts and
# shell argument-size limits that occur when passing large JSON via env variables.
REPORT_TMP="$(mktemp /tmp/report_XXXXXX.json)"
printf '%s' "$REPORT" > "$REPORT_TMP"
trap 'rm -f "$REPORT_TMP"' EXIT

echo ""
echo "💾  Writing results..."

# Plain-text transcript — one utterance per line with full analysis (terminal preview)
python3 - "$REPORT_TMP" << 'PYEOF'
import sys, json

with open(sys.argv[1]) as f:
    data = json.load(f)
utts = data.get("content", {}).get("utterances", [])

for u in utts:
    start   = u.get("start", 0)
    end     = u.get("end", 0)
    speaker = u.get("speaker", "?")
    text    = u.get("text", "")
    intent  = u.get("intention") or ""
    sent    = u.get("sentiment") or ""
    issues  = "; ".join(u.get("issues") or []) or "aucun"
    print(f"[{speaker}] {start:.1f}s → {end:.1f}s  {text}")
    if intent or sent:
        print(f"  → intention: {intent} | sentiment: {sent} | problèmes: {issues}")
PYEOF

# Plain-text transcript to file
python3 - "$REPORT_TMP" << 'PYEOF' > "$TXT_FILE"
import sys, json

with open(sys.argv[1]) as f:
    data = json.load(f)
utts = data.get("content", {}).get("utterances", [])

for u in utts:
    start   = u.get("start", 0)
    end     = u.get("end", 0)
    speaker = u.get("speaker", "?")
    text    = u.get("text", "")
    intent  = u.get("intention") or ""
    sent    = u.get("sentiment") or ""
    issues  = "; ".join(u.get("issues") or []) or "aucun"
    print(f"[{speaker}] {start:.1f}s → {end:.1f}s  {text}")
    if intent or sent:
        print(f"  → intention: {intent} | sentiment: {sent} | problèmes: {issues}")
PYEOF

# JSON utterances array — full data including analysis fields
python3 -c "
import sys, json
with open(sys.argv[1]) as f:
    data = json.load(f)
utts = data.get('content', {}).get('utterances', [])
print(json.dumps(utts, ensure_ascii=False, indent=2))
" "$REPORT_TMP" > "$JSON_FILE"

# Full structured report JSON
python3 -m json.tool "$REPORT_TMP" > "$REPORT_FILE"

echo "✔  Transcript + analysis : $TXT_FILE"
echo "✔  Utterances JSON       : $JSON_FILE"
echo "✔  Full report JSON      : $REPORT_FILE"

# ── Step 6: Print report summary to terminal ──────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  RAPPORT FINAL"
echo "════════════════════════════════════════════════════════"
echo ""
python3 -c "
import sys, json
with open(sys.argv[1]) as f:
    data = json.load(f)
c     = data.get('content', {})
synth = c.get('synthesis', '')
axes  = c.get('improvement_axes', [])

print('SYNTHÈSE')
print('--------')
print(synth)
print()
print('AXES D\'AMÉLIORATION')
print('-------------------')
for i, ax in enumerate(axes, 1):
    print(f'  {i}. {ax}')
" "$REPORT_TMP"
echo ""
echo "════════════════════════════════════════════════════════"
echo ""
echo "Session ID : $SESSION_ID"
