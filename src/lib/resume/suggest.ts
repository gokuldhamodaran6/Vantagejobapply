import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { resumeText } from "@/lib/ats";
import { familyOf } from "@/lib/jobs/roles";
import type { ResumeContent } from "@/lib/types";

export type RoleSuggestion = { title: string; fit: "strong" | "adjacent" | "switch"; why: string };

const title = (t: string) => t.replace(/\b(sr\.?|senior|jr\.?|junior|intern(ship)?|graduate assistant|independent project|i{1,3}|iv)\b/gi, "").replace(/[,(].*$/, "").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** Roles worth targeting, read from the resume the way a recruiter would: what they've done, and the natural next steps. */
export async function suggestRoles(r: ResumeContent): Promise<RoleSuggestion[]> {
  const out: RoleSuggestion[] = [];
  const add = (s: RoleSuggestion) => {
    if (s.title.length < 3 || out.some((x) => x.title.toLowerCase() === s.title.toLowerCase())) return;
    out.push(s);
  };
  if (aiConfigured()) {
    const res = await claude(
      `You are a senior technical recruiter. From this resume, suggest 6 job titles this person should target, as recruiters would post them.
- 2–3 "strong": roles they are clearly qualified for today.
- 2 "adjacent": a realistic step (related field or one level up) they could win with a well-positioned resume.
- at most 1 "switch": only if the resume shows real signs of interest in another field (projects, courses, side work).
Use standard, common titles (e.g. "Product Analyst", not "Data & Product Wizard"). "why": max 14 words, concrete, from the resume.
Return ONLY JSON: [{"title":string,"fit":"strong"|"adjacent"|"switch","why":string}]`,
      [{ role: "user", content: JSON.stringify({ headline: r.headline, summary: r.summary, experience: (r.experience || []).map((e) => ({ title: e.title, company: e.company, start: e.start, end: e.end, bullets: e.bullets.slice(0, 3) })), skills: r.skills, education: r.education, certifications: r.certifications, projects: r.projects }).slice(0, 9000) }],
      900,
      { model: "fast", temperature: 0.3 },
    );
    for (const s of extractJson<RoleSuggestion[]>(res) || []) {
      if (s?.title && ["strong", "adjacent", "switch"].includes(s.fit)) add({ title: String(s.title).slice(0, 60), fit: s.fit, why: String(s.why || "").slice(0, 120) });
    }
    if (out.length >= 3) return out.slice(0, 6);
  }
  // Without AI: the titles they've held, then their family's neighbours, then what their skills point to.
  for (const e of (r.experience || []).slice(0, 3)) {
    const t = title(e.title || "");
    if (t) add({ title: t, fit: "strong", why: `You've worked as ${e.title}${e.company ? ` at ${e.company}` : ""}.` });
  }
  for (const e of (r.experience || []).slice(0, 2)) {
    const fam = familyOf(e.title || "");
    for (const v of fam?.variants.slice(0, 3) || []) add({ title: v.replace(/\b\w/g, (c) => c.toUpperCase()) + (/(manager|analyst|engineer|designer|specialist|executive|owner|nurse|driver|accountant|recruiter)$/i.test(v) ? "" : " Specialist"), fit: "adjacent", why: `A close neighbour of your ${e.title} experience.` });
  }
  const text = resumeText(r).toLowerCase();
  if (/\bsql\b|power bi|tableau|looker|excel/.test(text)) add({ title: "Data Analyst", fit: "adjacent", why: "Your SQL and BI tools are what data analyst postings ask for." });
  if (/requirements|user stor|acceptance criteria|roadmap/.test(text)) add({ title: "Product Analyst", fit: "adjacent", why: "Requirements and product work translate directly." });
  return out.slice(0, 6);
}
