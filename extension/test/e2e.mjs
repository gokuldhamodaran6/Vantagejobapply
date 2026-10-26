// End-to-end test of the extension in a real Chromium: fake Vantage API + a Greenhouse-style form.
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../worker/node_modules/playwright/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, "../../worker/test/fixtures");
const calls = [];
const ANS = { "first name": "Priya", "last name": "Raman", email: "priya.careers@gmail.com", phone: "(312) 555-0142", "linkedin profile": "https://linkedin.com/in/priya" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const j = (d) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
  if (url.pathname.startsWith("/api/ext/")) {
    calls.push(url.pathname);
    if (req.headers.authorization !== "Bearer vx_testtoken_0123456789abcdef") { res.writeHead(401); return res.end("{}"); }
    if (url.pathname === "/api/ext/start") return j({ taskId: "t1", job: { title: "Senior Analyst", company: "Umbrella" }, ghost: null, match: 82 });
    if (url.pathname === "/api/ext/plan" && process.env.REAL_PLAN) {
      // The real Vantage planner (facts, answer bank, option matching) from the agent's mock app.
      const r = await fetch("http://127.0.0.1:4100/api/agent/worker/plan", { method: "POST", headers: { "x-agent-secret": "test-secret-0123456789abcdef", "content-type": "application/json" }, body: JSON.stringify({ taskId: process.env.REAL_PLAN, fields: JSON.parse(body).fields }) });
      const out = await r.json();
      if (process.env.SHOW_PLAN) console.log("plan:", JSON.stringify(out).slice(0, 1500));
      return j(out);
    }
    if (url.pathname === "/api/ext/plan") {
      const { fields } = JSON.parse(body);
      const fills = [], missing = [];
      for (const f of fields) {
        const k = f.label.toLowerCase().replace(/[*:]/g, "").trim();
        if (f.type === "file" && /resume|cv/i.test(f.label)) fills.push({ id: f.id, file: "resume" });
        else if (ANS[k]) fills.push({ id: f.id, value: ANS[k] });
        else if (/authorized/i.test(f.label)) fills.push({ id: f.id, value: "Yes" });
        else if (f.type === "combobox" && f.options?.length) fills.push({ id: f.id, value: f.options.find((o) => /united states|yes|chicago/i.test(o)) || f.options[0] });
        else if (f.required) missing.push({ id: f.id, qkey: k, label: f.label, type: f.type, options: f.options, required: true });
      }
      return j({ fills, missing });
    }
    if (url.pathname === "/api/ext/file") return j({ name: "Priya_Raman_Resume.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64") });
    if (url.pathname === "/api/ext/submitted") return j({ ok: true });
    if (url.pathname === "/api/ext/me") return j({ name: "Priya Raman" });
    return j({});
  }
  try {
    const file = readFileSync(join(FX, url.pathname.replace(/^\/fx\//, "")));
    res.writeHead(200, { "content-type": "text/html" });
    res.end(file);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4300, r));

const dist = join(here, "../dist");
const ctx = await chromium.launchPersistentContext("", { headless: true, channel: "chromium", args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
console.log("extension id", sw.url().split("/")[2]);
await sw.evaluate(() => chrome.storage.local.set({ token: "vx_testtoken_0123456789abcdef", apiBase: "http://127.0.0.1:4300" }));
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:4300/fx/" + (process.argv[2] || "greenhouse.html"));
await page.waitForTimeout(800);
await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1:4300/*" }); await run(t.id); });
await page.waitForTimeout(1500);
const values = await page.evaluate(() => [...document.querySelectorAll("input, select, textarea")].filter((e) => e.type !== "hidden").map((e) => {
  const shell = e.closest("[class*='select__control'], [class*='-control']");
  const shown = shell?.querySelector("[class*='single-value'], [class*='singleValue'], [class*='multi-value__label']")?.textContent;
  return `${(e.name || e.id || e.getAttribute("aria-label") || "").slice(0, 40)}=${e.type === "file" ? (e.files?.[0]?.name || "") : e.type === "checkbox" || e.type === "radio" ? e.checked : shown || e.value}`;
}));
console.log(values.join("\n"));
if (process.env.SUBMIT) {
  // The user presses Submit on the site: the extension should notice the confirmation and record it.
  await page.click("button[type='submit'], input[type='submit']").catch((e) => console.log("submit click failed", e.message));
  await page.waitForTimeout(5000);
  console.log("after submit:", page.url());
}
console.log("panel:", await page.evaluate(() => Boolean(document.getElementById("vantage-panel"))));
console.log("api calls:", calls.join(" "));
await ctx.close();
server.close();
