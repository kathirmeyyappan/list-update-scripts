#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/sync/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env not found at $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"

SHEET_KEY="${SHEET_KEY:-1MCPi0GCz_YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA}"
TAB=".csv Anime List Mirror"
OUTPUT="${1:-anime-list.csv}"

RANGE="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${TAB}'))")"
URL="https://sheets.googleapis.com/v4/spreadsheets/${SHEET_KEY}/values/${RANGE}?key=${GOOGLE_API_KEY}"

echo "Fetching sheet data..."
RESPONSE=$(curl -sf "$URL")

# formats json response into csv for saving
echo "$RESPONSE" | jq -r '
  .values[] |
  map(
    gsub("\""; "\"\"") |
    if test("[,\"\n\r]") then "\"" + . + "\"" else . end
  ) |
  join(",")
' > "$OUTPUT"

echo "Exported to $OUTPUT ($(wc -l < "$OUTPUT") rows)"
