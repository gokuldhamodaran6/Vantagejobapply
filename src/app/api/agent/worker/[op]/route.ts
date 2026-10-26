import { agentSecretOk, rpc } from "@/lib/agent/svc";
import { filesFor, loadBundle } from "@/lib/agent/bundle";
import { planFields, type FormField } from "@/lib/agent/fields";
import { syncAccount } from "@/lib/agent/mailsync";
import { encryptFor, generatePassword } from "@/lib/vault";
import type { MailAccount } from "@/lib/mail";

export const maxDuration = 120;

const j = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Endpoints the browser worker calls. Every call needs the shared agent secret. */
export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  if (!agentSecretOk(req)) return j({ error: "unauthorised" }, 401);
  const { op } = await params;
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
      const files = await filesFor(b);
      return j({
        task: { id: b.task.id, ats: b.target.ats, url: b.target.url, host: b.host, job: b.task.job, attempts: b.task.attempts, userInput: b.task.user_input },
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
      const out = await planFields((body.fields as FormField[]) || [], {
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
      const t = await rpc<{ status: string; user_input: Record<string, unknown>; user_id: string } | null>("task", { task_id: taskId });
      if (!t) return j({ cancelled: true });
      if (t.status === "cancelled") return j({ cancelled: true });
      const since = String(body.since || new Date(Date.now() - 10 * 60 * 1000).toISOString());
      let codes = await rpc<{ from_addr: string; subject: string; code: string | null; link: string | null; received_at: string }[]>("recent_codes", { user_id: t.user_id, since });
      if (!codes?.length && body.checkMail) {
        const accts = await rpc<MailAccount[]>("mail_accounts", { user_id: t.user_id });
        if (accts?.[0]) {
          await syncAccount(accts[0], { days: 1 });
          codes = await rpc("recent_codes", { user_id: t.user_id, since });
        }
      }
      const hint = String(body.senderHint || "").toLowerCase();
      const pick = (codes || []).find((c) => !hint || (c.from_addr || "").toLowerCase().includes(hint) || (c.subject || "").toLowerCase().includes(hint)) || (codes || [])[0];
      return j({ userInput: t.user_input, code: pick?.code || null, link: pick?.link || null });
    }

    if (op === "credential") {
      const b = await loadBundle(taskId);
      if (!b) return j({ error: "task not found" }, 404);
      if (b.credential?.password && !body.rotate) return j(b.credential);
      const password = generatePassword();
      const login = String(body.login || b.identity);
      await rpc("vault_upsert", { user_id: b.task.user_id, host: b.host, label: b.task.job.company, login, secret_enc: encryptFor(b.task.user_id, password) });
      return j({ login, password });
    }

    return j({ error: "unknown op" }, 404);
  } catch (e) {
    console.error("worker op failed", op, e);
    return j({ error: (e as Error).message }, 500);
  }
}
