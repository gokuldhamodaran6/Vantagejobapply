import "server-only";
import { tidyResume } from "@/lib/resume/health";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { RESUME_STYLES } from "./styles";
import { formatFor, sectionOrderFor } from "./country";
import type { ResumeContent, ResumeStyle } from "@/lib/types";

/* Characters the standard PDF fonts (WinAnsi) can draw; everything else is mapped to a close ASCII form. */
const EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function safe(s: string | undefined | null): string {
  if (!s) return "";
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA.includes(ch)) out += ch;
    else if (ch === "\n" || ch === "\t") out += " ";
    else if (ch === "→" || ch === "➔") out += "->";
    else if (ch === "≥") out += ">=";
    else if (ch === "≤") out += "<=";
    else if (ch === "×") out += "x";
    else if (ch === "₹") out += "INR ";
    else if (ch === "−") out += "-";
    else {
      const ascii = ch.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
      out += ascii;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  size: number;
  lineGap: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pageSize: [number, number];
};

function newPage(c: Ctx) {
  c.page = c.doc.addPage(c.pageSize);
  c.y = c.pageSize[1] - c.top;
}

function ensure(c: Ctx, h: number) {
  if (c.y - h < c.bottom) newPage(c);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      // Hard-break very long tokens (URLs).
      let word = w;
      while (font.widthOfTextAtSize(word, size) > width) {
        let i = word.length;
        while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > width) i--;
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function text(c: Ctx, s: string, opts: { x?: number; font?: PDFFont; size?: number; color?: [number, number, number]; width?: number; indent?: number; align?: "left" | "center" } = {}) {
  const font = opts.font || c.font;
  const size = opts.size || c.size;
  const x = opts.x ?? c.left;
  const width = opts.width ?? c.right - x;
  const lines = wrap(s, font, size, width - (opts.indent || 0));
  for (let i = 0; i < lines.length; i++) {
    ensure(c, size * c.lineGap);
    const lx = opts.align === "center" ? (c.pageSize[0] - font.widthOfTextAtSize(lines[i], size)) / 2 : x + (i > 0 ? opts.indent || 0 : 0);
    c.page.drawText(lines[i], { x: lx, y: c.y - size, size, font, color: rgb(...(opts.color || [0.07, 0.07, 0.07])) });
    c.y -= size * c.lineGap;
  }
}

function rowWithRight(c: Ctx, leftText: string, rightText: string, font: PDFFont, size: number) {
  const rw = rightText ? font.widthOfTextAtSize(safe(rightText), size - 0.4) : 0;
  const leftLines = wrap(leftText, font, size, c.right - c.left - rw - 12);
  ensure(c, size * c.lineGap * leftLines.length);
  leftLines.forEach((l, i) => {
    c.page.drawText(l, { x: c.left, y: c.y - size, size, font, color: rgb(0.07, 0.07, 0.07) });
    if (i === 0 && rightText) c.page.drawText(safe(rightText), { x: c.right - rw, y: c.y - size, size: size - 0.4, font: c.font, color: rgb(0.2, 0.2, 0.2) });
    c.y -= size * c.lineGap;
  });
}

async function setup(country: string, style: ResumeStyle) {
  const st = RESUME_STYLES[style] || RESUME_STYLES.classic;
  const doc = await PDFDocument.create();
  const fam = st.font === "times" ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic] : [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique];
  const [font, bold, italic] = await Promise.all(fam.map((f) => doc.embedFont(f)));
  // Paper follows the country's format: US Letter for US/CA, A4 elsewhere (no country = Letter).
  const pageSize: [number, number] = formatFor(country).paper === "letter" ? [612, 792] : [595.28, 841.89];
  const margin = style === "compact" ? 40 : 46;
  const c: Ctx = { doc, page: doc.addPage(pageSize), y: 0, font, bold, italic, size: st.body, lineGap: st.lineGap, left: margin, right: pageSize[0] - margin, top: margin - 4, bottom: margin, pageSize };
  c.y = pageSize[1] - c.top;
  return { c, st };
}

function finish(doc: PDFDocument, title: string, author: string) {
  // Neutral metadata: nothing that names a tool.
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setCreator(author || " ");
  doc.setProducer(" ");
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc.save({ useObjectStreams: false });
}

function headerBlock(c: Ctx, st: (typeof RESUME_STYLES)[ResumeStyle], r: Pick<ResumeContent, "name" | "headline" | "location" | "phone" | "email" | "links">) {
  const center = st.center;
  text(c, r.name || "", { font: c.bold, size: st.nameSize, color: st.accent, align: center ? "center" : "left" });
  c.y -= 1;
  if (r.headline) text(c, r.headline, { size: st.body + 0.8, align: center ? "center" : "left", color: [0.2, 0.2, 0.2] });
  const contact = [r.location, r.phone, r.email, ...(r.links || [])].filter(Boolean).join("  |  ");
  if (contact) text(c, contact, { size: st.body - 0.6, align: center ? "center" : "left", color: [0.25, 0.25, 0.25] });
}

function heading(c: Ctx, st: (typeof RESUME_STYLES)[ResumeStyle], label: string) {
  c.y -= st.sectionGap * 0.7;
  ensure(c, st.heading * 3.2);
  const lab = safe(label.toUpperCase());
  const size = st.heading;
  const x = st.center ? (c.pageSize[0] - c.bold.widthOfTextAtSize(lab, size)) / 2 : c.left;
  c.page.drawText(lab, { x, y: c.y - size, size, font: c.bold, color: rgb(...st.accent) });
  c.y -= size * 1.32;
  if (st.rule === "full") c.page.drawLine({ start: { x: c.left, y: c.y + 2 }, end: { x: c.right, y: c.y + 2 }, thickness: 0.7, color: rgb(...st.accent) });
  c.y -= 3;
}

function bullets(c: Ctx, items: string[]) {
  const size = c.size;
  const indent = 11;
  for (const b of items.filter((x) => x && x.trim())) {
    const lines = wrap(b, c.font, size, c.right - c.left - indent);
    ensure(c, size * c.lineGap * Math.min(lines.length, 2));
    c.page.drawText("•", { x: c.left + 2, y: c.y - size, size, font: c.font, color: rgb(0.07, 0.07, 0.07) });
    for (const l of lines) {
      ensure(c, size * c.lineGap);
      c.page.drawText(l, { x: c.left + indent, y: c.y - size, size, font: c.font, color: rgb(0.07, 0.07, 0.07) });
      c.y -= size * c.lineGap;
    }
    c.y -= 0.8;
  }
}

export async function resumePdf(raw: ResumeContent, opts: { style?: ResumeStyle; country?: string; name?: string } = {}): Promise<Uint8Array> {
  // Never render broken data: full name, no URL-as-summary, re-joined bullets, merged skill groups.
  const r = tidyResume(raw, opts.name);
  const style = opts.style || "classic";
  const fmt = formatFor(opts.country || "US");
  const { c, st } = await setup(opts.country || "US", style);
  headerBlock(c, st, r);

  if (r.summary) {
    heading(c, st, fmt.personalStatement ? "Profile" : "Summary");
    text(c, r.summary);
  }
  const educationFirst = sectionOrderFor(r) === "education-first";
  const education = () => {
    if (!r.education?.length) return;
    heading(c, st, "Education");
    for (const e of r.education) {
      rowWithRight(c, e.degree || e.school, e.end || "", c.bold, c.size);
      const sub = [e.degree ? e.school : "", e.location].filter(Boolean).join(" · ") + (e.details ? `. ${e.details}` : "");
      if (sub) text(c, sub, { size: c.size - 0.3, color: [0.25, 0.25, 0.25] });
      c.y -= 1.5;
    }
  };
  // Students, new grads and people with under 2 years of experience lead with education.
  if (educationFirst) education();
  if (r.skills?.length) {
    heading(c, st, "Skills");
    for (const g of r.skills) {
      const label = `${safe(g.group)}: `;
      const lw = c.bold.widthOfTextAtSize(label.trim(), c.size) + c.size * 0.38;
      const lines = wrap(g.items.join(", "), c.font, c.size, c.right - c.left - lw);
      ensure(c, c.size * c.lineGap);
      c.page.drawText(label, { x: c.left, y: c.y - c.size, size: c.size, font: c.bold, color: rgb(0.07, 0.07, 0.07) });
      lines.forEach((l, i) => {
        ensure(c, c.size * c.lineGap);
        c.page.drawText(l, { x: c.left + (i === 0 ? lw : 0), y: c.y - c.size, size: c.size, font: c.font, color: rgb(0.07, 0.07, 0.07) });
        c.y -= c.size * c.lineGap;
      });
    }
  }
  if (r.experience?.length) {
    heading(c, st, "Experience");
    for (const e of r.experience) {
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      rowWithRight(c, e.title || e.company, dates, c.bold, c.size + 0.2);
      const org = [e.title ? e.company : "", e.location].filter(Boolean).join(" · ");
      if (org) text(c, org, { font: c.italic, size: c.size - 0.2, color: [0.25, 0.25, 0.25] });
      c.y -= 1;
      bullets(c, e.bullets);
      c.y -= 3;
    }
  }
  if (r.projects?.length) {
    heading(c, st, "Projects");
    for (const p of r.projects) {
      rowWithRight(c, `${p.name}${p.tech ? ` (${p.tech})` : ""}`, "", c.bold, c.size);
      bullets(c, p.bullets);
      c.y -= 2;
    }
  }
  if (!educationFirst) education();
  if (r.certifications?.length) {
    heading(c, st, "Certifications");
    text(c, r.certifications.join("  •  "));
  }
  if (r.awards?.length) {
    heading(c, st, "Awards");
    bullets(c, r.awards);
  }
  if (r.additional?.length) {
    heading(c, st, "Additional");
    bullets(c, r.additional);
  }
  return finish(c.doc, `${r.name || fmt.docName} - ${fmt.docName}`, r.name || "");
}

export async function coverLetterPdf(letter: string, raw: Pick<ResumeContent, "name" | "headline" | "location" | "phone" | "email" | "links">, opts: { style?: ResumeStyle; country?: string; name?: string } = {}): Promise<Uint8Array> {
  const r = { ...raw, name: tidyResume({ name: raw.name } as ResumeContent, opts.name).name };
  const style = opts.style || "classic";
  const { c, st } = await setup(opts.country || "US", style);
  c.size = st.body + 0.8;
  c.lineGap = 1.42;
  headerBlock(c, st, { ...r, headline: undefined });
  c.y -= 18;
  const country = opts.country || "US";
  text(c, new Date().toLocaleDateString(formatFor(country).spelling === "us" ? "en-US" : "en-GB", { day: "numeric", month: "long", year: "numeric" }));
  c.y -= 10;
  for (const para of letter.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = para.split("\n");
    for (const l of lines) text(c, l.trim() || " ");
    c.y -= c.size * 0.65;
  }
  return finish(c.doc, `${r.name || "Cover letter"} - Cover Letter`, r.name || "");
}
