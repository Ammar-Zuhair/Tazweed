#!/usr/bin/env bash
set -euo pipefail
workspace_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Phase05 real PostgreSQL (private local development/test server).
if ! command -v psql >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-client-16
fi
for project in customer-app admin-app courier-app backend; do
  (cd "$workspace_dir/$project" && npm ci --no-audit --no-fund)
done
# Phase11 Arabic server PDF renderer and review tools.
(cd "$workspace_dir/backend" && npx --no-install playwright install --with-deps chromium)
if ! command -v pdftoppm >/dev/null; then apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y poppler-utils; fi
