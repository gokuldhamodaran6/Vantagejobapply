/** "Datadog Careers | Datadog" → "Datadog"; "Careers at Acme" → "Acme". */
export function cleanCompany(name: string) {
  const parts = name.split(/\s[|·–—-]\s/).map((x) => x.replace(/\b(careers?|jobs?|job board|work with us|join us)\b/gi, "").replace(/^\s*(at|@)\s+/i, "").trim()).filter(Boolean);
  return (parts.sort((a, b) => a.length - b.length)[0] || name).trim();
}
