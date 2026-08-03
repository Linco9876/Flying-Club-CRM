#!/usr/bin/env bash

set -euo pipefail

desired_state="${1:-}"
project_ref="${2:-}"
access_token="${SUPABASE_ACCESS_TOKEN:-}"
maximum_attempts="${SUPABASE_STATE_MAX_ATTEMPTS:-120}"

if [[ "$desired_state" != "active" && "$desired_state" != "inactive" ]]; then
  echo "Usage: set-supabase-project-state.sh <active|inactive> <project-ref>" >&2
  exit 2
fi
if [[ -z "$project_ref" || -z "$access_token" ]]; then
  echo "A project reference and SUPABASE_ACCESS_TOKEN are required." >&2
  exit 2
fi
if ! [[ "$maximum_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "SUPABASE_STATE_MAX_ATTEMPTS must be a positive integer." >&2
  exit 2
fi

project_url="https://api.supabase.com/v1/projects/$project_ref"
last_request_attempt=-10

get_status() {
  curl --fail --silent --show-error \
    --header "Authorization: Bearer $access_token" \
    "$project_url" \
    | jq -er '.status'
}

request_transition() {
  local action="$1"
  local response_file
  local status_code
  response_file="$(mktemp)"
  if ! status_code="$(curl --silent --show-error \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --request POST \
      --header "Authorization: Bearer $access_token" \
      --header "Content-Type: application/json" \
      "$project_url/$action")"; then
    rm -f "$response_file"
    echo "Supabase $action request had a transient transport failure; retrying."
    return 0
  fi
  rm -f "$response_file"
  if [[ "$status_code" =~ ^2 ]]; then
    echo "Supabase $action request accepted."
    return 0
  fi
  # A transitional-state race can legitimately return 400. Re-read the
  # project status on the next loop instead of failing or issuing a conflicting
  # lifecycle request.
  echo "Supabase $action returned HTTP $status_code; rechecking project state."
  return 0
}

for ((attempt = 1; attempt <= maximum_attempts; attempt += 1)); do
  if ! status="$(get_status)"; then
    echo "Supabase project status was temporarily unavailable; retrying (attempt $attempt of $maximum_attempts)."
    sleep 10
    continue
  fi

  if [[ "$desired_state" == "active" && "$status" == "ACTIVE_HEALTHY" ]]; then
    echo "Supabase project is active and healthy."
    exit 0
  fi
  if [[ "$desired_state" == "inactive" && "$status" == "INACTIVE" ]]; then
    echo "Supabase project is inactive."
    exit 0
  fi

  if ((attempt - last_request_attempt >= 3)); then
    if [[ "$desired_state" == "active" && "$status" == "INACTIVE" ]]; then
      request_transition restore
      last_request_attempt=$attempt
    elif [[ "$desired_state" == "inactive" && "$status" == "ACTIVE_HEALTHY" ]]; then
      request_transition pause
      last_request_attempt=$attempt
    fi
  fi

  echo "Waiting for Supabase project to become $desired_state (status: $status, attempt $attempt of $maximum_attempts)..."
  sleep 10
done

echo "::error::Supabase project did not become $desired_state within $((maximum_attempts * 10)) seconds."
exit 1
