import type { ResumeContent } from "@/lib/types";

/**
 * Harvard Office of Career Services bullet rules, checked without AI:
 * start with an action verb, no personal pronouns, quantify where you can, vary the verbs,
 * keep each bullet a short phrase, and avoid weak openers.
 */

/** Action verbs grouped the way Harvard's resume guide groups them (past tense). */
export const ACTION_VERBS: Record<string, string[]> = {
  Leadership: [
    "Accomplished", "Achieved", "Administered", "Analyzed", "Assigned", "Attained", "Chaired", "Consolidated", "Contracted", "Coordinated", "Delegated",
    "Developed", "Directed", "Earned", "Evaluated", "Executed", "Handled", "Headed", "Impacted", "Improved", "Increased", "Led", "Mastered",
    "Orchestrated", "Organized", "Oversaw", "Planned", "Predicted", "Prioritized", "Produced", "Proved", "Recommended", "Regulated", "Reorganized",
    "Reviewed", "Scheduled", "Spearheaded", "Strengthened", "Supervised", "Surpassed", "Managed", "Launched", "Championed", "Drove", "Steered",
  ],
  Communication: [
    "Addressed", "Arbitrated", "Arranged", "Authored", "Collaborated", "Convinced", "Corresponded", "Delivered", "Developed", "Directed", "Documented",
    "Drafted", "Edited", "Energized", "Enlisted", "Formulated", "Influenced", "Interpreted", "Lectured", "Liaised", "Mediated", "Moderated",
    "Negotiated", "Persuaded", "Presented", "Promoted", "Publicized", "Reconciled", "Recruited", "Reported", "Rewrote", "Spoke", "Suggested",
    "Synthesized", "Translated", "Verbalized", "Wrote", "Briefed", "Pitched", "Published",
  ],
  Research: [
    "Clarified", "Collected", "Concluded", "Conducted", "Constructed", "Critiqued", "Derived", "Determined", "Diagnosed", "Discovered", "Evaluated",
    "Examined", "Extracted", "Formed", "Identified", "Inspected", "Interpreted", "Interviewed", "Investigated", "Modeled", "Organized", "Resolved",
    "Reviewed", "Summarized", "Surveyed", "Systematized", "Tested", "Analysed", "Measured", "Mapped", "Benchmarked", "Validated", "Assessed",
  ],
  Technical: [
    "Assembled", "Built", "Calculated", "Computed", "Designed", "Devised", "Engineered", "Fabricated", "Installed", "Maintained", "Operated",
    "Optimized", "Overhauled", "Programmed", "Remodeled", "Repaired", "Solved", "Standardized", "Streamlined", "Upgraded", "Automated", "Coded",
    "Configured", "Deployed", "Debugged", "Implemented", "Integrated", "Migrated", "Architected", "Refactored", "Shipped", "Scaled", "Prototyped",
  ],
  Teaching: [
    "Adapted", "Advised", "Clarified", "Coached", "Communicated", "Coordinated", "Demystified", "Developed", "Enabled", "Encouraged", "Evaluated",
    "Explained", "Facilitated", "Guided", "Informed", "Instructed", "Persuaded", "Set goals", "Stimulated", "Studied", "Taught", "Trained", "Mentored", "Tutored",
  ],
  Quantitative: [
    "Administered", "Allocated", "Analyzed", "Appraised", "Audited", "Balanced", "Budgeted", "Calculated", "Computed", "Developed", "Forecasted",
    "Managed", "Marketed", "Maximized", "Minimized", "Planned", "Projected", "Researched", "Reduced", "Cut", "Saved", "Grew", "Generated", "Doubled", "Tripled",
  ],
  Creative: [
    "Acted", "Composed", "Conceived", "Conceptualized", "Created", "Customized", "Designed", "Developed", "Directed", "Established", "Fashioned",
    "Founded", "Illustrated", "Initiated", "Instituted", "Integrated", "Introduced", "Invented", "Originated", "Performed", "Planned", "Published",
    "Redesigned", "Revised", "Revitalized", "Shaped", "Visualized", "Pioneered", "Crafted", "Produced",
  ],
  Helping: [
    "Assessed", "Assisted", "Clarified", "Coached", "Counseled", "Demonstrated", "Diagnosed", "Educated", "Enhanced", "Expedited", "Facilitated",
    "Familiarized", "Guided", "Motivated", "Participated", "Proposed", "Provided", "Referred", "Rehabilitated", "Represented", "Served", "Supported", "Resolved", "Cared",
  ],
  Organizational: [
    "Approved", "Accelerated", "Added", "Arranged", "Broadened", "Cataloged", "Centralized", "Changed", "Classified", "Collected", "Compiled",
    "Completed", "Controlled", "Defined", "Dispatched", "Executed", "Expanded", "Gained", "Gathered", "Generated", "Implemented", "Inspected",
    "Launched", "Monitored", "Operated", "Organized", "Prepared", "Processed", "Purchased", "Recorded", "Reduced", "Reinforced", "Retrieved",
    "Screened", "Selected", "Simplified", "Sold", "Specified", "Steered", "Structured", "Systematized", "Tabulated", "Unified", "Updated",
    "Utilized", "Validated", "Verified", "Delivered", "Ran", "Won", "Secured", "Negotiated", "Owned",
  ],
};

/** Irregular verbs (past -> base) that the -ed rules can't see. */
const IRREGULAR: Record<string, string> = {
  led: "lead", built: "build", wrote: "write", rewrote: "rewrite", taught: "teach", ran: "run", drove: "drive", made: "make", won: "win", grew: "grow",
  spoke: "speak", sold: "sell", oversaw: "oversee", set: "set", cut: "cut", began: "begin", brought: "bring", bought: "buy", chose: "choose", drew: "draw",
  found: "find", gave: "give", held: "hold", kept: "keep", met: "meet", overcame: "overcome", rebuilt: "rebuild", sent: "send", spent: "spend", took: "take",
  undertook: "undertake", upheld: "uphold", shot: "shoot", hit: "hit", put: "put", beat: "beat", flew: "fly", forecast: "forecast", wove: "weave",
  stood: "stand", saw: "see", thought: "think", told: "tell", understood: "understand", went: "go", shook: "shake", struck: "strike",
};

/** Openers that read as duties, not achievements. */
const WEAK = /^(responsible for|duties (included|include)|tasked with|helped|helping|help|worked on|working on|assisted with|assisted in|in charge of|participated in|involved in|was responsible|were responsible|my role|my responsibilities|i was|we were|served as)\b/i;

const VERB_BASES = (() => {
  const set = new Set<string>();
  const add = (w: string) => set.add(w.toLowerCase());
  for (const group of Object.values(ACTION_VERBS)) {
    for (const v of group) {
      const w = v.split(" ")[0].toLowerCase();
      add(w);
      if (w.endsWith("ied")) add(`${w.slice(0, -3)}y`);
      if (w.endsWith("ed")) {
        add(w.slice(0, -1)); // created -> create
        add(w.slice(0, -2)); // developed -> develop
        if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); // planned -> plan
      }
    }
  }
  for (const [past, base] of Object.entries(IRREGULAR)) {
    add(past);
    add(base);
  }
  return set;
})();

const NOT_VERBS = new Set(["the", "a", "an", "this", "that", "these", "those", "as", "in", "on", "for", "with", "at", "by", "from", "of", "to", "and", "or", "team", "role", "member", "part", "one", "some", "various", "multiple", "key", "main", "daily", "weekly", "monthly", "successfully", "highly", "very"]);
const AUX = new Set(["am", "was", "have", "had", "will", "would", "can", "could", "also", "then", "did", "do", "helped", "worked", "think", "believe", "feel"]);

function firstWord(b: string) {
  return (b.trim().replace(/^[•●▪■◦‣∙·*–—-]\s*/, "").split(/\s+/)[0] || "").replace(/[^A-Za-z'-]/g, "");
}

/** Is this word an action verb (any tense)? Accepts listed verbs and their forms, and other regular past-tense verbs ("Containerized"). */
export function isActionVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z-]/g, "");
  if (!w || NOT_VERBS.has(w)) return false;
  if (VERB_BASES.has(w)) return true;
  if (w.endsWith("s") && (VERB_BASES.has(w.slice(0, -1)) || VERB_BASES.has(w.slice(0, -2)))) return true; // leads, manages, finishes
  if (w.endsWith("ies") && VERB_BASES.has(`${w.slice(0, -3)}y`)) return true;
  if (w.length > 4 && w.endsWith("ed") && !/^(speed|breed|creed|greed|steed|indeed|hundred|kindred|sacred|naked|wicked|rugged|seasoned|talented|experienced|skilled|dedicated|motivated|qualified)$/.test(w)) return true; // regular past tense
  if (/^(re|co|over|under|out|up)-?/.test(w) && VERB_BASES.has(w.replace(/^(re|co|over|under|out|up)-?/, ""))) return true;
  return false;
}

/** Stem used to spot repeats ("Led", "Leads" and "Lead" are the same verb). */
function verbKey(word: string): string {
  let w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/ie[sd]$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/([bcdfghjklmnpqrstvwxz])\1ed$/.test(w)) return w.slice(0, -3);
  if (w.endsWith("ed") || w.endsWith("es")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w.replace(/e$/, "");
}

/** A few alternatives from the same Harvard group, for "vary your verbs" tips. */
export function verbAlternatives(word: string, n = 3): string[] {
  const key = verbKey(word);
  const group = Object.values(ACTION_VERBS).find((g) => g.some((v) => verbKey(v.split(" ")[0]) === key)) || ACTION_VERBS.Leadership;
  return [...new Set(group)].filter((v) => verbKey(v.split(" ")[0]) !== key).slice(0, n);
}

// Case-sensitive on purpose: "US" and "ME" are places, not pronouns.
const PRONOUN_ANY = /\b(me|my|myself|we|our|ours|ourselves|us|Me|My|Myself|We|Our|Ours|Ourselves)\b/;
const PRONOUN_I = /(^|[^A-Za-z])I('m|'ve|'d|'ll)?\s+([a-z]+)/g;

function hasPronoun(b: string): string | null {
  const m = b.match(PRONOUN_ANY);
  if (m) return m[0];
  for (const x of b.matchAll(PRONOUN_I)) {
    if (x[2] || AUX.has(x[3]) || isActionVerb(x[3])) return x[2] ? `I${x[2]}` : "I";
  }
  if (/^I\b/.test(b.trim())) return "I";
  return null;
}

const HAS_NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozens?|hundreds?|thousands?|millions?|billions?|doubled|tripled|halved|twice)\b/i;

export type BulletIssueKind = "weak" | "pronoun" | "verb" | "repeat" | "long" | "narrative" | "metric";

export type BulletIssue = {
  kind: BulletIssueKind;
  /** Soft tips (quantify) never count against a bullet. */
  soft: boolean;
  section: "experience" | "projects";
  /** Entry index (role/project) and bullet index inside it. */
  index: number;
  bullet: number;
  /** "Data Analyst · Monzo, bullet 2" */
  where: string;
  /** The bullet itself, trimmed for display. */
  bulletText: string;
  /** What is wrong, in plain words. */
  text: string;
  /** How to fix it. */
  tip: string;
};

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n) > 30 ? s.lastIndexOf(" ", n) : n)}…` : s);

/** Check every experience and project bullet against Harvard's rules. Pure: no AI, no network. */
export function lintBullets(content: ResumeContent | null | undefined): BulletIssue[] {
  if (!content) return [];
  const issues: BulletIssue[] = [];
  const entries = [
    ...(content.experience || []).map((e, i) => ({ section: "experience" as const, index: i, label: [e.title, e.company].filter(Boolean).join(" · ") || `Role ${i + 1}`, bullets: e.bullets || [] })),
    ...(content.projects || []).map((p, i) => ({ section: "projects" as const, index: i, label: p.name || `Project ${i + 1}`, bullets: p.bullets || [] })),
  ];
  const overall = new Map<string, number>();
  for (const entry of entries) {
    const seen = new Map<string, number>();
    entry.bullets.forEach((raw, bi) => {
      const b = (raw || "").trim().replace(/^[•●▪■◦‣∙·*–—-]\s*/, "");
      if (b.length < 3) return;
      const where = `${entry.label}, bullet ${bi + 1}`;
      const push = (kind: BulletIssueKind, text: string, tip: string, soft = false) =>
        issues.push({ kind, soft, section: entry.section, index: entry.index, bullet: bi, where, bulletText: short(b), text, tip });
      const word = firstWord(b);
      const weak = b.match(WEAK);
      const pronoun = hasPronoun(b);
      if (weak) {
        push("weak", `Starts with “${weak[0]}”, which reads as a duty, not an achievement.`, "Lead with what you did and the result: “Managed…”, “Built…”, “Reduced…”.");
      } else if (!isActionVerb(word) && !(pronoun && /^(i|i'm|i've|i'd|i'll|we|my|our)$/i.test(word))) {
        const ing = /ing$/i.test(word) && word.length > 5;
        push("verb", ing ? `Starts with “${word}”; Harvard recommends a past-tense verb.` : `Doesn't start with an action verb${word ? ` (“${word}”)` : ""}.`, ing ? `Try “${word.replace(/ing$/i, "ed")}” (or the present tense for your current role).` : "Start with a verb such as Led, Built, Analyzed, Designed or Improved.");
      }
      if (pronoun) push("pronoun", `Uses “${pronoun}”. Resumes leave out personal pronouns.`, "Drop the pronoun and start with the verb: “Led…”, not “I led…”.");
      // Repeated opening verb: within one role always; across the resume from the third time.
      if (!weak && isActionVerb(word)) {
        const key = verbKey(word);
        const inRole = seen.get(key) || 0;
        const total = overall.get(key) || 0;
        seen.set(key, inRole + 1);
        overall.set(key, total + 1);
        if (inRole >= 1 || total >= 2) {
          const alts = verbAlternatives(word);
          push("repeat", `“${word}” already opens ${inRole >= 1 ? "another bullet in this role" : `${total} other bullets`}.`, alts.length ? `Vary it: ${alts.join(", ")}.` : "Use a different verb.");
        }
      }
      const words = b.split(/\s+/).filter(Boolean).length;
      if (words > 30) push("long", `Long bullet (${words} words).`, "Keep it to one or two lines, under ~30 words: the result, then how.");
      else if (/[.!?]\s+[A-Z]/.test(b)) push("narrative", "Reads as full sentences, not a bullet.", "Make it one phrase: verb, what you did, the result. No full stops in the middle.");
      if (!HAS_NUMBER.test(b)) push("metric", "No number.", "If you know it, add a real figure (how many, how much, how often, % change). Never guess one.", true);
    });
  }
  const order: Record<BulletIssueKind, number> = { weak: 0, pronoun: 1, verb: 2, repeat: 3, long: 4, narrative: 5, metric: 6 };
  return issues.sort((a, b) => order[a.kind] - order[b.kind]);
}

export type HarvardSummary = {
  /** Bullets checked. */
  total: number;
  /** Bullets with no hard issues (a missing number is only a tip). */
  ok: number;
  /** Hard issues, then soft tips. */
  issues: { where: string; text: string; tip: string; kind: BulletIssueKind; soft: boolean }[];
  byKind: Record<BulletIssueKind, number>;
  quantified: number;
};

export function harvardScore(content: ResumeContent | null | undefined, list = lintBullets(content)): HarvardSummary {
  const all = content ? [...(content.experience || []).map((e) => e.bullets || []), ...(content.projects || []).map((p) => p.bullets || [])] : [];
  const bullets = all.flatMap((bs, i) => bs.map((b, j) => ({ b: (b || "").trim(), key: `${i}:${j}` }))).filter((x) => x.b.length >= 3);
  // Keys must match lintBullets' entry indexing: experience entries first, then projects.
  const expCount = content?.experience?.length || 0;
  const bad = new Set(list.filter((x) => !x.soft).map((x) => `${x.section === "experience" ? x.index : expCount + x.index}:${x.bullet}`));
  const byKind = { weak: 0, pronoun: 0, verb: 0, repeat: 0, long: 0, narrative: 0, metric: 0 } as Record<BulletIssueKind, number>;
  for (const x of list) byKind[x.kind]++;
  return {
    total: bullets.length,
    ok: bullets.filter((x) => !bad.has(x.key)).length,
    issues: list.map(({ where, text, tip, kind, soft }) => ({ where, text, tip, kind, soft })),
    byKind,
    quantified: bullets.filter((x) => HAS_NUMBER.test(x.b)).length,
  };
}

/** Rules for the AI writer, in the same words as the checks above. */
export const HARVARD_PROMPT = `HARVARD BULLET RULES (every bullet is checked against these afterwards)
- Start every bullet with an action verb (e.g. Led, Built, Analyzed, Designed, Negotiated, Reduced, Launched, Trained). Past tense for past roles, present tense for a current role.
- No personal pronouns anywhere: never I, me, my, we, our.
- Never open with "Responsible for", "Helped", "Worked on", "Duties included", "Tasked with", "Assisted with", "Involved in".
- Quantify ONLY with numbers that already exist in the resume. Never invent a number, %, team size, budget, time saved or result. If no number exists, write a clear outcome instead.
- Vary opening verbs: never the same opening verb twice in one role, and not more than twice in the whole resume.
- Each bullet is one phrase of at most ~30 words (1–2 lines), not a narrative paragraph.
- Never invent skills, tools, employers, titles, degrees or dates.`;
