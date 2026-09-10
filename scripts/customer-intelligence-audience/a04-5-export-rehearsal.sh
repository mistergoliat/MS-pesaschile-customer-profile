#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "usage: $0 BASE_URL DEFINITION_JSON EXPORT_TOKEN PII_TOKEN [CUSTOMER_PROFILE_PID]" >&2
  exit 2
fi

BASE_URL="${1%/}"
DEFINITION_JSON="$2"
EXPORT_TOKEN="$3"
PII_TOKEN="$4"
SERVICE_PID="${5:-}"

if [[ ! -f "$DEFINITION_JSON" ]]; then
  echo "definition file does not exist: $DEFINITION_JSON" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to build the four request bodies" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d -t audience-export-a04-5.XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

rss_kb() {
  if [[ -n "$SERVICE_PID" && -r "/proc/$SERVICE_PID/status" ]]; then
    awk '/^VmRSS:/ { print $2; exit }' "/proc/$SERVICE_PID/status"
  else
    echo 0
  fi
}

run_case() {
  local name="$1"
  local format="$2"
  local fields_json="$3"
  local output="$TMP_DIR/$name"
  local headers="$TMP_DIR/$name.headers"
  local request="$TMP_DIR/$name.request.json"
  local peak_file="$TMP_DIR/$name.peak"

  jq -n --slurpfile definition "$DEFINITION_JSON" \
    --arg format "$format" --argjson fields "$fields_json" \
    '{definition: $definition[0], format: $format, fields: $fields}' > "$request"

  local idle_rss
  idle_rss="$(rss_kb)"
  local curl_exit=0
  local curl_pid
  local monitor_pid
  (
    set +e
    curl -sS -X POST \
      -H "Authorization: Bearer $EXPORT_TOKEN" \
      -H "x-internal-customer-intelligence-export-token: $EXPORT_TOKEN" \
      -H "x-internal-customer-intelligence-pii-export-token: $PII_TOKEN" \
      -H 'Content-Type: application/json' \
      --data-binary "@$request" \
      -D "$headers" \
      -o "$output" \
      -w '%{http_code} %{size_download} %{time_starttransfer} %{time_total}\n' \
      "$BASE_URL/v1/customer-intelligence/audiences/export" > "$TMP_DIR/$name.curl"
    echo "$?" > "$TMP_DIR/$name.curl_exit"
  ) &
  curl_pid=$!
  (
    local peak=0
    while kill -0 "$curl_pid" 2>/dev/null; do
      local current
      current="$(rss_kb)"
      if (( current > peak )); then peak="$current"; fi
      sleep 0.2
    done
    echo "$peak" > "$peak_file"
  ) &
  monitor_pid=$!
  wait "$curl_pid" || true
  curl_exit="$(cat "$TMP_DIR/$name.curl_exit")"
  wait "$monitor_pid"

  local post_rss
  post_rss="$(rss_kb)"
  local peak_rss
  peak_rss="$(cat "$peak_file")"
  local status size ttfb total content_type matched unknown generation total_server
  read -r status size ttfb total < "$TMP_DIR/$name.curl"
  content_type="$(awk -F': ' 'tolower($1)=="content-type" {gsub(/\r/, "", $2); print $2; exit}' "$headers")"
  matched="$(awk -F': ' 'tolower($1)=="x-audience-export-matched-count" {gsub(/\r/, "", $2); print $2; exit}' "$headers")"
  unknown="$(awk -F': ' 'tolower($1)=="x-audience-export-unknown-count" {gsub(/\r/, "", $2); print $2; exit}' "$headers")"
  generation="$(awk -F': ' 'tolower($1)=="x-audience-export-generation-ms" {gsub(/\r/, "", $2); print $2; exit}' "$headers")"
  total_server="$(awk -F': ' 'tolower($1)=="x-audience-export-total-ms" {gsub(/\r/, "", $2); print $2; exit}' "$headers")"

  echo "[$name] curl_exit=$curl_exit status=$status content_type=$content_type matched=${matched:-n/a} unknown=${unknown:-n/a} bytes=$size ttfb_s=$ttfb total_s=$total generation_ms=${generation:-n/a} server_total_ms=${total_server:-n/a} idle_rss_kb=$idle_rss peak_rss_kb=$peak_rss post_rss_kb=$post_rss"
  grep -qi '^Content-Disposition: attachment;' "$headers"
  [[ "$status" == "200" ]]
  [[ "$curl_exit" == "0" ]]

  if [[ "$format" == "CSV" ]]; then
    echo "[$name] csv_rows=$(awk 'END {print NR}' "$output") first_line=$(head -n 1 "$output")"
  else
    python3 - "$output" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys

path = Path(sys.argv[1])
with ZipFile(path) as workbook:
    names = set(workbook.namelist())
    assert '[Content_Types].xml' in names
    assert 'xl/workbook.xml' in names
print('[xlsx] zip_ok=true workbook_xml=true')
PY
  fi
}

run_case customerId-csv CSV '["customerId"]'
run_case full-csv CSV '["customerId","email","firstname","lastname"]'
run_case customerId-xlsx XLSX '["customerId"]'
run_case full-xlsx XLSX '["customerId","email","firstname","lastname"]'

echo "Rehearsal completed. Temporary request/download files were removed: $TMP_DIR"
