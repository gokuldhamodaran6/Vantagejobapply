// Best-effort country detection from free-text locations (ATS feeds).
const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(united states|usa|u\.s\.a?\.?|us-remote|remote[- ,(]*us\b|remote[- ,(]*united states)\b/i, "US"],
  [/\b(united kingdom|uk|england|scotland|wales|northern ireland|great britain|london|manchester|edinburgh|glasgow|birmingham|bristol|leeds|cambridge, uk|oxford)\b/i, "GB"],
  [/\b(canada|toronto|vancouver|montreal|montréal|calgary|ottawa|waterloo|edmonton)\b/i, "CA"],
  [/\b(australia|sydney|melbourne|brisbane|perth|adelaide|canberra)\b/i, "AU"],
  [/\b(new zealand|auckland|wellington|christchurch)\b/i, "NZ"],
  [/\b(ireland|dublin|cork|galway)\b/i, "IE"],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart)\b/i, "DE"],
  [/\b(netherlands|amsterdam|rotterdam|utrecht|the hague|eindhoven)\b/i, "NL"],
  [/\b(france|paris|lyon)\b/i, "FR"],
  [/\b(spain|madrid|barcelona)\b/i, "ES"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|chennai|gurgaon|gurugram|noida|delhi)\b/i, "IN"],
  [/\b(uae|dubai|abu dhabi)\b/i, "AE"],
  [/\b(japan|tokyo)\b/i, "JP"],
  [/\b(poland|warsaw|kraków|krakow)\b/i, "PL"],
  [/\b(switzerland|zurich|zürich|geneva)\b/i, "CH"],
  [/\b(sweden|stockholm)\b/i, "SE"],
  [/\b(portugal|lisbon|porto)\b/i, "PT"],
  [/\b(mexico|mexico city)\b/i, "MX"],
  [/\b(brazil|são paulo|sao paulo)\b/i, "BR"],
];

const US_STATES =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b|\b(new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|dallas|houston|washington, dc|palo alto|mountain view|menlo park|sunnyvale|san jose|san diego|philadelphia|pittsburgh|portland|salt lake city|raleigh|nashville|phoenix|minneapolis|detroit)\b/i;

const CA_PROVINCES = /,\s*(ON|BC|QC|AB|MB|SK|NS|NB|NL|PE)\b/;

export function detectCountry(location: string | null | undefined, fallback: string | null = null): string | null {
  const l = (location || "").trim();
  if (!l) return fallback;
  if (CA_PROVINCES.test(l)) return "CA";
  for (const [re, code] of COUNTRY_WORDS) if (re.test(l)) return code;
  if (US_STATES.test(l)) return "US";
  return fallback;
}

export function isRemoteLocation(location: string | null | undefined): boolean {
  return /\bremote\b|anywhere|work from home|distributed/i.test(location || "");
}
