// A stand-in for the Vantage app's worker API, using the real field planner. Serves the fixture pages too.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildFacts, planFields, qkeyOf, type FormField } from "../../src/lib/agent/fields";
import { parseResumeText } from "../../src/lib/resume/parse";
import { resumePdf, coverLetterPdf } from "../../src/lib/resume/pdf";
import { generatePassword } from "../../src/lib/vault";

const PORT = 4100;
const BASE = `http://127.0.0.1:${PORT}`;
const FX = join(import.meta.dirname, "fixtures");
const resume = parseResumeText(readFileSync(join(import.meta.dirname, "../../scripts/fixtures/resume-pdf.txt"), "utf8"));
const auth = { country: "US", status: "post_study_work" as const, needs_sponsorship_now: false, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent" as const, details: { opt_end: "2028-01-25" } };
const applicant = { city: "Chicago", state: "IL", postal_code: "60601", address_line1: "1 Main St", country: "United States", phone: "(312) 555-0142", agent_consent: true };
const answers: { qkey: string; question: string; answer: string }[] = [];

type T = { id: string; ats: string; url: string; job: { title: string; company: string; country: string }; status: string; needs?: unknown; log: string[]; userInput: Record<string, unknown>; attempts: number };
const tasks: T[] = [
  { id: "t-gh", ats: "greenhouse", url: `${BASE}/fx/greenhouse.html`, job: { title: "Product Marketing Specialist", company: "Acme", country: "US" }, status: "queued", log: [], userInput: {}, attempts: 0 },
  { id: "t-ashby", ats: "ashby", url: `${BASE}/fx/ashby.html`, job: { title: "Growth Marketing Manager", company: "Initech", country: "US" }, status: "queued", log: [], userInput: {}, attempts: 0 },
  { id: "t-wd", ats: "workday", url: `${BASE}/fx/workday.html`, job: { title: "Brand Marketing Specialist", company: "Globex", country: "US" }, status: "queued", log: [], userInput: {}, attempts: 0 },
  { id: "t-cap", ats: "generic", url: `${BASE}/fx/captcha.html`, job: { title: "Data Analyst", company: "Hooli", country: "US" }, status: "queued", log: [], userInput: {}, attempts: 0 },
];
const vault: Record<string, { login: string; password: string }> = {};
export const events: string[] = [];

async function files() {
  return {
    resume: { name: "Priya_Raman_Resume.pdf", mimeType: "application/pdf", base64: Buffer.from(await resumePdf(resume, { style: "modern" })).toString("base64") },
    cover: { name: "Priya_Raman_Cover_Letter.pdf", mimeType: "application/pdf", base64: Buffer.from(await coverLetterPdf("Dear team,\n\nHello.\n\nSincerely,\nPriya Raman", resume)).toString("base64") },
  };
}
const facts = () => buildFacts({ email: "priya.careers@gmail.com", name: "Priya Raman", applicant, resume, auth, country: "US" });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, BASE);
  if (url.pathname.startsWith("/fx/")) {
    const p = join(FX, url.pathname.slice(4));
    if (!existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(readFileSync(p));
  }
  if (url.pathname === "/control/state") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ tasks: tasks.map((t) => ({ id: t.id, status: t.status, needs: t.needs, log: t.log })), vault, answers }));
  }
  if (url.pathname === "/control/answer" && req.method === "POST") {
    const body = JSON.parse(await read(req));
    for (const [label, answer] of Object.entries(body.answers as Record<string, string>)) answers.push({ qkey: qkeyOf(label), question: label, answer });
    const t = tasks.find((x) => x.id === body.taskId)!;
    t.status = "queued";
    t.needs = [];
    return res.writeHead(200).end("{}");
  }
  const m = url.pathname.match(/^\/api\/agent\/worker\/(\w+)$/);
  if (!m) return res.writeHead(404).end();
  if (req.headers["x-agent-secret"] !== "test-secret-0123456789abcdef") return res.writeHead(401).end();
  const body = JSON.parse((await read(req)) || "{}");
  const op = m[1];
  const t = tasks.find((x) => x.id === body.taskId);
  let out: unknown = {};
  if (op === "claim") {
    const next = tasks.find((x) => x.status === "queued");
    if (!next) out = { task: null };
    else {
      next.status = "running";
      next.attempts++;
      out = { task: { id: next.id, ats: next.ats, url: next.url, host: new URL(next.url).hostname, job: next.job, attempts: next.attempts, userInput: {} }, identity: { email: "priya.careers@gmail.com", name: "Priya Raman" }, credential: vault[next.id] || null, hasMailbox: next.id === "t-wd", files: await files() };
    }
  } else if (op === "plan") {
    out = await planFields(body.fields as FormField[], { facts: facts(), answers, job: t!.job, resume, coverLetter: "Dear team,\n\nHello.\n\nSincerely,\nPriya Raman", consent: true });
  } else if (op === "update") {
    if (body.status) t!.status = body.status;
    if (body.needs) t!.needs = body.needs;
    if (body.log) t!.log.push(body.log);
    if (body.proof) (await import("node:fs")).writeFileSync(`${process.env.LOG_DIR || "/tmp"}/proof-${t!.id}.jpg`, Buffer.from(body.proof, "base64"));
    events.push(`${t!.id}: ${body.status || ""} ${body.step || ""} ${body.log || ""}`.trim());
    console.log(`[app] ${t!.id} ${body.status || "·"} ${body.log || body.step || ""}`);
  } else if (op === "poll") {
    if (t!.id === "t-wd") out = { code: "482913", link: null, userInput: {} };
    else out = { userInput: t!.userInput };
  } else if (op === "credential") {
    vault[t!.id] = { login: "priya.careers@gmail.com", password: generatePassword() };
    out = { ...vault[t!.id], host: body.host };
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
});

function read(req: http.IncomingMessage) {
  return new Promise<string>((r) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => r(d));
  });
}

server.listen(PORT, () => console.log(`[app] mock app on ${BASE}`));
