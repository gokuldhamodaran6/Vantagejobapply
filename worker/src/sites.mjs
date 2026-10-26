// Per-employer site keys and the signals that mean "this site doesn't want automated applications".
// Keep in sync with src/lib/agent/sites.ts.

const seg = (u, i = 0) => (u.pathname.split("/").filter(Boolean)[i] || "").toLowerCase();
const q = (u, name) => {
  for (const [k, v] of u.searchParams) if (k.toLowerCase() === name) return v.toLowerCase();
  return "";
};

// Shared careers hosts: the employer is in the path or the query, never the hostname.
// Returning "" means "can't tell which employer this is", and then no block is recorded at all.
const SHARED = [
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
export function siteKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const [re, base, tenant] of SHARED) {
      if (!re.test(host)) continue;
      if (!base) return host;
      const t = tenant(u).replace(/[^a-z0-9._-]/g, "");
      return t ? `${base}/${t}` : "";
    }
    return host;
  } catch {
    return "";
  }
}

// A site refusing the visitor outright.
export const BOT_WALL = /access denied|you don.?t have permission to access|(this |your )?request (was |has been )?blocked|sorry, you have been blocked|unusual traffic from your|automated (access|requests|queries|traffic) (is |are )?(not allowed|prohibited|detected|blocked)|pardon our interruption|incapsula incident|error 1020|your ip( address)? (has been|is) (blocked|banned)|bot (activity|traffic) (detected|blocked)/i;

// A human check (Cloudflare, PerimeterX, DataDome, hCaptcha…): handed to the person, never treated as a block.
export const CHALLENGE = /just a moment|checking (if the site connection is secure|your browser)|verify (that )?(you are|you're) (a )?human|press (&|and) hold|are you a robot|complete the (security )?check|captcha|enable javascript and cookies to continue|needs to review the security of your connection/i;

// The applicant is asked to certify no automation, or told automated applications are refused.
// Only wording aimed at the applicant counts — not agency disclaimers or "we don't use automated hiring decisions" notices.
export const NO_AUTOMATION = new RegExp(
  [
    // "I certify / confirm that I have not used any automated tool / bot / auto-apply service to complete this application"
    String.raw`\b(i|applicant) (hereby )?(certify|confirm|attest|affirm|acknowledge|declare)[^.]{0,80}\b(not|no|without)\b[^.]{0,20}\b(used?|using|use of|help of|assistance of)\b[^.]{0,25}\b(automated|automation|bots?|auto-?apply|scripts?|ai[- ]?(powered|generated|tools?|assistants?)?)\b`,
    // "this application was completed by me personally, without automated tools"
    String.raw`\bapplication (was|has been|is being) (completed|submitted|filled( out)?) (by me|personally|by myself)[^.]{0,40}without\b[^.]{0,20}\b(automated|automation|bots?|auto-?apply|ai)\b`,
    // "applications must not be submitted using bots / automated tools"
    String.raw`\b(applications?|this form) (must|should|may) not be (completed|submitted|filled( out)?) (by|using|with|through) (a |an |any )?(bots?|automated|automation|auto-?apply|scripts?)\b`,
    // "automated applications will be rejected"
    String.raw`\b(automated|bot|auto-?apply|ai[- ]generated) (applications|submissions|application tools) (are|will be) (not accepted|rejected|prohibited|disqualified|not permitted)\b`,
    // "do not use automated tools / AI to apply / write your answers" (not "we do not use automated tools to make decisions")
    String.raw`(?<!\bwe )(?<!\bi )\bdo not use (any )?(automated|auto-?apply|bots?|ai|artificial intelligence|chatgpt)( tools| services| software| assistants?)? (to|when|for) (apply|applying|submit|complete|fill|write|answer|your (application|answers|responses))`,
  ].join("|"),
  "i",
);
