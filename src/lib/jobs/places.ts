import type { Job, TargetPrefs } from "@/lib/types";

/** Cities (with radius approximated by name match), whole states/regions, or remote. */
export function inPreferredPlace(job: Pick<Job, "location" | "remote" | "country">, prefs: TargetPrefs | null) {
  const places = (prefs?.locations || []).filter((l) => l.country === job.country);
  if (!places.length) return true;
  if (job.remote && prefs?.remote_ok) return true;
  const loc = (job.location || "").toLowerCase();
  if (!loc) return true;
  return places.some((p) => (p.city && loc.includes(p.city.toLowerCase())) || (p.state && stateHit(loc, p.state)));
}

export const US_STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

export function stateHit(loc: string, state: string) {
  const s = state.trim();
  const code = s.length === 2 ? s.toUpperCase() : Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === s.toLowerCase())?.[0];
  const name = code ? US_STATES[code] : s;
  if (name && loc.includes(name.toLowerCase())) return true;
  return Boolean(code && new RegExp(`(^|[,\\s(])${code.toLowerCase()}($|[,\\s)])`).test(loc));
}
