// Builds worker/test/fixtures/gh-2026.html from gh-2026.jsx (react + react-select bundled inline, no network at test time).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const out = await build({ entryPoints: [join(here, "gh-2026.jsx")], bundle: true, minify: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
writeFileSync(join(here, "../fixtures/gh-2026.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Job Application for Product Marketing Manager at Umbrella Robotics</title>
<style>body{font-family:sans-serif;margin:20px auto;max-width:760px}.field-wrapper,.select,.file-upload{margin:14px 0;position:relative}.label{display:block;font-weight:700;margin-bottom:4px}.input{width:100%;padding:8px;box-sizing:border-box}.btn{margin:4px 4px 0 0;padding:8px 14px}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log("built gh-2026.html", js.length);
