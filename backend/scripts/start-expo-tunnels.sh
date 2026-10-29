#!/usr/bin/env bash
set -euo pipefail
workspace_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
roles=(customer admin courier)
for index in 0 1 2; do
  role="${roles[$index]}"
  port=$((8091 + index))
  unit="tazweed-$role-expo-$port"
  runtime="--go"
  runtime_label="Expo Go"
  if systemctl is-active --quiet "$unit" && ! systemctl show "$unit" --property=ExecStart --value | grep -q -- "$runtime"; then
    systemctl stop "$unit"
  fi
  if systemctl is-active --quiet "$unit"; then
    printf '%s\n' "$unit already active; see journalctl -u $unit"
    continue
  fi
  if ss -H -ltn "sport = :$port" | read -r _; then
    printf '%s\n' "Port $port is already owned. Identify its service before starting $unit." >&2
    exit 1
  fi
  systemd-run --unit="$unit" --description="Tazweed $role SDK 57 $runtime_label tunnel" \
    --collect --service-type=exec --working-directory="$workspace_dir/$role-app" \
    --setenv=EXPO_UNSTABLE_HEADLESS=1 --setenv=EXPO_NO_DEPENDENCY_VALIDATION=0 \
    --setenv=EXPO_NO_NEW_ARCH_COMPAT_CHECK=0 --property=Restart=on-failure --property=RestartSec=10s \
    /usr/bin/npx --no-install expo start --tunnel "$runtime" --port "$port" --max-workers 2
  printf '%s\n' "Started $unit; verify status, listening address, /status, manifest and public tunnel before sharing its URL."
done
