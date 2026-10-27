// Reading and filling application forms on any careers site.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const human = (min = 120, max = 420) => sleep(min + Math.random() * (max - min));

/** Runs inside the page: find every fillable control, give it a stable handle, and describe it. */
function extractInPage() {
  const W = window;
  // Some sign-in pages (e.g. Amazon's) build their forms inside web components: look inside open shadow roots too.
  const roots = [document];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        walk(el.shadowRoot);
      }
    }
  };
  walk(document);
  const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const rootOf = (el) => (el.getRootNode && el.getRootNode().querySelector ? el.getRootNode() : document);
  const text = (el) => {
    if (!el) return "";
    if (el.querySelector && el.querySelector("select, option, [role='listbox'], [role='option']")) {
      const c = el.cloneNode(true);
      c.querySelectorAll("select, option, [role='listbox'], [role='option'], ul[class*='dropdown' i]").forEach((n) => n.remove());
      return (c.textContent || "").replace(/\s+/g, " ").trim();
    }
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none")) return false;
    // Styled checkboxes/radios (Workday "I agree") keep the real input at opacity 0 under a drawn box.
    if (el.tagName === "INPUT" && /^(checkbox|radio)$/i.test(el.type)) return r.width >= 8 && r.height >= 8;
    return s.opacity !== "0";
  };
  // Bot traps (Workday's 1-pixel "beecatcher" box, honeypot fields) are never filled.
  const trap = (el) => {
    const r = el.getBoundingClientRect();
    return (el.tagName === "INPUT" && !/^(checkbox|radio|file)$/i.test(el.type) && (r.width < 4 || r.height < 4)) || /honeypot|beecatcher|bot.?trap/i.test(`${el.name} ${el.id} ${el.getAttribute("data-automation-id") || ""}`);
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
    if (lb) parts.push(lb.split(/\s+/).map((id) => text(rootOf(el).getElementById ? rootOf(el).getElementById(id) : document.getElementById(id))).join(" "));
    if (el.id) {
      try {
        const l = rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`);
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

  for (const el of qsa("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']")) {
    const isListButton = el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox";
    const type = isListButton ? "combobox" : (el.tagName === "INPUT" ? el.getAttribute("type") || "text" : el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search"].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== "file") continue;
    const isFile = type === "file";
    if (!isFile && type !== "radio" && type !== "checkbox" && !visible(el)) continue;
    if (!isFile && trap(el)) continue;
    if (el.closest("[aria-hidden='true']") && !isFile) continue;
    // Site search boxes (job keyword / location search in the header) are not part of the application.
    if (el.closest("header, nav, [role='search'], [role='banner'], form[action*='search' i]") || /search|keyword|query/i.test(`${el.id} ${el.name} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`)) continue;
    // react-select puts the real input inside a combobox container; skip duplicates
    if (el.tagName === "INPUT" && el.closest("[role='combobox']") && el.getAttribute("role") !== "combobox") continue;

    if (type === "radio") {
      const group = el.name || el.closest("fieldset, [role='radiogroup']")?.id || "";
      if (!group || seenGroups.has(group)) continue;
      seenGroups.add(group);
      const radios = [...rootOf(el).querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`)];
      const fs = el.closest("fieldset, [role='radiogroup']");
      const label = (fs && text(fs.querySelector("legend"))) || containerLabel(fs || el) || el.name;
      fields.push({ id: tag(el), type: "radio", label, name: el.name, required: radios.some((r) => r.required) || /\*/.test(label), options: radios.map((r) => labelOf(r) || r.value) });
      continue;
    }
    const label = labelOf(el);
    if (type === "checkbox") {
      // Several checkboxes sharing one name are one question with options (e.g. Lever: "Previously employed? No / Yes - Intern").
      const group = el.name ? [...rootOf(el).querySelectorAll(`input[type='checkbox'][name="${CSS.escape(el.name)}"]`)] : [];
      if (group.length >= 2) {
        if (seenGroups.has(`cb:${el.name}`)) continue;
        seenGroups.add(`cb:${el.name}`);
        const box = el.closest("fieldset, [role='group'], ul, ol") || el.parentElement?.parentElement || el;
        const gl = (box.tagName === "FIELDSET" && text(box.querySelector("legend"))) || containerLabel(box) || el.name;
        fields.push({ id: tag(el), type: "checkboxes", label: gl, name: el.name, required: group.some((c) => c.required) || /\*/.test(gl), options: group.map((c) => labelOf(c) || c.value), value: group.filter((c) => c.checked).map((c) => labelOf(c) || c.value).join("; ") });
        continue;
      }
      fields.push({ id: tag(el), type: "checkbox", label, name: el.name, required: required(el, label), checked: el.checked });
      continue;
    }
    if (el.tagName === "SELECT") {
      fields.push({ id: tag(el), type: "select", label, name: el.name, required: required(el, label), options: [...el.options].slice(0, 600).map((o) => (o.textContent || o.value || "").replace(/\s+/g, " ").trim().slice(0, 140)).filter(Boolean), value: el.value });
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
    fields.push({ id: tag(el), type: t, label, name: el.name || el.getAttribute("data-automation-id") || "", required: required(el, label), placeholder: el.placeholder || "", value: t === "file" ? "" : el.value, accept: el.getAttribute("accept") || "", maxlen: el.maxLength > 0 ? el.maxLength : undefined, otp: el.autocomplete === "one-time-code" || undefined });
  }

  // Yes/No button groups (Ashby and others) — buttons inside a labelled container.
  for (const box of qsa("fieldset, [class*='question' i], [class*='field' i]")) {
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

/** Suggestions under a type-ahead text box (Lever locations, Google Places, ARIA listboxes). */
async function suggestions(fr, el) {
  const own = await ownOptions(fr, el);
  if (await own.count().catch(() => 0)) return own;
  return fr.locator(".pac-item:visible, [class*='dropdown-results' i] > *:visible, [class*='dropdown-location' i]:visible, [class*='suggestion' i]:visible, [class*='autocomplete' i] li:visible, [class*='typeahead' i] li:visible");
}

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
    if (f.type === "checkboxes") {
      const wants = String(fill.value || "").split(/;\s*/).map(norm).filter(Boolean);
      const boxes = fr.locator(`input[type='checkbox'][name="${f.name}"]`);
      const n = await boxes.count();
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const b = boxes.nth(i);
        const id = await b.getAttribute("id");
        const lab = (id ? await fr.locator(`label[for="${id}"]`).first().innerText().catch(() => "") : "") || (await b.evaluate((x) => x.closest("label")?.innerText || x.value || "").catch(() => ""));
        if (wants.some((w) => norm(lab) === w || norm(lab).startsWith(w))) {
          if (!(await b.isChecked().catch(() => false))) await b.check({ force: true, timeout: 4000 }).catch(() => b.click({ force: true }));
          hit++;
        }
      }
      return hit > 0;
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
    const auto = await el.evaluate((n) => Boolean(n.getAttribute("aria-autocomplete") || n.getAttribute("list") || n.getAttribute("aria-controls") || /location|city|autocomplete|places|typeahead/i.test(`${n.id} ${n.name} ${n.className}`))).catch(() => false);
    if (auto) {
      // Type like a person so the site's suggestions appear, then choose the one that matches.
      await el.fill("").catch(() => {});
      for (const q of [...new Set([v, v.split(",")[0].trim()])]) {
        await el.fill("").catch(() => {});
        await el.pressSequentially(q.slice(0, 60), { delay: 40 });
        await sleep(1300);
        const opts = await suggestions(fr, el);
        const texts = (await opts.allInnerTexts().catch(() => [])).map(cleanOpt).filter(Boolean);
        const pick = chooseOption(texts, v);
        if (pick) {
          await opts.nth(texts.indexOf(pick)).click({ timeout: 4000 }).catch(() => {});
          await sleep(300);
          return true;
        }
        if (!texts.length) break; // a plain text box after all
      }
      if (!(await el.inputValue().catch(() => ""))) await el.fill(v).catch(() => {});
      await el.dispatchEvent("blur").catch(() => {});
      return true;
    }
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

/** Pages between the job and the form that ask about an account (Amazon: "Looks like you're new here — Proceed to create account"). */
export const ACCOUNT_GATE = /create (an |your )?(account|profile)|sign in to (apply|continue)|log ?in to (apply|continue)|looks like you'?re new|new here|new (user|candidate)|already have an account|sign in or create|candidate (home|profile|account)|register to apply/i;
const GUEST_BTN = /^(continue as (a )?guest|apply as (a )?guest|apply without (an )?account|guest application|skip( for now)?)$/i;
const CREATE_BTN = /^(proceed to create (an )?account|create (an |your )?account|create account|create profile|sign ?up|register|get started|new user|i'?m new( here)?)$/i;
const SIGNIN_BTN = /^(sign ?in|log ?in|login|continue with email|use (my |your )?email|continue)$/i;
/** The button that moves past an account gate: a guest path first, then sign-in when we have a login here, else create. */
export async function findAccountButton(page, haveLogin) {
  return (await buttonByText(page, GUEST_BTN)) || (haveLogin ? await buttonByText(page, SIGNIN_BTN) : null) || (await buttonByText(page, CREATE_BTN)) || (haveLogin ? null : await buttonByText(page, SIGNIN_BTN));
}
/** "Verify", "Confirm" and similar buttons on code pages. */
export const findVerify = (page) => buttonByText(page, /^(verify( (code|email|account))?|confirm( (code|email))?|continue|submit( code)?|next|done)$/i);
export async function findEntry(page) {
  // A "Start your application" dialog (Workday and others): pick "Apply manually" so every field stays under our control.
  for (const frame of page.frames()) {
    const dlg = frame.locator("[role='dialog']:visible, [aria-modal='true']:visible, [data-automation-id*='Modal' i]:visible").first();
    if (await dlg.count().catch(() => 0)) {
      const manual = dlg.getByRole("button", { name: /apply manually/i }).first();
      if (await manual.isVisible().catch(() => false)) return manual;
      const link = dlg.getByText(/^apply manually$/i).first();
      if (await link.isVisible().catch(() => false)) return link;
    }
  }
  return buttonByText(page, ENTRY);
}

/** Decline optional cookies when a banner covers the form (privacy-preserving choice, and it can block clicks). */
export async function declineCookies(page) {
  for (const frame of page.frames()) {
    const btn = frame.getByRole("button", { name: /^(deny|reject|reject all|decline|decline all|only necessary|necessary only|use necessary cookies only|reject non-essential|refuse)$/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

export async function pageText(page) {
  const parts = [];
  // Includes text inside open shadow roots (web-component sign-in pages show nothing in body.innerText).
  for (const f of page.frames()) parts.push(await f.evaluate(() => {
    const out = [document.body?.innerText || ""];
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          out.push(el.shadowRoot.textContent || "");
          walk(el.shadowRoot);
        }
      }
    };
    if (document.body) walk(document.body);
    return out.join(" ");
  }).catch(() => ""));
  return parts.join("\n").replace(/\s+/g, " ");
}

export function isConfirmation(url, text) {
  return /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully submitted|your application is (complete|on its way)|application complete/i.test(text) || /\/(thanks|thank-you|confirmation|submitted|success)(\/|\?|$)/i.test(url);
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

/** Boxes for a one-time code the site emailed (e.g. Greenhouse's 8-character "security code"). Never a question for the user's profile. */
export const CODE_LABEL = /security code|verification code|confirmation code|one[- ]time (pass)?code|passcode|\botp\b|enter the \d+[- ](character|digit) code|code (was|has been) sent/i;
export const isCodeField = (f) => ["text", "number", "tel"].includes(f.type) && (f.otp || CODE_LABEL.test(`${f.label} ${f.name} ${f.placeholder || ""}`) || (f.maxlen === 1 && /code|verif/i.test(`${f.label} ${f.name}`)));

/** If the page is asking for an emailed code: the boxes (in order), how long the code is and where it was sent. */
export async function codeChallenge(page, fields) {
  const boxes = (fields || (await extractFields(page))).filter(isCodeField);
  if (!boxes.length) return null;
  const text = await pageText(page);
  const sentTo = (text.match(/sent to\s+([^\s@]+@[^\s,;]+?)[.,;]?\s/i) || [])[1] || null;
  const len = Number((text.match(/(\d+)[- ](?:character|digit) code/i) || [])[1]) || (boxes.length > 1 ? boxes.length : null);
  return { boxes, sentTo, length: len };
}

/** Type a code into one box or a row of single-character boxes, then confirm what the site shows. */
export async function enterCode(page, boxes, code) {
  const chars = [...String(code).trim()];
  const loc = (f) => frameFor(page, f).locator(`[data-vantage-id="${f.id}"]`);
  if (boxes.length > 1 && boxes.every((b) => !b.maxlen || b.maxlen <= 2)) {
    // Many OTP widgets spread a paste across the boxes; try that first, then fall back to one character per box.
    await loc(boxes[0]).click().catch(() => {});
    await page.keyboard.type(chars.join(""), { delay: 60 }).catch(() => {});
    let shown = "";
    for (const b of boxes) shown += await loc(b).inputValue().catch(() => "");
    if (shown.toUpperCase() !== chars.join("").toUpperCase()) {
      for (let i = 0; i < boxes.length && i < chars.length; i++) {
        await loc(boxes[i]).fill(chars[i]).catch(() => {});
        await sleep(40);
      }
      shown = "";
      for (const b of boxes) shown += await loc(b).inputValue().catch(() => "");
    }
    return shown.toUpperCase() === chars.join("").toUpperCase();
  }
  await loc(boxes[0]).fill(chars.join("")).catch(() => {});
  return (await loc(boxes[0]).inputValue().catch(() => "")).toUpperCase() === chars.join("").toUpperCase();
}
