/**
 * Ghost-job risk: postings that are unlikely to lead anywhere — talent pools dressed up as jobs, roles left
 * open for months, the same role posted over and over, or companies whose applicants (across Vantage) never
 * hear back. Shown in red so nobody spends an application on them; auto-apply skips "high".
 */
export type GhostRisk = { level: "high" | "medium"; reasons: string[] } | null;
export type CompanyReplies = { sent: number; replied: number; silent: number };

const POOL = /talent (community|pool|network|pipeline)|general application|future opportunit|join our talent|evergreen|always (be )?hiring|pipeline (role|requisition|req)|expression of interest|speculative application|open application/i;

export function ghostRisk(
  job: { title: string; description?: string | null; posted_at?: string | null },
  opts: { replies?: CompanyReplies | null; copies?: number; now?: number } = {},
): GhostRisk {
  const now = opts.now ?? Date.now();
  const high: string[] = [];
  const medium: string[] = [];
  if (POOL.test(job.title) || POOL.test((job.description || "").slice(0, 1500))) high.push("A talent pool, not a specific opening");
  const posted = Date.parse(job.posted_at || "");
  if (posted) {
    const days = Math.floor((now - posted) / 864e5);
    if (days > 60) high.push(`Open for ${days} days — likely filled or never being filled`);
    else if (days > 30) medium.push(`Open for ${days} days`);
  }
  const r = opts.replies;
  if (r && r.sent >= 3) {
    const silentShare = r.silent / r.sent;
    if (r.replied === 0 && silentShare >= 0.6) high.push(`${r.silent} of ${r.sent} Vantage applicants never heard back`);
    else if (silentShare >= 0.4) medium.push(`${r.silent} of ${r.sent} Vantage applicants heard nothing for 30+ days`);
  }
  if ((opts.copies || 0) >= 4) medium.push(`Posted ${opts.copies} times at once`);
  if (high.length || medium.length >= 2) return { level: "high", reasons: [...high, ...medium] };
  if (medium.length) return { level: "medium", reasons: medium };
  return null;
}

export const companyKey = (c: string) => c.toLowerCase().replace(/\s*(careers?|jobs?)\s*\|?\s*/gi, "").trim();
