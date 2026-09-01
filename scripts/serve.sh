#!/usr/bin/env bash
# Run diurn in the background as a detached process.
# Survives terminal close. Logs to .diurn/server.log.
# Usage: ./scripts/serve.sh [start|stop|status|restart|logs]
#
# ponytail: process identity is "whatever listens on $PORT" — we never kill by
# name or by stale PID file, only by port. Upgrade to a PID file written by
# the server itself if you ever run two instances on different ports.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DIURN_DATA_DIR:-$HOME/.diurn}"
LOG="$DATA_DIR/server.log"
PORT="${PORT:-11123}"

# PIDs currently listening on our port (may be empty).
port_pids() {
  ss -tlnp 2>/dev/null | awk -v port=":$PORT" '$4 ~ port"$" { if (match($0, /pid=[0-9]+/)) { p=substr($0, RSTART+4, RLENGTH-4); print p } }' | sort -u
}

start() {
  local pids
  pids="$(port_pids)"
  if [ -n "$pids" ]; then
    echo "port $PORT already in use by pid(s): $pids (not touching it)"
    return 1
  fi
  mkdir -p "$DATA_DIR"
  cd "$ROOT"
  # Rebuild only if .next is missing or older than any src file.
  if [ ! -d ".next" ] || [ -n "$(find src -newer .next/BUILD_ID -type f 2>/dev/null | head -1)" ]; then
    echo "building..."
    npm run build >"$LOG.build" 2>&1 || { echo "build failed, see $LOG.build"; exit 1; }
  fi
  nohup npx next start -p "$PORT" >"$LOG" 2>&1 < /dev/null &
  echo "starting on port $PORT (log: $LOG)"
  # Wait up to 10s for the port to come up.
  for _ in $(seq 1 40); do
    [ -n "$(port_pids)" ] && { echo "up: pid(s) $(port_pids)"; return 0; }
    sleep 0.25
  done
  echo "did not come up within 10s; check $LOG"
  return 1
}

stop() {
  local pids
  pids="$(port_pids)"
  if [ -z "$pids" ]; then
    echo "nothing listening on $PORT"
    return 0
  fi
  # Only kill processes bound to OUR port. Never kill by name.
  for pid in $pids; do
    if ! kill "$pid" 2>/dev/null; then
      echo "could not signal pid $pid (not ours or already gone?)"
      return 1
    fi
  done
  echo "stopped pid(s): $pids"
}

status() {
  local pids
  pids="$(port_pids)"
  if [ -n "$pids" ]; then
    echo "running on port $PORT, pid(s): $pids"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  restart) stop; start ;;
  logs) tail -f "$LOG" ;;
  *) echo "usage: $0 {start|stop|status|restart|logs}"; exit 1 ;;
esac
