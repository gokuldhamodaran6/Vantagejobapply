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
    // aria-labelledby and <label for> usually point at the same text: keep each distinct label once.
    const key = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const uniq = [];
    for (const p of parts.map((x) => (x || "").replace(/\s+/g, " ").trim()).filter(Boolean)) {
      if (!uniq.some((u) => key(u) === key(p) || key(u).includes(key(p)) || key(p).includes(key(u)))) uniq.push(p);
      else if (uniq.length && key(p).length > key(uniq[uniq.length - 1]).length && key(p).includes(key(uniq[uniq.length - 1]))) uniq[uniq.length - 1] = p;
    }
    const t = uniq.join(" ").trim();
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
      // react-select and similar show the chosen value in a sibling element; the input itself stays empty.
      const shell = el.closest("[class*='select__control'], [class*='-control'], [class*='Select-control'], [class*='select-shell'], [class*='container']") || el.parentElement?.parentElement;
      const shown = shell && shell.querySelector("[class*='single-value'], [class*='singleValue'], [class*='multi-value__label'], [class*='Select-value-label']");
      const cur = el.tagName === "BUTTON" ? text(el) : (shown ? text(shown) : el.value);
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

/**
 * The options of the dropdown this field just opened — only its own list (via aria-controls / aria-owns), or the
 * visible list nearest to it. Other lists on the page (a phone country-code picker, another question) are ignored.
 */
async function ownOptions(fr, el) {
  for (const attr of ["aria-controls", "aria-owns"]) {
    const id = await el.getAttribute(attr).catch(() => null);
    if (id) {
      const lb = fr.locator(`[id="${id.split(/\s+/)[0]}"]`);
      if (await lb.count().catch(() => 0)) {
        const inside = lb.locator("[role='option']");
        if (await inside.count().catch(() => 0)) return inside;
        return lb.locator("li, [class*='option' i]:not([class*='options' i])");
      }
    }
  }
  // No link: take visible options, preferring a list that opened right under this field.
  const box = await el.boundingBox().catch(() => null);
  const visible = fr.locator("[role='option']:visible, [role='listbox']:visible li, [class*='select__option']:visible, [class*='menu' i]:visible [class*='option' i]:not([class*='options' i])");
  if (!box) return visible;
  const near = [];
  const n = Math.min(await visible.count().catch(() => 0), 400);
  for (let i = 0; i < n; i++) {
    const b = await visible.nth(i).boundingBox().catch(() => null);
    if (b && b.y >= box.y - 400 && b.y <= box.y + box.height + 600) near.push(i);
  }
  if (!near.length) return visible;
  // A Locator for exactly those indices.
  return { nth: (i) => visible.nth(near[i]), count: async () => near.length, allInnerTexts: async () => Promise.all(near.map((i) => visible.nth(i).innerText().catch(() => ""))), filter: (o) => visible.filter(o) };
}

const cleanOpt = (o) => o.replace(/\s+/g, " ").trim();

const STATE_NAMES = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming", ON: "ontario", BC: "british columbia", QC: "quebec", AB: "alberta" };

/** The option that means the same as the answer: exact, then prefix, then "City, ST" → "City, State, Country". */
export function chooseOption(texts, want) {
  if (!texts.length || !want) return null;
  const hit = closest(texts, want);
  if (hit) return hit;
  const parts = want.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = norm(parts[0]);
    const region = STATE_NAMES[parts[1].toUpperCase()] || norm(parts[1]);
    const sameCity = texts.filter((t) => norm(t.split(",")[0]) === city);
    return sameCity.find((t) => norm(t).includes(region)) || (sameCity.length === 1 ? sameCity[0] : null);
  }
  return null;
}

/** Open a dropdown to read its options (so answers can be matched exactly). */
export async function readComboOptions(page, f) {
  const fr = frameFor(page, f);
  const el = fr.locator(`[data-vantage-id="${f.id}"]`).first();
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await el.click({ timeout: 4000 });
    await sleep(600);
    const opts = await (await ownOptions(fr, el)).allInnerTexts();
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
    return [...new Set(opts.map(cleanOpt).filter((o) => o && o.length < 160 && !/^(no (options|results)|loading)/i.test(o)))].slice(0, 400);
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
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
      const want = String(fill.value || "");
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const isButton = (await el.evaluate((n) => n.tagName)) === "BUTTON";
      // Type the full answer first; for searchable lists (cities, schools) fall back to shorter search terms.
      const queries = isButton ? [""] : [...new Set([want, want.split(",")[0].trim(), want.split(/\s+/)[0]].filter((q) => q && q.length >= 2))].slice(0, 3);
      let picked = null;
      for (const q of queries) {
        await el.click({ timeout: 5000 });
        await sleep(300);
        if (!isButton) {
          await el.fill("").catch(() => {});
          await el.pressSequentially(q.slice(0, 60), { delay: 30 });
          await sleep(1100); // async lists (Greenhouse locations) load after typing
        } else await sleep(500);
        const options = await ownOptions(fr, el);
        const texts = (await options.allInnerTexts().catch(() => [])).map(cleanOpt).filter((t) => t && !/^(no (options|results)|loading|type to search|start typing)/i.test(t));
        const pick = chooseOption(texts, want);
        if (pick) {
          const idx = texts.indexOf(pick);
          await (idx >= 0 ? options.nth(idx) : options.filter({ hasText: pick }).first()).click({ timeout: 4000 });
          picked = pick;
          break;
        }
      }
      if (!picked) {
        // Never press Enter on a guess: that would pick whatever is highlighted. Leave it for the user instead.
        if (!isButton) await el.fill("").catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        return false;
      }
      await sleep(300);
      // Check the page now shows the choice.
      const shown = await el.evaluate((n) => {
        const shell = n.closest("[class*='select__control'], [class*='-control'], [class*='Select-control'], [class*='container']") || n.parentElement?.parentElement;
        const sv = shell && shell.querySelector("[class*='single-value'], [class*='singleValue'], [class*='multi-value__label']");
        return (sv ? sv.textContent : n.tagName === "BUTTON" ? n.textContent : n.value) || "";
      }).catch(() => "");
      return !shown || norm(shown).includes(norm(picked).slice(0, 20)) || norm(picked).includes(norm(shown));
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

const SUBMIT = /^(submit( my| your)?( application| job application)?|submit & finish|send( my)?( application)?|finish( application)?|complete( application)?)$/i;
// "Apply" is often just the button that opens or scrolls to the form; it only counts as submit when it is a form's submit button.
const APPLY_SUBMIT = /^(apply( now)?|apply for (this|the) (job|position|role)|submit)$/i;
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

export async function findSubmit(page) {
  const strict = await buttonByText(page, SUBMIT);
  if (strict) return strict;
  // Fallback: an "Apply" button that submits a form with real fields in it.
  for (const frame of page.frames()) {
    const cands = frame.locator("form button[type='submit'], form input[type='submit'], form button:not([type])");
    const n = Math.min(await cands.count().catch(() => 0), 20);
    for (let i = 0; i < n; i++) {
      const c = cands.nth(i);
      const t = ((await c.innerText().catch(() => "")) || (await c.getAttribute("value").catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (!APPLY_SUBMIT.test(t) || !(await c.isVisible().catch(() => false))) continue;
      const fieldsInForm = await c.evaluate((b) => b.form ? b.form.querySelectorAll("input:not([type='hidden']), textarea, select").length : 0).catch(() => 0);
      if (fieldsInForm >= 3) return c;
    }
  }
  return null;
}
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
/**
 * Whether a frame's element is really on screen. Invisible reCAPTCHA keeps its challenge frame in the page
 * all the time (hidden, or parked off-screen) and shows a small badge in the corner — neither is a challenge.
 */
async function frameShown(f, minW, minH) {
  const el = await f.frameElement().catch(() => null);
  if (!el) return false;
  return el
    .evaluate((node, [minW, minH]) => {
      const r = node.getBoundingClientRect();
      if (r.width < minW || r.height < minH) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight + 2000 || r.left > window.innerWidth) return false;
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.1) return false;
      }
      return true;
    }, [minW, minH])
    .catch(() => false);
}

export async function humanCheckVisible(page) {
  for (const f of page.frames()) {
    const u = f.url();
    if (/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/.*frame=challenge|challenges\.cloudflare\.com/.test(u)) {
      if (await frameShown(f, 120, 120)) return true;
    }
    // A visible "I'm not a robot" checkbox (not the invisible-reCAPTCHA corner badge, whose anchor URL has size=invisible).
    if (/recaptcha\/(api2|enterprise)\/anchor/.test(u) && !/size=invisible/.test(u)) {
      const checked = await f.locator("#recaptcha-anchor[aria-checked='true']").count().catch(() => 0);
      if (!checked && (await frameShown(f, 200, 60))) return true;
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
