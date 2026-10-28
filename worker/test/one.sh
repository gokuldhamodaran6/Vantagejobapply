#!/usr/bin/env bash
# Run the agent on one fixture task and print what happened. Usage: ONLY=t-wdsign bash worker/test/one.sh
set -u
cd "$(dirname "$0")/../.."
LOG=${LOG_DIR:-/tmp}
SECRET=test-secret-0123456789abcdef
npx tsx --conditions=react-server --tsconfig tsconfig.json worker/test/mock-app.ts > $LOG/mock.log 2>&1 &
cleanup() { for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < $d/cmdline 2>/dev/null || true); case "$c" in *"worker/test/mock-app"*|*"node src/server.mjs"*) case "$c" in *bash*) ;; *) kill ${d#/proc/} 2>/dev/null;; esac;; esac; done; }
trap cleanup EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:4100/control/state >/dev/null && break; sleep 0.5; done
(cd worker && AGENT_ALLOW_LOCAL=1 APP_URL=http://127.0.0.1:4100 AGENT_SECRET=$SECRET PORT=4200 exec node src/server.mjs > $LOG/worker.log 2>&1) &
state() { curl -s http://127.0.0.1:4100/control/state | python3 -c "import json,sys; d=json.load(sys.stdin); t=d['tasks'][0]; print(t['status'], '|', t['log'][-1] if t['log'] else '', '| needs:', [n.get('label') for n in (t.get('needs') or [])])"; }
for i in $(seq 1 ${WAIT:-60}); do s=$(state); case "$s" in submitted*|failed*|manual*|needs_user*) break;; esac; sleep 2; done
echo "result: $s"
grep "\[app\]" $LOG/mock.log | tail -15
