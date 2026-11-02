import type { NextRequest } from "next/server";
import { json, loadUserContext } from "@/lib/server-user";
import { atsReadout, jobDemand, knockouts, roleDemand, type RoleDemand } from "@/lib/resume/recruiter-server";
import { gradeLines, skillProof, titleFound } from "@/lib/resume/recruiter";
import { repairResume } from "@/lib/resume/repair";
import type { ResumeContent, ResumeStyle } from "@/lib/types";

export const maxDuration = 60;

/** Recruiter check for one resume: what the ATS reads, search match for a role or job, line grades, knockouts. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const { data: r } = await ctx.supabase.from("resumes").select("id,name,style,content,is_master,target_role_id,kind").eq("id", id).maybeSingle();
  if (!r) return json({ error: "Not found" }, 404);
  const content = repairResume(r.content as ResumeContent);
  const country = ctx.prefs?.countries?.[0] || "US";
  const roles = ctx.roles.filter((x) => x.active);

  let target: { kind: "role" | "job"; id: string; label: string };
  let demand: RoleDemand;
  const jobId = sp.get("job");
  if (jobId) {
    const { data: job } = await ctx.supabase.from("jobs").select("id,title,company,description").eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "That job is no longer available." }, 404);
    target = { kind: "job", id: job.id, label: `${job.title} · ${job.company}` };
    demand = jobDemand(job.description || "");
  } else {
    const role = roles.find((x) => x.id === sp.get("role")) || roles.find((x) => x.id === r.target_role_id) || roles[0];
    if (!role) return json({ error: "Add a target role first." }, 400);
    target = { kind: "role", id: role.id, label: role.title };
    demand = await roleDemand(ctx.supabase, ctx.user.id, role.title, country);
  }

  const [parse] = await Promise.all([atsReadout(content, (r.style || "classic") as ResumeStyle, country)]);
  return json({
    resume: { id: r.id, name: r.name, style: r.style || "classic", isMaster: r.is_master, content },
    target: { ...target, postings: demand.postings },
    roles: roles.map((x) => ({ id: x.id, title: x.title })),
    parse,
    title: titleFound(content, target.kind === "role" ? target.label : target.label.split(" · ")[0]),
    skills: skillProof(content, demand.skills),
    lines: gradeLines(content),
    knockouts: knockouts(country, ctx.auth, ctx.prefs, content.location),
  });
}
