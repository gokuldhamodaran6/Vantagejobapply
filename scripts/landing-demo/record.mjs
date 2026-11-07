// Records the landing-page product demo: node scripts/landing-demo/record.mjs
// Plays scripts/landing-demo/demo.html (a sample candidate, no real data) in Chromium, records it, and writes
// public/landing/demo.mp4, demo.webm and demo-poster.jpg with ffmpeg.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Playwright is a dev tool here (installed globally or in node_modules), not an app dependency.
const { chromium } = createRequire(import.meta.url)("playwright");
const out = resolve(here, "../../public/landing");
const tmp = resolve(here, ".rec");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: tmp, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(join(here, "demo.html")).href);
await page.waitForTimeout(20800);
await ctx.close();
await browser.close();

const raw = join(tmp, readdirSync(tmp).find((f) => f.endsWith(".webm")));
const cut = ["-ss", "0.6", "-t", "20", "-i", raw];
const fade = "fade=t=in:st=0:d=0.35,fade=t=out:st=19.55:d=0.45,format=yuv420p";
execFileSync("ffmpeg", ["-y", ...cut, "-vf", fade, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-movflags", "+faststart", "-an", join(out, "demo.mp4")], { stdio: "inherit" });
execFileSync("ffmpeg", ["-y", ...cut, "-vf", fade, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8", "-an", join(out, "demo.webm")], { stdio: "inherit" });
execFileSync("ffmpeg", ["-y", "-ss", "6.4", "-i", join(out, "demo.mp4"), "-frames:v", "1", "-q:v", "4", join(out, "demo-poster.jpg")], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log("wrote", out);
