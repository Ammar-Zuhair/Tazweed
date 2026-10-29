#!/usr/bin/env bash
set -euo pipefail
workspace_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for project in customer-app admin-app courier-app backend; do
  (cd "$workspace_dir/$project" && npm ci --no-audit --no-fund)
done
# Optional UI acceptance browser. System packages must be restored after reprovision.
if [[ "${1:-}" == "--browser" ]]; then
  (cd "$workspace_dir/backend" && npx --no-install playwright install --with-deps chromium)
fi
