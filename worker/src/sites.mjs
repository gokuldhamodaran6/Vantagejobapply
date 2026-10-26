// Per-employer site keys and the signals that mean "this site doesn't want automated applications".

// On shared careers hosts the employer is the first path segment (job-boards.greenhouse.io/acme).
const PATH_TENANT = /^(job-boards|boards)(\.eu)?\.greenhouse\.io$|^jobs(\.eu)?\.lever\.co$|^jobs\.ashbyhq\.com$|^apply\.workable\.com$|^(jobs|careers)\.smartrecruiters\.com$|^ats\.rippling\.com$|^jobs\.gem\.com$|^jobs\.jobvite\.com$/;

/** The unit a block applies to: one employer's careers site, never a whole careers platform. */
export function siteKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (PATH_TENANT.test(host)) {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      return seg ? `${host}/${seg.toLowerCase()}` : host;
    }
    return host;
  } catch {
    return "";
  }
}

// A site refusing the visitor outright (not a CAPTCHA, which the person solves themselves).
export const BOT_WALL = /access denied|you don.?t have permission to access|(this |your )?request (was |has been )?blocked|sorry, you have been blocked|unusual traffic from your|automated (access|requests|queries|traffic) (is |are )?(not allowed|prohibited|detected|blocked)|pardon our interruption|incapsula incident|error 1020|your ip( address)? (has been|is) (blocked|banned)|bot (activity|traffic) (detected|blocked)/i;

// An application that asks the applicant to certify no automation was used, or says automated applications are refused.
export const NO_AUTOMATION = /(application|form)s? (must|should|may) not be (completed|submitted|filled( out)?) (by|using|with) (a |an |any )?(bot|automated|automation|auto-?apply|third[- ]party)|(have|has) not (been )?(used|completed (this application )?using|submitted (by|using)) (any )?(automated|bot|ai[- ]powered|auto-?apply)|automated (applications|submissions|application tools) (are|will be) (not accepted|rejected|prohibited|disqualified)|do not use (any )?(automated|auto-?apply|bot|ai) (tools|services|software)/i;
