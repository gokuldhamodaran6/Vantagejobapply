// Same rules as worker/src/sites.mjs: a block applies to one employer's careers site, never a whole platform.
const PATH_TENANT = /^(job-boards|boards)(\.eu)?\.greenhouse\.io$|^jobs(\.eu)?\.lever\.co$|^jobs\.ashbyhq\.com$|^apply\.workable\.com$|^(jobs|careers)\.smartrecruiters\.com$|^ats\.rippling\.com$|^jobs\.gem\.com$|^jobs\.jobvite\.com$/;

export function siteKey(url: string): string {
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
