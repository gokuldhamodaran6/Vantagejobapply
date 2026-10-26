import "server-only";

/**
 * Uploaded resume file → plain text that keeps the visual line layout
 * (right-aligned dates stay on the same line, separated by wide gaps).
 */
export async function fileToText(name: string, type: string, buf: ArrayBuffer): Promise<string> {
  const lower = name.toLowerCase();
  if (type === "application/pdf" || lower.endsWith(".pdf")) return pdfToText(buf);
  if (lower.endsWith(".docx") || type.includes("officedocument.wordprocessingml")) return docxToText(buf);
  if (lower.endsWith(".txt") || lower.endsWith(".md") || type.startsWith("text/")) return new TextDecoder().decode(buf);
  throw new Error("Upload a PDF, Word (.docx) or text file.");
}

type Item = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Item[]).filter((i) => typeof i.str === "string" && i.str.trim() !== "");
    // Group items into visual lines by their baseline (y), then order by x.
    const lines: { y: number; items: Item[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, h * 0.35));
      if (line) line.items.push(it);
      else lines.push({ y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let out = "";
      let lastEnd = -Infinity;
      for (const it of l.items) {
        const x = it.transform[4];
        const size = Math.abs(it.transform[0]) || 10;
        const gap = x - lastEnd;
        if (out) out += gap > size * 2.2 ? "    " : gap > size * 0.18 && !/\s$/.test(out) && !/^\s/.test(it.str) ? " " : "";
        out += it.str;
        lastEnd = x + (it.width || it.str.length * size * 0.5);
      }
      pages.push(out.replace(/[ \t]+$/, ""));
    }
  }
  return pages.join("\n").replace(/\u0000/g, "").replace(/[•]/g, "•");
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
  return html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|h\d|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "    ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
