import "server-only";
import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { tidyResume } from "@/lib/resume/health";
import { formatFor, sectionOrderFor } from "@/lib/resume/country";
import type { ResumeContent } from "@/lib/types";

/**
 * The same resume as the PDF, as a Word file: one column, real Word bullets, standard headings,
 * dates on a right tab stop. Some portals (and many recruiters) still ask for .docx.
 */
export async function resumeDocx(raw: ResumeContent, opts: { country?: string; name?: string } = {}): Promise<Buffer> {
  const r = tidyResume(raw, opts.name);
  const fmt = formatFor(opts.country || "US");
  const letter = fmt.paper === "letter";
  const width = letter ? 12240 : 11906;
  const margin = 820;
  const right = width - margin * 2;
  const FONT = "Calibri";
  const size = 21; // half-points: 10.5 pt
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size || size, bold: o.bold, italics: o.italics, color: o.color });
  const p = (children: TextRun[], o: { after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; tab?: boolean; keepNext?: boolean } = {}) =>
    new Paragraph({ children, spacing: { after: o.after ?? 0, before: o.before ?? 0 }, alignment: o.align, keepNext: o.keepNext, tabStops: o.tab ? [{ type: TabStopType.RIGHT, position: right }] : undefined });
  const heading = (label: string) =>
    new Paragraph({ children: [run(label.toUpperCase(), { bold: true, size: 22 })], spacing: { before: 200, after: 60 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "222222", space: 1 } } });
  const bullet = (text: string) => new Paragraph({ children: [run(text)], numbering: { reference: "dots", level: 0 }, spacing: { after: 20 } });
  const row = (left: string, rightText: string, o: { size?: number } = {}) => p([run(left, { bold: true, size: o.size }), ...(rightText ? [run(`\t${rightText}`, { size: o.size })] : [])], { tab: true, before: 80, keepNext: true });
  const sub = (text: string) => p([run(text, { italics: true, color: "444444" })], { keepNext: true, after: 20 });

  const out: Paragraph[] = [];
  out.push(p([run(r.name || "", { bold: true, size: 36 })]));
  if (r.headline) out.push(p([run(r.headline, { color: "333333" })]));
  const contact = [r.location, r.phone, r.email, ...(r.links || [])].filter(Boolean).join("  |  ");
  if (contact) out.push(p([run(contact, { size: 19, color: "444444" })], { after: 60 }));
  if (r.summary) {
    out.push(heading(fmt.personalStatement ? "Profile" : "Summary"));
    out.push(p([run(r.summary)]));
  }
  const education = () => {
    if (!r.education?.length) return;
    out.push(heading("Education"));
    for (const e of r.education) {
      out.push(row(e.degree || e.school, e.end || ""));
      const s = [e.degree ? e.school : "", e.location].filter(Boolean).join(" · ") + (e.details ? `. ${e.details}` : "");
      if (s) out.push(p([run(s, { color: "444444" })]));
    }
  };
  if (sectionOrderFor(r) === "education-first") education();
  if (r.skills?.length) {
    out.push(heading("Skills"));
    for (const g of r.skills) out.push(p([run(`${g.group}: `, { bold: true }), run(g.items.join(", "))], { after: 20 }));
  }
  if (r.experience?.length) {
    out.push(heading("Experience"));
    for (const e of r.experience.filter((x) => !x.brief)) {
      out.push(row(e.title || e.company, [e.start, e.end].filter(Boolean).join(" – ")));
      const org = [e.title ? e.company : "", e.location, e.url].filter(Boolean).join(" · ");
      if (org) out.push(sub(org));
      for (const b of e.bullets) out.push(bullet(b));
    }
    const brief = r.experience.filter((x) => x.brief);
    if (brief.length) {
      out.push(p([run("Earlier experience", { bold: true })], { before: 80, keepNext: true }));
      for (const e of brief) out.push(p([run([e.title, e.company].filter(Boolean).join(", ")), run(`\t${[e.start, e.end].filter(Boolean).join(" – ")}`)], { tab: true }));
    }
  }
  if (r.projects?.length) {
    out.push(heading("Projects"));
    for (const pr of r.projects) {
      out.push(row(pr.name, ""));
      if (pr.tech) out.push(sub(pr.tech));
      for (const b of pr.bullets) out.push(bullet(b));
    }
  }
  if (sectionOrderFor(r) !== "education-first") education();
  const list = (label: string, items?: string[], bullets = false) => {
    if (!items?.length) return;
    out.push(heading(label));
    if (bullets) for (const x of items) out.push(bullet(x));
    else out.push(p([run(items.join(" • "))]));
  };
  list("Certifications", r.certifications);
  list("Awards", r.awards, true);
  list("Additional", r.additional, true);

  const doc = new Document({
    creator: r.name || " ",
    title: `${r.name || "Resume"} - Resume`,
    numbering: { config: [{ reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width, height: letter ? 15840 : 16838 }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children: out }],
  });
  return Packer.toBuffer(doc);
}
