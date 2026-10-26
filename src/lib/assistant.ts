import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { COUNTRIES, COUNTRY_BY_CODE } from "@/lib/countries";
import type { Application, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

export type Change =
  | { type: "add_role"; title: string; levels: string[] }
  | { type: "add_companies"; names: string[] }
  | { type: "add_country"; code: string }
  | { type: "pause_role"; roleId: string; title: string };

export type Reply = { text: string; apps?: { id: string; title: string; company: string; status: string; when: string | null }[]; changes?: Change[] };

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(uk|united kingdom|britain|england|london)\b/i, "GB"], [/\b(usa|us|united states|america)\b/i, "US"], [/\bcanada\b/i, "CA"],
  [/\baustralia\b/i, "AU"], [/\bgermany\b/i, "DE"], [/\bireland\b/i, "IE"], [/\bnew zealand\b/i, "NZ"], [/\bsingapore\b/i, "SG"],
  [/\bnetherlands\b/i, "NL"], [/\bindia\b/i, "IN"],
];

const STATUS_TEXT: Record<string, string> = { saved: "saved", ready: "prepared", applied: "waiting on the company", in_review: "in review", interview: "interview stage", offer: "offer", rejected: "closed", withdrawn: "withdrawn" };

function splitNames(s: string) {
  return s.split(/,|\band\b|&/i).map((x) => x.replace(/^(the)\s+/i, "").replace(/[.?!]$/, "").trim()).filter((x) => x.length > 1 && x.length < 60);
}

function ruleIntent(msg: string, roles: TargetRole[]) {
  const m = msg.toLowerCase();
  const changes: Change[] = [];
  const role = msg.match(/(?:also target|start targeting|target|add(?: a)?(?: target)? role(?: for)?|look for|apply (?:to|for)|search for)\s+(?:some\s+)?(.+?)\s+(?:roles?|jobs|positions)\b/i);
  if (role && !/compan/i.test(role[1])) {
    const levels = /\b(entry|junior|graduate)\b/i.test(msg) ? ["entry"] : /\bsenior\b/i.test(msg) ? ["senior"] : /\bmid\b/i.test(msg) ? ["mid"] : ["entry", "mid"];
    const title = role[1].replace(/\b(entry[- ]level|junior|senior|mid[- ]level|remote|in [a-z ]+)$/gi, "").replace(/\b(entry[- ]level|junior|senior|mid[- ]level)\b/gi, "").trim();
    if (title) changes.push({ type: "add_role", title: title.replace(/\b\w/g, (ch) => ch.toUpperCase()), levels });
  }
  const comp = msg.match(/(?:add|watch|target)\s+(.+?)\s+(?:to (?:my )?(?:target )?(?:companies|company list)|as (?:a |my )?target compan(?:y|ies))/i) || msg.match(/compan(?:y|ies)\s*[:\-]\s*(.+)$/i);
  if (comp) changes.push({ type: "add_companies", names: splitNames(comp[1]) });
  if (/\b(also|add|start)\b.*\b(country|search in|jobs in|work in)\b/i.test(msg) || /\balso (?:target|search|look in)\b/i.test(msg)) {
    for (const [re, code] of COUNTRY_WORDS) if (re.test(msg)) changes.push({ type: "add_country", code });
  }
  const pause = msg.match(/(?:pause|stop|turn off)\s+(?:applying to\s+|applications to\s+|the\s+)?(.+?)\s*(?:roles?|jobs)?$/i);
  if (pause) {
    const r = roles.find((x) => pause[1].toLowerCase().includes(x.title.toLowerCase()));
    if (r) changes.push({ type: "pause_role", roleId: r.id, title: r.title });
  }
  return {
    changes,
    asksToday: /\btoday\b/.test(m),
    asksWeek: /\b(this week|7 days|past week)\b/.test(m),
    asksStatus: /\b(apply|applied|application|status|update|news|progress)\b/.test(m),
    asksInterviews: /\binterview/.test(m),
    company: msg.match(/(?:from|at|with|about|of|for)\s+([A-Z][\w&.\- ]{1,40}?)(?:\?|$|\s+(?:today|this|yet))/)?.[1]?.trim(),
    asksRules: /\b(visa|sponsor|rules|eligible|can i (?:work|apply))\b/i.test(msg),
  };
}

export async function answer(
  supabase: SupabaseClient,
  ctx: { userId: string; name: string; roles: TargetRole[]; prefs: TargetPrefs | null; auth: WorkAuth[] },
  message: string,
): Promise<Reply> {
  const { data } = await supabase.from("applications").select("*").order("updated_at", { ascending: false }).limit(300);
  const apps = (data as Application[]) || [];
  const intent = ruleIntent(message, ctx.roles);

  // Let the model refine intent if configured (better language understanding), never invent facts.
  if (aiConfigured() && intent.changes.length === 0 && /\b(target|add|watch|also|pause|stop)\b/i.test(message)) {
    const out = await claude(
      "Extract job-search setting changes from the user's message. Return ONLY JSON {\"roles\":[{\"title\":string,\"levels\":string[]}],\"companies\":string[],\"countries\":string[] (ISO-2)}. Levels from: intern, entry, mid, senior, lead. Empty arrays if none.",
      [{ role: "user", content: message }],
      300,
    );
    const j = extractJson<{ roles?: { title: string; levels?: string[] }[]; companies?: string[]; countries?: string[] }>(out);
    j?.roles?.forEach((r) => intent.changes.push({ type: "add_role", title: r.title, levels: r.levels?.length ? r.levels : ["entry", "mid"] }));
    if (j?.companies?.length) intent.changes.push({ type: "add_companies", names: j.companies });
    j?.countries?.forEach((c) => COUNTRY_BY_CODE[c] && intent.changes.push({ type: "add_country", code: c }));
  }

  if (intent.changes.length) {
    const parts = intent.changes.map((c) =>
      c.type === "add_role" ? `start targeting **${c.title}** roles (${c.levels.join(", ")} level) with its own resume`
        : c.type === "add_companies" ? `watch **${c.names.join(", ")}** and apply to their new jobs first`
          : c.type === "add_country" ? `add **${COUNTRY_BY_CODE[c.code]?.name}** to your countries`
            : `pause applications for **${c.title}**`,
    );
    return { text: `Here's what I'll change — confirm and it takes effect right away:\n• ${parts.join("\n• ")}`, changes: intent.changes };
  }

  const fmt = (a: Application) => ({ id: a.id, title: a.job.title, company: a.job.company, status: STATUS_TEXT[a.status] || a.status, when: a.applied_at || a.updated_at });

  if (intent.company) {
    const hits = apps.filter((a) => a.job.company.toLowerCase().includes(intent.company!.toLowerCase()));
    if (hits.length) {
      const latest = hits[0];
      const ev = latest.events?.[latest.events.length - 1];
      return { text: `${latest.job.company}: ${hits.length} application${hits.length > 1 ? "s" : ""}. The latest, ${latest.job.title}, is ${STATUS_TEXT[latest.status]}${ev ? ` — last update: ${ev.text.toLowerCase()} on ${new Date(ev.at).toLocaleDateString()}` : ""}.`, apps: hits.slice(0, 8).map(fmt) };
    }
  }

  if (intent.asksInterviews) {
    const iv = apps.filter((a) => a.status === "interview");
    return { text: iv.length ? `You have ${iv.length} application${iv.length > 1 ? "s" : ""} at interview stage.` : "No interviews yet. Keep your applications flowing — most interviews come 1–3 weeks after applying.", apps: iv.map(fmt) };
  }

  if (intent.asksStatus || intent.asksToday || intent.asksWeek) {
    const since = intent.asksToday ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : intent.asksWeek ? Date.now() - 7 * 864e5 : 0;
    const window = apps.filter((a) => a.status !== "saved" && Date.parse(a.applied_at || a.updated_at) >= since);
    const label = intent.asksToday ? "today" : intent.asksWeek ? "this week" : "so far";
    const byStatus = window.reduce<Record<string, number>>((acc, a) => ((acc[STATUS_TEXT[a.status]] = (acc[STATUS_TEXT[a.status]] || 0) + 1), acc), {});
    const roleCount = new Set(window.map((a) => a.target_role_id)).size;
    const summary = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ");
    return {
      text: window.length
        ? `${window.length} application${window.length > 1 ? "s" : ""} ${label}${roleCount > 1 ? ` across ${roleCount} target roles` : ""}: ${summary}.`
        : `Nothing applied ${label} yet. Open Live jobs to prepare your next applications — your best matches are at the top.`,
      apps: window.slice(0, 12).map(fmt),
    };
  }

  if (intent.asksRules) {
    const code = COUNTRY_WORDS.find(([re]) => re.test(message))?.[1] || ctx.prefs?.countries?.[0] || "US";
    const c = COUNTRY_BY_CODE[code];
    return { text: `${c.name}: ${c.routes.map((r) => `${r.name} — ${r.summary}`).join(" ")}\n\n${c.facts.join(" ")}\n\nThis is general information, not legal advice — confirm on the official site: ${c.sources[0]?.url || ""}` };
  }

  if (aiConfigured()) {
    const summary = {
      roles: ctx.roles.map((r) => r.title),
      countries: ctx.prefs?.countries,
      companies: ctx.prefs?.companies,
      applications: apps.slice(0, 40).map((a) => ({ title: a.job.title, company: a.job.company, status: a.status, applied: a.applied_at })),
    };
    const out = await claude(
      `You are Vantage, a careful job-search agent for ${ctx.name || "the user"}. Answer briefly and concretely using ONLY this account data: ${JSON.stringify(summary)}. Supported countries: ${COUNTRIES.map((c) => c.name).join(", ")}. Never give legal advice; point to official sources for immigration questions. If asked to change settings, tell them to say e.g. "Also target Product Analyst roles" or "Add Monzo to my companies".`,
      [{ role: "user", content: message }],
      600,
    );
    if (out) return { text: out };
  }
  return {
    text: "I can tell you what I applied to (“What did you apply to today?”), check a company (“Any news from Kestrel Bank?”), list interviews, explain visa rules (“UK sponsorship rules”), or change your targets (“Also target Product Analyst roles”, “Add Monzo and Wise to my companies”).",
  };
}
