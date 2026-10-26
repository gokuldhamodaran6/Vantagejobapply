#!/usr/bin/env bash
# End-to-end agent test against local fixture sites. Usage: bash worker/test/run.sh
set -u
cd "$(dirname "$0")/../.."
LOG=${LOG_DIR:-/tmp}
SECRET=test-secret-0123456789abcdef
npx tsx --conditions=react-server --tsconfig tsconfig.json worker/test/mock-app.ts > $LOG/mock.log 2>&1 & MOCK=$!
sleep 7
(cd worker && APP_URL=http://127.0.0.1:4100 AGENT_SECRET=$SECRET PORT=4200 exec node src/server.mjs > $LOG/worker.log 2>&1) & WORKER=$!
cleanup() { for d in /proc/[0-9]*; do c=$(tr '\0' ' ' < $d/cmdline 2>/dev/null); case "$c" in *"worker/test/mock-app"*|*"node src/server.mjs"*) case "$c" in *bash*) ;; *) kill ${d#/proc/} 2>/dev/null;; esac;; esac; done; }
trap cleanup EXIT
answered=0; capdone=0
state() { curl -s http://127.0.0.1:4100/control/state; }
for i in $(seq 1 80); do
  st=$(state); s=$(echo "$st" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(t['id']+'='+t['status'] for t in d['tasks']))")
  echo "$s"
  if echo "$s" | grep -q "t-gh=needs_user" && [ $answered = 0 ]; then
    echo "$st" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  agent asks:', [n['label'] for t in d['tasks'] for n in (t.get('needs') or [])])"
    curl -s -XPOST http://127.0.0.1:4100/control/answer -d '{"taskId":"t-gh","answers":{"Which marketing campaign are you proudest of, and why?":"The ABM program at Brightline: 100+ enterprise accounts and a 35% lift in qualified pipeline.","Have you used Marketo in a professional setting?":"No"}}' >/dev/null
    answered=1; curl -s -XPOST http://127.0.0.1:4200/tick -H "x-agent-secret: $SECRET" >/dev/null
  fi
  if echo "$s" | grep -q "t-cap=needs_human" && [ $capdone = 0 ]; then
    TOK=$(node -e "const c=require('crypto');const e=Math.floor(Date.now()/1000)+600;console.log(e+'.'+c.createHmac('sha256','$SECRET').update('t-cap.'+e).digest('hex'))")
    curl -s -o $LOG/live.jpg -w "  live frame %{http_code} %{size_download}B\n" "http://127.0.0.1:4200/live/t-cap/frame?t=$TOK"
    curl -s -o /dev/null -w "  live page %{http_code}\n" "http://127.0.0.1:4200/live/t-cap?t=$TOK"
    curl -s -o /dev/null -w "  forged token %{http_code}\n" "http://127.0.0.1:4200/live/t-cap/frame?t=9999999999.abc"
    # Act as the human: click the "I'm not a robot" box through the live view, then press done.
    node -e "
      const {chromium}=require('./worker/node_modules/playwright');
      (async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});
      await p.goto('http://127.0.0.1:4100/fx/captcha.html');await p.fill('#n','x');await p.fill('#e','x@y.z');await p.click('button[type=submit]');
      const box=await p.locator('#cap input').boundingBox();console.log(JSON.stringify({x:box.x+box.width/2,y:box.y+box.height/2}));await b.close();})()" > $LOG/xy.json
    curl -s -XPOST "http://127.0.0.1:4200/live/t-cap/input?t=$TOK" -H 'content-type: application/json' -d "$(python3 -c "import json;d=json.load(open('$LOG/xy.json'));print(json.dumps({'type':'click','x':d['x'],'y':d['y']}))")"; echo
    sleep 1; curl -s -XPOST "http://127.0.0.1:4200/live/t-cap/done?t=$TOK" -d '{}'; echo
    capdone=1
  fi
  if ! echo "$s" | grep -qE "running|queued|waiting|needs_human" && [ $answered = 1 ]; then break; fi
  sleep 5
done
echo "--- app log"; grep -v "mock app on" $LOG/mock.log
echo "--- final"; state | python3 -c "import json,sys; d=json.load(sys.stdin); [print(t['id'], t['status'], '|', t['log'][-1] if t['log'] else '', '| needs:', [n.get('label') for n in (t.get('needs') or [])]) for t in d['tasks']]; print('vault logins:', {k:v['login'] for k,v in d['vault'].items()}); print('saved answers:', len(d['answers']))"
