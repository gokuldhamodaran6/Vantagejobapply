const NOT_CODES = new Set(["CODE", "HTML", "HTTPS", "EMAIL", "GREENHOUSE", "WORKDAY", "APPLY", "SUBMIT", "VERIFY", "SECURITY", "PASSWORD", "ACCOUNT"]);
const yearOrZip = (c: string) => /^(19|20)\d{2}$/.test(c);
const plausible = (c: string) => /^[A-Z0-9]+$/.test(c) && !NOT_CODES.has(c) && !yearOrZip(c) && (/\d/.test(c) ? /[0-9]/.test(c) && c.length >= 4 : c.length >= 6);

/**
 * Pull a one-time code out of an email. Handles numeric codes ("Your code is 482913") and the
 * alphanumeric codes ATS systems use (Greenhouse: "…into the security code field on your application: O2YJR3FJ").
 */
export function extractCode(text: string): string | null {
  const t = text.replace(/\u00a0/g, " ");
  const tries: RegExp[] = [
    // "...code...: X1Y2Z3" (label, then a colon, then the code) — allows a long label like Greenhouse's.
    /(?:code|passcode|otp|pin)\b[^:\n]{0,90}?:\s*([A-Z0-9]{4,10})\b/gi,
    // "Your code is 482913" / "code 482913"
    /(?:code|passcode|otp|pin|verification)(?:\s+is)?[^0-9A-Za-z]{0,12}\b([A-Z0-9]{4,10})\b/gi,
    // A line that is only the code.
    /(?:^|\n)\s*([A-Z0-9]{6,10})\s*(?:\n|$)/g,
    // Any 6-digit number.
    /\b([0-9]{6})\b/g,
  ];
  for (const re of tries) {
    for (const m of t.matchAll(re)) {
      const c = m[1];
      if (c && plausible(c)) return c;
    }
  }
  return null;
}
