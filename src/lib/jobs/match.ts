import { analyzeText, normCompany } from "./signals";
import { roleSimilarity } from "./roles";
import { stateHit } from "./places";
import { authorisedNow, needsSponsorshipLater } from "@/lib/answers";
import { occupationCheck } from "@/lib/countries";
import type { Job, MatchResult, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

export { roleSimilarity } from "./roles";

const LEVEL_ORDER = ["intern", "entry", "mid", "senior", "lead"];

const CITIZEN_LIKE = new Set(["citizen", "permanent_resident"]);

export type MatchCtx = {
  roles: TargetRole[];
  prefs: TargetPrefs | null;
  auth: WorkAuth[];
  sponsorsLoaded?: Set<string>; // countries whose sponsor register is loaded
};

export function matchJob(job: Job, ctx: MatchCtx): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const signals = analyzeText(job.title, job.description);
  let tooSenior = false;

  // 1. Role fit
  let best: TargetRole | undefined;
  let roleScore = 0;
  for (const role of ctx.roles.filter((r) => r.active)) {
    let s = roleSimilarity(role.title, job.title);
    if (role.keywords.length && job.description) {
      const d = job.description.toLowerCase();
      const hit = role.keywords.filter((k) => d.includes(k.toLowerCase())).length;
      s = s * 0.75 + (hit / role.keywords.length) * 0.25;
    }
    if (s > roleScore) {
      roleScore = s;
      best = role;
    }
  }
  let score = Math.round(roleScore * 55);
  if (best && roleScore >= 0.6) reasons.push(`Fits your “${best.title}” target`);

  // 2. Level
  if (best && signals.level) {
    const want = best.levels.map((l) => LEVEL_ORDER.indexOf(l)).filter((i) => i >= 0);
    const got = LEVEL_ORDER.indexOf(signals.level);
    const dist = want.length ? Math.min(...want.map((w) => Math.abs(w - got))) : 0;
    if (dist === 0) {
      score += 12;
      reasons.push(`Level matches (${signals.level})`);
    } else if (dist === 1) {
      score += 4;
      warnings.push(`Stretch: listed as ${signals.level}`);
    } else {
      score -= 12;
      warnings.push(`Level mismatch: listed as ${signals.level}`);
      if (got > Math.max(...want)) tooSenior = true;
    }
  } else {
    score += 6;
  }

  // 3. Location
  const prefs = ctx.prefs;
  if (prefs) {
    const inCountry = !prefs.countries.length || prefs.countries.includes(job.country);
    if (!inCountry) {
      score -= 15;
      warnings.push("Outside your target countries");
    } else {
      const loc = (job.location || "").toLowerCase();
      const cityHit = prefs.locations.some((l) => l.country === job.country && ((l.city && loc.includes(l.city.toLowerCase())) || (l.state && stateHit(loc, l.state))));
      if (cityHit) {
        score += 12;
        reasons.push("In one of your target locations");
      } else if (job.remote && prefs.remote_ok) {
        score += 10;
        reasons.push("Remote");
      } else if (!prefs.locations.some((l) => l.country === job.country)) {
        score += 8;
      } else {
        score += 3;
      }
    }
    const comp = normCompany(job.company);
    if (prefs.blocked_companies.some((c) => normCompany(c) === comp)) blockers.push("Company is on your never-apply list");
    if (prefs.companies.some((c) => normCompany(c) === comp)) {
      score += 10;
      reasons.push("Target company");
    }
    if (prefs.industries.length && job.category) {
      const cat = job.category.toLowerCase();
      const indHit = prefs.industries.some((i) => cat.includes(i.toLowerCase().split(" ")[0]));
      if (indHit) {
        score += 5;
        reasons.push("Target industry");
      } else if (prefs.industry_mode === "only") {
        score -= 10;
        warnings.push("Outside your chosen industries");
      }
    }
    if (prefs.salary_min && job.salary_max && job.salary_max < prefs.salary_min) {
      score -= 8;
      warnings.push("Pay below your minimum");
    }
  }

  // 4. Freshness
  if (job.posted_at) {
    const hours = (Date.now() - new Date(job.posted_at).getTime()) / 36e5;
    if (hours < 24) {
      score += 8;
      reasons.push("Posted in the last 24 hours");
    } else if (hours < 72) score += 5;
    else if (hours > 24 * 21) score -= 5;
  }

  // 5. Work authorization & sponsorship (decides eligibility)
  const auth = ctx.auth.find((a) => a.country === job.country);
  const citizenLike = auth ? CITIZEN_LIKE.has(auth.status) : false;
  const needsNow = !authorisedNow(auth);
  const needsLater = needsSponsorshipLater(auth);
  const scope = auth?.apply_scope ?? "sponsor_or_silent";
  const restrictions = job.restrictions?.length ? job.restrictions : signals.restrictions;
  const knownSponsor = job.sponsor_registered;
  const sponsorLabel = job.country === "US" ? "Has sponsored H-1B visas before" : job.country === "GB" ? "Licensed UK visa sponsor" : "Known visa sponsor";

  if (!citizenLike) {
    if (restrictions.includes("Citizens only") || restrictions.includes("Citizens/PR only") || restrictions.includes("US persons only")) {
      blockers.push("Restricted to citizens or residents");
    }
    if (restrictions.includes("Security clearance")) blockers.push("Requires security clearance");
  }

  const sponsorship = job.sponsorship ?? signals.sponsorship;
  if (needsNow || needsLater) {
    const occ = occupationCheck(job.country, job.title);
    if (occ && needsNow && occ.severity === "blocked") blockers.push(occ.text);
    else if (occ) warnings.push(occ.text);
  }
  if (needsNow) {
    if (sponsorship === "no") blockers.push("Says it can't sponsor visas");
    else if (sponsorship === "offers" || knownSponsor) {
      score += 10;
      reasons.push(sponsorship === "offers" ? "Offers visa sponsorship" : sponsorLabel);
    } else if (scope === "sponsor_only") {
      blockers.push("Sponsorship not confirmed (you chose sponsor-only)");
    } else if (job.country === "GB" && ctx.sponsorsLoaded?.has("GB")) {
      blockers.push("Not on the UK licensed sponsor register");
    } else {
      warnings.push("Sponsorship not mentioned — ask early");
    }
  } else if (needsLater) {
    if (sponsorship === "no") {
      if (scope === "any_legal") warnings.push("Won't sponsor later — fine for now only");
      else blockers.push("Won't sponsor in the future");
    } else if (sponsorship === "offers" || knownSponsor) {
      score += 8;
      reasons.push(sponsorship === "offers" ? "Offers visa sponsorship" : sponsorLabel);
    } else if (scope === "sponsor_only") {
      blockers.push("Sponsorship not confirmed (you chose sponsor-only)");
    } else {
      warnings.push("You can start now; future sponsorship not mentioned");
    }
  }

  score = Math.max(0, Math.min(100, score));
  const eligible = blockers.length === 0;
  const verdict: MatchResult["verdict"] = !eligible ? "blocked" : score >= 75 ? "great" : score >= 55 ? "good" : "stretch";
  return { score: eligible ? score : Math.min(score, 30), eligible, verdict, reasons, warnings, blockers, role: best, tooSenior, roleFit: roleScore };
}
