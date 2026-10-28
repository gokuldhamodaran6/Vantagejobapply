import { json, loadUserContext } from "@/lib/server-user";
import { applyTarget } from "@/lib/agent/jobs";
import { formQuestions } from "@/lib/agent/precheck";
import { rpc, wakeWorker } from "@/lib/agent/svc";
import type { Job } from "@/lib/types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Release check: before trusting a new version, the agent does a dry run on one fresh real job per careers system.
 * A dry run fills the first page and stops — it never creates an account and never presses Submit. For systems that
 * publish their form (Greenhouse, Lever, Ashby) it also checks that Vantage can read the questions ahead.
 */
const SYSTEMS: [string, string][] = [["gh", "Greenhouse"], ["lever", "Lever"], ["ashby", "Ashby"], ["wd", "Workday"], ["sr", "SmartRecruiters"], ["wk", "Workable"]];

export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx || ctx.profile.role !== "admin") return json({ error: "forbidden" }, 403);
  const { data } = await ctx.supabase.from("agent_tasks").select("id,job,ats,status,step,error,needs,created_at,finished_at,user_input")
    .eq("mode", "dry_run").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).order("created_at", { ascending: false }).limit(40);
  return json({ runs: (data || []).map((t) => ({ ...t, needs: Array.isArray(t.needs) ? t.needs.length : 0, unanswered: Array.isArray(t.needs) ? (t.needs as { unanswered?: boolean }[]).filter((n) => n.unanswered).length : 0 })) });
}

export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx || ctx.profile.role !== "admin") return json({ error: "forbidden" }, 403);
  const { count } = await ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("mode", "dry_run").in("status", ["queued", "running"]);
  if ((count || 0) > 0) return json({ error: "A release check is already running — wait for it to finish." }, 409);
  const { data: master } = await ctx.supabase.from("resumes").select("id").eq("is_master", true).maybeSingle();
  if (!master) return json({ error: "Add a master resume first (the dry runs fill forms with it)." }, 400);

  const picked: { system: string; job: Job; questions: number | null }[] = [];
  await Promise.all(SYSTEMS.map(async ([prefix, system]) => {
    const { data } = await ctx.supabase.from("jobs").select("*").like("id", `${prefix}:%`).is("closed_at", null).eq("country", "US")
      .order("posted_at", { ascending: false }).limit(3);
    const job = (data as Job[] | null)?.[0];
    if (!job) return;
    const q = ["gh", "lever", "ashby"].includes(prefix) ? await formQuestions(job.id).catch(() => null) : undefined;
    picked.push({ system, job, questions: q === undefined ? null : q ? q.length : -1 });
  }));
  if (!picked.length) return json({ error: "No open jobs found to check." }, 404);

  const stamp = Date.now().toString(36);
  await rpc("insert_tasks", {
    user_id: ctx.user.id,
    tasks: picked.map(({ system, job, questions }) => {
      const target = applyTarget(job);
      return {
        job_id: `dry:${stamp}:${job.id}`.slice(0, 300),
        job: { title: job.title, company: job.company, url: job.url, country: job.country, location: job.location, role_id: "", match: "", system, form_read_ahead: questions },
        ats: target.ats, apply_url: target.url, status: "queued", mode: "dry_run", priority: 3,
        resume_id: master.id, resume_style: "classic", letter_tone: "confident", cover_letter: "",
      };
    }),
  });
  void wakeWorker();
  return json({ ok: true, started: picked.map((p) => ({ system: p.system, company: p.job.company, title: p.job.title, formReadAhead: p.questions })) });
}
