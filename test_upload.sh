#!/usr/bin/env bash
# test_upload.sh — Upload an audio file and poll until transcription is done.
#
# Usage:
#   ./test_upload.sh /path/to/audio.mp3
#   ./test_upload.sh                        # uses kick-off.mp3 next to this script
#
# Output files (written to results/ next to this script):
#   results/<basename>_<session_id>.txt   — full transcript (one line per utterance)
#   results/<basename>_<session_id>.json  — raw JSON array of all utterance rows

set -euo pipefail

API="http://localhost:8000"
AUDIO_FILE="${1:-"$(dirname "$0")/../kick-off.mp3"}"
SPEAKERS="${2:-}"          # optional: number of participants (improves diarisation)
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
echo ""

# ── Step 1: Create session ────────────────────────────────────────────────────
echo "▶  Creating session..."
TITLE="$(basename "$AUDIO_FILE")"
BASENAME="${TITLE%.*}"

RESPONSE=$(curl -sf -X POST "$API/sessions" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\"}")

SESSION_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "✔  Session created: $SESSION_ID"
echo ""

# ── Step 2: Upload audio ──────────────────────────────────────────────────────
echo "▶  Uploading $TITLE..."
UPLOAD_URL="$API/sessions/$SESSION_ID/audio"
[[ -n "$SPEAKERS" ]] && UPLOAD_URL="${UPLOAD_URL}?speakers_expected=${SPEAKERS}"
curl -sf -X POST "$UPLOAD_URL" -F "file=@$AUDIO_FILE" > /dev/null
echo "✔  Upload accepted — pipeline started in background"
echo ""

# ── Step 3: Poll until done ───────────────────────────────────────────────────
echo "⏳  Polling every ${POLL_INTERVAL}s (Ctrl+C to stop)..."
echo ""

ELAPSED=0
while true; do
  RESULT=$(curl -sf "$API/sessions/$SESSION_ID")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

  printf "    [%3ds]  status = %s\n" "$ELAPSED" "$STATUS"

  if [[ "$STATUS" == "done" ]]; then
    echo ""
    echo "✅  Transcription complete!"
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

# ── Step 4: Write results to files ────────────────────────────────────────────
TXT_FILE="$RESULTS_DIR/${BASENAME}_${SESSION_ID}.txt"
JSON_FILE="$RESULTS_DIR/${BASENAME}_${SESSION_ID}.json"

echo ""
echo "💾  Writing results..."

# Plain-text transcript — one utterance per line
docker exec poc-healthy-management-db-1 \
  psql -U postgres -d workathon --no-align --tuples-only --field-separator "" \
  -c "SELECT format('[%s] %ss → %ss  %s', speaker, to_char(start_time,'FM999990.0'), to_char(end_time,'FM999990.0'), text) FROM utterances WHERE session_id='$SESSION_ID' ORDER BY start_time;" \
  > "$TXT_FILE"

# JSON array — full data, useful for the LangGraph phase
docker exec poc-healthy-management-db-1 \
  psql -U postgres -d workathon --no-align --tuples-only \
  -c "SELECT json_agg(row_to_json(u) ORDER BY u.start_time) FROM (SELECT speaker, start_time, end_time, text FROM utterances WHERE session_id='$SESSION_ID') u;" \
  > "$JSON_FILE"

echo "✔  Transcript : $TXT_FILE"
echo "✔  JSON data  : $JSON_FILE"
echo ""
echo "Session ID: $SESSION_ID"
