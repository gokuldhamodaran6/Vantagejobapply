import "server-only";
import { tidyResume } from "@/lib/resume/health";
import { PDFDict, PDFDocument, PDFFont, PDFHexString, PDFName, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";
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

/** Wrap a list without ever splitting an item across lines (unless one item alone is wider than the line). */
function wrapItems(items: string[], sep: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const raw of items) {
    const it = safe(raw);
    const next = cur ? `${cur}${sep}${it}` : it;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(`${cur}${sep.trim() === "," ? "," : ""}`);
      if (font.widthOfTextAtSize(it, size) > width) {
        const parts = wrap(it, font, size, width);
        lines.push(...parts.slice(0, -1));
        cur = parts[parts.length - 1] || "";
      } else cur = it;
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

// A structured copy of the resume rides in the PDF's info dictionary under a neutral key, so re-uploading
// a PDF Vantage made reads back exactly, instead of being re-parsed from wrapped text.
const DATA_KEY = "ResumeData";
const info = (doc: PDFDocument) => (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
export async function embeddedResume(bytes: ArrayBuffer | Uint8Array): Promise<ResumeContent | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const v = info(doc).lookup(PDFName.of(DATA_KEY));
    const txt = v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : "";
    if (!txt) return null;
    const r = JSON.parse(txt) as ResumeContent & { v?: number };
    return r && typeof r === "object" && Array.isArray(r.experience) ? r : null;
  } catch {
    return null;
  }
}

function finish(doc: PDFDocument, title: string, author: string, data?: ResumeContent) {
  if (data) info(doc).set(PDFName.of(DATA_KEY), PDFHexString.fromText(JSON.stringify(data)));
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
  // A heading never sits alone at the foot of a page: keep it with the first few lines below it.
  ensure(c, st.heading * 1.8 + c.size * c.lineGap * 5);
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
      // Wrapped lines hang under the first item, so each group reads as one block.
      const lines = wrapItems(g.items, ", ", c.font, c.size, c.right - c.left - lw);
      ensure(c, c.size * c.lineGap);
      c.page.drawText(label, { x: c.left, y: c.y - c.size, size: c.size, font: c.bold, color: rgb(0.07, 0.07, 0.07) });
      lines.forEach((l) => {
        ensure(c, c.size * c.lineGap);
        c.page.drawText(l, { x: c.left + lw, y: c.y - c.size, size: c.size, font: c.font, color: rgb(0.07, 0.07, 0.07) });
        c.y -= c.size * c.lineGap;
      });
    }
  }
  const projectsBlock = () => {
  if (r.projects?.length) {
      heading(c, st, "Projects");
      for (const p of r.projects) {
        // Never strand a project name at the foot of a page: keep it with its stack line and first bullet.
        ensure(c, c.size * c.lineGap * 4);
        rowWithRight(c, p.name, "", c.bold, c.size + 0.2);
        if (p.tech) text(c, p.tech, { font: c.italic, size: c.size - 0.2, color: [0.25, 0.25, 0.25] });
        c.y -= 1;
        bullets(c, p.bullets);
        c.y -= 2;
      }
    }
  };
  if (r.experience?.length) {
    heading(c, st, "Experience");
    const full = r.experience.filter((e) => !e.brief);
    const brief = r.experience.filter((e) => e.brief);
    for (const e of full) {
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      // Keep a role's title with its company line and first two bullet lines, never orphaned at a page foot.
      ensure(c, c.size * c.lineGap * 4.5);
      rowWithRight(c, e.title || e.company, dates, c.bold, c.size + 0.2);
      const org = [e.title ? e.company : "", e.location, e.url].filter(Boolean).join(" · ");
      if (org) text(c, org, { font: c.italic, size: c.size - 0.2, color: [0.25, 0.25, 0.25] });
      c.y -= 1;
      bullets(c, e.bullets);
      c.y -= 3;
    }
    if (brief.length) {
      // Older roles: one line each, so the page stays on what matters.
      ensure(c, c.size * c.lineGap * (brief.length + 1));
      text(c, "Earlier experience", { font: c.bold, size: c.size - 0.2, color: [0.2, 0.2, 0.2] });
      for (const e of brief) {
        const dates = [e.start, e.end].filter(Boolean).join(" – ");
        rowWithRight(c, [e.title, e.company].filter(Boolean).join(", "), dates, c.font, c.size - 0.2);
      }
      c.y -= 3;
    }
  }
  projectsBlock();
  if (!educationFirst) education();
  if (r.certifications?.length) {
    heading(c, st, "Certifications");
    for (const l of wrapItems(r.certifications, "  •  ", c.font, c.size, c.right - c.left)) text(c, l);
  }
  if (r.awards?.length) {
    heading(c, st, "Awards");
    bullets(c, r.awards);
  }
  if (r.additional?.length) {
    heading(c, st, "Additional");
    bullets(c, r.additional);
  }
  return finish(c.doc, `${r.name || fmt.docName} - ${fmt.docName}`, r.name || "", r);
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

/**
 * Trim a resume until its PDF fits the page target, cutting the least valuable lines first:
 * the "Additional" section, long skill lists, then the last bullet of the role with the most bullets
 * (older roles before the current one, never below one bullet), then extra certifications and awards.
 * Nothing is rewritten; lines are only removed.
 */
export async function fitToPages(r0: ResumeContent, pages: number, opts: { style?: ResumeStyle; country?: string } = {}): Promise<{ resume: ResumeContent; pages: number; trimmed: number }> {
  const r: ResumeContent = JSON.parse(JSON.stringify(r0));
  const count = async () => (await PDFDocument.load(await resumePdf(r, opts))).getPageCount();
  let n = await count();
  let trimmed = 0;
  const exp = () => (r.experience || []).filter((e) => !e.brief);
  // Cut the weakest line: no result, no number, no promotion or leadership signal; later lines first on a tie.
  const value = (b: string, i: number) => (/\d[\d,.]*%/.test(b) ? 4 : 0) + (/\b(?!(19|20)\d{2}\b)\d[\d,.]*\+?/.test(b) ? 2 : 0) + (/\b(promoted|led a team|award|mentored|funding|acquisition)\b/i.test(b) ? 2 : 0) - i * 0.1;
  const cutBullet = (floorFirst: number, floorOther: number) => () => {
    const roles = exp();
    const cands = roles.map((e, i) => ({ e, floor: i === 0 ? floorFirst : i === 1 ? Math.max(floorOther, 2) : floorOther })).filter((x) => x.e.bullets.length > x.floor);
    if (!cands.length) return false;
    // Older roles give up lines first; then whichever role has the most.
    const t = cands.sort((a, b) => roles.indexOf(b.e) - roles.indexOf(a.e) || b.e.bullets.length - a.e.bullets.length)[0].e;
    let worst = 0;
    t.bullets.forEach((b, i) => { if (value(b, i) < value(t.bullets[worst], worst)) worst = i; });
    t.bullets.splice(worst, 1);
    return true;
  };
  const cap = (get: () => string[] | undefined, set: (x: string[]) => void, n: number) => () => {
    const x = get() || [];
    return x.length > n ? (set(x.slice(0, n)), true) : false;
  };
  const capSkills = (n: number) => () => {
    const g = (r.skills || []).find((x) => x.items.length > n);
    return g ? ((g.items = g.items.slice(0, n)), true) : false;
  };
  // Achievements outrank lists: certificates, awards and long skill lines go before real bullets do.
  const steps: (() => boolean)[] = [
    cap(() => r.additional, (x) => (r.additional = x), 0),
    cap(() => r.certifications, (x) => (r.certifications = x), 4),
    capSkills(8),
    cap(() => r.awards, (x) => (r.awards = x), 2),
    cutBullet(4, 2),
    // Less relevant projects (listed later) shrink to one line before real experience does.
    () => {
      const p = (r.projects || []).slice(2).find((x) => x.bullets.length > 1);
      return p ? (p.bullets.pop(), true) : false;
    },
    cap(() => r.certifications, (x) => (r.certifications = x), 3),
    cap(() => r.awards, (x) => (r.awards = x), 1),
    capSkills(6),
    () => ((r.skills || []).length > 3 ? (r.skills!.pop(), true) : false),
    cutBullet(3, 1),
    () => {
      const p = (r.projects || []).filter((x) => x.bullets.length > 2).sort((a, b) => b.bullets.length - a.bullets.length)[0];
      return p ? (p.bullets.pop(), true) : false;
    },
    cap(() => r.certifications, (x) => (r.certifications = x), 2),
    cutBullet(2, 1),
    () => {
      const p = (r.projects || []).filter((x) => x.bullets.length > 1).sort((a, b) => b.bullets.length - a.bullets.length)[0];
      return p ? (p.bullets.pop(), true) : false;
    },
  ];
  for (let guard = 0; n > pages && guard < 30; guard++) {
    const step = steps.find((s) => s());
    if (!step) break;
    trimmed++;
    n = await count();
  }
  return { resume: r, pages: n, trimmed };
}
