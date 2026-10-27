// Every dropdown style careers sites use, filled by the shared page filler (extension + cloud agent).
// Usage: node worker/test/widgets.mjs   (exit code 1 if any widget fails)
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CASES = [
  [/^country/i, "United States", (v) => v.country === "United States of America"],
  [/education/i, "Bachelor's degree", (v) => v.edu === "Bachelor's Degree"],
  [/city do you live/i, "Chicago, Illinois", (v) => v.city === "Chicago, Illinois"],
  [/hear about/i, "Job Board > LinkedIn Jobs", (v) => v.source === "LinkedIn Jobs"],
  [/years of professional/i, "5-7 years", (v) => v.years === "5-7 years"],
  [/^gender/i, "Decline to self-identify", (v) => v.gender === "I don't wish to answer"],
  [/relocate/i, "Yes", (v) => v.relocate === "Yes"],
  [/visa sponsorship/i, "Yes", (v) => v.sponsor === "yes"],
  [/location \(city\)/i, "Chicago, IL", (v) => v.location === "Chicago, IL, USA"],
  [/start date/i, "2026-11-15", (v) => v.start === "2026-11-15"],
  [/languages/i, "English; Tamil", (v) => v.languages === "English, Tamil"],
  [/phone country code/i, "United States", (v) => v.phoneCode === "United States (+1)"],
  [/school or university/i, "Illinois State University", (v) => v.school === "Illinois State University"],
];
const doFor = (kind) => (["select", "radio", "checkbox", "checkboxes"].includes(kind) ? "set" : kind === "combobox" || kind === "buttons" ? "choose" : "fill");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("file://" + join(here, "fixtures", process.argv[2] || "widgets.html"));
await page.addScriptTag({ path: join(here, "../src/pilot/page.js") });
let fails = 0;
for (const [re, value, check] of CASES) {
  const snap = await page.evaluate(() => window.__vp.snapshot());
  const it = snap.items.find((x) => re.test(x.label || "") && x.kind !== "option");
  if (!it) {
    console.log(`FAIL  ${re}: not found. Items: ${snap.items.filter((x) => x.kind !== "option").map((x) => `${x.kind}:${(x.label || "").slice(0, 30)}`).join(" | ")}`);
    fails++;
    continue;
  }
  const a = { do: doFor(it.kind), i: it.i, value };
  const r = await page.evaluate((a) => window.__vp.act(a), a);
  await page.waitForTimeout(300);
  const vals = await page.evaluate(() => window.vals);
  const ok = check(vals);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${it.kind.padEnd(10)} ${String(it.label).slice(0, 45).padEnd(45)} ${a.do} "${value}" → ${JSON.stringify(r).slice(0, 140)}`);
}
console.log(fails ? `\n${fails} failed` : "\nAll widgets filled");
await browser.close();
process.exit(fails ? 1 : 0);
