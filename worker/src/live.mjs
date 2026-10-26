import { createHmac, timingSafeEqual } from "node:crypto";

// Live view: lets the user see the agent's browser and do the one step only a human may do (e.g. a captcha).
const sessions = new Map(); // taskId -> { getPage, done }

export const live = {
  attach(taskId, getPage) {
    sessions.set(taskId, { getPage, done: false });
  },
  detach(taskId) {
    sessions.delete(taskId);
  },
  doneFlag(taskId) {
    return sessions.get(taskId)?.done || false;
  },
  clearDone(taskId) {
    const s = sessions.get(taskId);
    if (s) s.done = false;
  },
};

export function verifyToken(taskId, token) {
  const secret = process.env.AGENT_SECRET || "";
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = createHmac("sha256", secret).update(`${taskId}.${exp}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  } catch {
    return false;
  }
}

export async function handleLive(req, res, url) {
  const [, , taskId, action] = url.pathname.split("/"); // /live/:task[/frame|input|done]
  const token = url.searchParams.get("t");
  if (!verifyToken(taskId, token)) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("This live link has expired. Open it again from Vantage.");
  }
  const s = sessions.get(taskId);
  if (!action) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(PAGE(taskId, token, Boolean(s)));
  }
  if (!s) {
    res.writeHead(410, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "The agent isn't on this application right now." }));
  }
  const page = s.getPage();
  if (action === "frame") {
    const buf = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
    if (!buf) {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
    return res.end(buf);
  }
  if (req.method === "POST") {
    const body = await new Promise((r) => {
      let d = "";
      req.on("data", (c) => {
        d += c;
        if (d.length > 4096) req.destroy();
      });
      req.on("end", () => {
        try {
          r(d ? JSON.parse(d) : {});
        } catch {
          r({});
        }
      });
      req.on("error", () => r({}));
    });
    try {
      if (action === "input") {
        const x = Math.max(0, Math.min(1280, Number(body.x) || 0));
        const y = Math.max(0, Math.min(900, Number(body.y) || 0));
        if (body.type === "click") await page.mouse.click(x, y);
        else if (body.type === "scroll") await page.mouse.wheel(0, Number(body.dy) || 300);
        else if (body.type === "key") await page.keyboard.press(String(body.key).slice(0, 20));
        else if (body.type === "text") await page.keyboard.type(String(body.text).slice(0, 200), { delay: 30 });
      } else if (action === "done") {
        s.done = true;
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  res.writeHead(404);
  res.end();
}

const PAGE = (taskId, token, active) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live view · Vantage agent</title>
<style>
:root{--ink:#0e1525;--brand:#2f5beb;--line:#e3e6ee;--bg:#f5f6f9}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:var(--ink);background:var(--bg)}
header{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
header b{font-size:15px}header span{color:#5b6475;font-size:13px}
.btn{margin-left:auto;background:var(--brand);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}
main{padding:16px;max-width:1300px;margin:0 auto}
.screen{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 8px 24px rgba(16,24,40,.08)}
img{display:block;width:100%;height:auto;cursor:pointer;user-select:none}
.tip{margin:0 0 12px;color:#5b6475;font-size:14px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-top:10px}
.off{padding:40px;text-align:center;color:#5b6475}
</style></head><body>
<header><b>Your agent's browser</b><span id="st">${active ? "Live" : "Not active"}</span><button class="btn" id="done">I'm done — continue</button></header>
<main>
<p class="tip">Do only the “I'm human” check (tick the box or pick the images), then press <b>I'm done</b>. Click on the picture to click on the page; type in the box below to type into the page.</p>
${active ? `<div class="screen"><img id="v" alt="Live view of the application page"></div><input id="kb" placeholder="Type here to send text to the page, Enter to send" aria-label="Type into the page">` : `<div class="off">The agent isn't on this application right now. You can close this tab.</div>`}
</main>
<script>
const base = "/live/${taskId}", q = "?t=${encodeURIComponent(token)}";
const img = document.getElementById("v");
let w = 1280;
async function tick(){ if(!img) return; try{ const r = await fetch(base+"/frame"+q+"&_="+Date.now()); if(r.status===410){document.getElementById("st").textContent="Finished";return;} if(r.ok){ const b = await r.blob(); const u = URL.createObjectURL(b); img.onload=()=>URL.revokeObjectURL(u); img.src=u; } }catch(e){} setTimeout(tick, 700); }
tick();
const post = (a, b) => fetch(base+"/"+a+q, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(b||{})});
if (img) {
  img.addEventListener("click", e => { const r = img.getBoundingClientRect(); const scale = w / r.width; post("input", {type:"click", x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale}); });
  img.addEventListener("wheel", e => { e.preventDefault(); post("input", {type:"scroll", dy: e.deltaY}); }, {passive:false});
  const kb = document.getElementById("kb");
  kb.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (kb.value) post("input", {type:"text", text: kb.value}); else post("input", {type:"key", key:"Enter"}); kb.value=""; } else if (e.key === "Tab" || e.key === "Backspace" && !kb.value) { e.preventDefault(); post("input", {type:"key", key:e.key}); } });
}
document.getElementById("done").onclick = async () => { await post("done"); document.getElementById("st").textContent = "Thanks — your agent is continuing"; };
</script></body></html>`;
