import type { LetterTone, ResumeStyle } from "@/lib/types";

/** All styles are single-column, real-text and ATS-safe; they differ in typography and density. */
export const RESUME_STYLES: Record<ResumeStyle, {
  label: string;
  blurb: string;
  font: "helvetica" | "times";
  accent: [number, number, number];
  nameSize: number;
  body: number;
  heading: number;
  lineGap: number;
  sectionGap: number;
  center: boolean;
  rule: "full" | "none";
  css: { font: string; accent: string; nameSize: number; body: number; center: boolean };
}> = {
  classic: {
    label: "Classic", blurb: "The layout recruiters expect. Safest for every ATS.",
    font: "helvetica", accent: [0.07, 0.07, 0.07], nameSize: 20, body: 10.2, heading: 10.5, lineGap: 1.32, sectionGap: 9, center: false, rule: "full",
    css: { font: "Arial, Helvetica, sans-serif", accent: "#111111", nameSize: 22, body: 11.5, center: false },
  },
  modern: {
    label: "Modern", blurb: "A touch of colour and more air. Great for tech, marketing and design.",
    font: "helvetica", accent: [0.12, 0.31, 0.82], nameSize: 22, body: 10.2, heading: 10.5, lineGap: 1.36, sectionGap: 10, center: false, rule: "full",
    css: { font: "Arial, Helvetica, sans-serif", accent: "#1f4fd1", nameSize: 24, body: 11.5, center: false },
  },
  compact: {
    label: "Compact", blurb: "Fits more on one page. For experienced profiles.",
    font: "helvetica", accent: [0.07, 0.07, 0.07], nameSize: 18, body: 9.5, heading: 9.8, lineGap: 1.24, sectionGap: 7, center: false, rule: "full",
    css: { font: "Arial, Helvetica, sans-serif", accent: "#111111", nameSize: 20, body: 10.5, center: false },
  },
  executive: {
    label: "Executive", blurb: "Traditional serif with a centred header. Finance, consulting, leadership.",
    font: "times", accent: [0.1, 0.1, 0.1], nameSize: 21, body: 10.8, heading: 11, lineGap: 1.3, sectionGap: 9, center: true, rule: "full",
    css: { font: "Georgia, 'Times New Roman', serif", accent: "#1a1a1a", nameSize: 24, body: 12, center: true },
  },
};

export const LETTER_TONES: Record<LetterTone, { label: string; blurb: string; guide: string }> = {
  confident: {
    label: "Confident", blurb: "Direct and specific. Works almost everywhere.",
    guide: "Direct, specific and assured. Short declarative sentences. Lead with evidence, not enthusiasm.",
  },
  warm: {
    label: "Warm", blurb: "Personable and human. Mission-driven teams, healthcare, education.",
    guide: "Personable and sincere. Show genuine connection to the team's mission through a concrete detail. Still evidence-led.",
  },
  bold: {
    label: "Bold", blurb: "Punchy, startup energy. Shows ambition.",
    guide: "Punchy and energetic. Open with the single strongest result. Tight sentences, active voice, a clear point of view on the role.",
  },
  formal: {
    label: "Formal", blurb: "Traditional and polished. Banking, law, government.",
    guide: "Polished and traditional. Complete sentences, measured tone, no contractions, no slang.",
  },
};
