#!/usr/bin/env bash
# Safe updates: a worker restarted mid-application hands the run back (nothing sent) and the next worker finishes it.
# Usage: bash worker/test/restart.sh
set -u
cd "$(dirname "$0")/../.."
LOG=${LOG_DIR:-/tmp}
SECRET=test-secret-0123456789abcdef
ONLY=${ONLY:-t-ashby} npx tsx --conditions=react-server --tsconfig tsconfig.json worker/test/mock-app.ts > $LOG/mock.log 2>&1 & MOCK=$!
cleanup() { for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < $d/cmdline 2>/dev/null); case "$c" in *"worker/test/mock-app"*|*"node src/server.mjs"*) case "$c" in *bash*) ;; *) kill ${d#/proc/} 2>/dev/null;; esac;; esac; done; }
trap cleanup EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:4100/control/state >/dev/null && break; sleep 0.5; done
start() { (cd worker && AGENT_ALLOW_LOCAL=1 APP_URL=http://127.0.0.1:4100 AGENT_SECRET=$SECRET PORT=4200 exec node src/server.mjs >> $LOG/worker.log 2>&1) & }
state() { curl -s http://127.0.0.1:4100/control/state | python3 -c "import json,sys; d=json.load(sys.stdin); t=d['tasks'][0]; print(t['status'], '|', t['log'][-1] if t['log'] else '')"; }
: > $LOG/worker.log
start; W1=$!
# Let the first worker get into the form, then restart it as Render would.
for i in $(seq 1 120); do s=$(state); case "$s" in running*${WAIT_FOR:-}*) break;; esac; sleep 0.25; done
sleep ${PAUSE_AFTER:-4}; s=$(state)
echo "before restart: $s"
pid=$(for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < $d/cmdline 2>/dev/null || true); case "$c" in "node src/server.mjs"*) echo ${d#/proc/};; esac; done | head -1)
kill -TERM $pid; for i in $(seq 1 60); do kill -0 $pid 2>/dev/null || break; sleep 0.5; done
echo "after restart: $(state)"
grep "\[shutdown\]" $LOG/worker.log
start
for i in $(seq 1 60); do s=$(state); case "$s" in submitted*|failed*|manual*|needs_user*) break;; esac; sleep 2; done
echo "next worker: $s"
grep -c "Submitting\|pause" $LOG/mock.log
grep "\[app\]" $LOG/mock.log | tail -12
