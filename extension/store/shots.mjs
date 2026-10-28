// Chrome Web Store images: two 1280x800 screenshots and the 440x280 promo tile, rendered from the real popup and a
// sample application page (made-up applicant "Priya Raman" — no real person's data). Run: node extension/store/shots.mjs
import { chromium } from "../../worker/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "../src");
const popupHtml = readFileSync(join(ext, "popup.html"), "utf8");
const popupJs = readFileSync(join(ext, "popup.js"), "utf8");
const icon = `data:image/png;base64,${readFileSync(join(here, "../icons/128.png")).toString("base64")}`;
// A sample application form, styled like a modern careers page for the screenshots.
const FORM_CSS = `<meta charset="utf-8"><style>
  body{font:15px/1.5 Inter,-apple-system,"Segoe UI",sans-serif;color:#1d2433;max-width:640px;margin:0 auto;padding:28px 32px 40px}
  h1{font-size:26px;margin:0 0 4px} h1+*{margin-top:18px}
  label,legend{display:block;font-weight:600;font-size:13.5px;margin:14px 0 6px}
  input[type=text],input[type=email],input[type=tel],input:not([type]),select,textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #cfd5e1;border-radius:8px;padding:9px 11px;font:inherit;background:#fff}
  fieldset{border:0;padding:0;margin:0} input[type=radio],input[type=checkbox]{margin-right:6px}
  button,input[type=submit]{margin-top:18px;background:#1d2433;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-weight:700}
  br{display:none}
</style>`;
const form = readFileSync(join(here, "../../worker/test/fixtures/greenhouse.html"), "utf8").replace("</head>", `${FORM_CSS}</head>`).replace(/<body([^>]*)>/, '<body$1><p style="color:#5b6475;margin:0 0 8px">Acme &middot; Chicago, IL &middot; Full-time</p>');

// The popup, signed in, with the browser APIs it uses stubbed.
const popup = popupHtml.replace('<script src="popup.js"></script>', `<script>
  window.chrome = { runtime: { sendMessage: (m, cb) => cb && cb(m.type === "status" ? { connected: true, me: { name: "Priya Raman" } } : {}) },
    tabs: { query: async () => [{ id: 1, url: "https://job-boards.greenhouse.io/acme/jobs/1" }] } };
</script><script>${popupJs}</script>`);

const frame = (inner, side) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1280px;height:800px;background:#eef1f8;font:15px/1.45 Inter,-apple-system,"Segoe UI",sans-serif;color:#10142a;display:flex;flex-direction:column}
  .bar{height:44px;background:#dfe3ec;display:flex;align-items:center;gap:10px;padding:0 14px}
  .url{flex:1;background:#fff;border-radius:16px;height:28px;display:flex;align-items:center;padding:0 14px;font-size:13px;color:#555}
  .ext{width:28px;height:28px;border-radius:7px;background:#fff;display:grid;place-items:center;box-shadow:0 0 0 2px #2f5beb}
  .main{flex:1;display:flex;overflow:hidden}
  .page{flex:1;overflow:hidden;background:#fff}
  .side{width:360px;padding:18px;box-sizing:border-box}
  .card{background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(16,20,42,.18);overflow:hidden}
  iframe{border:0;width:100%;height:100%}
</style></head><body>
  <div class="bar"><div class="url">job-boards.greenhouse.io/acme/jobs/4012345</div><div class="ext"><img src="${icon}" width="18"></div></div>
  <div class="main"><div class="page">${inner}</div><div class="side">${side}</div></div>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });

// 1) The popup on a job application.
const formUrl = "data:text/html;base64," + Buffer.from(form).toString("base64");
const popupUrl = "data:text/html;base64," + Buffer.from(popup).toString("base64");
await p.setContent(frame(`<iframe src="${formUrl}"></iframe>`, `<div class="card" style="height:600px"><iframe src="${popupUrl}"></iframe></div>`));
await p.waitForTimeout(800);
await p.screenshot({ path: join(here, "screenshot-1-fill-here.png") });

// 2) The form filled, waiting for the person to press Submit.
const filled = form.replace("</body>", `<script>
  const v = { first_name: "Priya", last_name: "Raman", email: "priya.careers@gmail.com", phone: "(312) 555-0142" };
  const labelOf = (i) => (document.querySelector(\`label[for="\${i.id}"]\`)?.textContent || i.closest("label")?.textContent || i.previousSibling?.textContent || i.name || "").toLowerCase();
  for (const i of document.querySelectorAll("input[type=text],input[type=email],input[type=tel],input:not([type])")) {
    const k = labelOf(i) + " " + (i.name || "").toLowerCase();
    i.value = /first/.test(k) ? "Priya" : /last/.test(k) ? "Raman" : /mail/.test(k) ? v.email : /phone/.test(k) ? v.phone : /linkedin/.test(k) ? "linkedin.com/in/priyaraman" : /city|location/.test(k) ? "Chicago, IL" : /hear/.test(k) ? "Company careers site" : i.value;
    if (i.value) i.style.background = "#eef6ff";
  }
  for (const i of document.querySelectorAll("[aria-labelledby=loc-label], #loc-label ~ input, #loc-label + * input")) { i.value = "Chicago, IL"; i.style.background = "#eef6ff"; }
  for (const f of document.querySelectorAll("input[type=file]")) {
    const isCover = /cover/i.test(labelOf(f) + (f.name || ""));
    const chip = document.createElement("div");
    chip.textContent = (isCover ? "Priya_Raman_Cover_Letter.pdf" : "Priya_Raman_Resume.pdf") + "  ✓ attached";
    chip.style.cssText = "display:inline-block;background:#eef6ff;border:1px solid #cfd5e1;border-radius:8px;padding:8px 12px;font-weight:600;font-size:13.5px";
    f.replaceWith(chip);
  }
  for (const t of document.querySelectorAll("textarea")) { t.value = "I've spent four years turning product launches into pipeline at B2B software companies, most recently leading an ABM program across 100+ accounts."; t.style.background = "#eef6ff"; }
  for (const s of document.querySelectorAll("select")) {
    const opts = [...s.options];
    const pick = opts.find((o) => /decline|don.t wish|prefer not/i.test(o.text)) || opts.find((o) => /^yes$/i.test(o.text.trim())) || opts[1];
    if (pick) { s.value = pick.value; s.style.background = "#eef6ff"; }
  }
  const vet = [...document.querySelectorAll("input[type=radio]")].find((r) => /wish|decline/i.test(r.parentElement?.textContent || "") || /wish|decline/i.test(r.value));
  if (vet) vet.checked = true;
</script></body>`);
const statusCard = `<div class="card" style="padding:18px">
  <div style="display:flex;gap:10px;align-items:center;font-weight:700"><img src="${icon}" width="26" style="border-radius:7px"> Vantage</div>
  <p style="margin:14px 0 4px;font-weight:700;font-size:17px">Filled — check it, then Submit</p>
  <p style="margin:0;color:#5b6475;font-size:13.5px">Tailored resume and cover letter attached. 14 answers from your profile and saved answers. Nothing is sent until you press Submit.</p>
  <div style="margin-top:14px;display:grid;gap:8px;font-size:13.5px">
    <div>✓ Resume: <b>Priya_Raman_Resume.pdf</b> (tailored)</div><div>✓ Cover letter attached</div><div>✓ Work authorization: your own answer</div><div>✓ Voluntary questions: your choice, never shown to AI</div>
  </div>
  <div style="margin-top:16px;background:#2f5beb;color:#fff;border-radius:10px;padding:11px;text-align:center;font-weight:700">You press Submit</div>
</div>`;
await p.setContent(frame(`<iframe src="data:text/html;base64,${Buffer.from(filled).toString("base64")}"></iframe>`, statusCard));
await p.waitForTimeout(800);
await p.screenshot({ path: join(here, "screenshot-2-filled.png") });

// 3) Promo tile 440x280.
const t = await b.newPage({ viewport: { width: 440, height: 280 } });
await t.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;background:linear-gradient(135deg,#2f5beb,#e0457b);font-family:Inter,-apple-system,'Segoe UI',sans-serif;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box">
  <div style="display:flex;align-items:center;gap:12px;font-weight:800;font-size:26px"><img src="${icon}" width="44" style="border-radius:11px;background:#fff"> Vantage</div>
  <div style="margin-top:16px;font-size:21px;font-weight:700;line-height:1.25">Fill any job application<br>in seconds. You press Submit.</div>
</body></html>`);
await t.screenshot({ path: join(here, "promo-tile-440x280.png") });
await b.close();
console.log("store images written to", here);
