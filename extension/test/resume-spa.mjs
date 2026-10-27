// The person moves on by themselves while Vantage waits: the extension notices the new page and carries on filling.
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../worker/node_modules/playwright/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, "../../worker/test/fixtures");
const pilots = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const j = (d) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
  if (url.pathname === "/api/ext/start") return j({ taskId: "t1", job: { title: "Data Analyst", company: "Hooli" }, match: 80 });
  if (url.pathname === "/api/ext/pilot") {
    const snap = JSON.parse(body).snapshot;
    pilots.push(snap.url);
    if (/Sign in/.test(snap.headings.join(" "))) return j({ say: "Sign in first", status: "account", actions: [] });
    const first = snap.items.find((x) => /first name/i.test(x.label) && !x.value);
    const last = snap.items.find((x) => /last name/i.test(x.label) && !x.value);
    const actions = [first && { do: "fill", i: first.i, value: "Priya" }, last && { do: "fill", i: last.i, value: "Raman" }].filter(Boolean);
    return j(actions.length ? { say: "Filling", status: "continue", actions } : { say: "Done here", status: "stuck", actions: [] });
  }
  if (url.pathname.startsWith("/api/ext/")) return j({ name: "Priya" });
  let file = null;
  try { file = readFileSync(join(FX, url.pathname.replace(/^\/fx\//, ""))); } catch { /* missing */ }
  if (!file) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(file);
});
await new Promise((r) => server.listen(4301, r));
const dist = join(here, "../dist");
const ctx = await chromium.launchPersistentContext("", { headless: true, channel: "chromium", args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate(() => chrome.storage.local.set({ token: "vx_testtoken_0123456789abcdef", apiBase: "http://127.0.0.1:4301" }));
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:4301/fx/spa-step1.html");
await page.waitForTimeout(600);
await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1:4301/*" }); await run(t.id); });
await page.waitForTimeout(1200);
console.log("waiting on step 1, pilot calls:", pilots.length);
await page.click("#go"); // the person moves on by themselves
await page.waitForTimeout(6000);
const vals = await page.evaluate(() => [document.querySelector("[name=first]").value, document.querySelector("[name=last]").value]);
const ok = pilots.length >= 2 && vals[0] === "Priya" && vals[1] === "Raman";
console.log(ok ? "PASS  extension carried on by itself on the next page" : `FAIL  pilot calls: ${pilots.join(" ")} values: ${vals}`);
await ctx.close();
server.close();
process.exit(ok ? 0 : 1);
