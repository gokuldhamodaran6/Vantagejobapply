/** Shared by the 3D scene and the page around it (kept out of the scene file so three.js loads lazily). */
export type HeroDemo = {
  company: string;
  title: string;
  place: string;
  reqs: string[];
  headline: string;
  bullet: string;
  score: number;
  fields: number;
};

export const CARDS = [
  { key: "resume", label: "Resume", color: "#2f5beb" },
  { key: "letter", label: "Cover letter", color: "#7b61ff" },
  { key: "form", label: "Application", color: "#e0457b" },
  { key: "kit", label: "Interview kit", color: "#f08a24" },
] as const;
