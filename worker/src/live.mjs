import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Live view: the person sees the agent's browser inside Vantage, as a smooth video of the real page, and can take
 * control (click, type, paste, upload a file) whenever a step needs them. While they're in control the agent is
 * paused and nothing is recorded; keystrokes go straight to the page and are never logged or stored.
 *
 * The picture comes from Chrome's screencast (a frame only when the page changes), sent as an MJPEG stream.
 */
const sessions = new Map(); // taskId -> Session

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function session(taskId) {
  return sessions.get(taskId) || null;
}

export const live = {
  attach(taskId, getPage, opts = {}) {
    sessions.set(taskId, { getPage, done: false, waiting: 0, mode: "watch", handBack: false, youSince: 0, chooser: null, interactive: Boolean(opts.interactive), q: Promise.resolve(), stream: null, watcher: null });
  },
  detach(taskId) {
    const s = sessions.get(taskId);
    if (!s) return;
    sessions.delete(taskId);
    void stopStream(s, true);
  },
  doneFlag(taskId) {
    return session(taskId)?.done || false;
  },
  clearDone(taskId) {
    const s = session(taskId);
    if (s) s.done = false;
  },
  /** "watch" (the agent works) or "you" (the person is in control and the agent waits). */
  mode(taskId) {
    return session(taskId)?.mode || "watch";
  },
  setMode(taskId, mode) {
    const s = session(taskId);
    if (!s) return;
    if (s.mode === "you" && mode === "watch") s.handBack = true;
    s.mode = mode === "you" ? "you" : "watch";
    if (s.mode === "you") s.youSince = Date.now();
    else s.chooser = null;
  },
  /** True once after the person pressed "Hand back" (or "I'm done"). */
  takeHandBack(taskId) {
    const s = session(taskId);
    if (!s) return false;
    const v = s.handBack || s.done;
    s.handBack = false;
    s.done = false;
    return v;
  },
  /** The agent is stopped and waiting for the person (so their clicks can't collide with its typing). */
  async waitFor(taskId, fn) {
    const s = session(taskId);
    if (s) s.waiting += 1;
    try {
      return await fn();
    } finally {
      if (s) s.waiting = Math.max(0, s.waiting - 1);
    }
  },
  setInteractive(taskId, v) {
    const s = session(taskId);
    if (s) s.interactive = Boolean(v);
  },
  /** The page opened a file picker while the person is in control: they choose the file in Vantage. */
  chooser(taskId, fc) {
    const s = session(taskId);
    if (s && s.mode === "you") s.chooser = fc;
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

// ---------- the picture ----------

function writeFrame(res, buf) {
  if (res.__busy) return; // the viewer is behind: skip frames rather than pile them up
  const ok = res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`) && res.write(buf) && res.write("\r\n");
  if (!ok) {
    res.__busy = true;
    res.once("drain", () => (res.__busy = false));
  }
}

async function stopStream(s, endSubs = false) {
  const st = s.stream;
  if (s.watcher && (endSubs || !st?.subs.size)) {
    clearInterval(s.watcher);
    s.watcher = null;
  }
  if (!st) return;
  if (st.cdp) {
    await st.cdp.send("Page.stopScreencast").catch(() => {});
    await st.cdp.detach().catch(() => {});
    st.cdp = null;
  }
  if (endSubs) {
    for (const res of st.subs) res.end();
    st.subs.clear();
    s.stream = null;
  }
}

/** Screencast the page the agent is on now (it follows new tabs and pop-ups). */
async function ensureStream(s) {
  const page = s.getPage();
  if (!page || page.isClosed()) return s.stream;
  if (s.stream?.cdp && s.stream.page === page) return s.stream;
  const subs = s.stream?.subs || new Set();
  const last = s.stream?.last || null;
  if (s.stream?.cdp) await stopStream(s);
  const st = { page, cdp: null, subs, last, frames: 0, startedAt: Date.now() };
  s.stream = st;
  try {
    const vp = page.viewportSize() || { width: 1280, height: 900 };
    const cdp = await page.context().newCDPSession(page);
    st.cdp = cdp;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      const buf = Buffer.from(data, "base64");
      st.last = buf;
      st.frames += 1;
      for (const res of st.subs) writeFrame(res, buf);
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  } catch (e) {
    console.error("screencast failed", e.message);
    st.cdp = null;
  }
  // Follow the agent to a new tab, and keep idle connections alive with the latest picture.
  if (!s.watcher) {
    let beat = 0;
    s.watcher = setInterval(() => {
      if (!s.stream?.subs.size) return void stopStream(s);
      const p = s.getPage();
      if (p && p !== s.stream.page) void ensureStream(s);
      if (++beat % 16 === 0 && s.stream.last) for (const res of s.stream.subs) writeFrame(res, s.stream.last);
    }, 500);
  }
  return st;
}

// ---------- requests ----------

function readBody(req, max) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > max) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

const sendJson = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const KEYS = new Set(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "]);

async function input(page, b) {
  const vp = page.viewportSize() || { width: 1280, height: 900 };
  const x = Math.max(0, Math.min(vp.width, Number(b.x) || 0));
  const y = Math.max(0, Math.min(vp.height, Number(b.y) || 0));
  switch (b.type) {
    case "down":
      await page.mouse.move(x, y);
      await page.mouse.down();
      break;
    case "move":
      await page.mouse.move(x, y, { steps: 2 });
      break;
    case "up":
      await page.mouse.move(x, y);
      await page.mouse.up();
      break;
    case "click":
      await page.mouse.click(x, y, { clickCount: b.double ? 2 : 1 });
      break;
    case "wheel":
      await page.mouse.wheel(Math.max(-3000, Math.min(3000, Number(b.dx) || 0)), Math.max(-3000, Math.min(3000, Number(b.dy) || 0)));
      break;
    case "text":
      await page.keyboard.insertText(String(b.text || "").slice(0, 5000));
      break;
    case "key": {
      const key = String(b.key || "");
      const mods = ["Control", "Alt", "Shift"].filter((m) => b[m.toLowerCase()]);
      if (!(KEYS.has(key) || /^F\d{1,2}$/.test(key) || (/^[a-zA-Z0-9]$/.test(key) && mods.includes("Control")))) break;
      await page.keyboard.press([...mods, key === " " ? "Space" : key].join("+"));
      break;
    }
  }
}

export async function handleLive(req, res, url) {
  const [, , taskId, action] = url.pathname.split("/"); // /live/:task[/stream|frame|state|input|mode|done|file]
  const token = url.searchParams.get("t");
  if (!verifyToken(taskId, token)) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("This live link has expired. Open it again from Vantage.");
  }
  const s = session(taskId);
  if (!action) {
    // Only Vantage itself may show this page inside a window.
    const app = (process.env.APP_URL || "").replace(/\/$/, "");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": `frame-ancestors ${app || "'none'"}`, "referrer-policy": "no-referrer" });
    return res.end(PAGE(taskId, token, url.searchParams.get("embed") === "1", app));
  }
  if (action === "state") {
    if (!s) return sendJson(res, 200, { active: false });
    const page = s.getPage();
    const vp = page?.viewportSize() || { width: 1280, height: 900 };
    const title = page ? await page.title().catch(() => "") : "";
    return sendJson(res, 200, { active: true, mode: s.mode, paused: s.waiting > 0, url: page?.url() || "", title: title.slice(0, 120), w: vp.width, h: vp.height, upload: Boolean(s.chooser), fps: s.stream?.frames || 0 });
  }
  if (!s) return sendJson(res, 410, { error: "The agent isn't on this application right now." });
  const page = s.getPage();
  if (action === "stream") {
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const st = await ensureStream(s);
    if (!st) return res.end();
    st.subs.add(res);
    if (st.last) writeFrame(res, st.last);
    else {
      const buf = await page.screenshot({ type: "jpeg", quality: 72 }).catch(() => null);
      if (buf) writeFrame(res, buf);
    }
    req.on("close", () => {
      st.subs.delete(res);
      if (!st.subs.size) void stopStream(s);
    });
    return;
  }
  if (action === "frame") {
    const buf = s.stream?.last || (await page.screenshot({ type: "jpeg", quality: 72 }).catch(() => null));
    if (!buf) {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
    return res.end(buf);
  }
  if (req.method !== "POST") {
    res.writeHead(404);
    return res.end();
  }
  const body = await readBody(req, action === "file" ? 14 * 1024 * 1024 : 16 * 1024);
  if (action === "mode") {
    live.setMode(taskId, body.you ? "you" : "watch");
    return sendJson(res, 200, { ok: true, mode: s.mode });
  }
  if (action === "done") {
    s.done = true;
    live.setMode(taskId, "watch");
    return sendJson(res, 200, { ok: true });
  }
  // Clicking and typing only while the person has taken control, so they never fight the agent.
  if (s.mode !== "you") return sendJson(res, 409, { error: "Take control first." });
  if (!s.waiting) return sendJson(res, 409, { error: "Your agent is finishing its current step — one moment." });
  if (action === "file") {
    const fc = s.chooser;
    if (!fc) return sendJson(res, 409, { error: "The page isn't asking for a file right now." });
    const name = String(body.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const buffer = Buffer.from(String(body.data || ""), "base64");
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return sendJson(res, 400, { error: "Files up to 10 MB." });
    try {
      await fc.setFiles({ name, mimeType: String(body.mime || "application/octet-stream").slice(0, 100), buffer });
      s.chooser = null;
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }
  if (action === "input") {
    // One at a time, in order (a press-and-hold is down … move … up).
    const run = s.q.then(() => input(s.getPage(), body)).catch(() => {});
    s.q = run;
    await Promise.race([run, sleep(4000)]);
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(404);
  res.end();
}

const PAGE = (taskId, token, embed, app) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live view · Vantage</title>
<style>
:root{--ink:#0e1525;--muted:#5b6475;--brand:#2f5beb;--line:#e6e8ef;--bg:#f6f7fb;--orange:#f7862b;--orange-ink:#b4520a;--green:#22a05b}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--ink);background:${embed ? "#fff" : "var(--bg)"};display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f6f7fb;border-bottom:1px solid var(--line)}
.addr{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12.5px;white-space:nowrap;overflow:hidden}
.addr b{font-weight:600}.addr span{color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.live{background:#e8f6ee;color:#17804a}.dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.seg{display:inline-flex;padding:3px;border-radius:10px;background:#e9ebf1}
.seg button{border:0;height:30px;padding:0 12px;border-radius:8px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer;background:transparent;color:var(--muted)}
.seg button[aria-pressed=true].w{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.seg button[aria-pressed=true].y{background:var(--orange);color:#fff}
.you{display:none;align-items:center;gap:10px;padding:7px 12px;background:#fff1e5;color:var(--orange-ink);font-size:13px;font-weight:600}
.you.on{display:flex}.you button{margin-left:auto;border:0;border-radius:8px;height:30px;padding:0 12px;background:var(--brand);color:#fff;font:600 13px/1 inherit;font-family:inherit;cursor:pointer}
.up{display:none;align-items:center;gap:10px;padding:8px 12px;background:#eef2fe;color:#2448c8;font-size:13px;font-weight:600}.up.on{display:flex}
.stage{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:#eef0f4;outline:none}
.stage.you{box-shadow:inset 0 0 0 3px var(--orange)}
.wrap{position:relative;width:100%;max-width:1280px}
#v{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;background:#fff}
.stage.you #v{cursor:pointer}
.off{margin:auto;padding:40px;text-align:center;color:var(--muted)}
.spin{width:22px;height:22px;border:3px solid #d5d9e2;border-top-color:var(--brand);border-radius:50%;animation:s 1s linear infinite;margin:0 auto 10px}@keyframes s{to{transform:rotate(360deg)}}
.hint{font-size:12px;color:var(--muted);padding:6px 12px;border-top:1px solid var(--line);background:#fbfbfd}
kbd{border:1px solid #d5d9e2;border-radius:4px;padding:0 4px;background:#fff;font-size:11px}
</style></head><body>
<div class="bar">
  <div class="addr" aria-label="Page address"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#17804a" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><b id="host">Opening…</b><span id="path"></span></div>
  <span class="pill live" id="lv"><span class="dot"></span><span id="lvt">Live</span></span>
  <div class="seg" role="group" aria-label="Who controls the page"><button class="w" id="mw" aria-pressed="true">Watch</button><button class="y" id="my" aria-pressed="false">Take control</button></div>
</div>
<div class="you" id="you" role="status"><span id="youTxt">You're in control — your agent is paused and nothing is recorded. Click and type right on the page.</span><button id="hb">Hand back</button></div>
<div class="up" id="up">The page wants a file. <input type="file" id="file" aria-label="Choose a file to upload"></div>
<div class="stage" id="stage" tabindex="0" aria-label="Live company page">
  <div class="off" id="off"><div class="spin"></div>Opening the company's page in your agent's browser…</div>
  <div class="wrap" id="wrap" hidden><img id="v" alt="Live view of the company's application page" draggable="false"></div>
</div>
<div class="hint"><kbd>T</kbd> take control · <kbd>Esc</kbd> hand back · while in control, typing and pasting go to the page</div>
<script>
const base = "/live/${taskId}", q = "?t=${encodeURIComponent(token)}", APP = ${JSON.stringify(app)};
const $ = (id) => document.getElementById(id);
const img = $("v"), stage = $("stage");
let st = { active:false, mode:"watch", w:1280, h:900 }, streaming = false, polling = null, lastFrames = 0, lastTick = Date.now();
const post = (a, b) => fetch(base + "/" + a + q, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(b || {}) }).then(r => r.json()).catch(() => ({}));
function tell(){ try { parent !== window && parent.postMessage({ vantageLive: { active: st.active, mode: st.mode, url: st.url || "", title: st.title || "" } }, APP || "*"); } catch(e){} }
function startStream(){
  if (streaming) return; streaming = true;
  img.onerror = () => { streaming = false; img.onerror = null; startPolling(); };
  img.src = base + "/stream" + q + "&_=" + Date.now();
}
function startPolling(){
  if (polling) return;
  const tick = async () => { try { const r = await fetch(base + "/frame" + q + "&_=" + Date.now()); if (r.ok) { const u = URL.createObjectURL(await r.blob()); img.onload = () => URL.revokeObjectURL(u); img.src = u; } } catch(e){} polling = setTimeout(tick, 400); };
  tick();
}
function render(){
  $("off").hidden = st.active; $("wrap").hidden = !st.active;
  if (!st.active) $("off").innerHTML = st.ended ? "Your agent has finished with this page. You can close this window." : '<div class="spin"></div>Opening the company\\'s page in your agent\\'s browser…';
  const you = st.mode === "you";
  $("mw").setAttribute("aria-pressed", String(!you)); $("my").setAttribute("aria-pressed", String(you));
  $("you").classList.toggle("on", you); stage.classList.toggle("you", you);
  $("youTxt").textContent = you && !st.paused ? "Pausing your agent — it's finishing its current step…" : "You're in control — your agent is paused and nothing is recorded. Click and type right on the page.";
  $("up").classList.toggle("on", Boolean(you && st.upload));
  try { const u = new URL(st.url); $("host").textContent = u.host; $("path").textContent = u.pathname + u.search; } catch(e) { $("host").textContent = st.active ? "" : "Opening…"; $("path").textContent = ""; }
  tell();
}
let seen = false;
async function poll(){
  try {
    const r = await fetch(base + "/state" + q + "&_=" + Date.now());
    if (r.status === 403) { st = { active:false, ended:true }; render(); return; }
    const d = await r.json();
    if (d.active) { seen = true; const fps = Math.round((d.fps - lastFrames) * 1000 / Math.max(1, Date.now() - lastTick)); lastFrames = d.fps; lastTick = Date.now(); $("lvt").textContent = "Live" + (fps > 0 ? " · " + Math.min(30, fps) + " fps" : ""); }
    st = Object.assign({}, d, { ended: !d.active && seen });
    if (d.active) startStream();
    render();
  } catch(e) {}
  setTimeout(poll, 1000);
}
poll();
async function setMode(you){ st.mode = you ? "you" : "watch"; render(); await post("mode", { you }); if (you) stage.focus(); }
$("mw").onclick = () => setMode(false); $("my").onclick = () => setMode(true); $("hb").onclick = () => setMode(false);
window.addEventListener("message", (e) => { if (APP && e.origin !== APP) return; const m = e.data && e.data.vantageLive; if (m && (m.mode === "you" || m.mode === "watch")) setMode(m.mode === "you"); });
// Pointer: press, drag and release go to the page as they happen (works for sliders and press-and-hold checks).
function pt(e){ const r = img.getBoundingClientRect(); return { x: (e.clientX - r.left) * (st.w / r.width), y: (e.clientY - r.top) * (st.h / r.height) }; }
let down = false, lastMove = 0;
img.addEventListener("pointerdown", (e) => { if (st.mode !== "you") return; e.preventDefault(); stage.focus(); down = true; img.setPointerCapture(e.pointerId); post("input", Object.assign({ type:"down" }, pt(e))); });
img.addEventListener("pointermove", (e) => { if (st.mode !== "you" || !down) return; const n = Date.now(); if (n - lastMove < 40) return; lastMove = n; post("input", Object.assign({ type:"move" }, pt(e))); });
img.addEventListener("pointerup", (e) => { if (st.mode !== "you" || !down) return; down = false; post("input", Object.assign({ type:"up" }, pt(e))); });
img.addEventListener("dblclick", (e) => { if (st.mode !== "you") return; post("input", Object.assign({ type:"click", double:true }, pt(e))); });
stage.addEventListener("wheel", (e) => { if (st.mode !== "you" || !st.active) return; e.preventDefault(); post("input", { type:"wheel", dx: e.deltaX, dy: e.deltaY }); }, { passive:false });
// Keyboard: letters are batched into text; special keys are pressed as keys.
let buf = "", flushT = null;
const flush = () => { if (buf) { post("input", { type:"text", text: buf }); buf = ""; } };
document.addEventListener("keydown", (e) => {
  if (e.target && e.target.id === "file") return;
  if (st.mode !== "you") { if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setMode(true); } return; }
  if (e.key === "Escape" && !e.shiftKey) { e.preventDefault(); flush(); setMode(false); return; }
  if ((e.metaKey || e.ctrlKey) && (e.key === "v" || e.key === "V")) return; // handled by paste
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); buf += e.key; clearTimeout(flushT); flushT = setTimeout(flush, 60); return; }
  e.preventDefault(); flush();
  post("input", { type:"key", key: e.key, control: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey });
});
document.addEventListener("paste", (e) => { if (st.mode !== "you") return; e.preventDefault(); flush(); const t = e.clipboardData.getData("text"); if (t) post("input", { type:"text", text: t }); });
$("file").addEventListener("change", async () => {
  const f = $("file").files[0]; if (!f) return;
  if (f.size > 10 * 1024 * 1024) return alert("Files up to 10 MB.");
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.readAsDataURL(f); });
  const d = await post("file", { name: f.name, mime: f.type, data });
  $("file").value = ""; if (d.error) alert(d.error);
});
</script></body></html>`;
