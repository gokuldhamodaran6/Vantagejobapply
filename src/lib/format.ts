export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (isNaN(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function money(min: number | null, max: number | null, currency: string | null) {
  if (!min && !max) return "";
  const f = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0, notation: n >= 100000 ? "compact" : "standard" }).format(n);
  if (min && max && min !== max) return `${f(min)}–${f(max)}`;
  return f((min || max)!);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const TINTS = [
  ["#eef2fe", "#2448c8"], ["#fdecf2", "#b4235a"], ["#fff1e5", "#b4520a"], ["#e8f6ee", "#17804a"], ["#f3eefd", "#6b3fc4"], ["#eef0f4", "#3a4254"],
];
export function tintFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[h % TINTS.length];
  return { background: bg, color: fg };
}
