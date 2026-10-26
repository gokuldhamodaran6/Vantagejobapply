// Same rules as worker/src/sites.mjs: a block applies to one employer's careers site, never a whole platform.

const seg = (u: URL, i = 0) => (u.pathname.split("/").filter(Boolean)[i] || "").toLowerCase();
const q = (u: URL, name: string) => {
  for (const [k, v] of u.searchParams) if (k.toLowerCase() === name) return v.toLowerCase();
  return "";
};

const SHARED: [RegExp, string | null, ((u: URL) => string) | null][] = [
  [/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/, "greenhouse.io", (u) => q(u, "for") || (["embed", "job_app"].includes(seg(u)) ? "" : seg(u))],
  [/^jobs(\.eu)?\.lever\.co$/, "lever.co", (u) => seg(u)],
  [/^jobs\.ashbyhq\.com$/, "ashbyhq.com", (u) => seg(u)],
  [/^apply\.workable\.com$/, "workable.com", (u) => (["j", "api"].includes(seg(u)) ? "" : seg(u))],
  [/^(jobs|careers)\.smartrecruiters\.com$/, "smartrecruiters.com", (u) => seg(u)],
  [/^ats\.rippling\.com$/, "rippling.com", (u) => seg(u)],
  [/^jobs\.gem\.com$/, "gem.com", (u) => seg(u)],
  [/^jobs\.jobvite\.com$/, "jobvite.com", (u) => seg(u)],
  [/^app\.dover\.com$/, "dover.com", (u) => (seg(u) === "apply" ? seg(u, 1) : seg(u))],
  [/^career[0-9]*\.successfactors\.(com|eu)$|^jobs\.sap\.com$/, "successfactors", (u) => q(u, "company")],
  [/^recruiting[0-9]*\.ultipro\.com$/, "ultipro.com", (u) => seg(u)],
  [/^recruiting\.paylocity\.com$/, "paylocity.com", () => ""],
  [/^workforcenow\.adp\.com$/, "adp.com", (u) => q(u, "cid")],
  [/^myjobs\.adp\.com$/, "adp.com", (u) => seg(u)],
  [/^[a-z0-9-]+\.applytojob\.com$/, null, null],
];

/** The unit a block applies to: one employer's careers site, never a whole careers platform. "" = unknown. */
export function siteKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const [re, base, tenant] of SHARED) {
      if (!re.test(host)) continue;
      if (!base || !tenant) return host;
      const t = tenant(u).replace(/[^a-z0-9._-]/g, "");
      return t ? `${base}/${t}` : "";
    }
    return host;
  } catch {
    return "";
  }
}
