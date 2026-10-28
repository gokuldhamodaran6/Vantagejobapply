// Extension fast pass: fields Vantage already knows are filled at once, without waiting for the AI.
import { fastFill, FAST_SAY } from "../src/lib/agent/pilot";
import { testCtx } from "../src/lib/agent/pilot-test";

let fail = 0;
const ok = (c: unknown, label: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail++; };

const ctx = { ...testCtx(), surface: "extension" as const };
const snap = { url: "https://boards.greenhouse.io/acme/jobs/1", items: [
  { i: 0, kind: "text", label: "First Name*", value: "" },
  { i: 1, kind: "email", label: "Email*", value: "" },
  { i: 2, kind: "text", label: "Last Name*", value: "Raman" },
  { i: 3, kind: "file", label: "Resume/CV", value: "" },
  { i: 4, kind: "combobox", label: "Gender", value: "" },
  { i: 5, kind: "button", label: "Submit application", final: true },
] };
const sugg = new Map<number, { value?: string; file?: "resume" | "cover_letter" }>([[0, { value: "Priya" }], [1, { value: "priya.careers@gmail.com" }], [2, { value: "Priya" }], [3, { file: "resume" }], [4, { value: "Female" }]]);
const t = fastFill(snap, [], sugg as never, ctx);
ok(t && t.say === FAST_SAY && t.status === "continue", "fast pass returns a turn without asking the AI");
ok(t?.actions.some((a) => a.i === 0 && a.value === "Priya") && t?.actions.some((a) => a.i === 1) && t?.actions.some((a) => a.i === 3 && a.do === "upload"), "known fields and the resume upload are filled at once");
ok(!t?.actions.some((a) => a.i === 2), "a field already filled on the page is left alone");
ok(!t?.actions.some((a) => a.i === 5 && a.do === "click"), "the fast pass never presses Submit");
ok(!t?.actions.some((a) => a.i === 4 && !a.private), "private answers only go in as Vantage's own private fills");
ok(fastFill(snap, [{ say: FAST_SAY, url: snap.url, actions: [], results: [] }], sugg as never, ctx) === null, "only once per page: the AI takes over next");
ok(fastFill(snap, [], sugg as never, { ...ctx, surface: "agent" }) === null, "the fast pass is for the extension only");

console.log(fail ? `\n${fail} failed` : "\nAll fast-fill checks passed");
process.exit(fail ? 1 : 0);
