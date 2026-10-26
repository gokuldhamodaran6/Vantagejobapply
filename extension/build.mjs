// Builds the Chrome extension: copies src/, puts the form reader shared with the agent into content.js,
// and zips it to public/vantage-extension.zip for download from Vantage.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, "src"), out, { recursive: true });
cpSync(join(here, "icons"), join(out, "icons"), { recursive: true });

// The exact same form reader the browser agent uses, so both understand forms identically.
const forms = readFileSync(join(here, "../worker/src/forms.mjs"), "utf8");
const start = forms.indexOf("function extractInPage()");
let depth = 0, end = -1;
for (let i = forms.indexOf("{", start); i < forms.length; i++) {
  if (forms[i] === "{") depth++;
  else if (forms[i] === "}" && --depth === 0) { end = i + 1; break; }
}
if (start < 0 || end < 0) throw new Error("extractInPage not found");
const block = (from) => {
  const i = forms.indexOf(from);
  if (i < 0) throw new Error(`${from} not found`);
  let d = 0;
  for (let k = forms.indexOf("{", i); k < forms.length; k++) {
    if (forms[k] === "{") d++;
    else if (forms[k] === "}" && --d === 0) return forms.slice(i, k + 1) + (forms[k + 1] === ";" ? ";" : "");
  }
  throw new Error(`${from} not closed`);
};
const content = readFileSync(join(out, "content.js"), "utf8")
  .replace("/* __EXTRACT__ */", forms.slice(start, end))
  .replace("/* __CHOOSE__ */", `${block("const STATE_NAMES = {")}\n  ${block("export function chooseOption(").replace(/^export /, "")}`);
writeFileSync(join(out, "content.js"), content);

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

const zip = join(here, "../public/vantage-extension.zip");
rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, ...readdirSync(out)], { cwd: out });
console.log("built", out, "→", zip);
