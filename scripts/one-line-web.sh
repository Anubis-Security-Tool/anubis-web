#!/usr/bin/env bash
# One-line installer for Anubis-Security-Tool web (build from source).
#   curl -fsSL <your-host>/scripts/one-line-web.sh | bash
# Override with env vars:
#   ANUBIS_REPO_URL  git url   (default: https://github.com/Anubis-Security-Tool/anubis-web.git)
#   ANUBIS_REF       branch/tag to checkout (default: repo default branch)
#   ANUBIS_DIR       target dir (default: ./anubis-web)
#   ANUBIS_MANAGED_URL gateway origin (default: https://api.anubis.locker)
#   ANUBIS_MANAGED_ACCESS=0 explicit standalone install (default: managed)
set -Eeuo pipefail

REPO_URL="${ANUBIS_REPO_URL:-https://github.com/Anubis-Security-Tool/anubis-web.git}"
REF="${ANUBIS_REF:-}"
TARGET_DIR="${ANUBIS_DIR:-anubis-web}"
MIN_NODE_MAJOR=24

log () { printf '\033[1;34m[anubis]\033[0m %s\n' "$*"; }
die () { printf '\033[1;31m[anubis] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
trap 'rc=$?; die "failed at line ${LINENO} (exit ${rc})"' ERR

need () { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed. $2"; }

need git "Install git first."
need node "Install Node.js ${MIN_NODE_MAJOR}+ (https://nodejs.org or fnm)."
need npm "Install npm with Node.js."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  die "Node.js ${MIN_NODE_MAJOR}+ required, found $(node -v)."
fi
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  log "warning: make/g++ not found; native modules (node-pty, serialport) may fail to build."
  log "  Debian/Ubuntu: sudo apt install -y make python3 g++ build-essential"
fi

if [ -e "${TARGET_DIR}/.git" ]; then
  git -C "${TARGET_DIR}" diff --quiet
  git -C "${TARGET_DIR}" diff --cached --quiet
  log "updating existing checkout in ${TARGET_DIR}"
  git -C "${TARGET_DIR}" fetch --tags --prune origin
  if [ -n "${REF}" ]; then
    git -C "${TARGET_DIR}" checkout "${REF}"
  else
    git -C "${TARGET_DIR}" pull --ff-only
  fi
elif [ -e "${TARGET_DIR}" ]; then
  die "${TARGET_DIR} exists and is not a git checkout; set ANUBIS_DIR to another path."
else
  log "cloning ${REPO_URL}"
  if [ -n "${REF}" ]; then
    git clone --depth 1 --branch "${REF}" "${REPO_URL}" "${TARGET_DIR}"
  else
    git clone --depth 1 "${REPO_URL}" "${TARGET_DIR}"
  fi
fi

cd "${TARGET_DIR}"

node scripts/install-source.js

log "done. Start with:  cd ${TARGET_DIR} && npm run managed   (local: http://127.0.0.1:5577)"
log "Web login credentials are stored in .env; the gateway also requires administrator approval and browser login."
