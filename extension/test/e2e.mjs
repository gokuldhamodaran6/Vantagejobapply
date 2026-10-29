// End-to-end test of the extension in a real Chromium: fake Vantage API + a Greenhouse-style form.
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../worker/node_modules/playwright/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, "../../worker/test/fixtures");
const calls = [];
let fileCalls = 0;
const snapClicked = new Set();
const ANS = { "first name": "Priya", "last name": "Raman", email: "priya.careers@gmail.com", phone: "(312) 555-0142", "linkedin profile": "https://linkedin.com/in/priya" };
// A scripted stand-in for the AI pilot, for the Workday copy: checks the extension's loop, actions and uploads.
const RULES = [
  [/hear about/i, "choose", "Job Board > LinkedIn Jobs"], [/previously worked/i, "set", "No"], [/^first name/i, "fill", "Priya"], [/^last name/i, "fill", "Raman"],
  [/address line 1/i, "fill", "1 Main St"], [/^city/i, "fill", "Chicago"], [/^state/i, "choose", "Illinois"], [/postal/i, "fill", "60601"],
  [/device type/i, "choose", "Mobile"], [/phone code/i, "choose", "United States of America (+1)"], [/phone number/i, "fill", "3125550142"],
  [/job title/i, "fill", "Senior Marketing Manager"], [/^company/i, "fill", "Brightline"], [/currently work/i, "set", "checked"],
  [/from month/i, "fill", "03"], [/from year/i, "fill", "2021"], [/upload a file/i, "upload", "resume"],
  [/legally authorized/i, "choose", "Yes"], [/sponsorship/i, "choose", "Yes"], [/relatives/i, "choose", "No"], [/why are you interested/i, "fill", "I build integrated campaigns for technical products."],
  [/^country/i, "choose", "United States"], [/non-compete/i, "choose", "No"], [/refer you/i, "choose", "No"], [/linkedin/i, "fill", "https://linkedin.com/in/priya"],
  [/legally authorized to work/i, "choose", "Yes"], [/resume\/cv|^attach/i, "upload", "resume"], [/^email/i, "fill", "priya.careers@gmail.com"], [/^phone/i, "fill", "3125550142"],
  [/onsite/i, "choose", "Yes"], [/^gender/i, "choose", "I do not wish to answer"], [/veteran/i, "choose", "I do not wish to answer"], [/consent to the terms/i, "set", "checked"],
  [/^name/i, "fill", "Priya Raman"], [/^date month/i, "fill", "10"], [/^date year/i, "fill", "2026"], [/check one of the boxes/i, "set", "I do not want to answer"],
];
function fakePilot(snap) {
  const it = snap.items;
  const link = it.find((x) => /apply manually/i.test(x.label));
  if (link) return { say: "Starting the application", status: "next", actions: [{ do: "click", i: link.i }] };
  if (/my experience/i.test(snap.headings.join(" ")) && !it.some((x) => /job title/i.test(x.label))) {
    const add = it.find((x) => x.kind === "button" && /^add$/i.test(x.label) && /work/i.test(x.section || ""));
    if (add) return { say: "Adding your work history", status: "continue", actions: [{ do: "click", i: add.i }] };
  }
  const actions = [];
  // CLICK_ATTACH: behave like an AI that clicks the page's "Attach" button instead of uploading (opens a file picker).
  if (process.env.CLICK_ATTACH) {
    const emptyFile = it.find((x) => x.kind === "file" && !x.value);
    const attach = emptyFile && it.find((x) => x.kind === "button" && /^attach$/i.test(x.label) && !snapClicked.has(x.i));
    if (attach) { snapClicked.add(attach.i); return { say: "Attaching", status: "continue", actions: [{ do: "click", i: attach.i }] }; }
  }
  for (const x of it) {
    const empty = x.kind === "file" ? !x.value : x.kind === "checkbox" ? x.value !== "checked" : !x.value;
    if (!empty) continue;
    const r = RULES.find(([re]) => re.test(x.label));
    if (!r) continue;
    actions.push(r[1] === "upload" ? { do: "upload", i: x.i, file: "resume" } : { do: r[1], i: x.i, value: r[2] });
  }
  if (actions.length) return { say: "Filling this page", status: "continue", actions };
  const fin = it.find((x) => x.final);
  if (fin) return { say: "Ready to submit", status: "ready", actions: [], submit: fin.i };
  const next = it.find((x) => x.kind === "button" && /save and continue|^next$|continue/i.test(x.label));
  if (next) return { say: "Next page", status: "next", actions: [{ do: "click", i: next.i }] };
  return { say: "Nothing to do", status: "stuck", actions: [] };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const j = (d) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
  if (url.pathname.startsWith("/api/ext/")) {
    calls.push(url.pathname);
    if (req.headers.authorization !== "Bearer vx_testtoken_0123456789abcdef") { res.writeHead(401); return res.end("{}"); }
    if (url.pathname === "/api/ext/start") return j({ taskId: "t1", job: { title: "Senior Analyst", company: "Umbrella" }, ghost: null, match: 82, tailoring: Boolean(process.env.FILE_PENDING) });
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
    if (url.pathname === "/api/ext/pilot") {
      if (!process.env.FAKE_PILOT) { res.writeHead(404); return res.end("{}"); }
      calls.push("pilot");
      return j(fakePilot(JSON.parse(body).snapshot));
    }
    // FILE_PENDING=n: the resume for this job is "still being written" for the first n requests (202), like a slow tailoring.
    if (url.pathname === "/api/ext/file") {
      fileCalls++;
      if (fileCalls <= Number(process.env.FILE_PENDING || 0) && url.searchParams.get("now") !== "1") { res.writeHead(202, { "content-type": "application/json" }); return res.end(JSON.stringify({ pending: true })); }
      const cover = url.searchParams.get("kind") === "cover_letter";
      return j({ name: cover ? "Priya_Raman_Cover_Letter.pdf" : "Priya_Raman_Resume.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64") });
    }
    if (url.pathname === "/api/ext/status") {
      const ready = fileCalls >= Number(process.env.FILE_PENDING || 0);
      return j({ ready, report: ready ? { covered: 9, total: 11, matched: ["SQL"], missing: ["Looker", "Healthcare payments"], format: { code: "US", label: "US resume", docName: "Resume", paper: "letter", pages: 1, note: "" }, harvard: { ok: 7, total: 8 }, resumeId: null } : null });
    }
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
let page;
if (process.env.OPEN_FROM_SITE) {
  // "Tailor & apply" on the website: the extension opens the company's page itself and starts filling once it loads.
  const opened = ctx.waitForEvent("page");
  const r = await sw.evaluate((u) => openAndFill({ taskId: "00000000-0000-4000-8000-000000000001", url: u, job: { title: "Senior Analyst", company: "Umbrella" } }), "http://127.0.0.1:4300/fx/" + (process.argv[2] || "greenhouse.html"));
  console.log("openAndFill:", JSON.stringify(r));
  page = await opened;
  await page.waitForLoadState("load");
  await page.waitForTimeout(4500);
  console.log("started without /api/ext/start:", !calls.includes("/api/ext/start"));
} else {
  page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4300/fx/" + (process.argv[2] || "greenhouse.html"));
  await page.waitForTimeout(800);
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1:4300/*" }); await run(t.id); });
}
await page.waitForTimeout(1500);
if (process.env.FAKE_PILOT) {
  const st = await page.evaluate(() => window.__state && { pickerOpened: window.__state.pickerOpened || 0, page: window.__state.page, values: window.__state.values, files: window.__state.files, work: window.__state.work?.length, trap: window.__state.trapped || null });
  console.log("WORKDAY COPY STATE:", JSON.stringify(st, null, 1));
  if (process.env.SUBMIT_FOR_ME) {
    await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1:4300/*" }); await onPanel(t.id, { action: "submit_now" }); });
    await page.waitForTimeout(1500);
    console.log("AFTER SUBMIT-FOR-ME:", JSON.stringify(await page.evaluate(() => ({ submitted: window.__state.submitted, text: document.body.innerText.slice(0, 120) }))));
  }
  console.log("panel text:", await page.evaluate(() => document.getElementById("vantage-panel") ? "present" : "none"));
}
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
if (process.env.DEBUG_STATE) console.log("dbg:", JSON.stringify(await sw.evaluate(async () => (await chrome.storage.session.get("dbg")).dbg)));
if (process.env.DEBUG_STATE) console.log("ext state:", JSON.stringify(await sw.evaluate(async () => { const tabs = await chrome.tabs.query({}); const out = []; for (const t of tabs) { const st = await store.tab(t.id); if (st) out.push({ fileReady: st.fileReady, tailoring: st.tailoring, report: Boolean(st.report), waiting: st.waiting, history: (st.history || []).map((h) => [h.say, (h.actions || []).map((a) => a.do + ":" + a.i + (a.file ? ":" + a.file : "")).join(","), (h.results || []).map((r) => r && (r.ok ? "ok" : r.note)).join("|")]) }); } return out; })).slice(0, 3000));
console.log("panel:", await page.evaluate(() => Boolean(document.getElementById("vantage-panel"))));
console.log("api calls:", calls.join(" "));
await ctx.close();
server.close();
