import http from "node:http";
import { chromium } from "playwright";
import { call, update } from "./api.mjs";
import { runTask } from "./flow.mjs";
import { handleLive } from "./live.mjs";

const PORT = Number(process.env.PORT || 10000);
let running = false;
let browser = null;
let lastWork = 0;
const stats = { started: new Date().toISOString(), done: 0, failed: 0, current: null };

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = process.env.BROWSER_WS_ENDPOINT
    ? await chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT)
    : await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--js-flags=--max-old-space-size=256"] });
  return browser;
}

/** Work through the queue one application at a time (human pace, low memory). */
async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const bundle = await call("claim").catch((e) => {
        console.error("claim failed", e.message);
        return { task: null };
      });
      if (!bundle.task) break;
      lastWork = Date.now();
      stats.current = { id: bundle.task.id, company: bundle.task.job?.company };
      try {
        const b = await getBrowser();
        const result = await runTask(bundle, b);
        if (result === "submitted") stats.done++;
        else if (result === "failed") stats.failed++;
      } catch (e) {
        console.error("run failed", e);
        await update(bundle.task.id, { status: "failed", error: String(e.message || e).slice(0, 300) });
        await browser?.close().catch(() => {});
        browser = null;
      }
      stats.current = null;
      // Pause between applications so it never looks like a burst.
      await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000));
    }
  } finally {
    running = false;
    // Release memory when idle.
    if (browser && !process.env.BROWSER_WS_ENDPOINT) {
      await browser.close().catch(() => {});
      browser = null;
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, running, ...stats }));
  }
  if (url.pathname === "/tick" && req.method === "POST") {
    if (req.headers["x-agent-secret"] !== process.env.AGENT_SECRET) {
      res.writeHead(401);
      return res.end();
    }
    drain();
    res.writeHead(202, { "content-type": "application/json" });
    return res.end(JSON.stringify({ accepted: true, running }));
  }
  if (url.pathname.startsWith("/live/")) return handleLive(req, res, url);
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`Vantage agent worker on :${PORT}`));
// Safety net: check the queue every minute while recently busy.
setInterval(() => {
  if (!running && Date.now() - lastWork < 20 * 60 * 1000) drain();
}, 60_000);
drain();
