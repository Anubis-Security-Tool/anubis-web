#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec env NODE_ENV=production node ./src/app/app.js