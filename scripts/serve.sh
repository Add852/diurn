#!/usr/bin/env bash
# Diurn server manager — the one command for deployment.
#
#   npm run serve                 build if stale, start in background
#   npm run serve -- stop         stop it
#   npm run serve -- restart
#   npm run serve -- status
#   npm run serve -- logs         tail the server log
#   npm run serve -- enable       systemd user service: starts on boot,
#                                 auto-restarts on crash
#   npm run serve -- disable      undo enable
#
# Config: ~/.diurn/serve.conf (shell syntax) — see README. If the file uses
# "${PORT:-9000}" guards, environment variables win over the file.
#
# ponytail: process identity is "whatever listens on $PORT" — we never kill by
# name or by stale PID file, only by port. Running two instances on different
# ports would need a per-instance conf and unit name.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DIURN_DATA_DIR:-$HOME/.diurn}"
LOG="$DATA_DIR/server.log"
CONF="${DIURN_SERVE_CONF:-$HOME/.diurn/serve.conf}"
UNIT="diurn.service"
PORT="${PORT:-}"
HOST="${HOST:-}"

# Env (unset) -> conf file -> default 11123.
if [ -f "$CONF" ]; then . "$CONF"; fi
: "${PORT:=11123}"

# PIDs currently listening on our port (may be empty).
port_pids() {
  ss -tlnp 2>/dev/null | awk -v port=":$PORT" '$4 ~ port"$" { if (match($0, /pid=[0-9]+/)) { p=substr($0, RSTART+4, RLENGTH-4); print p } }' | sort -u
}

unit_enabled() { systemctl --user is-enabled "$UNIT" >/dev/null 2>&1; }

wait_up() {
  for _ in $(seq 1 40); do
    if [ -n "$(port_pids)" ]; then echo "up: pid(s) $(port_pids)"; return 0; fi
    sleep 0.25
  done
  echo "did not come up within 10s; check $LOG"
  return 1
}

server_args() {
  # Args for the next binary: [command] start -p PORT [-H HOST]
  echo start -p "$PORT"
  [ -n "$HOST" ] && echo -H "$HOST"
}

ensure_build() {
  if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
    build_now
    return
  fi
  local newer
  newer="$(find "$ROOT/src" "$ROOT/next.config.mjs" -newer "$ROOT/.next/BUILD_ID" 2>/dev/null | head -1)"
  if [ -n "$newer" ]; then
    build_now
  fi
}

build_now() {
  echo "building..."
  if ! (cd "$ROOT" && npm run build >"$LOG.build" 2>&1); then
    echo "build failed, see $LOG.build"
    exit 1
  fi
}

start() {
  if unit_enabled; then
    systemctl --user start "$UNIT"
    wait_up
    return
  fi
  local pids
  pids="$(port_pids)"
  if [ -n "$pids" ]; then
    echo "port $PORT already in use by pid(s): $pids (not touching it)"
    return 1
  fi
  mkdir -p "$DATA_DIR"
  ensure_build
  nohup node "$ROOT/node_modules/next/dist/bin/next" $(server_args) >"$LOG" 2>&1 < /dev/null &
  echo "starting on port $PORT (log: $LOG)"
  wait_up
}

stop() {
  if unit_enabled; then
    systemctl --user stop "$UNIT"
    echo "stopped (systemd)"
    return 0
  fi
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
  if unit_enabled; then
    echo "systemd unit $UNIT: $(systemctl --user is-active "$UNIT") (auto-start on boot)"
  fi
  local pids
  pids="$(port_pids)"
  if [ -n "$pids" ]; then
    echo "running on port $PORT, pid(s): $pids"
  else
    echo "not running"
  fi
}

logs() {
  mkdir -p "$DATA_DIR"
  touch "$LOG"
  tail -f "$LOG"
}

run() {
  # Foreground, used by the systemd unit (ExecStart) — exec so systemd
  # supervises the actual process. Use node directly, NOT npx: npx spawns
  # next-server as a child and exits 0 when the child is killed, which
  # defeats Restart=on-failure.
  mkdir -p "$DATA_DIR"
  ensure_build
  exec node "$ROOT/node_modules/next/dist/bin/next" $(server_args)
}

enable() {
  if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user is-system-running >/dev/null 2>&1; then
    echo "no systemd user session available — use plain 'start' for background mode"
    exit 1
  fi
  # Free the port if currently running in nohup mode (unit not installed yet,
  # so stop() takes the port-listener path).
  stop >/dev/null 2>&1 || true
  mkdir -p "$DATA_DIR" "$HOME/.config/systemd/user"
  ensure_build
  cat > "$HOME/.config/systemd/user/$UNIT" <<EOF
[Unit]
Description=Diurn server (port $PORT)
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart="$ROOT/scripts/serve.sh" run
Restart=always
RestartSec=5
StartLimitIntervalSec=0
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
EOF
  local was_active=false
  systemctl --user is-active --quiet "$UNIT" && was_active=true
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT" >/dev/null
  if $was_active; then
    systemctl --user restart "$UNIT"
  else
    systemctl --user start "$UNIT"
  fi
  wait_up
  echo "enabled — starts on login, auto-restarts on crash"
  echo "unit: $HOME/.config/systemd/user/$UNIT (regenerate via 'enable' after moving the project or changing port)"
  if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q "yes"; then
    echo "note: run 'sudo loginctl enable-linger $USER' so it starts before your first login after boot"
  fi
}

disable() {
  if unit_enabled; then
    systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/$UNIT"
    systemctl --user daemon-reload
    echo "disabled (stopped + unit removed)"
  else
    echo "not enabled"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) logs ;;
  enable) enable ;;
  disable) disable ;;
  run) run ;;
  *) echo "usage: $0 {start|stop|restart|status|logs|enable|disable|run}"; exit 1 ;;
esac
