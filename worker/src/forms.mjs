// Reading and filling application forms on any careers site.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const human = (min = 120, max = 420) => sleep(min + Math.random() * (max - min));

/** Runs inside the page: find every fillable control, give it a stable handle, and describe it. */
function extractInPage() {
  const W = window;
  const text = (el) => (el ? (el.innerText || el.textContent || "") : "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  let n = W.__vantageN || 0;
  const tag = (el) => {
    if (!el.dataset.vantageId) el.dataset.vantageId = `f${n++}`;
    return el.dataset.vantageId;
  };
  const containerLabel = (el) => {
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const l = p.querySelector(":scope > label, :scope > legend, :scope > [class*='label' i], :scope > [class*='question' i], :scope > div > label, :scope > h3, :scope > h4, :scope > p > strong");
      if (l && !l.contains(el) && text(l).length > 1) return text(l);
    }
    return "";
  };
  const labelOf = (el) => {
    const parts = [];
    const lb = el.getAttribute("aria-labelledby");
    if (lb) parts.push(lb.split(/\s+/).map((id) => text(document.getElementById(id))).join(" "));
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(text(l));
      } catch { /* ignore */ }
    }
    const wrap = el.closest("label");
    if (wrap && !parts.length) parts.push(text(wrap));
    if (el.getAttribute("aria-label") && !parts.length) parts.push(el.getAttribute("aria-label"));
    if (!parts.join("").trim()) parts.push(containerLabel(el));
    if (!parts.join("").trim() && el.placeholder) parts.push(el.placeholder);
    const t = parts.join(" ").replace(/\s+/g, " ").trim();
    return t.slice(0, 300);
  };
  const required = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|\*\s|\(required\)/i.test(label);
  const fields = [];
  const seenGroups = new Set();

  for (const el of document.querySelectorAll("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']")) {
    const isListButton = el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox";
    const type = isListButton ? "combobox" : (el.tagName === "INPUT" ? el.getAttribute("type") || "text" : el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search"].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== "file") continue;
    const isFile = type === "file";
    if (!isFile && type !== "radio" && type !== "checkbox" && !visible(el)) continue;
    if (el.closest("[aria-hidden='true']") && !isFile) continue;
    // react-select puts the real input inside a combobox container; skip duplicates
    if (el.tagName === "INPUT" && el.closest("[role='combobox']") && el.getAttribute("role") !== "combobox") continue;

    if (type === "radio") {
      const group = el.name || el.closest("fieldset, [role='radiogroup']")?.id || "";
      if (!group || seenGroups.has(group)) continue;
      seenGroups.add(group);
      const radios = [...document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`)];
      const fs = el.closest("fieldset, [role='radiogroup']");
      const label = (fs && text(fs.querySelector("legend"))) || containerLabel(fs || el) || el.name;
      fields.push({ id: tag(el), type: "radio", label, name: el.name, required: radios.some((r) => r.required) || /\*/.test(label), options: radios.map((r) => labelOf(r) || r.value) });
      continue;
    }
    const label = labelOf(el);
    if (type === "checkbox") {
      fields.push({ id: tag(el), type: "checkbox", label, name: el.name, required: required(el, label), checked: el.checked });
      continue;
    }
    if (el.tagName === "SELECT") {
      fields.push({ id: tag(el), type: "select", label, name: el.name, required: required(el, label), options: [...el.options].map((o) => text(o) || o.value).filter(Boolean), value: el.value });
      continue;
    }
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") {
      const cur = el.tagName === "BUTTON" ? text(el) : el.value;
      fields.push({ id: tag(el), type: "combobox", label: label || containerLabel(el), name: el.name || el.getAttribute("data-automation-id") || "", required: required(el, label || containerLabel(el)), options: [], value: /select one|^select$|^choose/i.test(cur) ? "" : cur });
      continue;
    }
    const t = el.tagName === "TEXTAREA" ? "textarea" : ["email", "tel", "url", "number", "date", "password", "file"].includes(type) ? type : "text";
    fields.push({ id: tag(el), type: t, label, name: el.name || el.getAttribute("data-automation-id") || "", required: required(el, label), placeholder: el.placeholder || "", value: t === "file" ? "" : el.value, accept: el.getAttribute("accept") || "" });
  }

  // Yes/No button groups (Ashby and others) — buttons inside a labelled container.
  for (const box of document.querySelectorAll("fieldset, [class*='question' i], [class*='field' i]")) {
    const btns = [...box.querySelectorAll(":scope button, :scope [role='button']")].filter((b) => visible(b) && /^(yes|no)$/i.test(text(b)));
    if (btns.length !== 2 || box.querySelector("input:not([type='hidden']), select, textarea")) continue;
    const label = text(box.querySelector("legend, label, [class*='label' i], [class*='title' i]")) || containerLabel(btns[0]);
    if (!label) continue;
    fields.push({ id: tag(box), type: "buttons", label, required: /\*/.test(label), options: btns.map(text), value: btns.find((b) => b.getAttribute("aria-pressed") === "true" || /selected|active/i.test(b.className))?.innerText || "" });
  }
  W.__vantageN = n;
  return fields;
}

/** All fields on the page, including inside same-origin and cross-origin frames (e.g. embedded Greenhouse). */
export async function extractFields(page) {
  const out = [];
  for (const frame of page.frames()) {
    try {
      const fs = await frame.evaluate(extractInPage);
      for (const f of fs) out.push({ ...f, frame: frame === page.mainFrame() ? null : frame.url() });
    } catch {
      /* detached or blocked frame */
    }
  }
  return out;
}

function frameFor(page, f) {
  if (!f.frame) return page.mainFrame();
  return page.frames().find((fr) => fr.url() === f.frame) || page.mainFrame();
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function closest(options, want) {
  const w = norm(want);
  return options.find((o) => norm(o) === w) || options.find((o) => norm(o).startsWith(w)) || options.find((o) => norm(o).includes(w)) || options.find((o) => w.includes(norm(o)) && norm(o).length > 2) || null;
}

/** Open a searchable dropdown to read its options (so answers can be matched exactly). */
export async function readComboOptions(page, f) {
  const fr = frameFor(page, f);
  const el = fr.locator(`[data-vantage-id="${f.id}"]`).first();
  try {
    await el.click({ timeout: 4000 });
    await sleep(500);
    const opts = await fr.locator("[role='option'], [role='listbox'] li, [class*='option' i]:not([class*='options' i])").allInnerTexts();
    await page.keyboard.press("Escape").catch(() => {});
    return [...new Set(opts.map((o) => o.replace(/\s+/g, " ").trim()).filter((o) => o && o.length < 120))].slice(0, 80);
  } catch {
    return [];
  }
}

/** Fill one field. Returns true when the value was set. */
export async function fillField(page, f, fill, files) {
  const fr = frameFor(page, f);
  const el = fr.locator(`[data-vantage-id="${f.id}"]`).first();
  try {
    if (fill.file) {
      const file = fill.file === "cover_letter" ? files.cover : files.resume;
      if (!file) return false;
      await el.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.base64, "base64") });
      await sleep(1500); // parsers (Lever/Ashby/Workday) read the resume and may prefill fields
      return true;
    }
    if (f.type === "checkbox") {
      if (fill.check && !(await el.isChecked().catch(() => false))) {
        await el.check({ force: true, timeout: 4000 }).catch(async () => {
          const id = await el.getAttribute("id");
          if (id) await fr.locator(`label[for="${id}"]`).click({ timeout: 3000 });
          else await el.click({ force: true });
        });
      }
      return true;
    }
    if (f.type === "select") {
      const opt = closest(f.options || [], fill.value);
      if (!opt) return false;
      await el.selectOption({ label: opt }, { timeout: 4000 }).catch(() => el.selectOption(opt));
      return true;
    }
    if (f.type === "radio") {
      const name = f.name;
      const radios = fr.locator(`input[type='radio'][name="${name}"]`);
      const count = await radios.count();
      for (let i = 0; i < count; i++) {
        const r = radios.nth(i);
        const id = await r.getAttribute("id");
        const lab = id ? await fr.locator(`label[for="${id}"]`).first().innerText().catch(() => "") : "";
        const val = (await r.getAttribute("value")) || "";
        if (norm(lab) === norm(fill.value) || norm(val) === norm(fill.value) || (lab && norm(lab).startsWith(norm(fill.value)))) {
          await r.check({ force: true, timeout: 4000 }).catch(() => (id ? fr.locator(`label[for="${id}"]`).click() : r.click({ force: true })));
          return true;
        }
      }
      return false;
    }
    if (f.type === "buttons") {
      const btn = el.locator("button, [role='button']").filter({ hasText: new RegExp(`^\\s*${fill.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") }).first();
      await btn.click({ timeout: 4000 });
      return true;
    }
    if (f.type === "combobox") {
      await el.click({ timeout: 5000 });
      await sleep(300);
      const isButton = (await el.evaluate((n) => n.tagName)) === "BUTTON";
      if (!isButton) {
        await el.fill("").catch(() => {});
        await el.pressSequentially(String(fill.value).slice(0, 60), { delay: 35 });
        await sleep(900);
      } else {
        await sleep(500);
      }
      const options = fr.locator("[role='option']");
      const texts = (await options.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim());
      const pick = closest(texts, fill.value) || (!isButton && texts.length && texts[0] && !/no (options|results)/i.test(texts[0]) ? texts[0] : null);
      if (pick) {
        await options.filter({ hasText: pick }).first().click({ timeout: 4000 });
      } else if (!isButton) {
        await page.keyboard.press("Enter");
      } else {
        await page.keyboard.press("Escape");
        return false;
      }
      await sleep(250);
      return true;
    }
    // Text-like inputs
    let v = String(fill.value ?? "");
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(v);
      if (isNaN(d)) return false;
      v = d.toISOString().slice(0, 10);
    }
    await el.click({ timeout: 4000 }).catch(() => {});
    await el.fill(v, { timeout: 5000 });
    await el.dispatchEvent("blur").catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

const SUBMIT = /^(submit( my)?( application)?|submit & finish|send( application)?|apply( now)?|finish|complete( application)?)$/i;
const NEXT = /^(next|continue|save (and|&) continue|save and next|proceed|next step|review)$/i;
const ENTRY = /^(apply( now| for this (job|position|role)| manually| to this job)?|i'?m interested|start (your )?application|apply with resume)$/i;

async function buttonByText(page, re) {
  for (const frame of page.frames()) {
    const cands = frame.locator("button, input[type='submit'], a[role='button'], [role='button'], a.button, a[class*='btn' i], a[class*='apply' i]");
    const n = Math.min(await cands.count().catch(() => 0), 80);
    for (let i = 0; i < n; i++) {
      const c = cands.nth(i);
      const t = ((await c.innerText().catch(() => "")) || (await c.getAttribute("value").catch(() => "")) || (await c.getAttribute("aria-label").catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (t && re.test(t) && (await c.isVisible().catch(() => false)) && !(await c.isDisabled().catch(() => false))) return c;
    }
  }
  return null;
}

export const findSubmit = (page) => buttonByText(page, SUBMIT);
export const findNext = (page) => buttonByText(page, NEXT);
export const findEntry = (page) => buttonByText(page, ENTRY);

export async function pageText(page) {
  const parts = [];
  for (const f of page.frames()) parts.push(await f.evaluate(() => document.body?.innerText || "").catch(() => ""));
  return parts.join("\n").replace(/\s+/g, " ");
}

export function isConfirmation(url, text) {
  return /thank(s| you) for (applying|your application|your interest)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully submitted|your application is (complete|on its way)|application complete/i.test(text) || /\/(thanks|thank-you|confirmation|submitted|success)(\/|\?|$)/i.test(url);
}

/** A visible "prove you're human" challenge. The agent never tries to solve these. */
export async function humanCheckVisible(page) {
  for (const f of page.frames()) {
    const u = f.url();
    if (/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/.*frame=challenge|challenges\.cloudflare\.com/.test(u)) {
      const el = await f.frameElement().catch(() => null);
      const box = el ? await el.boundingBox().catch(() => null) : null;
      if (box && box.width > 80 && box.height > 80) return true;
    }
    if (/recaptcha\/(api2|enterprise)\/anchor/.test(u)) {
      const checked = await f.locator("#recaptcha-anchor[aria-checked='true']").count().catch(() => 0);
      const el = await f.frameElement().catch(() => null);
      const box = el ? await el.boundingBox().catch(() => null) : null;
      if (!checked && box && box.width > 60) return true;
    }
  }
  const t = (await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || "").catch(() => "")).toLowerCase();
  return /verify (that )?you are (a )?human|are you a robot|press (and|&) hold|complete the captcha|security check to continue/.test(t);
}

export async function visibleErrors(page) {
  const out = [];
  for (const f of page.frames()) {
    const errs = await f.evaluate(() => {
      const t = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();
      return [...document.querySelectorAll("[role='alert'], [aria-live='assertive'], .error, .error-message, [class*='error' i]:not(input):not(form), [data-automation-id='errorMessage']")]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map(t)
        .filter((x) => x && x.length < 240);
    }).catch(() => []);
    out.push(...errs);
  }
  return [...new Set(out)].slice(0, 8);
}
