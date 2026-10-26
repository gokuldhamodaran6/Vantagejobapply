// Vantage extension — coordinates filling across the page's frames and talks to your Vantage account.
const API = "https://vantagejobapply.onrender.com";

const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  tab: async (tabId) => (await chrome.storage.session.get(`t${tabId}`))[`t${tabId}`] || null,
  setTab: (tabId, v) => (v ? chrome.storage.session.set({ [`t${tabId}`]: v }) : chrome.storage.session.remove(`t${tabId}`)),
};

async function api(path, { method = "GET", body } = {}) {
  const token = await store.get("token");
  if (!token) throw Object.assign(new Error("Connect the extension to your Vantage account first."), { code: 401 });
  const base = (await store.get("apiBase")) || API; // apiBase is only set by the extension's own tests
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Vantage error ${r.status}`), { code: r.status, data: d });
  return d;
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() => {});
}
async function inFrames(tabId, func, args = [], frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  const res = await chrome.scripting.executeScript({ target, func, args }).catch(() => []);
  return res || [];
}
async function top(tabId, func, args = []) {
  const [r] = await inFrames(tabId, func, args, [0]);
  return r?.result;
}
const showPanel = (tabId, state) => top(tabId, (s) => window.__vantage?.panel(s), [state]);

const STEPS = ["Read the job", "Write your tailored resume and cover letter", "Fill the form", "You review and press Submit"];
const steps = (at) => STEPS.map((text, i) => ({ text, state: i < at ? "done" : i === at ? "now" : "" }));

async function run(tabId, { force = false } = {}) {
  await inject(tabId);
  const info = await top(tabId, () => window.__vantage?.info());
  if (!info) return;
  let st = { steps: steps(0) };
  await showPanel(tabId, st);
  try {
    st = { ...st, steps: steps(1), note: "Writing a resume and cover letter for this exact job — about 30 seconds the first time.", noteTone: "ok" };
    await showPanel(tabId, st);
    const start = await api("/api/ext/start", { method: "POST", body: { ...info, force } });
    if (start.alreadyApplied) {
      return showPanel(tabId, { job: start.job, ghost: start.ghost, note: "You already applied to this job — Vantage won't send it twice.", noteTone: "warn", buttons: [{ text: "Fill anyway", action: "force" }, { text: "Close", action: "close", ghost: true }] });
    }
    const base = { job: start.job, ghost: start.ghost, match: start.match };
    await store.setTab(tabId, { taskId: start.taskId, job: start.job, url: info.url, at: Date.now() });
    st = { ...base, steps: steps(2) };
    await showPanel(tabId, st);
    const done = new Set();
    const missing = await fillPass(tabId, start.taskId, done);
    // Answers can reveal follow-up questions: one more pass for anything new.
    const more = await fillPass(tabId, start.taskId, done);
    const left = dedupe([...missing, ...more]);
    await store.setTab(tabId, { taskId: start.taskId, job: start.job, url: info.url, at: Date.now(), missing: left });
    await showPanel(tabId, {
      ...base, steps: steps(3), missing: left,
      note: left.length ? null : "Everything is filled. Check it over, then press Submit on the page — Vantage adds it to your Applications automatically.",
      buttons: left.length ? [{ text: "Save answers & fill", action: "answers" }, { text: "I submitted it", action: "submitted", ghost: true }] : [{ text: "I submitted it", action: "submitted", ghost: true }, { text: "Fill again", action: "refill", ghost: true }],
    });
  } catch (e) {
    await showPanel(tabId, { ...st, note: e.code === 401 ? "Connect the extension to your Vantage account: click the Vantage icon → Connect." : e.message, noteTone: "warn", buttons: [{ text: "Try again", action: "refill" }, { text: "Close", action: "close", ghost: true }] });
  }
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((m) => (seen.has(m.label) ? false : (seen.add(m.label), true)));
};

/** Read every frame's fields, ask Vantage for the answers, and fill them. Returns what only the user can answer. */
async function fillPass(tabId, taskId, done = new Set()) {
  const frames = await inFrames(tabId, () => window.__vantage?.extract() || []);
  const fields = [];
  for (const fr of frames) {
    for (const f of fr.result || []) {
      if (f.type === "password") continue;
      const key = `${fr.frameId}:${f.id}`;
      if (done.has(key) || (f.value && f.type !== "checkbox" && f.type !== "file")) continue;
      done.add(key);
      if (f.type === "combobox" && !f.options?.length) {
        const [o] = await inFrames(tabId, (id) => window.__vantage?.readOptions(id), [f.id], [fr.frameId]);
        f.options = o?.result || [];
      }
      fields.push({ ...f, id: key, frameId: fr.frameId, localId: f.id });
    }
  }
  if (!fields.length) return [];
  const plan = await api("/api/ext/plan", { method: "POST", body: { taskId, fields: fields.map(({ frameId, localId, ...f }) => f) } });
  const files = {};
  for (const p of plan.fills || []) {
    const f = fields.find((x) => x.id === p.id);
    if (!f) continue;
    let file = null;
    if (p.file) file = files[p.file] ||= await api(`/api/ext/file?taskId=${taskId}&kind=${p.file}`).catch(() => null);
    await inFrames(tabId, (field, fill, fl) => window.__vantage?.fill(field, fill, fl), [{ ...f, id: f.localId }, p, file], [f.frameId]);
    done.add(f.id);
  }
  return (plan.missing || []).filter((m) => m.required !== false).map((m) => ({ ...m, frameKey: m.id }));
}

async function onPanel(tabId, msg) {
  const t = await store.tab(tabId);
  if (msg.action === "close") return showPanel(tabId, null);
  if (msg.action === "force") return run(tabId, { force: true });
  if (msg.action === "refill") return run(tabId);
  if (!t) return;
  if (msg.action === "answers") {
    const answers = (msg.answers || []).filter((a) => String(a.answer || "").trim());
    if (!answers.length) return;
    await api("/api/ext/answers", { method: "POST", body: { taskId: t.taskId, answers: answers.map((a) => ({ label: a.label, type: a.type, answer: a.answer })) } }).catch(() => {});
    return run(tabId);
  }
  if (msg.action === "submitted") return markSubmitted(tabId, "manual");
}

async function markSubmitted(tabId, how) {
  const t = await store.tab(tabId);
  if (!t || t.sent) return;
  await api("/api/ext/submitted", { method: "POST", body: { taskId: t.taskId, how } }).catch(() => {});
  await store.setTab(tabId, { ...t, sent: true });
  await inject(tabId);
  await showPanel(tabId, { job: t.job, steps: STEPS.map((text) => ({ text, state: "done" })), note: "Applied! It's in your Vantage Applications, and replies from the company will show up there and in your Interviews.", noteTone: "ok", buttons: [{ text: "Close", action: "close", ghost: true }] });
  chrome.action.setBadgeText({ tabId, text: "✓" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#22a05b" });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "fill") {
      const tabId = msg.tabId || sender.tab?.id;
      if (tabId) await run(tabId);
      reply({ ok: true });
    } else if (msg.type === "panel" && sender.tab?.id) {
      await onPanel(sender.tab.id, msg);
      reply({ ok: true });
    } else if (msg.type === "confirmation" && sender.tab?.id) {
      await markSubmitted(sender.tab.id, "detected");
      reply({ ok: true });
    } else if (msg.type === "status") {
      const token = await store.get("token");
      if (!token) return reply({ connected: false });
      const me = await api("/api/ext/me").catch(() => null);
      reply({ connected: Boolean(me), me });
    } else if (msg.type === "disconnect") {
      await chrome.storage.local.remove("token");
      reply({ ok: true });
    }
  })();
  return true;
});

// One-click connect from the Vantage website (Settings → Chrome extension).
chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  if (!sender.url?.startsWith(API)) return reply({ ok: false });
  if (msg?.type === "ping") {
    store.get("token").then((t) => reply({ ok: true, connected: Boolean(t), version: chrome.runtime.getManifest().version }));
    return true;
  }
  if (msg?.type !== "connect" || !/^vx_[A-Za-z0-9_-]{20,}$/.test(msg.token || "")) return reply({ ok: false });
  store.set("token", msg.token).then(() => reply({ ok: true }));
  return true;
});

// After a full page load in a tab we filled, look for the "thank you for applying" page.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const t = await store.tab(tabId);
  if (!t || t.sent || Date.now() - t.at > 3 * 3600_000) return;
  await inject(tabId);
  const yes = await top(tabId, () => window.__vantage?.isConfirmation());
  if (yes) await markSubmitted(tabId, "detected");
});
chrome.tabs.onRemoved.addListener((tabId) => store.setTab(tabId, null));
