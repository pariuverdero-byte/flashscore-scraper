#!/usr/bin/env bash
set -euo pipefail

required=(
  BETFAIR_APP_KEY
  BETFAIR_USERNAME
  BETFAIR_PASSWORD
  BETFAIR_CERT_B64
  BETFAIR_KEY_B64
  CONTROL_API_TOKEN
  CONTROL_PLANE_URL
  REPOSITORY_ROOT
)

for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Missing required GitHub secret or setting: ${name}"
    exit 1
  fi
done

credential_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$credential_dir"
}
trap cleanup EXIT

printf '%s' "$BETFAIR_CERT_B64" | base64 --decode > "$credential_dir/client.crt"
printf '%s' "$BETFAIR_KEY_B64" | base64 --decode > "$credential_dir/client.key"
chmod 600 "$credential_dir/client.crt" "$credential_dir/client.key"

export BETFAIR_CERT_PATH="$credential_dir/client.crt"
export BETFAIR_KEY_PATH="$credential_dir/client.key"

corepack pnpm --dir control-plane install --frozen-lockfile
corepack pnpm --dir control-plane exec tsx worker/index.ts --once
