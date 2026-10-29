// Vantage extension — coordinates filling across the page's frames and talks to your Vantage account.
const API = "https://vantagejobapply.onrender.com";

const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  tab: async (tabId) => (await chrome.storage.session.get(`t${tabId}`))[`t${tabId}`] || null,
  setTab: (tabId, v) => (v ? chrome.storage.session.set({ [`t${tabId}`]: v }) : chrome.storage.session.remove(`t${tabId}`)),
  /** Change some fields of a tab's state, keeping what others (the resume watcher) wrote meanwhile. */
  patchTab: async (tabId, p) => {
    const cur = (await chrome.storage.session.get(`t${tabId}`))[`t${tabId}`];
    if (cur) await chrome.storage.session.set({ [`t${tabId}`]: { ...cur, ...p } });
  },
};

async function api(path, { method = "GET", body } = {}) {
  const token = await store.get("token");
  if (!token) throw Object.assign(new Error("Connect the extension to your Vantage account first."), { code: 401 });
  const base = (await store.get("apiBase")) || API; // apiBase is only set by the extension's own tests
  // Never hang on a slow request: give up after 75 s and let the loop carry on or explain.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 75_000);
  const r = await fetch(`${base}${path}`, {
    signal: ctl.signal,
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Vantage-Ext": chrome.runtime.getManifest().version, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  clearTimeout(timer);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Vantage error ${r.status}`), { code: r.status, data: d });
  return d;
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["pilot.js", "content.js"] }).catch(() => {});
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastPanel = new Map();
/** The panel always shows what the resume written for this job covers (or that it's being written). */
async function showPanel(tabId, state) {
  if (state) {
    const t = await store.tab(tabId);
    if (t?.report && !state.report) state = { ...state, report: t.report };
    if (t?.tailoring && !t.report && state.tailoring === undefined) state = { ...state, tailoring: true };
    lastPanel.set(tabId, state);
  } else lastPanel.delete(tabId);
  return top(tabId, (s) => window.__vantage?.panel(s), [state]);
}

/*
 * Chrome stops an extension's background after ~30 s without activity, which would freeze a run mid-page. While any
 * application is being filled, a light ping every 20 s keeps it awake; when none is, it may sleep as usual.
 */
const active = new Set();
let pinger = null;
function keepAwake() {
  if (active.size && !pinger) pinger = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);
  if (!active.size && pinger) { clearInterval(pinger); pinger = null; }
}

/**
 * The resume and cover letter for this job are written on the server (20–60 s) while the form is filled. Ask every
 * few seconds; when they're ready, remember what the resume covers and show it in the panel.
 */
const watching = new Set();
async function watchTailoring(tabId, taskId) {
  if (watching.has(tabId)) return;
  watching.add(tabId);
  active.add(`w${tabId}`);
  keepAwake();
  try {
    for (let k = 0; k < 60; k++) {
      const st = await api(`/api/ext/status?taskId=${taskId}`).catch(() => null);
      const t = await store.tab(tabId);
      if (!t || t.taskId !== taskId) return;
      if (st?.ready) {
        await store.patchTab(tabId, { tailoring: false, fileReady: true, report: st.report || t.report || null });
        const last = lastPanel.get(tabId);
        if (last) await showPanel(tabId, { ...last, report: st.report || undefined, tailoring: false });
        return;
      }
      await sleep(3000);
    }
  } finally {
    watching.delete(tabId);
    active.delete(`w${tabId}`);
    keepAwake();
  }
}

const STEPS = ["Read the job", "Fill every page of the form", "You check it and press Submit"];
const steps = (at) => STEPS.map((text, i) => ({ text, state: i < at ? "done" : i === at ? "now" : "" }));
const FIELD = new Set(["text", "email", "tel", "url", "number", "date", "month", "textarea", "select", "combobox", "radio", "checkbox", "checkboxes", "file"]);

/** The frame with the application form (the page itself, or an embedded form) and what's on it. */
async function readTab(tabId) {
  const frames = await inFrames(tabId, () => window.__vp?.snapshot() || null);
  let best = null;
  for (const f of frames) {
    if (!f.result) continue;
    const n = f.result.items.filter((x) => FIELD.has(x.kind)).length + (f.frameId === 0 ? 0.5 : 0);
    if (!best || n > best.n) best = { n, frameId: f.frameId, snap: f.result };
  }
  return best;
}

async function run(tabId, { force = false, resume = false } = {}) {
  await inject(tabId);
  let t = await store.tab(tabId);
  let base = t?.base || {};
  let info0 = await top(tabId, () => window.__vp?.info() || window.__vantage?.info());
  // Some careers sites (iCIMS, Taleo) show the job inside a frame: take the frame that names it.
  try {
    const frames = (await inFrames(tabId, () => window.__vp?.info() || null)).map((f) => f.result).filter(Boolean);
    if (frames.length > 1 && info0) {
      const titles = [...new Set([...(info0.titles || [info0.title]), ...frames.flatMap((f) => f.titles || [f.title])].filter(Boolean))].slice(0, 16);
      const richest = frames.slice().sort((a, b) => (b.description || "").length - (a.description || "").length)[0];
      info0 = { ...info0, titles, description: (info0.description || "").length > 400 ? info0.description : richest.description, company: info0.company || richest.company, location: info0.location || richest.location };
    }
  } catch { /* frames not readable */ }
  // Pressing "Apply with Vantage" again later in the same application (next page, after signing in) continues it —
  // it never starts a second application.
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  if (!resume && !force && t?.taskId && !t.sent && Date.now() - (t.at || 0) < 3 * 3600_000 && info0 && host(info0.url) === host(t.url)) resume = true;
  if (!resume || !t?.taskId) {
    const info = info0;
    if (!info) return;
    if (info.signIn) return showPanel(tabId, { note: "Sign in on this page first (Vantage never types your passwords), then press Apply with Vantage on the application.", noteTone: "ok", buttons: [{ text: "Close", action: "close", ghost: true }] });
    await showPanel(tabId, { steps: steps(0), note: "Reading the job…", noteTone: "ok" });
    try {
      const start = await api("/api/ext/start", { method: "POST", body: { ...info, force } });
      if (start.alreadyApplied) {
        return showPanel(tabId, { job: start.job, ghost: start.ghost, note: "You already applied to this job — Vantage won't send it twice.", noteTone: "warn", buttons: [{ text: "Fill anyway", action: "force" }, { text: "Close", action: "close", ghost: true }] });
      }
      base = { job: start.job, ghost: start.ghost, match: start.match };
      t = { taskId: start.taskId, job: start.job, url: info.url, at: Date.now(), base, history: [], tailoring: Boolean(start.tailoring) };
      await store.setTab(tabId, t);
    } catch (e) {
      return showPanel(tabId, { note: e.code === 401 ? "Connect the extension to your Vantage account: click the Vantage icon → Connect." : e.message, noteTone: "warn", buttons: [{ text: "Try again", action: "refill" }, { text: "Close", action: "close", ghost: true }] });
    }
  }
  // Not written yet (or written before this run): find out, and show what the resume covers.
  if (!t.fileReady) watchTailoring(tabId, t.taskId).catch(() => {});
  await pilotLoop(tabId, (await store.tab(tabId)) || t);
}

/** The pilot: read the page, let Vantage decide, act like a person, check, repeat — page after page. */
async function pilotLoop(tabId, t) {
  if (active.has(tabId)) return; // already filling this tab
  active.add(tabId);
  keepAwake();
  try {
    return await pilotTurns(tabId, t);
  } finally {
    active.delete(tabId);
    keepAwake();
  }
}

/** The resume (or cover letter) file for this job, or null while it's still being written. */
async function fileFor(t, kind, files) {
  if (files[kind]) return files[kind];
  const f = await api(`/api/ext/file?taskId=${t.taskId}&kind=${kind}`).catch(() => null);
  if (f && !f.pending && f.base64) files[kind] = f;
  return files[kind] || null;
}

/** Attach the resume to the form's resume box once it's written (the rest of the form was filled meanwhile). */
async function attachPending(tabId, t, files) {
  const page = await readTab(tabId);
  const box = page?.snap.items.find((x) => x.kind === "file" && !x.value && /resume|cv|curriculum|attach/i.test(x.label || "")) || page?.snap.items.find((x) => x.kind === "file" && !x.value && x.required);
  if (!box) return true; // already attached (or no resume box on this page)
  const f = await fileFor(t, "resume", files);
  if (!f) return false;
  await showPanel(tabId, { ...t.base, steps: steps(1), note: "Your resume for this job is ready — attaching it…", noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
  const r = (await inFrames(tabId, (x) => window.__vp?.act(x), [{ do: "upload", i: box.i, file: f }], [page.frameId]))[0]?.result;
  return Boolean(r?.ok);
}

async function pilotTurns(tabId, t) {
  const files = {};
  const history = t.history || [];
  let lastSig = "";
  let same = 0;
  let uploadPending = false;
  await store.patchTab(tabId, { paused: false });
  for (let turn = 0; turn < 70; turn++) {
    const cur = await store.tab(tabId);
    if (!cur || cur.paused) return;
    chrome.storage.session.set({ [`b${tabId}`]: Date.now() });
    // The resume finished while other fields were being filled: attach it now.
    if (uploadPending && cur.fileReady) uploadPending = !(await attachPending(tabId, cur, files));
    await inject(tabId);
    const page = await readTab(tabId);
    if (!page) { await sleep(1000); continue; }
    const sig = JSON.stringify([page.snap.url, page.snap.items.map((x) => [x.kind, x.label, x.value]), page.snap.errors]);
    same = sig === lastSig ? same + 1 : 0;
    lastSig = sig;
    if (same >= 3) return stuck(tabId, t, "The page isn't changing. Finish this step yourself, then press Continue.");
    let plan;
    try {
      plan = await api("/api/ext/pilot", { method: "POST", body: { taskId: t.taskId, snapshot: page.snap, history: history.slice(-4) } });
    } catch (e) {
      if (e.code === 404 || e.code === 405) return legacyFill(tabId, t); // an older Vantage server
      return stuck(tabId, t, e.message);
    }
    await showPanel(tabId, { ...t.base, steps: steps(1), note: plan.say, noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
    const results = [];
    for (const a of plan.actions || []) {
      if ((await store.tab(tabId))?.paused) return;
      let r;
      if (a.do === "upload") {
        const kind = a.file === "cover_letter" ? "cover_letter" : "resume";
        const f = await fileFor(t, kind, files);
        if (!f) {
          // Still being written: fill everything else now and attach it the moment it's ready.
          if (kind === "resume") uploadPending = true;
          r = { ok: false, note: kind === "resume" ? "the resume for this job is still being written — Vantage attaches it as soon as it's ready; fill the other fields" : "no cover letter yet — skip it" };
        } else {
          await showPanel(tabId, { ...t.base, steps: steps(1), note: kind === "resume" ? "Attaching the resume written for this job…" : "Attaching the cover letter written for this job…", noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
          r = (await inFrames(tabId, (x) => window.__vp?.act(x), [{ do: "upload", i: a.i, file: f }], [page.frameId]))[0]?.result;
        }
      } else {
        r = (await inFrames(tabId, (x) => window.__vp?.act(x), [a], [page.frameId]))[0]?.result;
      }
      r ||= { ok: false, note: "page changed" };
      results.push(r);
      if (r.note === "page changed") break;
      await sleep(a.do === "click" ? 450 : 120);
    }
    history.push({ say: plan.say, actions: plan.actions, results, url: page.snap.url, notes: plan.notes });
    while (history.length > 10) history.shift();
    await store.patchTab(tabId, { history });

    if (plan.status === "ready" && uploadPending) {
      // Everything else is filled: wait for the resume (the panel shows progress), attach it, then check the page again.
      for (let w = 0; w < 40 && uploadPending; w++) {
        const now = await store.tab(tabId);
        if (!now || now.paused) return;
        if (now.fileReady) uploadPending = !(await attachPending(tabId, now, files));
        if (!uploadPending) break;
        await showPanel(tabId, { ...t.base, steps: steps(1), note: `Every other field is filled. Your resume for this job is almost written — attaching it as soon as it's ready (${w * 3} s)…`, noteTone: "ok", buttons: [{ text: "Use my saved resume instead", action: "own_resume", ghost: true }, { text: "Pause", action: "pause", ghost: true }] });
        await sleep(3000);
      }
      lastSig = "";
      continue;
    }
    if (plan.status === "ready") {
      await store.patchTab(tabId, { history, submit: { i: plan.submit, frameId: page.frameId } });
      await markWaiting(tabId);
      return showPanel(tabId, { ...t.base, steps: steps(2), note: "Every page is filled and this is the last step. Look it over — then Vantage can submit it for you, or press Submit on the page yourself.", noteTone: "ok", buttons: [{ text: "Submit it for me", action: "submit_now" }, { text: "Check again", action: "continue", ghost: true }] });
    }
    if (plan.status === "done") return confirmed(tabId, "The page says the application went through.");
    if (plan.status === "ask") {
      await store.patchTab(tabId, { history, missing: plan.ask });
      await markWaiting(tabId);
      return showPanel(tabId, { ...t.base, steps: steps(1), missing: plan.ask, buttons: [{ text: "Save answers & continue", action: "answers" }, { text: "Pause", action: "pause", ghost: true }] });
    }
    if (plan.status === "account") {
      await markWaiting(tabId);
      return showPanel(tabId, { ...t.base, steps: steps(1), note: "This site needs you to sign in or create an account. Vantage never types your password — do it on the page; Vantage carries on by itself when the next page opens.", noteTone: "ok", buttons: [{ text: "Continue", action: "continue" }] });
    }
    if (plan.status === "stuck") return stuck(tabId, t, plan.say);
    if (plan.status === "handoff") {
      // LinkedIn: this step is filled; the person presses LinkedIn's button, then Vantage fills the next step itself.
      await showPanel(tabId, { ...t.base, steps: steps(1), note: "This step is filled. Check it and press Next (or Submit) on LinkedIn — Vantage fills the next step by itself.", noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
      const before = JSON.stringify([page.snap.url, page.snap.headings, page.snap.dialog]);
      let moved = false;
      for (let w = 0; w < 600 && !moved; w++) {
        await sleep(1000);
        if ((await store.tab(tabId))?.paused) return;
        await inject(tabId);
        if (await top(tabId, () => window.__vantage?.isConfirmation())) return confirmed(tabId, "LinkedIn shows the application as sent.");
        const now = await readTab(tabId);
        if (now && JSON.stringify([now.snap.url, now.snap.headings, now.snap.dialog]) !== before) moved = true;
      }
      if (!moved) return stuck(tabId, t, "Waiting for you to press Next.");
      lastSig = "";
      continue;
    }
    await sleep(plan.status === "next" ? 1500 : 500);
  }
  return stuck(tabId, t, "This application is taking longer than expected.");
}

async function stuck(tabId, t, why) {
  await markWaiting(tabId);
  return showPanel(tabId, { ...t.base, steps: steps(1), note: `${why || "Vantage needs a hand here."} Do this step on the page — Vantage carries on by itself when you move to the next page (or press Continue).`, noteTone: "warn", buttons: [{ text: "Continue", action: "continue" }, { text: "I submitted it", action: "submitted", ghost: true }] });
}

/** Older servers without the pilot: one pass with the field planner. */
async function legacyFill(tabId, t) {
  const done = new Set();
  const missing = await fillPass(tabId, t.taskId, done);
  const more = await fillPass(tabId, t.taskId, done);
  const left = dedupe([...missing, ...more]);
  await store.setTab(tabId, { ...t, missing: left });
  await showPanel(tabId, {
    ...t.base, steps: steps(2), missing: left,
    note: left.length ? null : "Everything is filled. Check it over, then press Submit on the page.",
    buttons: left.length ? [{ text: "Save answers & fill", action: "answers" }, { text: "I submitted it", action: "submitted", ghost: true }] : [{ text: "I submitted it", action: "submitted", ghost: true }],
  });
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
  // Small batches with trimmed option lists keep big forms (Amazon, Workday) fast and light.
  const slim = fields.map(({ frameId, localId, value, checked, accept, ...f }) => ({ ...f, label: String(f.label || "").slice(0, 300), options: Array.isArray(f.options) ? f.options.slice(0, 400) : f.options }));
  const plan = { fills: [], missing: [] };
  for (let i = 0; i < slim.length && i < 240; i += 40) {
    const r = await api("/api/ext/plan", { method: "POST", body: { taskId, fields: slim.slice(i, i + 40) } });
    plan.fills.push(...(r.fills || []));
    plan.missing.push(...(r.missing || []));
  }
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

/**
 * Waiting for the person (a sign-in, a question, a step Vantage couldn't do, the final check). If they move on to the
 * next page themselves — a full page load or a single-page app changing its step — Vantage notices and carries on.
 */
const pageSig = (tabId) => top(tabId, () => {
  const heads = [...document.querySelectorAll("h1, h2, h3, legend, [role='heading'], [aria-current='step']")].filter((h) => h.offsetParent).map((h) => (h.innerText || "").trim()).filter(Boolean).slice(0, 6).join("|");
  const fields = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, [role='combobox']")].filter((e) => e.offsetParent).map((e) => e.name || e.id || e.type).slice(0, 40).join(",");
  const dialog = Boolean(document.querySelector("[role='dialog']:not([aria-hidden='true']), [aria-modal='true']"));
  return `${location.href.split("#")[0]}::${heads}::${fields}::${dialog}`;
}).catch(() => null);

async function markWaiting(tabId) {
  const t = await store.tab(tabId);
  if (!t) return;
  await store.setTab(tabId, { ...t, waiting: true, waitSig: await pageSig(tabId), waitAt: Date.now() });
}

async function maybeResume(tabId) {
  const t = await store.tab(tabId);
  if (!t?.waiting || t.sent || t.paused || !t.taskId) return;
  if (Date.now() - (t.resumeAt || 0) < 2500) return;
  await sleep(700); // let the new page settle
  await inject(tabId);
  if (await top(tabId, () => window.__vantage?.isConfirmation()).catch(() => false)) return confirmed(tabId, "The confirmation page appeared.");
  const sig = await pageSig(tabId);
  if (!sig || sig === t.waitSig) return;
  await store.setTab(tabId, { ...t, waiting: false, resumeAt: Date.now(), missing: null });
  await showPanel(tabId, { ...t.base, steps: steps(1), note: "You moved on — Vantage is reading this page and filling it.", noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
  return pilotLoop(tabId, { ...t, waiting: false });
}

async function onPanel(tabId, msg) {
  const t = await store.tab(tabId);
  if (msg.action === "close") return showPanel(tabId, null);
  if (msg.action === "force") return run(tabId, { force: true });
  if (msg.action === "refill") return run(tabId);
  if (!t) return;
  if (msg.action === "pause") {
    await store.setTab(tabId, { ...t, paused: true });
    return showPanel(tabId, { ...t.base, steps: steps(1), note: "Paused. Press Continue when you want Vantage to carry on from this page.", noteTone: "ok", buttons: [{ text: "Continue", action: "continue" }, { text: "Close", action: "close", ghost: true }] });
  }
  if (msg.action === "continue") { await store.setTab(tabId, { ...t, waiting: false }); return run(tabId, { resume: true }); }
  if (msg.action === "submit_now" && t.submit) {
    // The person checked the form and asked Vantage to press the final Submit.
    await showPanel(tabId, { ...t.base, steps: steps(2), note: "Submitting…", noteTone: "ok" });
    await store.setTab(tabId, { ...t, submitAt: Date.now() });
    await inFrames(tabId, (x) => window.__vp?.act(x), [{ do: "click", i: t.submit.i, allowFinal: true }], [t.submit.frameId]);
    await sleep(3500);
    await inject(tabId);
    if (await top(tabId, () => window.__vantage?.isConfirmation())) return confirmed(tabId, "The confirmation page appeared.");
    // Not confirmed yet (an error, a code, or one more step): carry on from the page as it is now.
    await store.setTab(tabId, { ...t, submit: null, submitted_click: true });
    return run(tabId, { resume: true });
  }
  if (msg.action === "answers") {
    const answers = (msg.answers || []).filter((a) => String(a.answer || "").trim());
    if (!answers.length) return;
    await api("/api/ext/answers", { method: "POST", body: { taskId: t.taskId, answers: answers.map((a) => ({ label: a.label, type: a.type, answer: a.answer })) } }).catch(() => {});
    return run(tabId, { resume: true });
  }
  if (msg.action === "submitted") return markSubmitted(tabId, "manual");
  if (msg.action === "own_resume") {
    // Don't wait for the tailored resume: attach the person's saved one.
    const f = await api(`/api/ext/file?taskId=${t.taskId}&kind=resume&now=1`).catch(() => null);
    if (f?.base64) {
      const page = await readTab(tabId);
      const box = page?.snap.items.find((x) => x.kind === "file" && !x.value && /resume|cv|attach/i.test(x.label || ""));
      if (box) await inFrames(tabId, (x) => window.__vp?.act(x), [{ do: "upload", i: box.i, file: f }], [page.frameId]);
      await store.setTab(tabId, { ...t, fileReady: true });
    }
    return;
  }
  if (msg.action === "not_yet") {
    await store.setTab(tabId, { ...t, submitAt: 0 });
    return showPanel(tabId, { ...t.base, steps: steps(1), note: "OK — it's not marked as applied. Finish the form, press the site's Submit, and Vantage records it when the confirmation appears.", noteTone: "ok", buttons: [{ text: "Continue filling", action: "continue" }, { text: "Close", action: "close", ghost: true }] });
  }
}

/**
 * The page looks like a confirmation. It only counts as applied by itself if the form's own Submit was pressed
 * in the last 15 minutes (by the person, or by "Submit it for me"); otherwise the person is asked. Moving to
 * another page, signing in or an "application received" line on a job page never marks a job as applied.
 */
async function confirmed(tabId, why) {
  const t = await store.tab(tabId);
  if (!t || t.sent) return;
  if (t.submitAt && Date.now() - t.submitAt < 15 * 60_000) return markSubmitted(tabId, "detected");
  return showPanel(tabId, { ...t.base, steps: steps(2), note: `${why} Did you submit this application?`, noteTone: "ok", buttons: [{ text: "Yes, I submitted it", action: "submitted" }, { text: "Not yet", action: "not_yet", ghost: true }] });
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
    } else if (msg.type === "alive" && sender.tab?.id) {
      // The panel says "filling" but nothing is running (Chrome restarted the extension): carry on where it was.
      const tabId = sender.tab.id;
      if (!active.has(tabId)) {
        const t = await store.tab(tabId);
        const beat = (await chrome.storage.session.get(`b${tabId}`))[`b${tabId}`] || 0;
        if (t?.taskId && !t.paused && !t.waiting && !t.sent && Date.now() - beat > 15_000) run(tabId, { resume: true }).catch(() => {});
      }
      reply({ ok: true });
    } else if (msg.type === "submit_click" && sender.tab?.id) {
      const t = await store.tab(sender.tab.id);
      if (t && !t.sent) await store.setTab(sender.tab.id, { ...t, submitAt: Date.now() });
      reply({ ok: true });
    } else if (msg.type === "page_changed" && sender.tab?.id) {
      await maybeResume(sender.tab.id);
      reply({ ok: true });
    } else if (msg.type === "confirmation" && sender.tab?.id) {
      await confirmed(sender.tab.id, "The confirmation page appeared.");
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
  if (msg?.type === "apply") {
    // "Tailor & apply" on the Vantage website: the resume and cover letter for this job are already written. Open the
    // company's application in a new tab and start filling it as soon as it loads. The person presses Submit.
    openAndFill(msg).then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type !== "connect" || !/^vx_[A-Za-z0-9_-]{20,}$/.test(msg.token || "")) return reply({ ok: false });
  store.set("token", msg.token).then(() => reply({ ok: true }));
  return true;
});

async function openAndFill(msg) {
  if (!(await store.get("token"))) return { ok: false, error: "Connect the extension to your Vantage account first." };
  // Only https careers pages (plain http only for the extension's own local tests).
  const local = Boolean(await store.get("apiBase")) && /^http:\/\/127\.0\.0\.1:/.test(String(msg.url || ""));
  if (!/^[0-9a-f-]{36}$/i.test(String(msg.taskId || "")) || !(/^https:\/\//i.test(String(msg.url || "")) || local)) return { ok: false, error: "Bad request" };
  const tab = await chrome.tabs.create({ url: msg.url, active: true });
  const job = msg.job && typeof msg.job === "object" ? { title: String(msg.job.title || ""), company: String(msg.job.company || "") } : null;
  const st = await api(`/api/ext/status?taskId=${msg.taskId}`).catch(() => null);
  await store.setTab(tab.id, { taskId: msg.taskId, job, url: msg.url, at: Date.now(), base: { job }, history: [], autostart: true, fileReady: Boolean(st?.ready), report: st?.report || null });
  return { ok: true };
}

/** A tab opened by "Tailor & apply": start filling once the company's page has loaded (once). */
async function maybeAutostart(tabId) {
  const t = await store.tab(tabId);
  if (!t?.autostart || t.started) return;
  await store.setTab(tabId, { ...t, started: true, autostart: false });
  await sleep(1200); // let the careers site finish drawing the form
  await inject(tabId);
  const info = await top(tabId, () => window.__vp?.info() || window.__vantage?.info()).catch(() => null);
  if (info?.signIn) {
    await markWaiting(tabId);
    return showPanel(tabId, { ...t.base, steps: steps(1), note: "Sign in on this page first (Vantage never types your passwords). Vantage carries on by itself when the application opens.", noteTone: "ok", buttons: [{ text: "Continue", action: "continue" }] });
  }
  await showPanel(tabId, { ...t.base, steps: steps(1), note: "Your resume and cover letter for this job are ready. Filling the form…", noteTone: "ok", buttons: [{ text: "Pause", action: "pause", ghost: true }] });
  return run(tabId, { resume: true });
}

// After a full page load that follows a Submit press in a tab we filled, look for the "thank you for applying" page.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  maybeAutostart(tabId).catch(() => {});
  // A new page in a tab where Vantage is waiting for the person: carry on filling it.
  maybeResume(tabId).catch(() => {});
  const t = await store.tab(tabId);
  if (!t || t.sent || !t.submitAt || Date.now() - t.submitAt > 15 * 60_000) return;
  await inject(tabId);
  const yes = await top(tabId, () => window.__vantage?.isConfirmation());
  if (yes) await markSubmitted(tabId, "detected");
});
chrome.tabs.onRemoved.addListener((tabId) => store.setTab(tabId, null));
