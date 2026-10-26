import { call, log, update } from "./api.mjs";
import { codeChallenge, declineCookies, enterCode, extractFields, isCodeField, fillField, findEntry, findNext, findSubmit, human, humanCheckVisible, isConfirmation, pageText, readComboOptions, visibleErrors } from "./forms.mjs";
import { live } from "./live.mjs";
import { allowedUrl, baseDomain } from "./guard.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TASK_BUDGET_MS = 9 * 60 * 1000; // active work, excluding time spent waiting for the user
const HARD_CAP_MS = 25 * 60 * 1000; // everything included

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
  context.on("page", (p) => (page = p)); // follow "Apply" links that open a new tab
  live.attach(task.id, () => page);
  const filled = {};
  const seen = new Set();
  const clock = { started, waited: 0 };
  bundle.clock = clock;
  // Test mode: fill everything, never create accounts, never submit. Used to check real careers sites safely.
  bundle.dry = task.mode === "dry_run";
  bundle.dryMissing = [];
  const goto = async (url) => {
    if (!(await allowedUrl(url))) throw new Stop("failed", "This link isn't a public web page, so your agent won't open it.");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  };
  bundle.goto = goto;

  try {
    await log(task.id, `Opening ${task.job.company}'s application`, "Opening the application");
    await goto(task.url);
    await settle(page);
    if (await declineCookies(page)) await settle(page, 600);

    for (let step = 0; step < 14; step++) {
      if (Date.now() - started - clock.waited > TASK_BUDGET_MS || Date.now() - started > HARD_CAP_MS) throw new Stop("failed", "Took too long on this site. You can finish it yourself from the job link.");
      const text = await pageText(page);
      if (isConfirmation(page.url(), text)) break;

      if (await humanCheckVisible(page)) {
        if (bundle.dry) throw new Stop("manual", "Dry run: the site showed a human check");
        await waitForHuman(task, page, clock);
      }

      const fields = await extractFields(page);
      // The site emailed a code (Greenhouse's "security code" after Submit): read it from the inbox and enter it.
      const challenge = await codeChallenge(page, fields);
      if (challenge) {
        if (bundle.dry) throw new Stop("manual", "Dry run: the site asked for an emailed security code", { needs: await diagnose(page, bundle) });
        if (await passCode(bundle, page, challenge)) break;
        continue;
      }
      const formish = fields.filter((f) => !["password"].includes(f.type));
      const passwords = fields.filter((f) => f.type === "password");

      // 1) Account wall: sign in or create an account with the job email and a vault password.
      if (passwords.length) {
        if (bundle.dry) throw new Stop("manual", "Dry run: stopped at the careers-site account page", { needs: await diagnose(page, bundle) });
        await handleAccount(bundle, page, fields, passwords);
        continue;
      }

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
      const submit = await findSubmit(page);
      const next = submit ? null : await findNext(page);
      if (!submit && !next) {
        if (step > 0 && formish.length === 0) throw new Stop("manual", "This site needs a step the agent can't do. Open the job link to finish.");
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
        if (errs.length) {
          await log(task.id, `The form flagged: ${errs.slice(0, 3).join(" · ")}`);
          if (/captcha|robot|human|verification failed/i.test(errs.join(" "))) await waitForHuman(task, page, clock);
          // Errors usually mean a required field we couldn't fill; the next pass asks the user for it.
          const missing = await fillPage(bundle, page, filled, seen, true);
          if (bundle.dry && (missing.length || bundle.dryMissing.length)) throw new Stop("manual", `Dry run: the form needs answers before the next step (${errs.slice(0, 2).join(" · ").slice(0, 120)})`, { needs: await diagnose(page, bundle) });
          if (missing.length) throw new Stop("needs_user", "A few questions only you can answer", { needs: missing });
        }
      }
    }

    const finalText = await pageText(page);
    if (!isConfirmation(page.url(), finalText)) throw new Stop("manual", "The site didn't confirm the submission. Open the job link to check and finish it.");
    const shot = await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
    await update(task.id, { status: "submitted", step: "Applied", needs: [], log: `Applied to ${task.job.title} at ${task.job.company}`, proof: shot ? shot.toString("base64") : undefined, answers: filled });
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

async function settle(page, extra = 1200) {
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await sleep(extra);
}

/** Fill every known field on the page. Returns required fields still unknown (only when collectMissing). */
async function fillPage(bundle, page, filled, seen, collectMissing = false) {
  const { task, files } = bundle;
  let missingAll = [];
  const failed = [];
  for (let pass = 0; pass < 3; pass++) {
    const fields = (await extractFields(page)).filter((f) => f.type !== "password" && !isCodeField(f));
    const fresh = fields.filter((f) => !seen.has(f.id) || (collectMissing && f.required && !f.value && !f.checked));
    if (!fresh.length) break;
    for (const f of fresh) {
      if (f.type === "combobox" && !f.options?.length) f.options = await readComboOptions(page, f);
    }
    const plan = await call("plan", { taskId: task.id, fields: fresh.map(({ frame, value, checked, accept, ...rest }) => rest) });
    const byId = new Map(fresh.map((f) => [f.id, f]));
    for (const fill of plan.fills || []) {
      const f = byId.get(fill.id);
      if (!f) continue;
      // Don't overwrite what the site already prefilled correctly from the resume.
      if (f.value && !fill.file && f.type !== "checkbox" && String(f.value).trim().toLowerCase() === String(fill.value || "").trim().toLowerCase()) {
        seen.add(f.id);
        continue;
      }
      const ok = await fillField(page, f, fill, files);
      if (ok) {
        seen.add(f.id);
        if (fill.value && f.type !== "file") filled[f.label.slice(0, 120)] = String(fill.value).slice(0, 500);
      } else if (f.required && f.type === "file") {
        throw new Stop("manual", "This site wouldn't take the resume upload. Open the job link to finish.");
      } else if (f.required) {
        // The site wouldn't take the answer (e.g. none of its options matched). Ask the user to pick from the site's own options.
        failed.push({ id: f.id, label: f.label, type: f.type, options: f.options?.length ? f.options : undefined, required: true, tried: String(fill.value || "").slice(0, 80) });
      }
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
    }
    for (const f of fresh) seen.add(f.id);
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
  const createBtn = await page.getByRole("button", { name: /create account|sign up|register/i }).first().isVisible().catch(() => false);
  const signInBtn = await page.getByRole("button", { name: /^(sign in|log in|login)$/i }).first().isVisible().catch(() => false);
  const creating = passwords.length >= 2 || (!cred && createBtn && !signInBtn);

  bundle.signIns = (bundle.signIns || 0) + (creating ? 0 : 1);
  if (!creating && cred && bundle.signIns > 1) {
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
    cred = await call("credential", { taskId: task.id, host: pageHost, rotate: !siteCred?.password });
    if (pageHost === task.host) bundle.credential = cred;
    await log(task.id, `Creating your ${task.job.company} careers account with ${cred.login}`, "Creating your account");
  } else {
    await log(task.id, `Signing in to ${task.job.company} careers`, "Signing in");
  }

  const emailField = fields.find((f) => ["email", "text"].includes(f.type) && /e-?mail|user ?name|login/i.test(`${f.label} ${f.name}`));
  if (emailField) await fillField(page, emailField, { value: cred.login }, {});
  for (const p of passwords) await fillField(page, p, { value: cred.password }, {});
  for (const f of fields.filter((x) => x.type === "checkbox" && /agree|terms|privacy|consent|acknowledge/i.test(x.label))) await fillField(page, f, { check: true }, {});
  // Other simple sign-up fields (first/last name, phone, country) go through the planner.
  const others = fields.filter((f) => !["password", "checkbox"].includes(f.type) && f !== emailField);
  if (others.length) {
    const plan = await call("plan", { taskId: task.id, fields: others.map(({ frame, value, checked, accept, ...rest }) => rest) });
    for (const fill of plan.fills || []) {
      const f = others.find((x) => x.id === fill.id);
      if (f) await fillField(page, f, fill, bundle.files);
    }
  }
  const byName = async (re) => {
    const l = page.getByRole("button", { name: re }).first();
    return (await l.isVisible().catch(() => false)) ? l : null;
  };
  const btn = creating
    ? (await byName(/create account|sign up|register|^create$/i)) || (await findSubmit(page)) || (await findNext(page))
    : (await byName(/^(sign in|log in|login|continue)$/i)) || (await findSubmit(page));
  if (!btn) throw new Stop("manual", "Couldn't find the account button on this site.");
  const sinceIso = new Date(Date.now() - 30_000).toISOString();
  await btn.click({ timeout: 8000 }).catch(() => btn.click({ force: true }));
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
    await verifyEmail(bundle, page, sinceIso);
  }
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
async function passCode(bundle, page, ch) {
  const { task } = bundle;
  const company = cleanCo(task.job.company);
  // Careers pages often embed the ATS in a frame (Datadog → Greenhouse), so look at every frame and the task's ATS.
  const urls = [page.url(), ...page.frames().map((f) => f.url()), String(task.ats || "")].join(" ").toLowerCase();
  const system = systemOf(urls, company);
  const sentTo = ch.sentTo || bundle.identity.email;
  const waitStart = Date.now();
  const tried = new Set();
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // the email often lands while Submit is still spinning
  const meta = (extra = {}) => [{ kind: "site_code", system, company, sentTo, length: ch.length, auto: bundle.hasMailbox, startedAt: new Date(waitStart).toISOString(), expiresAt: new Date(waitStart + 10 * 60 * 1000).toISOString(), ...extra }];
  await update(task.id, {
    status: "waiting_code",
    step: bundle.hasMailbox ? `Reading the security code ${system} emailed to ${sentTo}` : `Enter the code ${system} emailed to ${sentTo}`,
    needs: meta(),
    log: `${system} emailed a security code to ${sentTo} to confirm this application`,
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
      const submit = await findSubmit(page);
      if (submit) {
        await log(task.id, "Submitting the application with the security code", "Submitting");
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

/** Pause for the user to complete a human check in the live view. The agent never solves these itself. */
async function waitForHuman(task, page, clock) {
  await update(task.id, { status: "needs_human", step: "Complete the quick “I'm human” check — open Live view", log: "The site asked for a human check" });
  const begin = Date.now();
  const deadline = Math.min(begin + 10 * 60 * 1000, (clock?.started || begin) + HARD_CAP_MS);
  while (Date.now() < deadline) {
    await sleep(3000);
    if (live.doneFlag(task.id)) break;
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
  await update(task.id, { status: "running", step: "Continuing the application", clearInput: true, log: "Human check done — continuing" });
}
