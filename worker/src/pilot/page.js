// Vantage Pilot — page side. Runs inside a careers-site page (cloud agent and Chrome extension alike).
// snapshot(): every control a person could use, with its question, section, value, options and errors, numbered.
// act(): do one thing a person would do — type, pick from a dropdown (nested ones too), tick, upload, click.
// It never presses a final Submit/Send button; the caller decides that.
(() => {
  const VERSION = 7;
  if (window.__vp && window.__vp.v >= VERSION) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const FINAL = /^(submit|submit (my |your )?application|send( my)? application|complete (my )?application|finish( application)?|confirm and submit|submit and finish)\b/i;

  /* ---------- reading ---------- */
  const roots = () => {
    const out = [document];
    const walk = (r) => {
      for (const el of r.querySelectorAll("*")) if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); }
    };
    walk(document);
    return out;
  };
  const qsa = (sel) => roots().flatMap((r) => [...r.querySelectorAll(sel)]);
  const rootOf = (el) => (el.getRootNode && el.getRootNode().querySelector ? el.getRootNode() : document);
  const byId = (el, id) => { try { return rootOf(el).getElementById ? rootOf(el).getElementById(id) : document.getElementById(id); } catch { return null; } };

  const text = (el) => {
    if (!el) return "";
    if (el.querySelector && el.querySelector("select, option, [role='listbox'], [role='option'], input, textarea")) {
      const c = el.cloneNode(true);
      c.querySelectorAll("select, option, [role='listbox'], [role='option'], input, textarea, [aria-hidden='true'], style, script").forEach((n) => n.remove());
      return clean(c.textContent);
    }
    return clean(el.innerText || el.textContent);
  };
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    // Styled checkboxes and radios (Workday, many design systems) keep the real input at opacity 0 under a drawn box.
    if (el.tagName === "INPUT" && /^(checkbox|radio)$/i.test(el.type)) return r.width >= 8 && r.height >= 8;
    return Number(s.opacity) > 0.02;
  };
  // Bot traps: inputs a person can't see or reach (1-pixel boxes, "honeypot" names). Never touch them.
  const trap = (el) => {
    const r = el.getBoundingClientRect();
    return (el.tagName === "INPUT" && !/^(checkbox|radio|file)$/i.test(el.type) && (r.width < 4 || r.height < 4)) ||
      /honeypot|beecatcher|bot.?trap|\bhp_|leave (this )?(field )?(blank|empty)/i.test(`${el.name} ${el.id} ${el.getAttribute("data-automation-id") || ""} ${el.getAttribute("aria-label") || ""} ${el.placeholder || ""}`) ||
      el.tabIndex === -1 && el.tagName === "INPUT" && el.getAttribute("aria-hidden") === "true";
  };
  const chrome = (el) => Boolean(el.closest("header, nav, footer, [role='banner'], [role='navigation'], [role='contentinfo'], [data-automation-id='header'], [data-automation-id='footerContainer'], [data-automation-id='navigationContainer'], #vantage-panel")) && !el.closest("[role='dialog'], [aria-modal='true']");

  const containerLabel = (el) => {
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const l = p.querySelector(":scope > label, :scope > legend, :scope > [class*='label' i]:not(input), :scope > [class*='question' i], :scope > div > label, :scope > h3, :scope > h4, :scope > p > strong, :scope > span > label");
      if (l && !l.contains(el) && text(l).length > 1) return text(l);
    }
    return "";
  };
  const labelOf = (el) => {
    const parts = [];
    const lb = el.getAttribute("aria-labelledby");
    if (lb) parts.push(lb.split(/\s+/).map((id) => text(byId(el, id))).join(" "));
    if (el.id) {
      try {
        const l = rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(text(l));
      } catch { /* ignore */ }
    }
    const wrap = el.closest("label");
    if (wrap && !parts.join("").trim()) parts.push(text(wrap));
    if (el.getAttribute("aria-label") && !parts.join("").trim()) parts.push(el.getAttribute("aria-label"));
    if (!parts.join("").trim()) parts.push(containerLabel(el));
    if (!parts.join("").trim() && el.placeholder) parts.push(el.placeholder);
    if (!parts.join("").trim() && el.title) parts.push(el.title);
    const key = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const uniq = [];
    for (const p of parts.map(clean).filter(Boolean)) {
      if (!uniq.some((u) => key(u) === key(p) || key(u).includes(key(p)) || key(p).includes(key(u)))) uniq.push(p);
    }
    let t = uniq.join(" ");
    // Date parts ("Month", "Year", "MM") say which date only through their field's label ("From", "To").
    if (/^(month|day|year|mm|dd|yyyy|yy)$/i.test(t.trim())) {
      const q = containerLabel(el.closest("[data-automation-id='dateInputWrapper'], [class*='date' i]") || el);
      if (q && !/^(month|day|year)$/i.test(q)) t = `${q.replace(/\*$/, "")} ${t}${/\*/.test(q) ? "*" : ""}`;
    }
    return t.slice(0, 300);
  };
  const isRequired = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|\*\s|\(required\)/i.test(label);

  // The section a control belongs to ("My Information", "Work Experience 2", "Education 1").
  const HEAD = "h1, h2, h3, h4, h5, legend, [role='heading'], [data-automation-id*='Heading' i], [data-automation-id*='panelSetHeader' i]";
  const sectionOf = (el) => {
    let p = el.parentElement;
    for (let i = 0; i < 12 && p && p !== document.body; i++, p = p.parentElement) {
      const hs = [...p.querySelectorAll(`:scope > ${HEAD.split(", ").join(", :scope > ")}, :scope > div > ${HEAD.split(", ").join(", :scope > div > ")}`)].filter((h) => !h.contains(el) && visible(h) && h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !(h.tagName === "LEGEND" && h.parentElement && h.parentElement.contains(el)));
      if (hs.length) return text(hs[hs.length - 1]).slice(0, 80);
    }
    return "";
  };
  const fieldBox = (el) => el.closest("[data-automation-id^='formField'], [class*='field' i], [class*='question' i], fieldset, .form-group, li") || el.parentElement;
  const errorOf = (el) => {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    const described = ids.map((id) => byId(el, id)).filter((n) => n && /error|invalid|required/i.test(`${n.id} ${n.className} ${n.getAttribute("data-automation-id") || ""} ${text(n)}`)).map(text).join(" ");
    if (described) return described.slice(0, 160);
    const box = fieldBox(el);
    const e = box && [...box.querySelectorAll("[role='alert'], [data-automation-id*='error' i], [class*='error' i], [class*='invalid' i]")].find((n) => visible(n) && text(n) && !n.contains(el) && text(n).length < 200);
    if (e) return text(e);
    return el.getAttribute("aria-invalid") === "true" ? "invalid" : "";
  };

  let items = [];
  let lastOpened = null;

  function tagEl(el, i) {
    el.setAttribute("data-vp", String(i));
  }

  function optionText(o) {
    return clean(o.getAttribute("data-automation-label") || o.getAttribute("aria-label") || text(o)).slice(0, 140);
  }
  const OPTION_SEL = "[role='option'], [data-automation-id='promptOption'], [data-automation-id='promptLeafNode'], [role='menuitem'], [role='menuitemradio'], [role='treeitem'], .select2-results__option, .pac-item, [class*='select__option' i], [class*='dropdown-item' i], [class*='autocomplete' i] li, [class*='suggestion' i] li, [role='listbox'] li";
  const LIST_SEL = "[role='listbox'], [role='menu'], [role='tree'], [data-automation-id='activeListContainer'], [data-automation-id*='promptOption' i], .select2-results, .pac-container, [class*='select__menu' i], [class*='dropdown-menu' i], [class*='autocomplete' i], [class*='suggestions' i]";
  const hasSubmenu = (o) => o.getAttribute("aria-haspopup") === "true" || o.getAttribute("aria-expanded") === "false" || Boolean(o.querySelector("[data-automation-id='promptIcon'], [data-automation-id*='chevron' i], [class*='chevron' i], [class*='arrow-right' i]")) && !o.querySelector("input[type='radio'], input[type='checkbox']");
  const visibleOptions = () => {
    const seen = new Set();
    const out = [];
    for (const o of qsa(OPTION_SEL)) {
      if (!visible(o) || seen.has(o)) continue;
      if ([...seen].some((s) => s.contains(o))) continue; // nested element of an option already taken
      const t = optionText(o);
      if (!t || t.length > 140 || /^(no (options|results|matches)|loading|searching|type to search)/i.test(t)) continue;
      seen.add(o);
      out.push(o);
    }
    return out.slice(0, 120);
  };

  /** Everything a person could act on, numbered. */
  function snapshot() {
    for (const el of qsa("[data-vp]")) el.removeAttribute("data-vp");
    items = [];
    const groups = new Set();
    const add = (el, item) => {
      const i = items.length;
      tagEl(el, i);
      items.push({ i, ...item });
      return i;
    };
    const controls = qsa("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='spinbutton'], [role='searchbox'], [role='radio'], [role='checkbox'], [role='switch'], button, [role='button'], a[href], [aria-haspopup='listbox'], [data-automation-id='promptOption']");
    for (const el of controls) {
      if (el.closest("[data-vp-skip]")) continue;
      const tagName = el.tagName;
      const type = tagName === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase() : "";
      const isFile = type === "file";
      if (["hidden", "image", "reset"].includes(type)) continue;
      if (!isFile && !visible(el) && !(["radio", "checkbox"].includes(type) && el.closest("label") && visible(el.closest("label")))) continue;
      if (chrome(el) || (!isFile && trap(el))) continue;
      if (el.matches(OPTION_SEL) || el.closest(OPTION_SEL)) continue; // options are listed separately
      if (el.disabled && !isFile) continue;
      const label = labelOf(el);

      if (type === "radio" || el.getAttribute("role") === "radio") {
        const name = el.name || el.closest("[role='radiogroup']")?.id || "";
        const gkey = `r:${name}:${el.closest("fieldset, [role='radiogroup']") ? "" : sectionOf(el)}`;
        if (name && groups.has(gkey)) continue;
        groups.add(gkey);
        const box = el.closest("fieldset, [role='radiogroup']") || fieldBox(el);
        const radios = name ? [...rootOf(el).querySelectorAll(`input[type='radio'][name="${CSS.escape(name)}"]`)] : box ? [...box.querySelectorAll("input[type='radio'], [role='radio']")] : [el];
        const q = clean(text(box?.querySelector("legend, [class*='label' i], label:not(:has(input))")) || containerLabel(box || el) || el.getAttribute("aria-label") || name);
        const opts = radios.map((r) => labelOf(r) || r.value);
        const on = radios.find((r) => r.checked || r.getAttribute("aria-checked") === "true");
        add(radios[0] || el, { kind: "radio", label: q, options: opts, value: on ? labelOf(on) || on.value : "", required: radios.some((r) => r.required) || /\*/.test(q), section: sectionOf(el), error: errorOf(el) });
        continue;
      }
      if (type === "checkbox" || ["checkbox", "switch"].includes(el.getAttribute("role") || "")) {
        const name = el.name;
        const group = name ? [...rootOf(el).querySelectorAll(`input[type='checkbox'][name="${CSS.escape(name)}"]`)] : [];
        if (group.length >= 2) {
          if (groups.has(`c:${name}`)) continue;
          groups.add(`c:${name}`);
          const box = el.closest("fieldset, [role='group']") || el.parentElement?.parentElement || el;
          const q = (box.tagName === "FIELDSET" && text(box.querySelector("legend"))) || containerLabel(box) || name;
          add(el, { kind: "checkboxes", label: q, options: group.map((c) => labelOf(c) || c.value), value: group.filter((c) => c.checked).map((c) => labelOf(c) || c.value).join("; "), required: group.some((c) => c.required) || /\*/.test(q), section: sectionOf(el), error: errorOf(el) });
          continue;
        }
        const checked = el.checked ?? el.getAttribute("aria-checked") === "true";
        add(el, { kind: "checkbox", label: label || containerLabel(el), value: checked ? "checked" : "unchecked", required: isRequired(el, label), section: sectionOf(el), error: errorOf(el) });
        continue;
      }
      if (isFile) {
        const box = el.closest("[data-automation-id*='attachment' i], [data-automation-id*='file' i], [class*='upload' i], [class*='drop' i], [class*='file' i], fieldset, section") || el.parentElement;
        const shown = box ? [...box.querySelectorAll("[data-automation-id*='file-upload-item' i], [data-automation-id*='fileName' i], [class*='file-name' i], [class*='filename' i], [class*='attachment' i] a, [class*='chip' i]")].map(text).filter((t) => /\.\w{2,4}\b/.test(t)).join(", ") : "";
        const l = label || (box && text(box).slice(0, 120)) || "File upload";
        add(el, { kind: "file", label: l, value: shown || (el.files?.length ? [...el.files].map((f) => f.name).join(", ") : ""), required: isRequired(el, l), section: sectionOf(el), error: errorOf(el), accept: el.getAttribute("accept") || "" });
        continue;
      }
      if (tagName === "SELECT") {
        const opts = [...el.options].map((o) => clean(o.textContent)).filter(Boolean).slice(0, 300);
        const cur = el.selectedIndex >= 0 ? clean(el.options[el.selectedIndex]?.textContent) : "";
        add(el, { kind: "select", label, options: opts, value: /^(select|choose|--|please select)/i.test(cur) ? "" : cur, required: isRequired(el, label), section: sectionOf(el), error: errorOf(el) });
        continue;
      }
      const role = el.getAttribute("role") || "";
      const popup = el.getAttribute("aria-haspopup");
      const isCombo = role === "combobox" || popup === "listbox" || (tagName === "BUTTON" && popup && popup !== "false" && popup !== "menu" && popup !== "dialog") || el.getAttribute("data-automation-id") === "searchBox" && el.closest("[data-automation-id='multiselectInputContainer']");
      if (isCombo) {
        // The chosen value: button text, a react-select single value, or Workday's selected pills.
        const box = el.closest("[data-automation-id^='formField'], [class*='select__control' i], [class*='-control'], [data-automation-id='multiselectInputContainer']") || el.parentElement?.parentElement;
        const pills = box ? [...box.querySelectorAll("[data-automation-id='selectedItem'], [class*='multi-value__label' i], [class*='single-value' i], [class*='singleValue' i]")].map(text).filter(Boolean) : [];
        const cur = pills.length ? pills.join("; ") : tagName === "BUTTON" || role === "button" ? text(el) : clean(el.value || el.textContent);
        const l = label && !/^select one$/i.test(label) ? label : containerLabel(el) || label;
        add(el, { kind: "combobox", label: l, value: /^(select one|select|choose|choose one|select\.\.\.|search|please select|--)$/i.test(cur) ? "" : cur, required: isRequired(el, l), section: sectionOf(el), error: errorOf(el), expanded: el.getAttribute("aria-expanded") === "true" || undefined });
        continue;
      }
      if (tagName === "TEXTAREA" || tagName === "INPUT" || el.isContentEditable || ["textbox", "spinbutton", "searchbox"].includes(role)) {
        if (type === "password") {
          add(el, { kind: "password", label, value: el.value ? "(filled)" : "", required: true, section: sectionOf(el) });
          continue;
        }
        if (["submit", "button"].includes(type)) {
          const t = clean(el.value || label);
          if (t) add(el, { kind: "button", label: t, final: FINAL.test(t) || undefined });
          continue;
        }
        const k = tagName === "TEXTAREA" || el.isContentEditable ? "textarea" : role === "spinbutton" ? "number" : ["email", "tel", "url", "number", "date", "month"].includes(type) ? type : "text";
        const l = label || el.getAttribute("data-automation-id") || el.name || "";
        add(el, { kind: k, label: l, value: clean(el.isContentEditable ? el.innerText : el.value).slice(0, 400), required: isRequired(el, l), section: sectionOf(el), error: errorOf(el), placeholder: el.placeholder || undefined, max: el.maxLength > 0 ? el.maxLength : undefined, otp: el.autocomplete === "one-time-code" || undefined });
        continue;
      }
      // Buttons and links.
      const t = clean(text(el) || el.getAttribute("aria-label") || el.title).slice(0, 80);
      if (!t) continue;
      if (tagName === "A" && !el.closest("form, main, [role='main'], [role='dialog'], [data-automation-id*='applyFlow'], [data-automation-id*='Page']") && items.length > 60) continue;
      add(el, { kind: tagName === "A" ? "link" : "button", label: t, final: FINAL.test(t) || undefined, pressed: el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true" || undefined, section: sectionOf(el) || undefined });
    }

    // Options of any open dropdown, with which control opened them.
    const opts = visibleOptions();
    let owner = null;
    if (opts.length) {
      const list = opts[0].closest(LIST_SEL);
      const lid = list?.id;
      const ctl = lid ? qsa(`[aria-controls~="${CSS.escape(lid)}"], [aria-owns~="${CSS.escape(lid)}"]`)[0] : null;
      const ownerEl = ctl || lastOpened;
      owner = ownerEl && ownerEl.getAttribute("data-vp") !== null ? Number(ownerEl.getAttribute("data-vp")) : null;
      for (const o of opts) {
        const sel = o.getAttribute("aria-selected") === "true" || o.getAttribute("aria-checked") === "true" || Boolean(o.querySelector("input:checked"));
        add(o, { kind: "option", label: optionText(o), of: owner ?? undefined, selected: sel || undefined, more: hasSubmenu(o) || undefined });
      }
    }

    const errors = [...new Set(qsa("[role='alert'], [data-automation-id='errorMessage'], [data-automation-id*='errorBanner' i], [class*='error-summary' i], [class*='errorSummary' i], [data-automation-id='inlineErrorText']").filter(visible).map(text).filter((t) => t && t.length < 400))].slice(0, 8);
    const progress = clean(text(qsa("[data-automation-id='progressBar'], [aria-label*='progress' i], [class*='progress' i] ol, [class*='stepper' i]").find(visible))).slice(0, 200);
    const current = clean(text(qsa("[aria-current='step'], [data-automation-id='progressBarActiveStep']").find(visible))).slice(0, 80);
    const heads = [...new Set(qsa("h1, h2, h3").filter((h) => visible(h) && !chrome(h)).map(text).filter(Boolean))].slice(0, 6);
    const dialog = qsa("[role='dialog'], [aria-modal='true']").find(visible);
    const main = document.querySelector("main, [role='main'], form") || document.body;
    return {
      v: VERSION,
      url: location.href,
      title: document.title.slice(0, 120),
      headings: heads,
      step: current || undefined,
      progress: progress || undefined,
      dialog: dialog ? text(dialog).slice(0, 300) : undefined,
      errors,
      excerpt: clean(main.innerText).slice(0, 900),
      items,
    };
  }

  /* ---------- acting ---------- */
  const find = (i) => qsa(`[data-vp="${i}"]`)[0] || null;
  function fire(el, type, init = {}) {
    const C = type.startsWith("pointer") ? (window.PointerEvent || MouseEvent) : type.startsWith("key") ? KeyboardEvent : type === "input" || type === "beforeinput" ? (window.InputEvent || Event) : type.startsWith("mouse") || type === "click" ? MouseEvent : type.startsWith("focus") || type === "blur" ? FocusEvent : Event;
    el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, composed: true, view: window, ...init }));
  }
  async function press(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(60);
    const r = el.getBoundingClientRect();
    const xy = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    fire(el, "pointerover", xy); fire(el, "mouseover", xy);
    fire(el, "pointerdown", { ...xy, pointerType: "mouse", isPrimary: true }); fire(el, "mousedown", xy);
    if (el.focus) el.focus({ preventScroll: true });
    fire(el, "pointerup", { ...xy, pointerType: "mouse", isPrimary: true }); fire(el, "mouseup", xy);
    el.click();
  }
  const setterFor = (el) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, "value")?.set;
  };
  function setValue(el, v) {
    const s = setterFor(el);
    if (s) s.call(el, v); else el.value = v;
  }
  async function typeText(el, value, { perChar = true, blur = true } = {}) {
    const v = String(value ?? "");
    el.scrollIntoView({ block: "center" });
    if (el.focus) el.focus();
    fire(el, "focusin");
    if (el.isContentEditable) {
      el.innerText = v;
      fire(el, "input", { inputType: "insertText", data: v });
    } else {
      if (el.select) try { el.select(); } catch { /* not selectable */ }
      setValue(el, "");
      fire(el, "input", { inputType: "deleteContentBackward" });
      if (perChar && v.length <= 80) {
        for (const ch of v) {
          fire(el, "keydown", { key: ch });
          fire(el, "beforeinput", { inputType: "insertText", data: ch });
          setValue(el, el.value + ch);
          fire(el, "input", { inputType: "insertText", data: ch });
          fire(el, "keyup", { key: ch });
          await sleep(12);
        }
      } else {
        setValue(el, v);
        fire(el, "input", { inputType: "insertText", data: v });
      }
      fire(el, "change");
    }
    if (blur) { fire(el, "focusout"); fire(el, "blur"); if (el.blur) el.blur(); }
  }
  function key(el, k) {
    const t = el || document.activeElement || document.body;
    const code = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[k] || 0;
    fire(t, "keydown", { key: k, code: k, keyCode: code, which: code });
    fire(t, "keypress", { key: k, code: k, keyCode: code, which: code });
    fire(t, "keyup", { key: k, code: k, keyCode: code, which: code });
  }

  // How well an option's text matches the answer (1 = same).
  function score(opt, want) {
    const o = norm(opt), w = norm(want);
    if (!o || !w) return 0;
    if (o === w) return 1;
    if (o.startsWith(w) || w.startsWith(o) && o.length > 3) return 0.92;
    if (o.includes(w)) return 0.85;
    if (w.includes(o) && o.length > 3) return 0.8;
    const ot = new Set(o.split(" ")), wt = w.split(" ");
    const hit = wt.filter((t) => ot.has(t)).length;
    return hit ? 0.7 * hit / Math.max(wt.length, ot.size) : 0;
  }
  const best = (opts, want, min = 0.5) => {
    let top = null;
    for (const o of opts) {
      const s = score(optionText(o), want);
      if (s >= min && (!top || s > top.s)) top = { o, s };
    }
    return top?.o || null;
  };

  function listFor(el) {
    for (const attr of ["aria-controls", "aria-owns"]) {
      const id = el.getAttribute(attr);
      if (id) {
        const l = byId(el, id.split(/\s+/)[0]);
        if (l && visible(l)) return l;
      }
    }
    return null;
  }
  async function waitOptions(ms = 1500) {
    const end = Date.now() + ms;
    let opts = visibleOptions();
    while (!opts.length && Date.now() < end) { await sleep(120); opts = visibleOptions(); }
    await sleep(150);
    return visibleOptions();
  }
  const searchBoxIn = (scope) => [...(scope || document).querySelectorAll("input[data-automation-id='searchBox'], input[type='search'], input[placeholder*='search' i], input[aria-autocomplete]")].find(visible);

  /** Pick an answer from a dropdown, type-ahead or nested list ("Job Board > LinkedIn"). */
  async function choose(el, value) {
    const path = String(value).split(/\s*>\s*/).filter(Boolean);
    const want = path[path.length - 1];
    lastOpened = el;
    const typeable = (el.tagName === "INPUT" || el.getAttribute("role") === "combobox" && el.tagName === "INPUT") && !el.readOnly;
    let opts = [];
    if (!(el.getAttribute("aria-expanded") === "true" && visibleOptions().length)) {
      await press(el);
      opts = await waitOptions(typeable ? 400 : 1500);
    } else opts = visibleOptions();
    // Type to search when we can: in the field itself, or a search box inside the opened list.
    const search = typeable ? el : searchBoxIn(listFor(el) || el.closest("[data-automation-id^='formField']") || document);
    const tryPick = async (target) => {
      const list = visibleOptions();
      const o = best(list, target, 0.55);
      if (!o) return null;
      const inner = o.querySelector("input[type='radio'], input[type='checkbox']");
      await press(inner || o);
      await sleep(450);
      return optionText(o);
    };
    let picked = null;
    // Nested lists: walk the given path ("Job Board" then "LinkedIn Jobs").
    for (let k = 0; k < path.length - 1; k++) {
      const cat = best(visibleOptions(), path[k], 0.6);
      if (!cat) break;
      await press(cat);
      await waitOptions(1200);
    }
    picked = await tryPick(want);
    if (!picked && search) {
      for (const q of [...new Set([want, want.split(/[,(]/)[0].trim(), want.split(/\s+/).slice(0, 2).join(" ")])].filter((q) => q.length >= 2).slice(0, 3)) {
        await typeText(search, q, { blur: false });
        await sleep(300);
        if (!typeable) key(search, "Enter");
        await waitOptions(1800);
        picked = await tryPick(want);
        if (picked) break;
      }
    }
    // A category was opened instead of a final answer: look one level down.
    if (picked && visibleOptions().length && path.length === 1) {
      const deeper = best(visibleOptions(), want, 0.75);
      if (deeper && optionText(deeper) !== picked) picked = (await tryPick(want)) || picked;
    }
    const left = visibleOptions().map(optionText).slice(0, 40);
    // Close a list that stays open (multi-selects), so the next field can open its own.
    if (visibleOptions().length) { key(document.activeElement, "Escape"); await sleep(150); }
    if (picked) return { ok: true, chosen: picked };
    return { ok: false, note: left.length ? `no option matched "${want}"` : `the list didn't open or had no options`, options: left };
  }

  async function set(el, item, value) {
    const v = String(value ?? "");
    if (el.tagName === "SELECT") {
      const opts = [...el.options];
      let top = null;
      for (const o of opts) { const s = score(o.textContent, v); if (s >= 0.55 && (!top || s > top.s)) top = { o, s }; }
      if (!top) return { ok: false, note: "no option matched", options: opts.map((o) => clean(o.textContent)).slice(0, 40) };
      el.focus();
      setValue(el, top.o.value);
      fire(el, "input"); fire(el, "change"); fire(el, "blur");
      return { ok: true, chosen: clean(top.o.textContent) };
    }
    if (item?.kind === "radio") {
      const name = el.name;
      const box = el.closest("fieldset, [role='radiogroup']") || fieldBox(el);
      const radios = name ? [...rootOf(el).querySelectorAll(`input[type='radio'][name="${CSS.escape(name)}"]`)] : [...(box || document).querySelectorAll("input[type='radio'], [role='radio']")];
      let top = null;
      for (const r of radios) { const s = Math.max(score(labelOf(r), v), score(r.value, v)); if (s >= 0.55 && (!top || s > top.s)) top = { r, s }; }
      if (!top) return { ok: false, note: "no option matched", options: radios.map((r) => labelOf(r) || r.value) };
      const lab = top.r.id ? rootOf(top.r).querySelector(`label[for="${CSS.escape(top.r.id)}"]`) : top.r.closest("label");
      await press(lab || top.r);
      await sleep(150);
      if (!(top.r.checked || top.r.getAttribute("aria-checked") === "true")) await press(top.r);
      return { ok: Boolean(top.r.checked || top.r.getAttribute("aria-checked") === "true"), chosen: labelOf(top.r) };
    }
    if (item?.kind === "checkbox") {
      const want = /^(true|yes|checked|on|1|agree|i agree)$/i.test(v);
      const isOn = () => (el.checked ?? el.getAttribute("aria-checked") === "true") === true || el.getAttribute("aria-checked") === "true";
      if (isOn() !== want) {
        const lab = el.id ? rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        await press(lab || el);
        await sleep(150);
        if (isOn() !== want) await press(el);
      }
      return { ok: isOn() === want };
    }
    if (item?.kind === "checkboxes") {
      const wants = v.split(/;\s*/).map(norm).filter(Boolean);
      let hit = 0;
      for (const b of rootOf(el).querySelectorAll(`input[type='checkbox'][name="${CSS.escape(el.name || "")}"]`)) {
        const on = wants.some((w) => score(labelOf(b) || b.value, w) >= 0.85);
        if (on !== b.checked) { await press(b); }
        if (on) hit++;
      }
      return { ok: hit > 0 };
    }
    if (item?.kind === "combobox") return choose(el, v);
    await typeText(el, v, { perChar: v.length <= 80 });
    await sleep(120);
    // Type-ahead text boxes (locations, schools) show suggestions: take the matching one.
    const sugg = visibleOptions();
    if (sugg.length && (el.getAttribute("aria-autocomplete") || el.getAttribute("role") === "combobox" || /location|city|school|university|address/i.test(item?.label || ""))) {
      await sleep(600);
      const o = best(visibleOptions(), v, 0.6);
      if (o) { await press(o); await sleep(300); return { ok: true, chosen: optionText(o) }; }
    }
    const now = el.isContentEditable ? el.innerText : el.value;
    return { ok: norm(now) === norm(v) || norm(now).includes(norm(v).slice(0, 20)) || Boolean(now), value: clean(now).slice(0, 120) };
  }

  /** The real file input behind an upload button or drop zone. */
  function fileInputFor(el) {
    if (el.tagName === "INPUT" && el.type === "file") return el;
    let p = el;
    for (let k = 0; k < 7 && p; k++, p = p.parentElement) {
      const f = p.querySelector && p.querySelector("input[type='file']");
      if (f) return f;
    }
    const all = qsa("input[type='file']");
    return all.length === 1 ? all[0] : null;
  }
  async function attach(el, file) {
    const input = fileInputFor(el);
    if (!input) return { ok: false, note: "no file input here" };
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.mimeType || "application/pdf" }));
    input.files = dt.files;
    fire(input, "input"); fire(input, "change");
    // Drop zones that ignore the input also get a drop.
    const zone = input.closest("[data-automation-id*='drop' i], [class*='drop' i]");
    if (zone) { try { fire(zone, "drop", { dataTransfer: dt }); } catch { /* not supported */ } }
    await sleep(1500);
    return { ok: true, chosen: file.name };
  }

  /** Do one action. a = { do, i, value?, key?, file? } */
  async function act(a) {
    try {
      if (a.do === "wait") { await sleep(Math.min(Number(a.ms) || 800, 5000)); return { ok: true }; }
      if (a.do === "key") { key(document.activeElement, a.key || "Enter"); await sleep(250); return { ok: true }; }
      if (a.do === "scroll") { window.scrollBy(0, a.value === "up" ? -600 : 600); await sleep(200); return { ok: true }; }
      const el = find(a.i);
      if (!el) return { ok: false, note: `element ${a.i} is gone — read the page again` };
      const item = items[a.i];
      if (a.do === "click") {
        const t = clean(text(el) || el.value || el.getAttribute("aria-label"));
        if (FINAL.test(t) && !a.allowFinal) return { ok: false, note: "final submit is pressed by the person (or the agent's review step), not here" };
        if (item?.kind === "option") {
          const inner = el.querySelector("input[type='radio'], input[type='checkbox']");
          await press(inner || el);
        } else {
          if (item?.kind === "combobox" || el.getAttribute("aria-haspopup")) lastOpened = el;
          await press(el);
        }
        await sleep(350);
        return { ok: true };
      }
      if (a.do === "fill") return await set(el, item?.kind === "combobox" || item?.kind === "radio" || item?.kind === "select" ? item : { ...item, kind: "text" }, a.value);
      if (a.do === "set") return await set(el, item, a.value);
      if (a.do === "choose") return await choose(el, a.value);
      if (a.do === "clear") { await typeText(el, "", { perChar: false }); return { ok: true }; }
      if (a.do === "upload") {
        if (!a.file) { const input = fileInputFor(el); if (!input) return { ok: false, note: "no file input here" }; input.setAttribute("data-vp-file", "1"); return { ok: true, needFile: true }; }
        return await attach(el, a.file);
      }
      return { ok: false, note: `unknown action ${a.do}` };
    } catch (e) {
      return { ok: false, note: String(e && e.message || e).slice(0, 160) };
    }
  }

  /** Job details on the page, so Vantage can tailor the resume. */
  function info() {
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
    const h1 = clean(document.querySelector("h1, [data-automation-id='jobPostingHeader'], [data-automation-id='jobTitleHeading']")?.innerText);
    const ld = [...document.querySelectorAll("script[type='application/ld+json']")].map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } }).flat().find((x) => x && x["@type"] === "JobPosting");
    return {
      url: location.href,
      title: clean(ld?.title || (h1 && h1.length < 140 ? h1 : "") || meta("og:title") || document.title).replace(/\s*[|–-]\s*(careers?|jobs?).*$/i, ""),
      company: ld?.hiringOrganization?.name || meta("og:site_name") || "",
      location: ld?.jobLocation?.address?.addressLocality || "",
      description: (ld?.description ? ld.description.replace(/<[^>]+>/g, " ") : (document.querySelector("[data-automation-id='jobPostingDescription'], main, article, [class*='description' i]") || document.body).innerText).slice(0, 15000),
    };
  }

  window.__vp = { v: VERSION, snapshot, act, info };
})();
