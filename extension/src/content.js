// Vantage — runs inside job application pages (every frame) only when you press "Fill with Vantage".
// It reads the form, fills it with your answers and tailored files, and never presses Submit for you.
(() => {
  if (window.__vantage) return;

  /* __EXTRACT__ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const closest = (options, want) => {
    const w = norm(want);
    if (!w) return null;
    return options.find((o) => norm(o) === w) || options.find((o) => norm(o).startsWith(w)) || options.find((o) => norm(o).includes(w)) || options.find((o) => w.includes(norm(o)) && norm(o).length > 2) || null;
  };
  const byId = (id) => document.querySelector(`[data-vantage-id="${CSS.escape(id)}"]`);
  const labelFor = (input) => {
    const id = input.getAttribute("id");
    const l = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return ((l && l.innerText) || input.closest("label")?.innerText || input.value || "").trim();
  };

  // React, Vue and Angular forms only notice values set through the native setter plus input/change events.
  function setNative(el, value, blur = true) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (blur) el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function check(el, on = true) {
    if (el.checked === on) return;
    const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    (lab || el).click();
    if (el.checked !== on) {
      el.checked = on;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function ownList(el) {
    const ids = `${el.getAttribute("aria-controls") || ""} ${el.getAttribute("aria-owns") || ""}`.trim().split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const l = document.getElementById(id);
      if (l) return [...l.querySelectorAll("[role='option'], li")].filter((o) => o.offsetParent !== null);
    }
    const lists = [...document.querySelectorAll("[role='listbox'], [class*='menu-list' i], [class*='select__menu' i], ul[class*='dropdown' i]")].filter((l) => l.offsetParent !== null);
    if (!lists.length) return [];
    const r = el.getBoundingClientRect();
    lists.sort((a, b) => Math.abs(a.getBoundingClientRect().top - r.bottom) - Math.abs(b.getBoundingClientRect().top - r.bottom));
    return [...lists[0].querySelectorAll("[role='option'], li, [class*='option' i]")].filter((o) => o.offsetParent !== null);
  }
  /* __CHOOSE__ */
  function suggestions(el) {
    const own = ownList(el);
    if (own.length) return own;
    return [...document.querySelectorAll(".pac-item, [class*='dropdown-results' i] > *, [class*='dropdown-location' i], [class*='suggestion' i], [class*='autocomplete' i] li, [class*='typeahead' i] li")].filter((o) => o.offsetParent !== null);
  }
  async function readOptions(id) {
    const el = byId(id);
    if (!el) return [];
    el.scrollIntoView({ block: "center" });
    el.click();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(500);
    const out = [...new Set(ownList(el).map((o) => (o.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 160 && !/^(no (options|results)|loading)/i.test(t)))].slice(0, 400);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
    await sleep(120);
    return out;
  }
  async function typeInto(el, text) {
    el.focus();
    setNative(el, "", false);
    for (const ch of text.slice(0, 60)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(el, el.value + ch) : (el.value += ch);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      await sleep(25);
    }
  }

  /** Fill one field. Returns true when the page shows the value. */
  async function fill(f, plan, file) {
    const el = byId(f.id);
    if (!el) return false;
    try {
      if (plan.file) {
        if (!file) return false;
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], file.name, { type: file.mimeType || "application/pdf" }));
        el.files = dt.files;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(1200);
        return el.files?.length > 0;
      }
      if (f.type === "checkbox") {
        if (plan.check) check(el, true);
        return true;
      }
      if (f.type === "checkboxes") {
        const wants = String(plan.value || "").split(/;\s*/).map(norm).filter(Boolean);
        let hit = 0;
        for (const b of document.querySelectorAll(`input[type='checkbox'][name="${CSS.escape(f.name || "")}"]`)) {
          const lab = norm(labelFor(b));
          if (wants.some((w) => lab === w || lab.startsWith(w))) { check(b, true); hit++; }
        }
        return hit > 0;
      }
      if (f.type === "radio") {
        for (const r of document.querySelectorAll(`input[type='radio'][name="${CSS.escape(f.name || "")}"]`)) {
          const lab = labelFor(r);
          if (norm(lab) === norm(plan.value) || norm(r.value) === norm(plan.value) || (lab && norm(lab).startsWith(norm(plan.value)))) { check(r, true); return true; }
        }
        return false;
      }
      if (f.type === "select") {
        const opts = [...el.options];
        const hit = closest(opts.map((o) => o.text.trim()), plan.value);
        const opt = opts.find((o) => o.text.trim() === hit);
        if (!opt) return false;
        setNative(el, opt.value);
        return true;
      }
      if (f.type === "buttons") {
        const btn = [...el.querySelectorAll("button, [role='button']")].find((b) => norm(b.innerText) === norm(plan.value));
        if (!btn) return false;
        btn.click();
        return true;
      }
      if (f.type === "combobox") {
        const want = String(plan.value || "");
        el.scrollIntoView({ block: "center" });
        const isButton = el.tagName === "BUTTON";
        const queries = isButton ? [""] : [...new Set([want, want.split(",")[0].trim(), want.split(/\s+/)[0]].filter((q) => q && q.length >= 2))].slice(0, 3);
        for (const q of queries) {
          el.click();
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          await sleep(250);
          if (!isButton) await typeInto(el, q);
          await sleep(isButton ? 400 : 1000);
          const opts = ownList(el);
          const texts = opts.map((o) => (o.innerText || "").replace(/\s+/g, " ").trim());
          const pick = closest(texts.filter((t) => t && !/^(no (options|results)|loading|type to search)/i.test(t)), want);
          if (pick) {
            const o = opts[texts.indexOf(pick)];
            o.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            o.click();
            await sleep(250);
            return true;
          }
        }
        if (!isButton) setNative(el, "");
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return false;
      }
      if (f.type === "text" && /location|city|where (do )?you (live|are based)/i.test(f.label)) {
        // Type-ahead location boxes (Lever, Google Places): type, then pick the matching suggestion.
        const want = String(plan.value);
        for (const q of [...new Set([want, want.split(",")[0].trim()])]) {
          await typeInto(el, q);
          await sleep(900);
          const opts = suggestions(el);
          const texts = opts.map((o) => (o.innerText || "").replace(/\s+/g, " ").trim());
          const pick = chooseOption(texts, want);
          if (pick) {
            const o = opts[texts.indexOf(pick)];
            o.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            o.click();
            await sleep(250);
            return true;
          }
          if (!opts.length) break; // a plain text box: keep what was typed
        }
        setNative(el, want);
        return true;
      }
      setNative(el, String(plan.value ?? ""));
      return true;
    } catch {
      return false;
    }
  }

  /** What the page says about the job, so Vantage can tailor for it. */
  function info() {
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
    const h1 = (document.querySelector("h1")?.innerText || "").trim();
    const title = (h1 && h1.length < 140 ? h1 : "") || meta("og:title") || document.title;
    const ld = [...document.querySelectorAll("script[type='application/ld+json']")].map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } }).flat().find((x) => x && x["@type"] === "JobPosting");
    return {
      url: location.href,
      title: (ld?.title || title || "").replace(/\s*[|–-]\s*(careers?|jobs?).*$/i, "").trim(),
      company: ld?.hiringOrganization?.name || meta("og:site_name") || "",
      location: ld?.jobLocation?.address?.addressLocality || "",
      description: (ld?.description ? ld.description.replace(/<[^>]+>/g, " ") : (document.querySelector("main, article, [class*='description' i]") || document.body).innerText).slice(0, 15000),
    };
  }

  const CONFIRM = /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully (submitted|applied)|your application is complete/i;
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const openFields = () => [...document.querySelectorAll("input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]), select, textarea")].filter(visible).length;
  /**
   * Is this the "thank you for applying" page? Only when the wording is in the page's headline area (a heading,
   * a status message or the first lines of the page) and the form itself is gone. A job page that merely says
   * "application received" in an FAQ, a sign-in page, or the next step of the form never counts.
   */
  const isConfirmation = () => {
    if (document.querySelector("input[type=password]")) return false;
    const heads = [...document.querySelectorAll("h1, h2, h3, [role=alert], [role=status], [role=dialog], [aria-live]")].filter(visible).map((n) => n.innerText || "").join("\n").slice(0, 4000);
    const lead = (document.querySelector("main, [role=main]") || document.body)?.innerText?.slice(0, 1500) || "";
    const said = CONFIRM.test(heads) || CONFIRM.test(lead) || (/\/(confirmation|thank-?you|application-?submitted)\b/i.test(location.pathname) && CONFIRM.test(document.body?.innerText?.slice(0, 6000) || ""));
    return said && openFields() <= 3;
  };

  // When the person presses the form's own final button, remember it (only a press on a filled-in form counts),
  // then watch for the confirmation (single-page apps don't reload).
  const FINAL = /^\s*(submit|send|finish|complete|apply)\b[^\n]{0,30}$/i;
  if (window === window.top) {
    document.addEventListener("click", (e) => {
      if (!e.isTrusted) return; // a page can't fake a Submit press
      const b = e.target instanceof Element ? e.target.closest("button, input[type='submit'], [role='button']") : null;
      if (!b || !FINAL.test(b.innerText || b.value || b.getAttribute("aria-label") || "")) return;
      if (openFields() < 2) return; // an "Apply" link on a job page, not a form's submit
      chrome.runtime.sendMessage({ type: "submit_click" }).catch(() => {});
      let n = 0;
      const t = setInterval(() => {
        if (isConfirmation()) { clearInterval(t); chrome.runtime.sendMessage({ type: "confirmation" }).catch(() => {}); }
        if (++n > 30) clearInterval(t);
      }, 1000);
    }, true);
  }

  /* ---------- the panel (top frame only) ---------- */
  let host = null;
  let root = null;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const CSS_TEXT = `
    :host { all: initial; }
    .p { position: fixed; right: 18px; bottom: 18px; width: 360px; max-height: 78vh; overflow: auto; z-index: 2147483647; background: #fff; color: #10142a;
      border: 1px solid #e3e6ee; border-radius: 16px; box-shadow: 0 18px 50px rgba(16,20,42,.18); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    .h { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #eef0f4; font-weight: 700; }
    .logo { width: 22px; height: 22px; border-radius: 6px; background: #2f5beb; color: #fff; display: grid; place-items: center; font-size: 13px; }
    .x { margin-left: auto; border: 0; background: none; font-size: 18px; color: #8a90a2; cursor: pointer; }
    .b { padding: 14px; }
    .job { font-weight: 700; } .muted { color: #6b7185; font-size: 12.5px; }
    .steps { margin: 12px 0 0; padding: 0; list-style: none; }
    .steps li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; background: #d4d8e2; }
    .done .dot { background: #22a05b; } .now .dot { background: #2f5beb; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .35; } }
    .warn { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: #fdecec; color: #a22; font-size: 13px; font-weight: 600; }
    .ok { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: #e8f6ee; color: #17713f; font-size: 13px; font-weight: 600; }
    .q { margin-top: 12px; } .q label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    .q input, .q textarea, .q select { width: 100%; box-sizing: border-box; border: 1px solid #d9dce5; border-radius: 9px; padding: 8px 10px; font: inherit; }
    .q textarea { min-height: 70px; }
    .row { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .btn { border: 0; border-radius: 10px; padding: 9px 14px; font: inherit; font-weight: 700; cursor: pointer; background: #2f5beb; color: #fff; }
    .btn.g { background: #f1f3f8; color: #10142a; }
    .rep { margin-top: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid #e3e6ee; background: #fafbfd; }
    .rep .t { font-weight: 700; font-size: 13px; }
    .bar { display: flex; gap: 3px; margin: 7px 0 6px; } .bar span { flex: 1; height: 6px; border-radius: 3px; background: #e3e6ee; } .bar span.on { background: #22a05b; }
    .chips { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font-size: 11.5px; border: 1px solid #f0c36d; color: #8a5a00; border-radius: 999px; padding: 1px 7px; }
    .rep a { color: #2f5beb; font-weight: 600; font-size: 12.5px; text-decoration: none; }
    .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #c8cfe0; border-top-color: #2f5beb; border-radius: 50%; animation: sp .8s linear infinite; margin-right: 6px; vertical-align: -1px; }
    @keyframes sp { to { transform: rotate(360deg); } }
  `;
  const APP = "https://vantagejobapply.onrender.com";
  const reportHtml = (r, tailoring) => {
    if (r && r.total) {
      const bars = Array.from({ length: Math.min(r.total, 12) }, (_, i) => `<span class="${i < r.covered ? "on" : ""}"></span>`).join("");
      const fmt = r.format ? `${esc(r.format.label || r.format.docName)}${r.format.pages ? `, ${r.format.pages} page${r.format.pages > 1 ? "s" : ""}` : ""}` : "";
      const gaps = (r.missing || []).slice(0, 4).map((m) => `<span class="chip">${esc(m)}</span>`).join("");
      return `<div class="rep"><div class="t">Resume and cover letter written for this job</div><div class="bar">${bars}</div>
        <div>Covers <b>${r.covered} of ${r.total}</b> key skills${fmt ? ` · ${fmt}` : ""}${r.harvard && r.harvard.total ? ` · ${r.harvard.ok}/${r.harvard.total} bullets pass Harvard checks` : ""}</div>
        ${gaps ? `<div class="muted" style="margin-top:6px">Not in your history (never added):</div><div class="chips">${gaps}</div>` : ""}
        ${r.resumeId ? `<div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap"><a href="${APP}/api/resume/${esc(r.resumeId)}/pdf?inline=1" target="_blank" rel="noopener">Resume (PDF) ↗</a><a href="${APP}/api/resume/${esc(r.resumeId)}/pdf?kind=cover&inline=1" target="_blank" rel="noopener">Cover letter (PDF) ↗</a><a href="${APP}/app/resumes/${esc(r.resumeId)}" target="_blank" rel="noopener">Edit ↗</a></div>` : ""}</div>`;
    }
    if (tailoring) return `<div class="rep"><span class="spin"></span><b>Writing your resume and cover letter for this job…</b><div class="muted" style="margin-top:4px">Usually 20–40 seconds. Vantage fills the rest of the form meanwhile and attaches the resume when it's ready.</div></div>`;
    return "";
  };
  let heartbeat = null;
  function panel(state) {
    if (window !== window.top) return;
    if (!host) {
      host = document.createElement("div");
      host.id = "vantage-panel";
      document.documentElement.appendChild(host);
      root = host.attachShadow({ mode: "closed" });
    }
    // While Vantage is filling (the panel offers Pause), tell it every few seconds that this page is still open,
    // so a run stopped by Chrome carries on by itself.
    const working = Boolean(state && (state.buttons || []).some((b) => b.action === "pause"));
    if (working && !heartbeat) heartbeat = setInterval(() => chrome.runtime.sendMessage({ type: "alive" }).catch(() => {}), 10000);
    if (!working && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (!state) { host.remove(); host = null; return; }
    const steps = (state.steps || []).map((s) => `<li class="${s.state}"><span class="dot"></span><span>${esc(s.text)}</span></li>`).join("");
    const qs = (state.missing || []).map((m, i) => {
      const id = `q${i}`;
      const sel = (o) => (m.suggest && o === m.suggest ? " selected" : "");
      const input = m.options?.length
        ? `<select id="${id}"><option value="">Choose…</option>${m.options.map((o) => `<option${sel(o)}>${esc(o)}</option>`).join("")}</select>`
        : m.type === "textarea" || m.label.length > 90 ? `<textarea id="${id}">${esc(m.suggest || "")}</textarea>` : `<input id="${id}" value="${esc(m.suggest || "")}" />`;
      const note = m.locked ? `<div class="muted" style="margin-top:4px">A statement in your name — Vantage never guesses it.${m.suggest ? " Pre-selected from your profile; check it's true for this exact question." : ""}</div>` : "";
      return `<div class="q"><label for="${id}">${esc(m.label)}</label>${note}${input}</div>`;
    }).join("");
    root.innerHTML = `<style>${CSS_TEXT}</style><div class="p" role="dialog" aria-label="Vantage">
      <div class="h"><span class="logo">V</span> Vantage <button class="x" aria-label="Close">×</button></div>
      <div class="b">
        ${state.job ? `<div class="job">${esc(state.job.title)}</div><div class="muted">${esc(state.job.company)}${state.match ? ` · ${state.match}% fit with your targets` : ""}</div>` : ""}
        ${state.ghost ? `<div class="warn">${state.ghost.level === "high" ? "Likely ghost job" : "Might be a ghost job"}: ${esc(state.ghost.reasons.join(" · "))}</div>` : ""}
        ${reportHtml(state.report, state.tailoring)}
        ${state.note ? `<div class="${state.noteTone || "ok"}">${esc(state.note)}</div>` : ""}
        <ul class="steps">${steps}</ul>
        ${qs ? `<div style="margin-top:12px;font-weight:700">Only you can answer ${state.missing.length === 1 ? "this" : "these"}</div><div class="muted">Answer once — Vantage remembers it for every future application.</div>${qs}` : ""}
        <div class="row">${(state.buttons || []).map((b) => `<button class="btn ${b.ghost ? "g" : ""}" data-a="${esc(b.action)}">${esc(b.text)}</button>`).join("")}</div>
      </div></div>`;
    root.querySelector(".x").onclick = () => chrome.runtime.sendMessage({ type: "panel", action: "close" });
    root.querySelectorAll("[data-a]").forEach((b) => {
      b.onclick = () => {
        const answers = (state.missing || []).map((m, i) => ({ ...m, answer: root.getElementById(`q${i}`)?.value || "" }));
        chrome.runtime.sendMessage({ type: "panel", action: b.getAttribute("data-a"), answers });
      };
    });
  }

  // Single-page sites (Workday, LinkedIn) change step without loading a new page: tell Vantage when the step changes,
  // so it carries on if it was waiting for the person.
  let lastStep = "";
  const stepSig = () => `${location.href.split("#")[0]}|${[...document.querySelectorAll("h1, h2, h3, legend, [aria-current='step']")].filter((h) => h.offsetParent && !h.closest("#vantage-panel")).map((h) => (h.innerText || "").trim()).slice(0, 5).join("|")}`;
  setInterval(() => {
    const now = stepSig();
    if (lastStep && now !== lastStep) chrome.runtime.sendMessage({ type: "page_changed" }).catch(() => {});
    lastStep = now;
  }, 1200);

  window.__vantage = { extract: () => extractInPage(), readOptions, fill, info, isConfirmation, panel };
})();
