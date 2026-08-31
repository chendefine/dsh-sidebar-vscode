#!/usr/bin/env bash
# Install the dsh.selection-reference VS Code extension into the LOCAL
# VS Code instance of this machine — the `code serve-web` server started by
# the runtime container entrypoint (port 8000, /vscode base path, server
# data dir /data/workspace/.vscode).
#
# What it does (idempotent):
#   1. package extension/ into a VSIX with @vscode/vsce (skip with --skip-build)
#   2. unzip the VSIX into  $SERVER_DATA_DIR/extensions/<publisher.name>-<version>/
#   3. register/refresh the entry in that dir's extensions.json (serve-web format)
#      and drop stale version folders of this extension
#   4. restart serve-web with its exact previous argv (extension scan runs at
#      startup), cleaning up orphaned inner server processes first
#   5. health-check the workbench URL
#
# Usage: scripts/install-extension.sh [--skip-build] [--vsix PATH] [-h]
#   --vsix PATH installs from that exact file (implies --skip-build — the
#   build step would otherwise repackage extension/ over it)
#
# Env overrides:
#   SERVER_DATA_DIR  serve-web --server-data-dir (default /data/workspace/.vscode)
#   CODE_BIN         code CLI binary            (default `command -v code`)
#   HOST/PORT/BASE_PATH/CLI_DATA_DIR/DEFAULT_FOLDER
#                    fallback argv when serve-web is not currently running
#   NPM_CACHE        npm cache for the vsce step (default $TMPDIR/dsh-vsce-npm-cache)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
EXT_SRC="$HERE/extension"

SERVER_DATA_DIR="${SERVER_DATA_DIR:-/data/workspace/.vscode}"
# command -v under `set -e` would exit SILENTLY when code is absent (the
# friendly FATAL below is then unreachable) — degrade to empty and let the
# executability check report it.
CODE_BIN="${CODE_BIN:-$(command -v code || true)}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
BASE_PATH="${BASE_PATH:-/vscode}"
CLI_DATA_DIR="${CLI_DATA_DIR:-/usr/local/share/vscode}"
DEFAULT_FOLDER="${DEFAULT_FOLDER:-/data/workspace}"
NPM_CACHE="${NPM_CACHE:-${TMPDIR:-/tmp}/dsh-vsce-npm-cache}"

SKIP_BUILD=0
VSIX_ARG=""

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --vsix) shift; [ $# -gt 0 ] || usage 1; VSIX_ARG="$1" ;;
    -h|--help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 1 ;;
  esac
  shift
done

# An explicit --vsix addresses an existing file: never rebuild over it.
if [ -n "$VSIX_ARG" ]; then SKIP_BUILD=1; fi

for dep in node unzip curl setsid; do
  command -v "$dep" >/dev/null 2>&1 || { echo "FATAL: missing dependency: $dep" >&2; exit 1; }
done
[ -x "$CODE_BIN" ] || { echo "FATAL: code CLI not found/executable: $CODE_BIN" >&2; exit 1; }
[ -f "$EXT_SRC/package.json" ] || { echo "FATAL: $EXT_SRC/package.json not found" >&2; exit 1; }

EXT_ID="$(DSH_PKG="$EXT_SRC/package.json" node -p "require(process.env.DSH_PKG).publisher + '.' + require(process.env.DSH_PKG).name")"
EXT_VERSION="$(DSH_PKG="$EXT_SRC/package.json" node -p "require(process.env.DSH_PKG).version")"
EXT_ROOT="$SERVER_DATA_DIR/extensions"
DEST_FOLDER="${EXT_ID}-${EXT_VERSION}"
DEST_DIR="$EXT_ROOT/$DEST_FOLDER"
VSIX_DIR="$EXT_SRC/vsix"
VSIX="${VSIX_ARG:-$VSIX_DIR/dsh-selection-reference-${EXT_VERSION}.vsix}"

log() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------- 1. VSIX ---
if [ "$SKIP_BUILD" = 1 ]; then
  [ -f "$VSIX" ] || { echo "FATAL: --skip-build but VSIX not found: $VSIX" >&2; exit 1; }
  log "skip build, reusing $VSIX"
else
  log "packaging VSIX from $EXT_SRC (vsce) into $VSIX_DIR"
  mkdir -p "$VSIX_DIR"
  ( cd "$EXT_SRC" && npm_config_cache="$NPM_CACHE" \
      npx --yes @vscode/vsce package --allow-missing-repository \
      --out "$VSIX" </dev/null )
  [ -f "$VSIX" ] || { echo "FATAL: vsce reported success but VSIX missing" >&2; exit 1; }
fi

# -------------------------------------------------------- 2. install files ---
log "installing files into $DEST_DIR"
mkdir -p "$EXT_ROOT"
TMP_EXTRACT="$(mktemp -d)"
trap 'rm -rf "$TMP_EXTRACT"' EXIT
unzip -q -o "$VSIX" 'extension/*' -d "$TMP_EXTRACT"
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -a "$TMP_EXTRACT/extension/." "$DEST_DIR/"

# drop stale version folders of this extension so only the installed one remains
find "$EXT_ROOT" -maxdepth 1 -type d -name "${EXT_ID}-*" ! -name "$DEST_FOLDER" \
  -exec rm -rf {} + 2>/dev/null || true

# ----------------------------------------------------- 3. register manifest ---
log "registering $EXT_ID@$EXT_VERSION in $EXT_ROOT/extensions.json"
if [ -f "$EXT_ROOT/extensions.json" ]; then
  cp -a "$EXT_ROOT/extensions.json" "$EXT_ROOT/extensions.json.bak-dsh"
else
  echo '[]' > "$EXT_ROOT/extensions.json"   # first extension ever installed
fi

DSH_EXT_ROOT="$EXT_ROOT" DSH_EXT_FOLDER="$DEST_FOLDER" DSH_EXT_ID="$EXT_ID" node <<'NODE'
'use strict'
// Register (or refresh) the extension entry in the serve-web extensions.json
// manifest. Entry shape mirrors what a gallery install writes on this
// instance: location carries path+scheme only, targetPlatform is the string
// "undefined" for universal extensions.
const fs = require('fs')
const root = process.env.DSH_EXT_ROOT
const folder = process.env.DSH_EXT_FOLDER
const id = process.env.DSH_EXT_ID
const pkg = JSON.parse(fs.readFileSync(`${root}/${folder}/package.json`, 'utf8'))
const listPath = `${root}/extensions.json`
const list = JSON.parse(fs.readFileSync(listPath, 'utf8'))
const entry = {
  identifier: { id },
  version: pkg.version,
  location: { $mid: 1, path: `${root}/${folder}`, scheme: 'file' },
  relativeLocation: folder,
  metadata: {
    installedTimestamp: Date.now(),
    pinned: false,
    source: 'gallery',
    publisherDisplayName: pkg.publisher,
    targetPlatform: 'undefined',
    updated: false,
    private: true,
    isPreReleaseVersion: false,
    hasPreReleaseVersion: false,
    preRelease: false,
  },
}
const next = list.filter(c => c.identifier?.id !== id)
next.push(entry)
fs.writeFileSync(listPath, `${JSON.stringify(next)}\n`)
console.log(`registered ${id}@${pkg.version}; manifest entries: ${next.length}`)
NODE

# ------------------------------------------------------ 4. restart serve-web ---
alive() { # alive <pid>: /proc exists and state is not zombie
  [ -d "/proc/$1" ] || return 1
  case "$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')" in Z*) return 1 ;; esac
  return 0
}
term_wait() { # term_wait <pid> <label>: TERM, up to 10s, then KILL
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do alive "$pid" || return 0; sleep 0.5; done
  echo "  (kill -KILL $pid)"
  kill -KILL "$pid" 2>/dev/null || true
}

# capture the running serve-web argv (router process = the `code serve-web` CLI).
# Both flag spellings match (--server-data-dir PATH and --server-data-dir=PATH).
mapfile -t ROUTERS < <(
  for pid in $(pgrep -f 'serve-web' || true); do
    [ "$pid" = "$$" ] && continue
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *"$CODE_BIN"*|*code*serve-web*) ;;
      *) continue ;;
    esac
    case "$cmd" in
      *serve-web*"--server-data-dir $SERVER_DATA_DIR"*|*serve-web*"--server-data-dir=$SERVER_DATA_DIR"*) echo "$pid" ;;
    esac
  done
)

ARGS=()
if [ "${#ROUTERS[@]}" -gt 0 ] && [ -n "${ROUTERS[0]}" ]; then
  mapfile -t ARGS < <(tr '\0' '\n' < "/proc/${ROUTERS[0]}/cmdline" | tail -n +2)
  log "stopping serve-web process tree (router + inner server): ${ROUTERS[*]}"
  for pid in "${ROUTERS[@]}"; do term_wait "$pid"; done
  # the inner server (node server-main.js, plus its sh wrapper) can outlive
  # the router — TERM anything still holding our --server-data-dir (both
  # flag spellings; dots ERE-escaped for pgrep)
  DATA_DIR_ERE="$(printf '%s' "$SERVER_DATA_DIR" | sed 's/[\\.]/\\&/g')"
  for pid in $(pgrep -f "server-data-dir[ =]$DATA_DIR_ERE" || true); do
    [ "$pid" = "$$" ] && continue
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *server-main.js*) echo "  cleaning orphan pid $pid"; term_wait "$pid" ;;
    esac
  done
else
  log "no running serve-web found — will start one with default args"
  read -r -a ARGS <<< "serve-web --host $HOST --port $PORT --accept-server-license-terms \
--without-connection-token --server-base-path $BASE_PATH \
--cli-data-dir $CLI_DATA_DIR --server-data-dir $SERVER_DATA_DIR \
--default-folder $DEFAULT_FOLDER"
  ARGS=("${ARGS[@]}")
fi

# relaunch detached with the exact same arguments (setsid: survives this shell)
SERVE_HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
LOG="/tmp/serve-web-restart-$(date +%Y%m%dT%H%M%S).log"
log "relaunching serve-web: $CODE_BIN ${ARGS[*]} (log: $LOG)"
setsid nohup env HOME="$SERVE_HOME" "$CODE_BIN" "${ARGS[@]}" >"$LOG" 2>&1 </dev/null &
sleep 1

# ------------------------------------------------------- 5. health check ---
hport="$PORT"; hbase="$BASE_PATH"
for ((i = 0; i < ${#ARGS[@]} - 1; i++)); do
  case "${ARGS[$i]}" in
    --port) hport="${ARGS[$((i + 1))]}" ;;
    --server-base-path) hbase="${ARGS[$((i + 1))]}" ;;
  esac
done
URL="http://127.0.0.1:${hport}${hbase}/"
log "health check: $URL"
ok=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$URL"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "FATAL: serve-web did not become healthy within 60s — last log lines:" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi
echo "healthy: $URL -> HTTP 200"

log "done: $EXT_ID@$EXT_VERSION installed"
echo "Reload any open workbench page (or Reload Window) to pick up the extension."
