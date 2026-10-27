// Pilot self-test: fills a copy of a Workday application (made-up applicant) with the live pilot and logs what happened.
// Runs only when PILOT_SELFTEST=1 on both the worker and the app. Nothing leaves the worker's browser.
import { readFileSync } from "node:fs";
import { call } from "./api.mjs";
import { pilotPage } from "./pilot.mjs";

// What the made-up applicant answers when asked (as a person would in the panel).
const USER = [[/relative/i, "No"], [/onsite|on-site|in the office/i, "Yes"], [/salary|compensation/i, "$95,000"], [/background check|drug screen/i, "Yes"], [/sponsorship/i, "Yes"], [/authori[sz]ed to work/i, "Yes"], [/notified your (current )?manager/i, "No"]];

export async function selftest(browser, name = "wd-real.html") {
  const html = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://pilot-test.example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  const page = await context.newPage();
  const started = Date.now();
  const answers = {};
  const recorded = {};
  let calls = 0;
  const task = { id: "selftest", pilotHistory: [] };
  const files = { resume: { name: "Priya_Raman_Resume.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4\n% test resume\n").toString("base64") }, cover: null };
  const callT = async (op, body) => { calls++; return call("pilot_test", { ...body, answers }); };
  let outcome = "unfinished";
  try {
    await page.goto("https://pilot-test.example.com/apply");
    for (let step = 0; step < 24; step++) {
      const r = await pilotPage({ page, task, files, call: callT, log: async (s) => console.log("[selftest] say:", s), record: (it, v) => { recorded[`${it.section || ""} | ${it.label}`] = v; }, maxTurns: 24 });
      const st = await page.evaluate(() => window.__state?.page).catch(() => "?");
      console.log("[selftest] page", st, "→", r.status, r.say || "", r.ask ? JSON.stringify(r.ask.map((q) => q.label)) : "");
      if (r.status === "ask") {
        let any = false;
        for (const q of r.ask) {
          const hit = USER.find(([re]) => re.test(q.label));
          console.log("[selftest] asked:", q.label, q.locked ? "(locked)" : "", "→", hit ? hit[1] : "(no answer)");
          if (hit) { answers[q.label] = hit[1]; any = true; }
        }
        if (!any) { outcome = "asked something the test can't answer"; break; }
        continue;
      }
      if (r.status === "ready") {
        await r.frame.evaluate((i) => window.__vp.act({ do: "click", i, allowFinal: true }), r.submit);
        await page.waitForTimeout(1500);
        outcome = "submitted";
        break;
      }
      if (r.status !== "advanced") { outcome = `${r.status}: ${r.say || ""}`; break; }
    }
  } catch (e) {
    outcome = `error: ${e.message}`;
  }
  const state = await page.evaluate(() => window.__state).catch(() => ({}));
  const secs = Math.round((Date.now() - started) / 1000);
  console.log("[selftest] RESULT", JSON.stringify({ outcome, submitted: state.submitted, page: state.page, trap: state.trapped || null, secs, aiCalls: calls }));
  console.log("[selftest] VALUES", JSON.stringify(state.values));
  console.log("[selftest] FILES", JSON.stringify(state.files), "work", state.work?.length, "edu", state.edu?.length);
  for (const h of task.pilotHistory) console.log("[selftest] turn", h.say, "|", h.actions.map((a, k) => `${a.do}${a.i ?? ""}${h.results[k]?.ok ? "" : "✗" + (h.results[k]?.note || "")}`).join(" "));
  await context.close().catch(() => {});
  return { outcome, state };
}
