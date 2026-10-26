import type { ResumeContent } from "@/lib/types";

/**
 * Resume quality gate. A resume with these problems never goes to an employer:
 * it's repaired for rendering (tidyResume) and, before applying, rewritten from the master.
 */
const isUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim());
const titleCase = (n: string) => (n === n.toUpperCase() || n === n.toLowerCase() ? n.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : n);

export function resumeIssues(c: ResumeContent | null | undefined, fullName?: string): string[] {
  if (!c) return ["missing"];
  const out: string[] = [];
  const name = (c.name || "").trim();
  if (name.split(/\s+/).length < 2 || (fullName && fullName.split(/\s+/).length > name.split(/\s+/).length)) out.push("name incomplete");
  if (!c.summary || c.summary.trim().length < 60 || isUrl(c.summary)) out.push("summary missing");
  const exp = c.experience || [];
  if (!exp.length) out.push("no experience");
  if (exp.some((e) => !e.title?.trim() || !e.company?.trim())) out.push("job without title or company");
  const bullets = exp.flatMap((e) => e.bullets || []);
  const frag = bullets.filter((b) => b.trim().length < 35 || /^[a-z]/.test(b.trim()) || /[,;—-]\s*$/.test(b.trim()));
  if (bullets.length && frag.length / bullets.length > 0.15) out.push("broken bullet points");
  if (exp.slice(0, 2).some((e) => !(e.bullets || []).length)) out.push("recent role without bullets");
  const groups = (c.skills || []).map((g) => g.group.toLowerCase());
  if (groups.filter((g) => g === "skills").length > 1) out.push("skills split into fragments");
  return out;
}

/** Repair what can be repaired safely (never inventing anything) so the PDF reads like a professional resume. */
export function tidyResume(c: ResumeContent, fullName?: string): ResumeContent {
  const r: ResumeContent = JSON.parse(JSON.stringify(c));
  const name = (r.name || "").trim();
  r.name = titleCase(fullName && fullName.split(/\s+/).length > name.split(/\s+/).length ? fullName : name || fullName || "");
  if (r.summary && (isUrl(r.summary) || r.summary.trim().length < 25)) {
    if (isUrl(r.summary)) r.links = [...new Set([...(r.links || []), r.summary.trim()])];
    r.summary = undefined;
  }
  // "Skills: & CPL Optimization" style continuation groups belong to the group before them.
  const skills: { group: string; items: string[] }[] = [];
  for (const g of r.skills || []) {
    const cont = /^skills?$/i.test(g.group.trim()) && skills.length;
    if (cont) {
      const prev = skills[skills.length - 1];
      const items = [...g.items];
      if (items[0] && (/^[&a-z]/.test(items[0]) || prev.items[prev.items.length - 1]?.match(/[&(]$/))) prev.items[prev.items.length - 1] = `${prev.items[prev.items.length - 1]} ${items.shift()}`.replace(/\s+/g, " ");
      prev.items.push(...items);
    } else skills.push({ group: g.group, items: [...g.items] });
  }
  r.skills = skills.map((g) => ({ ...g, items: [...new Set(g.items.map((i) => i.trim()).filter(Boolean))] }));
  // Re-join bullets that were cut into fragments (a lowercase start or a dangling comma means it continues).
  r.experience = (r.experience || []).map((e) => {
    const out: string[] = [];
    for (const raw of e.bullets || []) {
      const b = raw.trim();
      if (!b) continue;
      const prev = out[out.length - 1];
      if (prev && (/^[a-z&(]/.test(b) || /[,;—–-]$/.test(prev) || b.length < 18)) out[out.length - 1] = `${prev.replace(/[;—–-]$/, "")}${/[,]$/.test(prev) ? "" : ","} ${b}`.replace(/\s+/g, " ").replace(/,,/g, ",");
      else out.push(b);
    }
    return { ...e, bullets: out.map((b) => b.replace(/\.\.$/, ".")) };
  });
  return r;
}
