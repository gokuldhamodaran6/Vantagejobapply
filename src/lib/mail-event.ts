/**
 * Finds an interview time in an email: from a calendar invite (.ics) first, otherwise from the text
 * ("Tuesday, October 28 at 2:00 PM CT", "10/28 2pm–2:30pm ET"). The user always confirms before it goes on the calendar.
 */
export type MailEvent = {
  start: string | null; // ISO, UTC
  minutes: number;
  tz: string | null; // the zone the email used, e.g. "CT"
  link: string | null; // video link or a scheduling page
  location: string | null;
  title: string | null;
  source: "ics" | "text" | "scheduling";
  confidence: "high" | "medium" | "low";
  needsScheduling?: boolean;
  dismissed?: boolean;
};

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** US daylight saving: second Sunday of March to first Sunday of November. */
function usDst(y: number, m: number, d: number) {
  const marchStart = 8 + ((7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7); // second Sunday of March
  const novEnd = 1 + ((7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7); // first Sunday of November
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  if (m === 2) return d >= marchStart;
  return d < novEnd;
}

/** Offset in hours from UTC for the zone abbreviations recruiters use. */
function offsetFor(tz: string, y: number, m: number, d: number): number | null {
  const t = tz.toUpperCase();
  const fixed: Record<string, number> = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, UTC: 0, GMT: 0, BST: 1, CET: 1, CEST: 2, IST: 5.5, AEST: 10, AEDT: 11 };
  if (t in fixed) return fixed[t];
  const dst = usDst(y, m, d);
  const generic: Record<string, number> = { ET: -5, EASTERN: -5, CT: -6, CENTRAL: -6, MT: -7, MOUNTAIN: -7, PT: -8, PACIFIC: -8 };
  if (t in generic) return generic[t] + (dst ? 1 : 0);
  return null;
}

const TZ_RE = "(E[SD]?T|C[SD]?T|M[SD]?T|P[SD]?T|AK[SD]T|HST|UTC|GMT|BST|CES?T|IST|AE[SD]T|Eastern|Central|Mountain|Pacific)";

function toUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string | null, fallbackTz: string | null): Date {
  const zone = tz || fallbackTz;
  const off = zone ? offsetFor(zone, y, m, d) : null;
  if (off === null) {
    // No zone in the email: assume the user's own zone (Central by default) so it lands at the right local time.
    const local = offsetFor("CT", y, m, d)!;
    return new Date(Date.UTC(y, m, d, hh, mm) - local * 3600_000);
  }
  return new Date(Date.UTC(y, m, d, hh, mm) - off * 3600_000);
}

function to24(h: number, ap: string | undefined) {
  if (!ap) return h;
  const p = ap.toLowerCase().replace(/\./g, "");
  if (p.startsWith("p") && h < 12) return h + 12;
  if (p.startsWith("a") && h === 12) return 0;
  return h;
}

export function findLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return (
    urls.find((u) => /zoom\.us\/(j|my)\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup|webex\.com\/(meet|join)|chime\.aws\//i.test(u)) || null
  );
}

export function findSchedulingLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return urls.find((u) => /calendly\.com|goodtime\.io|gem\.com\/.*schedul|app\.greenhouse\.io\/.*(schedul|availability)|ashbyhq\.com\/.*schedul|cal\.com\/|zcal\.co|youcanbook\.me|calendar\.app\.google|outlook\.office\.com\/bookwithme|schedul/i.test(u)) || null;
}

/** Parse the first VEVENT of a calendar invite. */
export function parseIcs(ics: string): MailEvent | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const ev = unfolded.split(/BEGIN:VEVENT/i)[1];
  if (!ev) return null;
  const get = (k: string) => ev.match(new RegExp(`^${k}(;[^:\\r\\n]*)?:(.*)$`, "im"));
  const parseDt = (m: RegExpMatchArray | null): Date | null => {
    if (!m) return null;
    const v = m[2].trim();
    const x = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!x) return null;
    const [y, mo, d, hh = "09", mi = "00", , z] = x.slice(1);
    if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    const tzid = (m[1] || "").match(/TZID=([^;:]+)/i)?.[1] || "";
    const abbr = /New_York|Eastern/i.test(tzid) ? "ET" : /Chicago|Central/i.test(tzid) ? "CT" : /Denver|Mountain|Phoenix/i.test(tzid) ? "MT" : /Los_Angeles|Pacific/i.test(tzid) ? "PT" : /London/i.test(tzid) ? "GMT" : /Kolkata|India/i.test(tzid) ? "IST" : null;
    return toUtc(+y, +mo - 1, +d, +hh, +mi, abbr, null);
  };
  const start = parseDt(get("DTSTART"));
  if (!start) return null;
  const end = parseDt(get("DTEND"));
  const dur = ev.match(/^DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/im);
  const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60000) : dur ? (+(dur[1] || 0)) * 60 + +(dur[2] || 0) : 30;
  const desc = (get("DESCRIPTION")?.[2] || "").replace(/\\n/g, "\n").replace(/\\,/g, ",");
  const loc = (get("LOCATION")?.[2] || "").replace(/\\,/g, ",").trim();
  const url = get("URL")?.[2]?.trim() || null;
  return {
    start: start.toISOString(),
    minutes: Math.min(600, Math.max(5, minutes || 30)),
    tz: null,
    link: findLink(`${loc} ${url || ""} ${desc}`) || url,
    location: loc && !/^https?:/.test(loc) ? loc.slice(0, 200) : null,
    title: (get("SUMMARY")?.[2] || "").replace(/\\,/g, ",").trim().slice(0, 200) || null,
    source: "ics",
    confidence: "high",
  };
}

/** Find a concrete date + time in an interview email. Year is inferred from when the email arrived. */
export function parseEventText(text: string, receivedAt: Date = new Date()): MailEvent | null {
  const t = text.replace(/\s+/g, " ");
  const time = `(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?`;
  const range = `${time}(?:\\s*(?:-|–|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?)?`;
  const tzPart = `(?:\\s*\\(?${TZ_RE}\\b\\)?)?`;
  const monthName = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const patterns: { re: RegExp; parse: (m: RegExpMatchArray) => { y?: number; mo: number; d: number; i: number } }[] = [
    // "October 28, 2026 at 2:00 PM CT" / "Tue, Oct 28 @ 2pm"
    { re: new RegExp(`${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?(?:,|\\s)*(?:at|@|from|,)?\\s*${range}${tzPart}`, "i"), parse: (m) => ({ mo: MONTHS[m[1].slice(0, 3).toLowerCase()], d: +m[2], y: m[3] ? +m[3] : undefined, i: 4 }) },
    // "28 October 2026 at 14:00"
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}(?:,?\\s*(\\d{4}))?(?:,|\\s)*(?:at|@|from)?\\s*${range}${tzPart}`, "i"), parse: (m) => ({ mo: MONTHS[m[2].slice(0, 3).toLowerCase()], d: +m[1], y: m[3] ? +m[3] : undefined, i: 4 }) },
    // "10/28/2026 at 2:00 PM" / "10/28 2pm"
    { re: new RegExp(`\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\s*(?:at|@|,)?\\s*${range}${tzPart}`, "i"), parse: (m) => ({ mo: +m[1] - 1, d: +m[2], y: m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : undefined, i: 4 }) },
  ];
  for (const p of patterns) {
    const m = t.match(p.re);
    if (!m) continue;
    const { y, mo, d, i } = p.parse(m);
    if (mo === undefined || mo < 0 || mo > 11 || d < 1 || d > 31) continue;
    const [h1, m1, ap1, h2, m2, ap2, tz] = [m[i], m[i + 1], m[i + 2], m[i + 3], m[i + 4], m[i + 5], m[i + 6]];
    // A bare number with no am/pm and no minutes ("28 2") isn't a time.
    if (!ap1 && !m1 && !ap2) continue;
    const ap = ap1 || ap2;
    let hh = to24(+h1, ap);
    if (!ap && +h1 >= 1 && +h1 <= 7) hh = +h1 + 12; // "at 2:00" in a business email means the afternoon
    if (hh > 23 || +(m1 || 0) > 59) continue;
    let year = y ?? receivedAt.getUTCFullYear();
    if (!y) {
      const guess = Date.UTC(year, mo, d);
      if (guess < receivedAt.getTime() - 3 * 864e5) year += 1; // "Jan 5" in a December email is next year
    }
    const start = toUtc(year, mo, d, hh, +(m1 || 0), tz || null, null);
    let minutes = 0;
    if (h2) {
      const endH = to24(+h2, ap2 || ap1);
      minutes = (endH * 60 + +(m2 || 0)) - (hh * 60 + +(m1 || 0));
    }
    const durText = t.match(/(\d{2,3})[- ]?(?:minute|min)\b/i)?.[1] || (/\b(one|1)[- ]hour\b/i.test(t) ? "60" : null);
    if (!(minutes > 0 && minutes <= 600)) minutes = durText ? +durText : 30;
    return { start: start.toISOString(), minutes, tz: tz || null, link: findLink(text), location: null, title: null, source: "text", confidence: tz ? "high" : "medium" };
  }
  const sched = findSchedulingLink(text);
  if (sched) return { start: null, minutes: 30, tz: null, link: sched, location: null, title: null, source: "scheduling", confidence: "medium", needsScheduling: true };
  return null;
}
