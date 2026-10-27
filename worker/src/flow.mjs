import { call, log, update } from "./api.mjs";
import { ACCOUNT_GATE, codeChallenge, declineCookies, enterCode, extractFields, findAccountButton, findVerify, isCodeField, fillField, findEntry, findNext, findSubmit, human, humanCheckVisible, isConfirmation, pageText, readComboOptions, visibleErrors } from "./forms.mjs";
import { live } from "./live.mjs";
import { allowedUrl, baseDomain } from "./guard.mjs";
import { BOT_WALL, CHALLENGE, NO_AUTOMATION, siteKey } from "./sites.mjs";
import { pilotPage } from "./pilot.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TASK_BUDGET_MS = 9 * 60 * 1000; // active work, excluding time spent waiting for the user
const HARD_CAP_MS = 25 * 60 * 1000; // everything included

/**
 * Kill switch. If an employer's site refuses the visitor (403/429/451 or a block page) or its form says automated
 * applications aren't allowed, Vantage stops applying there for everyone and hands the job to the person.
 */
async function stopIfRefused(bundle, page, text, fields = []) {
  const { task } = bundle;
  // A human check (CAPTCHA, "press & hold", "just a moment") goes to the person — it is never recorded as a block.
  if (CHALLENGE.test(text.slice(0, 3000)) || (await humanCheckVisible(page))) return;
  // Only the status of the page we're actually on counts (not one left over from an earlier navigation).
  const status = bundle.statusUrl === page.url().split("#")[0] ? bundle.lastStatus || 0 : 0;
  let reason = null;
  if ([401, 403, 429, 451].includes(status) && (BOT_WALL.test(text) || text.length < 4000)) reason = status === 429 ? "rate_limited" : "blocked";
  else if (text.length < 2500 && BOT_WALL.test(text)) reason = "blocked";
  else {
    // "No automation" only counts on an application form: in the form's own questions, or the text of a form page.
    const labels = fields.map((f) => f.label || "").join("\n");
    const formPage = fields.filter((f) => !["hidden", "password"].includes(f.type)).length >= 2;
    if (NO_AUTOMATION.test(labels) || (formPage && NO_AUTOMATION.test(text))) reason = "no_automation";
  }
  if (!reason) return;
  // Recorded under the page we landed on and the job's own link (sites redirect), and only when the employer is known.
  const keys = [...new Set([siteKey(page.url()), siteKey(task.url)].filter(Boolean))];
  if (keys.length) await call("block", { taskId: task.id, keys, reason, status, url: page.url().slice(0, 300), snippet: text.slice(0, 400) }).catch((e) => console.error("block report failed", e.message));
  const why = reason === "no_automation" ? "asks applicants not to use automated tools" : reason === "rate_limited" ? "is limiting automated visits right now" : "refused automated access";
  throw new Stop("manual", `${task.job.company}'s careers site ${why}, so Vantage has stopped applying there. Open the job link to apply yourself — the Vantage Chrome extension can fill the form while you press Submit.`, { final: true });
}

// Buttons that send the application even when they aren't labelled "Submit".
const FINAL_NEXT = /\b(apply|submit|send|finish|complete|confirm)\b/i;

/** What the person saw in the review step, keyed the same way on the next run. */
const normLabel = (l) => String(l || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);

class Stop extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Apply to one job. Everything the user would type comes from the app (their facts, saved answers, tailored files).
 * Stops and asks the user only for: answers we don't know yet, a code when no mailbox is connected, or a human check.
 */
export async function runTask(bundle, browser) {
  const { task, files, identity } = bundle;
  const started = Date.now();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: process.env.TZ_DEFAULT || "America/Chicago",
    userAgent: process.env.BROWSER_UA || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (["media", "font"].includes(req.resourceType())) return route.abort();
    if (!(await allowedUrl(req.url()))) return route.abort("blockedbyclient");
    return route.continue();
  });
  let page = await context.newPage();
  // "Finish in Vantage": the person watches in the app, can take control at any time, and approves the final Submit.
  bundle.interactive = Boolean(task.userInput?.interactive) && task.mode !== "dry_run";
  const onChooser = (fc) => live.chooser(task.id, fc);
  page.on("filechooser", onChooser);
  context.on("page", (p) => {
    page = p; // follow "Apply" links that open a new tab
    p.on("filechooser", onChooser);
  });
  live.attach(task.id, () => page, { interactive: bundle.interactive });
  const filled = {};
  bundle.filledRef = filled;
  const seen = new Set();
  const clock = { started, waited: 0 };
  bundle.clock = clock;
  // Test mode: fill everything, never create accounts, never submit. Used to check real careers sites safely.
  bundle.dry = task.mode === "dry_run";
  bundle.dryMissing = [];
  // After the person approved the review, the same answers are used again, matched by question and position.
  bundle.reviewed = task.userInput?.review_ok && task.userInput?.reviewed && typeof task.userInput.reviewed === "object" ? task.userInput.reviewed : null;
  // Status of the latest top-level page load (also after clicks), so a block page is recognised wherever it appears.
  context.on("response", (r) => {
    try {
      if (r.request().isNavigationRequest() && !r.frame().parentFrame()) {
        bundle.lastStatus = r.status();
        bundle.statusUrl = r.url().split("#")[0];
      }
    } catch {}
  });
  const goto = async (url) => {
    if (!(await allowedUrl(url))) throw new Stop("failed", "This link isn't a public web page, so your agent won't open it.");
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (resp) {
      bundle.lastStatus = resp.status();
      bundle.statusUrl = resp.url().split("#")[0];
    }
  };
  bundle.goto = goto;

  try {
    await log(task.id, `Opening ${task.job.company}'s application`, "Opening the application");
    await goto(task.url);
    await settle(page);
    if (await declineCookies(page)) await settle(page, 600);

    // The pilot reads each page like a person and works through it (any careers site, any widget). If the AI isn't
    // reachable it falls back to the rule-based filler below.
    bundle.pilot = process.env.PILOT !== "0";
    // In the in-app browser a step the agent can't do goes to the person (who is watching) instead of ending the run.
    for (let round = 0; ; round++) {
    try {
    for (let step = 0; step < (bundle.pilot ? 36 : 14); step++) {
      await holdIfYou(bundle, page);
      if (Date.now() - started - clock.waited > TASK_BUDGET_MS || Date.now() - started > (bundle.interactive ? 60 * 60 * 1000 : HARD_CAP_MS)) throw new Stop("failed", "Took too long on this site. You can finish it yourself from the job link.");
      // A new visit to a page (even one seen earlier in this run, like a sign-in page) is filled afresh.
      if (page.url() !== bundle.lastUrl) {
        bundle.visit = (bundle.visit || 0) + 1;
        bundle.lastUrl = page.url();
      }
      const text = await pageText(page);
      if (isConfirmation(page.url(), text)) {
        // A "thanks for applying" page counts only after this run pressed Submit; before that it means the site
        // thinks you already applied (or it's boilerplate) — never record it as an application by the agent.
        if (bundle.submitPressed) break;
        throw new Stop("manual", "The site already shows an application-received page before anything was submitted — you may have applied before. Check Applications and your job email; nothing was sent this time.", { final: true });
      }

      if (await humanCheckVisible(page)) {
        if (bundle.dry) throw new Stop("manual", "Dry run: the site showed a human check");
        await waitForHuman(task, page, clock);
        await settle(page);
        continue;
      }

      const fields = await extractFields(page);
      await stopIfRefused(bundle, page, text, fields);
      if (process.env.AGENT_DEBUG) console.log("[step]", step, page.url(), fields.map((f) => `${f.type}:${(f.label || "").slice(0, 30)}`).join(" | "));
      // The site emailed a code (Greenhouse's "security code" after Submit): read it from the inbox and enter it.
      const challenge = await codeChallenge(page, fields);
      if (challenge) {
        if (bundle.dry) throw new Stop("manual", "Dry run: the site asked for an emailed security code", { needs: await diagnose(page, bundle) });
        const forAccount = /account|sign ?up|register|verify your email|confirm your email/i.test(text) && !/application/i.test(text.slice(0, 600));
        // A verified account is a step on the way, never the end of the application.
        if (await passCode(bundle, page, challenge, forAccount ? "account" : "application")) {
          if (forAccount || !bundle.submitPressed) continue;
          break;
        }
        continue;
      }
      const formish = fields.filter((f) => !["password"].includes(f.type));
      const passwords = fields.filter((f) => f.type === "password");

      // 0) "Enter your password" with a box we can't read (built inside a closed web component).
      if (!passwords.length && !formish.length && !bundle.dry && (await blindPassword(bundle, page, text))) continue;

      // 1) Account wall: sign in or create an account with the job email and a vault password.
      if (passwords.length) {
        if (bundle.dry) throw new Stop("manual", "Dry run: stopped at the careers-site account page", { needs: await diagnose(page, bundle) });
        await handleAccount(bundle, page, fields, passwords);
        continue;
      }

      // 2a) Account gate with no form yet ("Looks like you're new here — Proceed to create account").
      if (formish.filter((f) => f.type !== "checkbox").length === 0 && ACCOUNT_GATE.test(text) && (bundle.gates || 0) < 4) {
        const haveLogin = Boolean(bundle.credential?.password);
        const b = await findAccountButton(page, haveLogin);
        if (b) {
          if (bundle.dry) throw new Stop("manual", "Dry run: stopped at the careers-site account page", { needs: await diagnose(page, bundle) });
          bundle.gates = (bundle.gates || 0) + 1;
          const label = ((await b.innerText().catch(() => "")) || "").trim();
          await log(task.id, /guest/i.test(label) ? "Continuing as a guest — no account needed" : haveLogin ? `Signing in to ${task.job.company} careers` : `Creating your ${task.job.company} careers account`, haveLogin ? "Signing in" : "Creating your account");
          await b.click({ timeout: 8000 }).catch(() => b.click({ force: true }).catch(() => {}));
          await settle(page);
          continue;
        }
      }

      let submit = null;
      let next = null;
      let nextText = "";
      let finalStep = false;
      let viaPilot = false;
      if (bundle.pilot) {
        const r = await pilotPage({
          page, task, files, call, log: (s) => log(task.id, s, s),
          record: (it, value, isFile) => {
            const v = it.kind === "checkbox" ? (/^(checked|true|yes|on|agree)/i.test(value) ? "Checked" : "Unchecked") : String(value);
            const rk = it.rk || `${it.section || ""} | ${it.label}`;
            filled[rk] = { label: String(it.label || "").slice(0, 300), value: v.slice(0, 4000), reviewed: Boolean(bundle.reviewed && String(bundle.reviewed[rk] ?? "").trim().toLowerCase() === v.trim().toLowerCase()), info: isFile || undefined };
          },
        }).catch((e) => ({ status: "stuck", say: e.message }));
        if (r.status === "advanced") continue;
        if (r.status === "done") {
          if (bundle.submitPressed) break;
          throw new Stop("manual", "The site looks finished, but your agent never pressed Submit — nothing was sent. Open the job to check.", { final: true });
        }
        if (r.status === "ask") {
          if (bundle.dry) throw new Stop("manual", `Dry run: the form needs ${r.ask.length} answer${r.ask.length > 1 ? "s" : ""} only the person can give`, { needs: r.ask });
          throw new Stop("needs_user", `${r.ask.length} question${r.ask.length > 1 ? "s" : ""} only you can answer — answer once and your agent will remember`, { needs: r.ask });
        }
        if (r.status === "account") {
          const again = await extractFields(page);
          const pw = again.filter((f) => f.type === "password");
          if (pw.length) {
            if (bundle.dry) throw new Stop("manual", "Dry run: stopped at the careers-site account page", { needs: await diagnose(page, bundle) });
            await handleAccount(bundle, page, again, pw);
            continue;
          }
        }
        if (r.status === "ready") {
          submit = r.frame.locator(`[data-vp="${r.submit}"]`).first();
          finalStep = true;
          viaPilot = true;
        } else if (r.status === "stuck" || r.status === "account") {
          // Hand this page to the rule-based filler; if that can't move it either, the person finishes it.
          await log(task.id, `Trying another way on this page (${String(r.say || "").slice(0, 80)})`);
          bundle.pilotStuck = (bundle.pilotStuck || 0) + 1;
          if (bundle.pilotStuck > 3) bundle.pilot = false;
        }
      }
      if (!viaPilot) {
        // 2) Landing page with an "Apply" button and no form yet.
        if (formish.filter((f) => f.type !== "checkbox").length < 2) {
          const entry = await findEntry(page);
          if (entry) {
            await log(task.id, "Starting the application", "Starting the application");
            await entry.click({ timeout: 8000 }).catch(() => {});
            await settle(page);
            const manual = await (async () => {
              const b = await findEntry(page);
              const t = b ? (await b.innerText().catch(() => "")).toLowerCase() : "";
              return t.includes("manual") ? b : null;
            })();
            if (manual) {
              await manual.click().catch(() => {});
              await settle(page);
            }
            continue;
          }
        }

        // 3) Fill the form on this page (several passes: answers can reveal follow-up questions).
        await fillPage(bundle, page, filled, seen);

        // 4) Next step or submit.
        submit = await findSubmit(page);
        next = submit ? null : await findNext(page);
        nextText = next ? ((await next.innerText().catch(() => "")) || (await next.getAttribute("value").catch(() => "")) || "").trim() : "";
        finalStep = Boolean(submit) || FINAL_NEXT.test(nextText);
      }
      if (!viaPilot && !submit && !next) {
        if (step > 0 && formish.length === 0) {
          // A "Verify" page whose code box is a custom component we can't read (Amazon A to Z sign-in):
          // take the newest code the site emailed and type it in.
          if (await blindCode(bundle, page)) continue;
          // After signing in or creating an account, sites often land on a dashboard: go back to the job and press Apply.
          if (!bundle.backToJob && page.url().split("#")[0] !== task.url.split("#")[0]) {
            bundle.backToJob = true;
            await log(task.id, "Account ready — going back to the job to apply", "Back to the job");
            await goto(task.url);
            await settle(page);
            continue;
          }
          // Record what the page showed, so the next version of the agent can learn this step.
          const seenText = (text || "").replace(/\s+/g, " ").slice(0, 400);
          const buttons = await page.locator("button:visible, a[role='button']:visible, input[type='submit']:visible").allInnerTexts().catch(() => []);
          await log(task.id, `Stuck on ${new URL(page.url()).host}${new URL(page.url()).pathname.slice(0, 60)} — page says: “${seenText.slice(0, 220)}” · buttons: ${buttons.map((b) => b.trim()).filter(Boolean).slice(0, 8).join(" / ")}`);
          throw new Stop("manual", "This site needs a step the agent can't do. Open the job link to finish.");
        }
        await sleep(1500);
        continue;
      }
      const before = page.url();
      // Dry runs never press a final or intermediate button (an intermediate one can occasionally submit).
      if ((submit || next) && bundle.dry) {
        const shotFull = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true }).catch(() => null);
        const diag = await diagnose(page, bundle);
        await update(task.id, { status: "manual", step: `Dry run: stopped before ${submit ? "submitting" : "the next step"} (${bundle.dryMissing.length} unanswered)`, needs: diag, proof: shotFull ? shotFull.toString("base64") : undefined, log: `Dry run finished on ${page.url().slice(0, 120)}` });
        return "manual";
      }
      // First application on this kind of careers site: stop before Submit so the person can check every answer.
      // Also stops before a final button labelled "Apply", "Send" or "Finish", and again if the form now holds answers
      // the person didn't see (a new question, or one that couldn't be matched to what they approved).
      const changed = Object.values(filled).filter((x) => !x.reviewed && !x.info);
      if (finalStep && !bundle.interactive) {
        // The person may have opened this run in Vantage after it started: then they approve the Submit there.
        const p = await call("poll", { taskId: task.id, checkMail: false, lite: true }).catch(() => ({}));
        if (p.userInput?.interactive) bundle.interactive = true;
      }
      if (finalStep && bundle.interactive) {
        await holdIfYou(bundle, page);
        const who = await submitGate(bundle, page, submit || next);
        if (who === "you") continue; // the person pressed Submit on the page: the loop reads what came next
      }
      if (finalStep && task.review && !bundle.interactive && (!bundle.reviewed || changed.length)) {
        if (bundle.reviewed && (task.userInput?.review_round || 0) >= 3) {
          throw new Stop("manual", "This form kept changing after you reviewed it, so your agent didn't send it. Open the job link to check and submit it yourself.");
        }
        const shotFull = await page.screenshot({ type: "jpeg", quality: 55, fullPage: true }).catch(() => null);
        const review = Object.entries(filled).slice(0, 250).map(([rkey, x], i) => ({ id: `r${i}`, qkey: "", rkey, label: x.label, type: "review", value: x.value, info: x.info || undefined, changed: bundle.reviewed && !x.reviewed && !x.info ? true : undefined }));
        await update(task.id, {
          status: "awaiting_approval",
          step: bundle.reviewed ? "The form asked something new — check it before it's sent" : "Ready for your review — nothing has been sent yet",
          needs: review.length ? review : [{ id: "r0", qkey: "", rkey: "", label: "Application form", type: "review", value: "Filled and ready", info: true }],
          proof: shotFull ? shotFull.toString("base64") : undefined,
          log: bundle.reviewed
            ? `Stopped before sending: ${changed.length} answer${changed.length > 1 ? "s" : ""} on ${task.job.company}'s form weren't in what you approved`
            : `Filled ${task.job.company}'s form and stopped before Submit so you can review your first application on this site`,
        });
        return "awaiting_approval";
      }
      if (finalStep) {
        // Last check: the person may have cancelled while the form was being filled. Then record the moment of the
        // final press, so an interrupted run is never retried (it may already be in the employer's system).
        const last = await call("poll", { taskId: task.id, since: new Date().toISOString(), checkMail: false }).catch(() => ({}));
        if (last.cancelled) throw new Stop("cancelled", "Cancelled");
        await update(task.id, { submitClicked: true, step: "Submitting" });
        bundle.submitPressed = true;
      }
      if (!finalStep) await holdIfYou(bundle, page);
      if (submit) {
        await log(task.id, "Submitting the application", "Submitting");
        await human(600, 1400);
        await submit.click({ timeout: 10_000 }).catch(() => submit.click({ force: true }));
      } else {
        await log(task.id, "Moving to the next step", "Filling the next step");
        await next.click({ timeout: 10_000 }).catch(() => next.click({ force: true }));
      }
      await settle(page, 2500);
      if (await humanCheckVisible(page)) {
        await waitForHuman(task, page, clock);
        await settle(page);
      }
      const after = await pageText(page);
      if (isConfirmation(page.url(), after)) break;
      if (await codeChallenge(page)) continue; // handled at the top of the loop, without closing the page
      if (page.url() === before) {
        const errs = await visibleErrors(page);
        if (errs.length && viaPilot) {
          // The pilot reads the errors on the next pass and fixes them.
          await log(task.id, `The form flagged: ${errs.slice(0, 3).join(" · ")}`);
          if (/captcha|robot|human|verification failed/i.test(errs.join(" "))) await waitForHuman(task, page, clock);
        } else if (errs.length) {
          await log(task.id, `The form flagged: ${errs.slice(0, 3).join(" · ")}`);
          if (/captcha|robot|human|verification failed/i.test(errs.join(" "))) await waitForHuman(task, page, clock);
          // Errors usually mean a required field we couldn't fill; the next pass asks the user for it.
          const missing = await fillPage(bundle, page, filled, seen, true);
          if (bundle.dry && (missing.length || bundle.dryMissing.length)) throw new Stop("manual", `Dry run: the form needs answers before the next step (${errs.slice(0, 2).join(" · ").slice(0, 120)})`, { needs: await diagnose(page, bundle) });
          if (missing.length) throw new Stop("needs_user", "A few questions only you can answer", { needs: missing });
        }
      }
    }
    break;
    } catch (e) {
      if (!(e instanceof Stop) || !canHandOff(bundle, e, round)) throw e;
      await handToYou(bundle, page, e);
      await settle(page);
    }
    }

    const finalText = await pageText(page);
    if (!bundle.submitPressed) throw new Stop("manual", "Your agent stopped before pressing Submit — nothing was sent. Open the job to finish it.");
    if (!isConfirmation(page.url(), finalText)) throw new Stop("manual", "Submit was pressed, but the site didn't show a confirmation. Check your job email for a receipt before doing anything — it may already be sent.");
    const shot = await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
    const answers = Object.fromEntries(Object.values(filled).filter((x) => !x.info).map((x) => [x.label.slice(0, 120), x.value.slice(0, 500)]));
    await update(task.id, { status: "submitted", step: "Applied", needs: [], log: `Applied to ${task.job.title} at ${task.job.company}`, proof: shot ? shot.toString("base64") : undefined, answers });
    return "submitted";
  } catch (e) {
    const shot = await page.screenshot({ type: "jpeg", quality: 50 }).catch(() => null);
    if (e instanceof Stop) {
      await update(task.id, { status: e.status, step: e.message, error: e.status === "failed" || e.status === "manual" ? e.message : null, needs: e.extra.needs, proof: shot ? shot.toString("base64") : undefined, log: e.message });
      return e.status;
    }
    console.error("task error", task.id, e);
    await update(task.id, { status: "failed", step: "Something went wrong", error: String(e.message || e).slice(0, 300), proof: shot ? shot.toString("base64") : undefined, log: "Stopped after an unexpected error" });
    return "failed";
  } finally {
    live.detach(task.id);
    await context.close().catch(() => {});
  }
}

/** What the agent sees on the page right now: every field, its type, options and current value (dry runs only). */
async function diagnose(page, bundle) {
  const fields = await extractFields(page).catch(() => []);
  const missing = new Set((bundle.dryMissing || []).map((m) => m.label));
  return fields.slice(0, 80).map((f) => ({
    id: f.id, label: (f.label || "").slice(0, 160), type: f.type, required: Boolean(f.required),
    value: f.type === "checkbox" ? String(Boolean(f.checked)) : String(f.value ?? "").slice(0, 80),
    options: (f.options || []).slice(0, 8), unanswered: missing.has(f.label),
  }));
}

async function settle(page, extra = 700) {
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  // Most careers sites keep analytics connections open forever; don't wait long for "idle".
  await page.waitForLoadState("networkidle", { timeout: 3_500 }).catch(() => {});
  await sleep(extra);
}

/** Stable key for a field across runs: its question plus which occurrence of that question it is (repeated work-history boxes). */
function rkeyOf(bundle, fieldKey, label) {
  const ord = bundle.ord || (bundle.ord = { byKey: new Map(), count: new Map() });
  if (!ord.byKey.has(fieldKey)) {
    const l = normLabel(label);
    const n = (ord.count.get(l) || 0) + 1;
    ord.count.set(l, n);
    ord.byKey.set(fieldKey, `${l}#${n}`);
  }
  return ord.byKey.get(fieldKey);
}

/** Fill every known field on the page. Returns required fields still unknown (only when collectMissing). */
async function fillPage(bundle, page, filled, seen, collectMissing = false) {
  const { task, files } = bundle;
  let missingAll = [];
  const failed = [];
  const retry = [];
  for (let pass = 0; pass < 3; pass++) {
    const fields = (await extractFields(page)).filter((f) => f.type !== "password" && !isCodeField(f));
    // Field ids restart on every new page, so "already handled" is remembered per page, not per id.
    const doc = `${bundle.visit || 0}|${page.url().split("#")[0]}`;
    const key = (f) => `${doc}|${f.frame || ""}|${f.id}`;
    const fresh = fields.filter((f) => !seen.has(key(f)) || (collectMissing && f.required && !f.value && !f.checked));
    if (!fresh.length) break;
    for (const f of fresh) {
      if (f.type === "combobox" && !f.options?.length) f.options = await readComboOptions(page, f);
    }
    // Answers the person approved in the review are used exactly as they saw them; only the rest go to the planner.
    const direct = [];
    const toPlan = [];
    for (const f of fresh) {
      const v = bundle.reviewed && f.type !== "file" ? bundle.reviewed[rkeyOf(bundle, key(f), f.label)] : undefined;
      if (typeof v === "string") direct.push(f.type === "checkbox" ? { id: f.id, check: v === "Checked", fromReview: true } : { id: f.id, value: v, fromReview: true });
      else toPlan.push(f);
    }
    const plan = toPlan.length ? await planInChunks(task.id, toPlan) : { fills: [], missing: [] };
    plan.fills = [...direct.filter((d) => d.check !== false), ...(plan.fills || [])];
    const record = (f, fill, value) => {
      if (value === undefined || value === null || value === "") return;
      filled[rkeyOf(bundle, key(f), f.label)] = { label: String(f.label || "").slice(0, 300), value: String(value).slice(0, 4000), reviewed: Boolean(fill?.fromReview), info: f.type === "file" || undefined };
    };
    const shown = (f, fill) => (f.type === "file" ? (fill.file === "cover_letter" ? "Cover letter attached" : "Resume attached") : f.type === "checkbox" ? (fill.check ? "Checked" : "") : fill.value);
    const byId = new Map(fresh.map((f) => [f.id, f]));
    if (process.env.AGENT_DEBUG) console.log("[plan]", JSON.stringify(plan).slice(0, 600));
    for (const fill of plan.fills || []) {
      const f = byId.get(fill.id);
      if (!f) continue;
      // Don't overwrite what the site already prefilled correctly from the resume.
      if (f.value && !fill.file && f.type !== "checkbox" && String(f.value).trim().toLowerCase() === String(fill.value || "").trim().toLowerCase()) {
        seen.add(key(f));
        record(f, fill, f.value);
        continue;
      }
      const ok = await fillField(page, f, fill, files);
      if (process.env.AGENT_DEBUG) console.log("[fill]", f.label.slice(0, 30), ok);
      if (ok) {
        seen.add(key(f));
        record(f, fill, shown(f, fill));
      } else if (f.required && f.type === "file") {
        throw new Stop("manual", "This site wouldn't take the resume upload. Open the job link to finish.");
      } else if (f.required) {
        retry.push({ f, fill });
      }
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
    }
    // Dependent dropdowns (State after Country, City after State) only get their options once the field before
    // them is set: try the misses again after everything else is filled, with freshly read options.
    for (const { f, fill } of retry) {
      await sleep(600);
      const again = (await extractFields(page)).find((x) => x.id === f.id && x.frame === f.frame) || f;
      if (again.type === "combobox") again.options = await readComboOptions(page, again);
      const ok = await fillField(page, again, fill, files);
      if (ok) {
        seen.add(key(f));
        record(f, fill, shown(f, fill));
      } else {
        // The site wouldn't take the answer (none of its options matched). Ask the user to pick from the site's own options.
        failed.push({ id: f.id, label: again.label.replace(/\s*no (states?|provinces?|options|results)[^]*$/i, "").trim() || f.label, type: f.type, options: again.options?.length ? again.options : undefined, required: true, tried: String(fill.value || "").slice(0, 80) });
      }
    }
    retry.length = 0;
    // Dropdowns that had no options yet (they load after an earlier answer): read them again and plan once more.
    const empty = (plan.missing || []).filter((m) => {
      const f = byId.get(m.id);
      return f && ["select", "combobox"].includes(f.type) && !(f.options || []).some((o) => !/^(select|choose|please select|--|no (states?|provinces?|options|results))/i.test(o.trim()));
    });
    if (empty.length) {
      await sleep(500);
      const now = (await extractFields(page)).filter((x) => empty.some((m) => m.id === x.id));
      for (const f of now) if (f.type === "combobox") f.options = await readComboOptions(page, f);
      const again = now.length ? await planInChunks(task.id, now) : { fills: [], missing: [] };
      for (const fill of again.fills || []) {
        const f = now.find((x) => x.id === fill.id);
        if (f && (await fillField(page, f, fill, files))) {
          seen.add(key(f));
          plan.missing = (plan.missing || []).filter((m) => m.id !== f.id);
          record(f, fill, shown(f, fill));
        }
      }
    }
    for (const f of fresh) seen.add(key(f));
    const missing = [...(plan.missing || []).filter((m) => m.required), ...failed.filter((x) => !(plan.missing || []).some((m) => m.id === x.id))];
    failed.length = 0;
    if (missing.length) {
      missingAll = missing;
      if (bundle.dry) {
        for (const m of missing) if (!bundle.dryMissing.some((x) => x.label === m.label)) bundle.dryMissing.push(m);
      } else if (!collectMissing) throw new Stop("needs_user", `${missing.length} question${missing.length > 1 ? "s" : ""} only you can answer — answer once and your agent will remember`, { needs: missing });
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return missingAll;
}

/**
 * Ask the app for answers in small batches with trimmed option lists: big forms (Amazon, Workday) can have
 * hundreds of fields and long dropdowns, and one giant request could exhaust the app's memory.
 */
async function planInChunks(taskId, fields) {
  const slim = fields.map(({ frame, value, checked, accept, ...rest }) => ({
    ...rest,
    label: String(rest.label || "").slice(0, 300),
    options: Array.isArray(rest.options) ? rest.options.slice(0, 400).map((o) => String(o).slice(0, 140)) : rest.options,
  }));
  const out = { fills: [], missing: [] };
  for (let i = 0; i < slim.length && i < 240; i += 40) {
    const r = await call("plan", { taskId, fields: slim.slice(i, i + 40) });
    out.fills.push(...(r.fills || []));
    out.missing.push(...(r.missing || []));
  }
  return out;
}

/** Sign in, or create an account with the job email + a strong unique password saved to the user's vault. */
async function handleAccount(bundle, page, fields, allPasswords) {
  const { task } = bundle;
  const text = (await pageText(page)).toLowerCase();
  // Passwords are only ever typed into the site the login belongs to — never into another site's frame.
  const pageHost = new URL(page.url()).hostname.toLowerCase().replace(/^www\./, "");
  const passwords = allPasswords.filter((f) => !f.frame || new URL(f.frame).hostname.toLowerCase().replace(/^www\./, "") === pageHost);
  if (!passwords.length) throw new Stop("manual", "This site asks for a password inside another site's box. Open the job link to finish.");
  const siteCred = pageHost === task.host || pageHost.endsWith(`.${task.host}`) ? bundle.credential : null;
  let cred = siteCred?.password ? siteCred : null;
  // Sign-in often happens on a separate login host (Amazon → atozpublic.idprism-auth.amazon.com): use the login saved for it.
  if (!cred) {
    const saved = await call("credential", { taskId: task.id, host: pageHost, getOnly: true }).catch(() => null);
    if (saved?.password) cred = saved;
  }
  const createBtn = await page.getByRole("button", { name: /create account|sign up|register/i }).first().isVisible().catch(() => false);
  const signInBtn = await page.getByRole("button", { name: /^(sign in|log in|login)$/i }).first().isVisible().catch(() => false);
  const creating = passwords.length >= 2 || (!cred && createBtn && !signInBtn);

  bundle.signIns = (bundle.signIns || 0) + (creating ? 0 : 1);
  // Slow sign-in pages can show the password box again for a moment: only give up after a real error or 3 tries.
  const loginError = /incorrect|invalid (email|password|credentials)|wrong password|doesn.?t match|not recogni[sz]ed/.test(text);
  if (!creating && cred && bundle.signIns > 1 && (loginError || bundle.signIns > 3)) {
    // The saved login didn't work: try creating the account once (it may not exist here), then stop.
    const create = page.getByText(/create (an |your )?account|sign up|register|new user/i).first();
    if (bundle.signIns === 2 && (await create.isVisible().catch(() => false))) {
      await create.click().catch(() => {});
      await settle(page);
      return;
    }
    throw new Stop("manual", `Signing in to ${task.job.company}'s careers site didn't work. Your login is in Settings → Careers-site accounts; reset the password there if needed, then retry.`);
  }
  if (!creating && !cred) {
    // Look for a "create account" path.
    const link = page.getByText(/create (an |your )?account|sign up|register|new user/i).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click().catch(() => {});
      await settle(page);
      return;
    }
    throw new Stop("manual", "This site wants a login the agent doesn't have yet. Open the job link and create the account once.");
  }

  if (!creating && !cred) cred = null;
  if (creating) {
    cred = await call("credential", { taskId: task.id, host: pageHost, rotate: !cred?.password });
    if (pageHost === task.host) bundle.credential = cred;
    await log(task.id, `Creating your ${task.job.company} careers account with ${cred.login}`, "Creating your account");
  } else {
    await log(task.id, `Signing in to ${task.job.company} careers`, "Signing in");
  }

  const emailField = fields.find((f) => ["email", "text"].includes(f.type) && /e-?mail|user ?name|login/i.test(`${f.label} ${f.name}`));
  if (emailField) await fillField(page, emailField, { value: cred.login }, {});
  for (const p of passwords) await fillField(page, p, { value: cred.password }, {});
  const termsBoxes = fields.filter((x) => x.type === "checkbox" && /agree|terms|privacy|consent|acknowledge/i.test(x.label));
  if (termsBoxes.length && !task.consent && !task.userInput?.terms_ok) {
    throw new Stop("needs_user", `${task.job.company}'s careers site asks you to agree to its terms before it creates your account`, {
      needs: termsBoxes.map((f) => ({ id: f.id, qkey: "", label: f.label, type: "checkbox", required: true, kind: "consent" })),
    });
  }
  if (termsBoxes.length) {
    // Keep a record of exactly what was agreed to on the person's behalf, with links to the documents.
    const links = await page.$$eval("a[href]", (as) => as.filter((a) => /terms|privacy|conditions|policy|notice|consent/i.test(a.textContent || "")).slice(0, 8).map((a) => ({ text: (a.textContent || "").trim().slice(0, 120), href: a.href }))).catch(() => []);
    await call("terms", { taskId: task.id, key: siteKey(page.url()), url: page.url().slice(0, 300), items: termsBoxes.map((f) => f.label.slice(0, 600)), links }).catch(() => {});
  }
  for (const f of termsBoxes) {
    if (await fillField(page, f, { check: true }, {})) bundle.filledRef[`account:${normLabel(f.label)}`] = { label: `Careers-site account: ${f.label.slice(0, 260)}`, value: "Agreed", info: true };
  }
  // Other simple sign-up fields (first/last name, phone, country) go through the planner.
  const others = fields.filter((f) => !["password", "checkbox"].includes(f.type) && f !== emailField);
  if (others.length) {
    const plan = await planInChunks(task.id, others);
    for (const fill of plan.fills || []) {
      const f = others.find((x) => x.id === fill.id);
      if (f && (await fillField(page, f, fill, bundle.files)) && fill.value) bundle.filledRef[`account:${normLabel(f.label)}`] = { label: `Careers-site account: ${f.label.slice(0, 260)}`, value: String(fill.value).slice(0, 4000), info: true };
    }
  }
  const byName = async (re) => {
    const l = page.getByRole("button", { name: re }).first();
    return (await l.isVisible().catch(() => false)) ? l : null;
  };
  const btn = creating
    ? (await byName(/create account|sign up|register|^create$/i)) || (await findSubmit(page)) || (await findNext(page))
    : (await byName(/^(sign in|log in|login|continue)$/i)) || (await findSubmit(page));
  const sinceIso = new Date(Date.now() - 30_000).toISOString();
  if (btn) await btn.click({ timeout: 8000 }).catch(() => btn.click({ force: true }).catch(() => page.keyboard.press("Enter")));
  else {
    // The button is often still disabled while the page checks the input: submit from the password box instead.
    await sleep(800);
    const again = creating ? null : await byName(/^(sign in|log in|login|continue|next)$/i);
    if (again) await again.click({ timeout: 8000 }).catch(() => page.keyboard.press("Enter"));
    else await page.keyboard.press("Enter").catch(() => {});
  }
  await settle(page, 2500);
  if (await humanCheckVisible(page)) await waitForHuman(task, page, bundle.clock);

  const after = (await pageText(page)).toLowerCase();
  if (/incorrect|invalid (email|password|credentials)|wrong password|doesn.?t match/.test(after) && !creating) {
    throw new Stop("manual", "The saved login for this site didn't work. Reset the password from the job link; your vault keeps the latest one.");
  }
  if (/already (exists|registered|in use)|account with this email/.test(after) && creating) {
    // Account exists from before: switch to sign in with the vault password if we have one.
    if (siteCred?.password) return;
    throw new Stop("manual", `An account for ${cred.login} already exists on this site. Sign in once from the job link (use "forgot password"), then retry.`);
  }
  if (/verify|verification|confirm your email|check your (email|inbox)|we (have )?sent|enter (the )?code|one[- ]time/.test(after)) {
    const ch = await codeChallenge(page);
    if (ch) await passCode(bundle, page, ch, "account");
    else await verifyEmail(bundle, page, sinceIso);
  }
  bundle.accountDone = true;
}

/** Get the verification code or link from the job mailbox (or from the user when no mailbox is connected). */
async function verifyEmail(bundle, page, sinceIso) {
  const { task } = bundle;
  const pageHost = new URL(page.url()).hostname;
  const waitStart = Date.now();
  await update(task.id, { status: "waiting_code", step: bundle.hasMailbox ? "Reading the verification email" : `Enter the code sent to ${bundle.identity.email}`, log: "Waiting for the verification email" });
  const deadline = Date.now() + (bundle.hasMailbox ? 4 : 10) * 60 * 1000;
  let got = null;
  while (Date.now() < deadline) {
    const r = await call("poll", { taskId: task.id, since: sinceIso, checkMail: bundle.hasMailbox, pageHost }).catch(() => ({}));
    if (r.cancelled) throw new Stop("cancelled", "Cancelled");
    const userCode = r.userInput?.code;
    if (userCode) {
      got = { code: String(userCode) };
      break;
    }
    if (r.code || r.link) {
      got = { code: r.code, link: r.link };
      break;
    }
    await sleep(bundle.hasMailbox ? 8000 : 4000);
  }
  if (bundle.clock) bundle.clock.waited += Date.now() - waitStart;
  if (!got) throw new Stop("needs_user", `Verify your email: we couldn't find the code sent to ${bundle.identity.email}. Retry after it arrives.`, { needs: [] });
  if (got.link && !(new URL(got.link).hostname.endsWith(baseDomain(pageHost)) && (await allowedUrl(got.link)))) got.link = null;
  if (!got.code && !got.link) throw new Stop("manual", "The verification email pointed somewhere unexpected, so your agent didn't open it. Check your job email.");
  await update(task.id, { status: "running", step: "Verifying your email", clearInput: true, log: got.code ? "Entered the verification code" : "Opened the verification link" });
  if (got.code) {
    const fields = await extractFields(page);
    const codeField = fields.find((f) => /code|otp|verification|passcode|pin/i.test(`${f.label} ${f.name} ${f.placeholder}`)) || fields.find((f) => f.type === "text" || f.type === "number");
    if (codeField) {
      await fillField(page, codeField, { value: got.code }, {});
      const vb = page.getByRole("button", { name: /verify|confirm|continue|submit/i }).first();
      const b = (await findSubmit(page)) || (await findNext(page)) || ((await vb.isVisible().catch(() => false)) ? vb : null);
      if (b) await b.click().catch(() => {});
      await settle(page, 2000);
    }
  } else if (got.link) {
    const back = page.url();
    await bundle.goto(got.link).catch(() => {});
    await settle(page, 2000);
    if (!/apply|application|job/i.test(page.url())) await bundle.goto(bundle.task.url || back).catch(() => {});
    await settle(page);
  }
}

const ATS_NAMES = [["greenhouse", "Greenhouse"], ["lever", "Lever"], ["ashby", "Ashby"], ["workday", "Workday"], ["icims", "iCIMS"], ["smartrecruiters", "SmartRecruiters"], ["workable", "Workable"]];
const systemOf = (url, company) => (ATS_NAMES.find(([k]) => url.includes(k)) || [null, `${company}'s careers site`])[1];
const cleanCo = (c) => String(c || "").split(/\s*[|\-–]\s*/).filter(Boolean).pop()?.replace(/\bcareers?\b/i, "").trim() || c;

/**
 * The site emailed a one-time code to finish the application. The page stays open while the code is read
 * from the user's connected job inbox (checked every few seconds) or typed by the user in Vantage.
 * Returns true when the site confirmed the application.
 */
async function passCode(bundle, page, ch, purpose = "application") {
  const { task } = bundle;
  const company = cleanCo(task.job.company);
  // Careers pages often embed the ATS in a frame (Datadog → Greenhouse), so look at every frame and the task's ATS.
  const urls = [page.url(), ...page.frames().map((f) => f.url()), String(task.ats || "")].join(" ").toLowerCase();
  const system = systemOf(urls, company);
  const sentTo = ch.sentTo || bundle.identity.email;
  const waitStart = Date.now();
  const tried = new Set();
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // the email often lands while Submit is still spinning
  const meta = (extra = {}) => [{ kind: "site_code", system, company, sentTo, length: ch.length, auto: bundle.hasMailbox, purpose, startedAt: new Date(waitStart).toISOString(), expiresAt: new Date(waitStart + 10 * 60 * 1000).toISOString(), ...extra }];
  await update(task.id, {
    status: "waiting_code",
    step: bundle.hasMailbox ? `Reading the security code ${system} emailed to ${sentTo}` : `Enter the code ${system} emailed to ${sentTo}`,
    needs: meta(),
    log: purpose === "account" ? `${system} emailed a code to ${sentTo} to verify your new account` : `${system} emailed a security code to ${sentTo} to confirm this application`,
  });
  const deadline = waitStart + 10 * 60 * 1000;
  try {
    while (Date.now() < deadline) {
      const r = await call("poll", { taskId: task.id, since, checkMail: bundle.hasMailbox, pageHost: new URL(page.url()).hostname }).catch(() => ({}));
      if (r.cancelled) throw new Stop("cancelled", "Cancelled");
      const fromUser = r.userInput?.code ? String(r.userInput.code).trim() : "";
      const code = fromUser || (r.code && !tried.has(r.code) ? String(r.code) : "");
      if (!code || tried.has(code)) {
        await sleep(2500);
        continue;
      }
      tried.add(code);
      await update(task.id, { status: "running", step: `Entering the ${system} security code`, clearInput: Boolean(fromUser), log: fromUser ? "Entering the code you sent" : `Found the code in ${sentTo} — entering it` });
      const fresh = (await codeChallenge(page)) || ch;
      await enterCode(page, fresh.boxes, code);
      await human(300, 700);
      const submit = (await findSubmit(page)) || (await findVerify(page));
      if (submit) {
        if (purpose !== "account") {
          bundle.submitPressed = true;
          await update(task.id, { submitClicked: true });
        }
        await log(task.id, purpose === "account" ? "Verifying your account with the emailed code" : "Submitting the application with the security code", purpose === "account" ? "Verifying your account" : "Submitting");
        await submit.click({ timeout: 10_000 }).catch(() => submit.click({ force: true }).catch(() => {}));
      }
      await settle(page, 2500);
      if (isConfirmation(page.url(), await pageText(page))) return true;
      const still = await codeChallenge(page);
      if (!still) return false; // moved on (e.g. another step); the main loop carries on
      const errs = (await visibleErrors(page)).join(" ");
      const why = /expired/i.test(errs) ? "That code expired" : "That code didn't work";
      await update(task.id, { status: "waiting_code", step: `${why} — waiting for a new one`, needs: meta({ error: why, tried: tried.size }), log: `${why}${errs ? `: ${errs.slice(0, 120)}` : ""}` });
      if (tried.size >= 3) throw new Stop("needs_user", `${system} didn't accept the security code. Retry to get a fresh one.`, { needs: [] });
    }
    throw new Stop("needs_user", `The ${system} security code didn't arrive in 10 minutes. Retry and it will send a new one.`, { needs: [] });
  } finally {
    if (bundle.clock) bundle.clock.waited += Date.now() - waitStart;
  }
}

/**
 * "Enter your password" on a sign-in page whose box we can't read (Amazon A to Z): use the password saved for
 * exactly this site. A password is only ever typed on the site it belongs to.
 */
async function blindPassword(bundle, page, text) {
  const { task } = bundle;
  if ((bundle.blindPw || 0) >= 2 || (await findEntry(page))) return false;
  // Some sign-in pages render their text late (or inside closed components); a "Forgot password" link gives it away.
  const looksLikePassword = /enter (your )?password|^password\b/i.test(text) || (await page.getByText(/forgot (your )?password/i).first().isVisible().catch(() => false));
  if (!looksLikePassword) return false;
  const host = new URL(page.url()).hostname.toLowerCase().replace(/^www\./, "");
  const cred = await call("credential", { taskId: task.id, host, getOnly: true }).catch(() => null);
  if (!cred?.password) return false;
  bundle.blindPw = (bundle.blindPw || 0) + 1;
  await log(task.id, `Signing in to ${cleanCo(task.job.company)} careers`, "Signing in");
  const box = page.locator("input[type=password]:visible").first();
  if (await box.count().catch(() => 0)) {
    await box.click().catch(() => {});
    await box.fill(cred.password).catch(() => {});
  } else {
    await page.keyboard.type(cred.password, { delay: 40 });
  }
  await human(300, 600);
  const btn = page.getByRole("button", { name: /^\s*(continue|sign ?in|log ?in|next|submit)\s*$/i }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 8000 }).catch(() => page.keyboard.press("Enter"));
  else await page.keyboard.press("Enter");
  await settle(page, 2500);
  return true;
}

async function blindCode(bundle, page) {
  const { task } = bundle;
  // The Verify button is usually disabled until a code is typed, so look for it even when disabled.
  const verify = page.getByRole("button", { name: /^\s*(verify|confirm|submit code|verify code)\s*$/i }).first();
  if (!(await verify.isVisible().catch(() => false)) || (bundle.blindTries || 0) >= 3) return false;
  bundle.blindTries = (bundle.blindTries || 0) + 1;
  const company = cleanCo(task.job.company);
  const sentTo = bundle.identity.email;
  const waitStart = Date.now();
  const since = new Date(waitStart - 120_000).toISOString();
  await update(task.id, {
    status: "waiting_code",
    step: bundle.hasMailbox ? `Reading the sign-in code ${company} emailed to ${sentTo}` : `Enter the code ${company} emailed to ${sentTo}`,
    needs: [{ kind: "site_code", system: `${company}'s careers site`, company, sentTo, length: 6, auto: bundle.hasMailbox, purpose: "account", startedAt: new Date(waitStart).toISOString(), expiresAt: new Date(waitStart + 5 * 60_000).toISOString() }],
    log: `${company} emailed a sign-in code to ${sentTo}`,
  });
  let code = null;
  try {
    while (Date.now() - waitStart < 5 * 60_000) {
      const r = await call("poll", { taskId: task.id, since, checkMail: bundle.hasMailbox, pageHost: new URL(page.url()).hostname }).catch(() => ({}));
      if (r.cancelled) throw new Stop("cancelled", "Cancelled");
      code = r.userInput?.code ? String(r.userInput.code).trim() : r.code ? String(r.code) : null;
      if (code && !(bundle.usedCodes || []).includes(code)) break;
      code = null;
      await sleep(2500);
    }
  } finally {
    if (bundle.clock) bundle.clock.waited += Date.now() - waitStart;
  }
  if (!code) return false;
  bundle.usedCodes = [...(bundle.usedCodes || []), code];
  await update(task.id, { status: "running", step: "Entering the sign-in code", clearInput: true, log: `Found the code in ${sentTo} — entering it` });
  // Focus the code box (Playwright reaches open shadow roots); otherwise the page has already focused it.
  const box = page.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):visible").first();
  if (await box.count().catch(() => 0)) {
    await box.click().catch(() => {});
    await box.fill("").catch(() => {});
  }
  await page.keyboard.type(code, { delay: 90 });
  await human(400, 800);
  await verify.click({ timeout: 8000 }).catch(() => page.keyboard.press("Enter").catch(() => {}));
  await settle(page, 2500);
  return true;
}

/** Pause for the user to complete a human check in the live view. The agent never solves these itself. */
async function waitForHuman(task, page, clock) {
  await update(task.id, { status: "needs_human", step: "Complete the quick “I'm human” check — open Live view", log: "The site asked for a human check" });
  const begin = Date.now();
  const deadline = Math.min(begin + 10 * 60 * 1000, (clock?.started || begin) + HARD_CAP_MS);
  while (Date.now() < deadline) {
    await sleep(2000);
    if (live.takeHandBack(task.id)) break;
    if (live.mode(task.id) === "you") continue; // the person is doing it right now
    const r = await call("poll", { taskId: task.id }).catch(() => ({}));
    if (r.cancelled) throw new Stop("cancelled", "Cancelled");
    if (r.userInput?.human_done) break;
    if (!(await humanCheckVisible(page))) {
      await sleep(1500);
      if (!(await humanCheckVisible(page))) break;
    }
  }
  if (clock) clock.waited += Date.now() - begin;
  if (await humanCheckVisible(page)) throw new Stop("manual", "The human check wasn't completed in time. Open the job link to finish the application.");
  live.clearDone(task.id);
  live.setMode(task.id, "watch");
  await update(task.id, { status: "running", step: "Continuing the application", clearInput: true, log: "Human check done — continuing" });
}

/** Stops the person can finish themselves in the in-app browser (not refusals, not anything after Submit). */
function canHandOff(bundle, e, round) {
  if (!bundle.interactive || bundle.dry || bundle.submitPressed || e.extra?.final || round >= 6) return false;
  return e.status === "manual" || (e.status === "needs_user" && Array.isArray(e.extra?.needs));
}

/**
 * The person is watching in Vantage: hand them this step on the live page and carry on when they hand back.
 * Questions are answered in the panel (saved to their answers) or right on the page.
 */
async function handToYou(bundle, page, e) {
  const { task } = bundle;
  const questions = e.status === "needs_user" && e.extra.needs.length > 0;
  const reason = String(e.message || "").replace(/\s*Open the job( link)?[^.]*\.?/i, "").trim();
  await update(task.id, {
    status: questions ? "needs_user" : "needs_human",
    step: questions ? reason : `Your turn: ${reason} Take control, do it on the page, then press Hand back.`,
    needs: questions ? e.extra.needs.map((n) => ({ ...n, live: true })) : [{ id: "handoff", qkey: "", label: reason, type: "handoff", kind: "handoff" }],
    log: questions ? `Asked you ${e.extra.needs.length} question${e.extra.needs.length > 1 ? "s" : ""} in Vantage` : `Handed this step to you: ${reason}`,
  });
  const begin = Date.now();
  let lastPoll = 0;
  let back = false;
  while (Date.now() - begin < 15 * 60 * 1000) {
    await sleep(1200);
    if (live.takeHandBack(task.id)) { back = true; break; }
    if (Date.now() - lastPoll > 3000) {
      lastPoll = Date.now();
      const r = await call("poll", { taskId: task.id, checkMail: false, lite: true }).catch(() => ({}));
      if (r.cancelled) throw new Stop("cancelled", "Cancelled");
      if (r.status === "running" || r.userInput?.human_done) { back = true; break; }
    }
  }
  bundle.clock.waited += Date.now() - begin;
  live.setMode(task.id, "watch");
  if (!back) throw new Stop("manual", `${reason} Nothing was sent.`, { final: true });
  bundle.visit = (bundle.visit || 0) + 1; // read the page afresh
  bundle.lastUrl = null;
  await update(task.id, { status: "running", step: "Continuing the application", needs: [], clearInput: true, log: "You handed back — your agent is continuing" });
}

/** While the person has taken control, the agent waits (and never records the screen). */
async function holdIfYou(bundle, page) {
  const { task } = bundle;
  if (live.mode(task.id) !== "you") return;
  await update(task.id, { step: "You're in control — your agent is paused", log: "You took control of the page" });
  const begin = Date.now();
  let lastPoll = 0;
  while (live.mode(task.id) === "you" && Date.now() - begin < 15 * 60 * 1000) {
    await sleep(800);
    if (Date.now() - lastPoll > 5000) {
      lastPoll = Date.now();
      const r = await call("poll", { taskId: task.id, checkMail: false, lite: true }).catch(() => ({}));
      if (r.cancelled) throw new Stop("cancelled", "Cancelled");
      await update(task.id, { status: "running" }); // keeps the run marked as alive
    }
  }
  live.setMode(task.id, "watch");
  live.takeHandBack(task.id);
  bundle.clock.waited += Date.now() - begin;
  bundle.lastUrl = null;
  await update(task.id, { step: "Back to your agent — continuing", log: "You handed back — your agent is continuing" });
  await settle(page, 400);
}

/**
 * Everything is filled: the person decides. They press Submit on the page themselves, or tap "Submit it for me".
 * Returns "agent" (press it now) or "you" (they pressed it; the loop reads the next page).
 */
async function submitGate(bundle, page, button) {
  const { task } = bundle;
  const startUrl = page.url();
  await button.evaluate((el) => el.addEventListener("click", () => { window.__vpSubmit = true; }, { capture: true })).catch(() => {});
  await update(task.id, {
    status: "needs_human",
    step: "Everything is filled — check the page, then press Submit on it, or tap “Submit it for me”",
    needs: [{ id: "submit_gate", qkey: "", label: "Submit", type: "submit_gate", kind: "submit_gate" }],
    log: "Filled every page — waiting for your Submit",
  });
  const begin = Date.now();
  let lastPoll = 0;
  let who = null;
  while (Date.now() - begin < 20 * 60 * 1000) {
    await sleep(900);
    const pressed = await page.evaluate(() => Boolean(window.__vpSubmit)).catch(() => null);
    // The person pressed it on the page (the click was seen, or the page moved on while they were in control).
    if (pressed || (live.mode(task.id) === "you" && page.url() !== startUrl) || (pressed === null && page.url() !== startUrl)) { who = "you"; break; }
    if (Date.now() - lastPoll > 2000) {
      lastPoll = Date.now();
      const r = await call("poll", { taskId: task.id, checkMail: false, lite: true }).catch(() => ({}));
      if (r.cancelled) throw new Stop("cancelled", "Cancelled");
      if (Date.parse(r.userInput?.submit_ok_at || "") >= begin - 5000) { who = "agent"; break; }
    }
  }
  bundle.clock.waited += Date.now() - begin;
  if (!who) throw new Stop("manual", "Everything was filled, but Submit wasn't pressed within 20 minutes — nothing was sent.", { final: true });
  if (who === "you") {
    bundle.submitPressed = true;
    live.setMode(task.id, "watch");
    await update(task.id, { status: "running", submitClicked: true, needs: [], step: "You pressed Submit — checking the confirmation", log: "You pressed Submit on the page" });
    await settle(page, 2500);
    return "you";
  }
  live.setMode(task.id, "watch");
  await update(task.id, { status: "running", needs: [], step: "Submitting for you", log: "You asked your agent to submit" });
  return "agent";
}
