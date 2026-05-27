#!/usr/bin/env bash
#
# run-server.sh — supervisor wrapper for the kiosk backend.
#
# systemd runs THIS script; we run node in a loop so the in-app Restart button
# (which exits the node process cleanly with code 0) triggers a fresh server
# boot inside ~1s without relying on systemd's Restart=always semantics. That
# matters because systemd will refuse to restart a unit that exits too quickly
# too often (StartLimitBurst=5/10s by default) — the wrapper sidesteps all of
# that by never letting the unit itself exit unless node really has crashed.
#
# Crash policy: a non-zero exit propagates out of the wrapper, so systemd's
# Restart=always still kicks in for real failures. A clean exit (0) or a
# signal-induced exit (128+) just loops.

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "run-server.sh: node not found on PATH" >&2
  exit 127
fi

while true; do
  "$NODE_BIN" src/server/index.js
  EXIT_CODE=$?
  # 0   = clean exit, operator-triggered restart.
  # 128+ = killed by a signal (SIGTERM, SIGKILL, etc.) — usually systemd
  #        stopping us; let the loop decide whether to relaunch.
  if (( EXIT_CODE != 0 && EXIT_CODE < 128 )); then
    echo "run-server.sh: node exited $EXIT_CODE — propagating to systemd" >&2
    exit "$EXIT_CODE"
  fi
  sleep 1
done
