// Vantage Pilot — cloud driver. Reads the page (pilot/page.js), asks the app's pilot brain what to do, does it with
// the page's own controls, checks the result, and repeats until the page moves on, needs the person, or is ready to submit.
import { readFileSync } from "node:fs";

const PAGE_JS = readFileSync(new URL("./pilot/page.js", import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELD = new Set(["text", "email", "tel", "url", "number", "date", "month", "textarea", "select", "combobox", "radio", "checkbox", "checkboxes", "file"]);
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);

async function ensure(frame) {
  const ok = await frame.evaluate(() => Boolean(window.__vp && window.__vp.v >= 7)).catch(() => false);
  if (!ok) await frame.evaluate(PAGE_JS).catch(() => {});
}

/** The frame holding the form: the main page, or an embedded application (Greenhouse/iCIMS iframes). */
export async function readPage(page) {
  let bestFrame = page.mainFrame();
  let best = null;
  let bestCount = -1;
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (!frame.url() || frame.url() === "about:blank")) continue;
    await ensure(frame);
    const snap = await frame.evaluate(() => window.__vp?.snapshot()).catch(() => null);
    if (!snap) continue;
    const n = snap.items.filter((x) => FIELD.has(x.kind)).length + (frame === page.mainFrame() ? 0.5 : 0);
    if (n > bestCount) { bestCount = n; best = snap; bestFrame = frame; }
  }
  if (best) {
    // A stable key per question (section + label + which occurrence), used to replay answers the person approved.
    const seen = new Map();
    for (const it of best.items) {
      if (!FIELD.has(it.kind)) continue;
      const base = norm(`${it.section ? `${it.section} | ` : ""}${it.label}`);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      it.rk = `${base}#${n}`;
    }
  }
  return { frame: bestFrame, snap: best };
}

const sig = (snap) => JSON.stringify([snap.url, snap.items.map((i) => [i.kind, i.label, i.value]), snap.errors]).slice(0, 20000);

/**
 * Work through the current page. Returns:
 *  { status: "advanced" }                        the page moved on (Next was pressed)
 *  { status: "ready", frame, submit }            only the final Submit is left (data-vp index in frame)
 *  { status: "account" | "done" | "captcha" }    handled by the caller
 *  { status: "ask", ask }                        questions only the person can answer
 *  { status: "stuck", say }
 */
export async function pilotPage({ page, task, files, call, log, record, maxTurns = 8 }) {
  task.pilotHistory ||= [];
  let lastSig = "";
  let same = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    const { frame, snap } = await readPage(page);
    if (!snap) return { status: "stuck", say: "Couldn't read this page" };
    const s = sig(snap);
    same = s === lastSig ? same + 1 : 0;
    lastSig = s;
    if (same >= 2) return { status: "stuck", say: "The page isn't changing — the form may need something the agent can't do" };

    const plan = await call("pilot", { taskId: task.id, snapshot: snap, history: task.pilotHistory.slice(-4) });
    if (!plan || plan.error) return { status: "stuck", say: plan?.error || "The pilot didn't answer" };
    if (plan.say) await log(plan.say);
    if (process.env.AGENT_DEBUG) console.log("[pilot]", plan.status, plan.say, JSON.stringify(plan.actions).slice(0, 800), plan.notes || "");

    const results = [];
    const startUrl = page.url();
    for (const a of plan.actions || []) {
      let r;
      if (a.do === "upload") {
        r = await frame.evaluate((x) => window.__vp?.act(x), { do: "upload", i: a.i }).catch((e) => ({ ok: false, note: e.message }));
        if (r?.needFile) {
          const f = a.file === "cover_letter" ? files.cover : files.resume;
          if (!f) r = { ok: false, note: "no file" };
          else {
            const input = frame.locator("[data-vp-file='1']").first();
            r = await input.setInputFiles({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.base64, "base64") }).then(() => ({ ok: true, chosen: f.name }), (e) => ({ ok: false, note: e.message.slice(0, 120) }));
            await frame.evaluate(() => document.querySelectorAll("[data-vp-file]").forEach((n) => n.removeAttribute("data-vp-file"))).catch(() => {});
            await sleep(2000); // résumé parsers (Workday, Lever) fill fields from the file
          }
        }
      } else {
        r = await frame.evaluate((x) => window.__vp?.act(x), a).catch((e) => ({ ok: false, note: /detached|destroyed|navigat/i.test(e.message) ? "page changed" : e.message.slice(0, 120) }));
      }
      r ||= { ok: false, note: "no result" };
      results.push(r);
      if (r.ok && record) {
        const it = snap.items.find((x) => x.i === a.i);
        const owner = it?.kind === "option" ? snap.items.find((x) => x.i === it.of) : it;
        if (owner && FIELD.has(owner.kind)) {
          const value = a.do === "upload" ? `${a.file === "cover_letter" ? "Cover letter" : "Resume"} attached` : it.kind === "option" ? it.label : r.chosen || a.value;
          if (value) record(owner, String(value), a.do === "upload");
        }
      }
      if (r.note === "page changed" || page.url() !== startUrl) break;
      await sleep(a.do === "click" ? 450 : 120);
    }
    task.pilotHistory.push({ say: plan.say, actions: plan.actions, results, url: snap.url });
    if (task.pilotHistory.length > 12) task.pilotHistory.shift();

    if (plan.status === "ready") return { status: "ready", frame, submit: plan.submit, say: plan.say };
    if (plan.status === "account") return { status: "account" };
    if (plan.status === "done") return { status: "done" };
    if (plan.status === "ask") return { status: "ask", ask: plan.ask || [] };
    if (plan.status === "stuck") return { status: "stuck", say: plan.say };
    if (plan.status === "next" || page.url() !== startUrl) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await sleep(1600);
      return { status: "advanced" };
    }
    await sleep(500);
  }
  return { status: "stuck", say: "Spent too long on one page" };
}
