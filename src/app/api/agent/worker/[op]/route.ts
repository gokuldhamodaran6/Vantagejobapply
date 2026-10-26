import { agentSecretOk, rpc } from "@/lib/agent/svc";
import { filesFor, loadBundle } from "@/lib/agent/bundle";
import { ensureFreshTailoring } from "@/lib/agent/prepare";
import { planFields, type FormField } from "@/lib/agent/fields";
import { syncAccount } from "@/lib/agent/mailsync";
import { encryptFor, generatePassword } from "@/lib/vault";
import type { MailAccount } from "@/lib/mail";
import { baseDomain, isSafePublicUrl } from "@/lib/net";
import { hostOf } from "@/lib/agent/bundle";

export const maxDuration = 120;

const j = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Endpoints the browser worker calls. Every call needs the shared agent secret. */
export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  if (!agentSecretOk(req)) return j({ error: "unauthorised" }, 401);
  const { op } = await params;
  // Guard the app's memory: no worker request needs more than a few MB (screenshots are ~300 KB).
  if (Number(req.headers.get("content-length") || 0) > 6_000_000) return j({ error: "request too large" }, 413);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const taskId = String(body.taskId || "");

  try {
    if (op === "claim") {
      const t = await rpc<{ id: string } | null>("claim", {});
      if (!t) return j({ task: null });
      const b = await loadBundle(t.id);
      if (!b) return j({ task: null });
      if (!b.resume) {
        await rpc("update", { task_id: t.id, status: "failed", error: "No resume on file. Upload your resume in Vantage." });
        return j({ task: null });
      }
      // Quality gate: never send a broken or stale resume.
      if (b.task.mode !== "dry_run") {
        const fresh = await ensureFreshTailoring({
          taskId: b.task.id, userId: b.task.user_id, name: b.facts.full_name, jobId: b.task.job_id, job: b.task.job,
          resume: b.raw.resume?.content || null, resumeUpdatedAt: b.raw.resume?.updated_at || null, tone: b.task.letter_tone, style: b.task.resume_style, fullName: b.facts.full_name,
        }).catch((e) => { console.error("retailor failed", e); return { refreshed: false }; });
        if (fresh.refreshed) {
          const nb = await loadBundle(t.id);
          if (nb) Object.assign(b, nb);
        }
      }
      if (!(await isSafePublicUrl(b.target.url, { httpsOnly: true }))) {
        await rpc("update", { task_id: t.id, status: "failed", error: "This application link isn't a public https page, so your agent won't open it." });
        return j({ task: null });
      }
      const files = await filesFor(b);
      return j({
        task: { id: b.task.id, ats: b.target.ats, url: b.target.url, host: b.host, job: b.task.job, attempts: b.task.attempts, userInput: b.task.user_input, mode: b.task.mode },
        identity: { email: b.identity, name: b.facts.full_name, firstName: b.facts.first_name, lastName: b.facts.last_name, phone: b.facts.phone },
        credential: b.credential,
        hasMailbox: b.hasMailbox,
        files,
      });
    }

    if (op === "plan") {
      const b = await loadBundle(taskId);
      if (!b) return j({ error: "task not found" }, 404);
      const consent = Boolean(b.raw.applicant?.agent_consent);
      const out = await planFields(((body.fields as FormField[]) || []).slice(0, 80), {
        facts: b.facts,
        answers: b.raw.answers,
        job: { title: b.task.job.title, company: b.task.job.company },
        resume: b.resume,
        coverLetter: b.task.cover_letter,
        consent,
      });
      return j(out);
    }

    if (op === "update") {
      const patch: Record<string, unknown> = { task_id: taskId };
      for (const k of ["status", "step", "needs", "error", "log", "proof"]) if (body[k] !== undefined) patch[k] = body[k];
      if (body.clearInput) patch.clear_input = true;
      const t = await rpc("update", patch);
      if (body.status === "submitted") await rpc("record_application", { task_id: taskId, answers: body.answers || {} });
      return j({ ok: true, task: t });
    }

    if (op === "poll") {
      // Worker waits for: user-entered code, "I finished the human check", cancellation, or a verification email.
      const t = await rpc<{ status: string; user_input: Record<string, unknown>; user_id: string; apply_url: string; started_at: string | null; locked_at: string | null; job: { company: string } } | null>("task", { task_id: taskId });
      if (!t) return j({ cancelled: true });
      if (t.status === "cancelled") return j({ cancelled: true });
      // Only codes that arrived during this run, from the employer or its careers system.
      const floor = Date.parse(t.started_at || "") || Date.now() - 15 * 60 * 1000;
      const asked = Date.parse(String(body.since || "")) || floor;
      const since = new Date(Math.max(floor - 60_000, asked)).toISOString();
      type CodeMail = { from_addr: string; subject: string; code: string | null; link: string | null; received_at: string };
      const pageHost = String(body.pageHost || "");
      const domains = [baseDomain(hostOf(t.apply_url)), pageHost ? baseDomain(pageHost) : ""].filter(Boolean);
      const words = [...domains.map((d) => d.split(".")[0]), ...t.job.company.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)];
      const ATS_MAIL = /(myworkday|workday|greenhouse|lever|ashby|icims|taleo|successfactors|smartrecruiters|workable|recruitee|jobvite|oraclecloud|avature|eightfold)/;
      const fromEmployer = (c: CodeMail) => {
        const f = `${c.from_addr || ""} ${c.subject || ""}`.toLowerCase();
        return words.some((w) => f.includes(w)) || ATS_MAIL.test((c.from_addr || "").toLowerCase());
      };
      // Several applications can run on the same ATS at once (Datadog and Robinhood both use Greenhouse):
      // a mail that names another company ("…your application to Robinhood") never answers this one.
      const names = words.filter((w) => !["careers", "jobs", "inc", "llc", "the", "greenhouse", "lever", "ashbyhq", "myworkdayjobs", "workday"].includes(w));
      const named = (c: CodeMail) => names.some((w) => (c.subject || "").toLowerCase().includes(w));
      const forOther = (c: CodeMail) => {
        const m = (c.subject || "").toLowerCase().match(/(?:application|apply(?:ing)?) (?:to|at|for|with) (.+)$/);
        return Boolean(m && names.length && !names.some((w) => m[1].includes(w)));
      };
      const best = (list: CodeMail[] | null) =>
        (list || []).filter((c) => (c.code || c.link) && fromEmployer(c) && !forOther(c)).sort((a, b) => Number(named(b)) - Number(named(a)) || Date.parse(b.received_at) - Date.parse(a.received_at))[0];
      let pick = best(await rpc<CodeMail[]>("recent_codes", { user_id: t.user_id, since }));
      if (!pick && body.checkMail) {
        // Not in yet: read the mailbox right now (new mail only) rather than waiting for the next sync.
        const accts = await rpc<MailAccount[]>("mail_accounts", { user_id: t.user_id });
        if (accts?.[0]) {
          await syncAccount(accts[0], { days: 1 }).catch(() => {});
          pick = best(await rpc<CodeMail[]>("recent_codes", { user_id: t.user_id, since }));
        }
      }
      // A verification link is opened only if it points at the same site the agent is applying on.
      const link = pick?.link && domains.some((d) => hostOf(pick.link!).endsWith(d)) ? pick.link : null;
      return j({ userInput: t.user_input, code: pick?.code || null, link });
    }

    if (op === "credential") {
      const b = await loadBundle(taskId);
      if (!b) return j({ error: "task not found" }, 404);
      // Logins are per site: the worker names the site it is on; a password is only ever returned for that site.
      const host = String(body.host || b.host).toLowerCase().replace(/^www\./, "");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return j({ error: "bad host" }, 400);
      if (host === b.host && b.credential?.password && !body.rotate) return j({ ...b.credential, host });
      if (host !== b.host) {
        const other = await loadBundle(taskId, host);
        if (other?.credential?.password && !body.rotate) return j({ ...other.credential, host });
      }
      // Signing in (not creating): never invent a password the site doesn't know.
      if (body.getOnly) return j({ none: true, host });
      const password = generatePassword();
      const login = b.identity;
      await rpc("vault_upsert", { user_id: b.task.user_id, host, label: b.task.job.company, login, secret_enc: encryptFor(b.task.user_id, password) });
      return j({ login, password, host });
    }

    return j({ error: "unknown op" }, 404);
  } catch (e) {
    console.error("worker op failed", op, e);
    return j({ error: (e as Error).message }, 500);
  }
}
