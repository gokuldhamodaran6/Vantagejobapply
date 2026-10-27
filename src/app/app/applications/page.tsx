"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Building2, CalendarPlus, ChevronDown, Download, ExternalLink, FileText, LayoutGrid, List, Mail, Search, ShieldCheck, Sparkles, User, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Segmented, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, timeAgo, tintFor } from "@/lib/format";
import { RESUME_STYLES } from "@/lib/resume/styles";
import { statusLine, type AgentTask } from "@/lib/agent/status";
import type { Application, AppStatus, ResumeStyle } from "@/lib/types";

type App = Application & { source?: string | null; agent_task_id?: string | null; resume_style?: string | null; letter_tone?: string | null };
type ResumeLite = { id: string; name: string; style: string | null; ats_score: number | null; target_role_id: string | null; kind: string | null };
type Mail = { id: string; subject: string; from_name: string; kind: string; received_at: string; snippet: string };
type Range = "today" | "week" | "month" | "all";
type Group = "company" | "role" | "day";
type StatusFilter = "all" | "active" | "interviewing" | "offers" | "closed" | "todo";

const STATUS: Record<AppStatus, { label: string; cls: string; dot: string }> = {
  saved: { label: "Saved", cls: "bg-[#eef0f4] text-ink-2", dot: "#a3a9b6" },
  ready: { label: "Ready to apply", cls: "bg-orange-tint text-orange-ink", dot: "#f7862b" },
  applied: { label: "Applied", cls: "bg-brand-tint text-brand-ink", dot: "#2f5beb" },
  in_review: { label: "Under review", cls: "bg-[#eef0f4] text-ink-2", dot: "#7c8aa5" },
  assessment: { label: "Assessment", cls: "bg-[#fff4e5] text-orange-ink", dot: "#e8930c" },
  interview: { label: "Interview", cls: "bg-pink-tint text-pink-ink", dot: "#e0457b" },
  offer: { label: "Offer", cls: "bg-green-tint text-green-ink", dot: "#22a05b" },
  rejected: { label: "Not selected", cls: "bg-[#eef0f4] text-subtle", dot: "#c3c8d3" },
  withdrawn: { label: "Withdrawn", cls: "bg-[#eef0f4] text-subtle", dot: "#c3c8d3" },
};
const STAGES: { key: AppStatus; label: string }[] = [
  { key: "applied", label: "Applied" }, { key: "in_review", label: "Under review" }, { key: "assessment", label: "Assessment" }, { key: "interview", label: "Interview" }, { key: "offer", label: "Offer" },
];
const STAGE_INDEX: Record<AppStatus, number> = { saved: -1, ready: -1, applied: 0, in_review: 1, assessment: 2, interview: 3, offer: 4, rejected: 1, withdrawn: 0 };
const COLUMNS: { ids: AppStatus[]; title: string; dot: string }[] = [
  { ids: ["saved", "ready"], title: "To apply", dot: "#f7862b" }, { ids: ["applied"], title: "Applied", dot: "#2f5beb" }, { ids: ["in_review"], title: "Under review", dot: "#7c8aa5" }, { ids: ["assessment"], title: "Assessment", dot: "#e8930c" },
  { ids: ["interview"], title: "Interview", dot: "#e0457b" }, { ids: ["offer"], title: "Offer", dot: "#22a05b" }, { ids: ["rejected", "withdrawn"], title: "Closed", dot: "#a3a9b6" },
];
const RANGE_DAYS: Record<Range, number> = { today: 1, week: 7, month: 30, all: 0 };

const sentAt = (a: App) => Date.parse(a.applied_at || a.created_at);
const dayKey = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export default function ApplicationsPage() {
  const { roles, userId } = useMe();
  const [apps, setApps] = useState<App[] | null>(null);
  const [resumes, setResumes] = useState<Map<string, ResumeLite>>(new Map());
  const [range, setRange] = useState<Range>("week");
  const [group, setGroup] = useState<Group>("company");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(30);
  const [open, setOpen] = useState<App | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [working, setWorking] = useState<AgentTask[]>([]);

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [a, r, w] = await Promise.all([
      s.from("applications").select("*").order("applied_at", { ascending: false, nullsFirst: false }).limit(3000),
      s.from("resumes").select("id,name,style,ats_score,target_role_id,kind"),
      s.from("agent_tasks").select("*").in("status", ["queued", "running", "waiting_code", "needs_user", "needs_human", "awaiting_approval"]).order("created_at"),
    ]);
    setApps((a.data as App[]) || []);
    setWorking((w.data as AgentTask[]) || []);
    setResumes(new Map(((r.data as ResumeLite[]) || []).map((x) => [x.id, x])));
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);
  // Keep the in-progress list live while the agent is working.
  useEffect(() => {
    if (!userId || !working.length) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [userId, working.length, load]);

  const roleName = useCallback((id: string | null) => roles.find((r) => r.id === id)?.title || "Other roles", [roles]);
  const days = RANGE_DAYS[range];
  const since = days ? (range === "today" ? dayKey(now) : now - days * 864e5) : 0;

  const inRange = useMemo(() => (apps || []).filter((a) => sentAt(a) >= since), [apps, since]);
  const prevRange = useMemo(() => (days ? (apps || []).filter((a) => sentAt(a) >= since - days * 864e5 && sentAt(a) < since) : []), [apps, since, days]);
  const sent = (l: App[]) => l.filter((a) => !["saved", "ready"].includes(a.status));
  const heard = (l: App[]) => l.filter((a) => ["in_review", "assessment", "interview", "offer", "rejected"].includes(a.status));
  const intv = (l: App[]) => l.filter((a) => ["interview", "offer"].includes(a.status));
  const offers = (l: App[]) => l.filter((a) => a.status === "offer");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inRange.filter((a) => {
      if (needle && !`${a.job.company} ${a.job.title} ${a.job.location || ""}`.toLowerCase().includes(needle)) return false;
      if (status === "active") return ["applied", "in_review", "assessment", "interview"].includes(a.status);
      if (status === "interviewing") return a.status === "interview";
      if (status === "offers") return a.status === "offer";
      if (status === "closed") return ["rejected", "withdrawn"].includes(a.status);
      if (status === "todo") return ["saved", "ready"].includes(a.status);
      return true;
    });
  }, [inRange, q, status]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; sub?: string; items: App[]; latest: number }>();
    for (const a of filtered) {
      const k = group === "company" ? a.job.company.toLowerCase().trim() : group === "role" ? a.target_role_id || "other" : String(dayKey(sentAt(a)));
      const title = group === "company" ? a.job.company : group === "role" ? roleName(a.target_role_id) : dayLabel(+k, now);
      const g = m.get(k) || { key: k, title, items: [], latest: 0 };
      g.items.push(a);
      g.latest = Math.max(g.latest, sentAt(a));
      m.set(k, g);
    }
    return [...m.values()].sort((x, y) => (group === "day" ? +y.key - +x.key : y.latest - x.latest));
  }, [filtered, group, roleName, now]);

  // Applications per day (or per hour today) for the activity chart.
  const chart = useMemo(() => {
    const list = sent(inRange);
    if (range === "today") {
      const b = Array.from({ length: 24 }, (_, h) => ({ label: `${h % 12 || 12}${h < 12 ? "a" : "p"}`, n: 0 }));
      list.forEach((a) => b[new Date(sentAt(a)).getHours()].n++);
      return b;
    }
    const n = range === "all" ? 12 : days;
    if (range === "all") {
      const b = Array.from({ length: n }, (_, i) => ({ label: new Date(now - (n - 1 - i) * 7 * 864e5).toLocaleDateString(undefined, { month: "short", day: "numeric" }), n: 0 }));
      list.forEach((a) => { const w = Math.floor((now - sentAt(a)) / (7 * 864e5)); if (w < n) b[n - 1 - w].n++; });
      return b;
    }
    const today = dayKey(now);
    const b = Array.from({ length: n }, (_, i) => ({ label: new Date(today - (n - 1 - i) * 864e5).toLocaleDateString(undefined, n > 7 ? { day: "numeric" } : { weekday: "short" }), n: 0 }));
    list.forEach((a) => { const d = Math.round((today - dayKey(sentAt(a))) / 864e5); if (d >= 0 && d < n) b[n - 1 - d].n++; });
    return b;
  }, [inRange, range, days, now]);

  async function move(a: App, s: AppStatus) {
    const at = new Date().toISOString();
    const events = [...(a.events || []), { at, type: s, text: `Moved to ${STATUS[s].label}` }];
    const { error } = await supabaseBrowser().from("applications").update({ status: s, events, applied_at: s === "applied" && !a.applied_at ? at : a.applied_at }).eq("id", a.id);
    if (error) return setToast(error.message);
    setToast(`Moved to ${STATUS[s].label}`);
    setOpen({ ...a, status: s, events });
    load();
  }

  if (apps && apps.length === 0 && working.length === 0) {
    return (
      <>
        <PageHeader title="Applications" />
        <EmptyState title="No applications yet" body="Every job your agent applies to — or you mark as applied — is tracked here with the resume it used, every email from the company, and each interview round." action={<Link href="/app/jobs" className="btn-primary">Find jobs</Link>} />
      </>
    );
  }

  const s1 = sent(inRange), s0 = sent(prevRange);
  const delta = days ? s1.length - s0.length : null;
  const replyRate = s1.length ? Math.round((heard(inRange).length / s1.length) * 100) : null;
  const max = Math.max(1, ...chart.map((c) => c.n));
  const rangeLabel = { today: "today", week: "in the last 7 days", month: "in the last 30 days", all: "in total" }[range];

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="Every application, every reply, every round — in one place."
        actions={<Segmented label="Time range" value={range} onChange={(v) => { setRange(v); setShown(30); }} options={[{ value: "today", label: "Today" }, { value: "week", label: "7 days" }, { value: "month", label: "30 days" }, { value: "all", label: "All time" }]} />}
      />

      {/* Overview */}
      <section className="mb-5 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted">Applications sent {rangeLabel}</p>
              <p className="mt-1 flex items-baseline gap-3 text-4xl font-bold tracking-tight">{s1.length}
                {delta !== null && (delta === 0 ? <span className="text-sm font-medium text-muted">same as previous period</span> : <span className={`text-sm font-semibold ${delta > 0 ? "text-green-ink" : "text-red-ink"}`}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs previous period</span>)}
              </p>
            </div>
            <p className="text-sm text-muted">{new Set(s1.map((a) => a.job.company.toLowerCase())).size} companies · {new Set(s1.map((a) => a.target_role_id)).size} roles</p>
          </div>
          {s1.length === 0 ? (
            <div className="mt-5 flex h-28 flex-col items-center justify-center rounded-xl bg-canvas text-center">
              <p className="text-sm font-semibold">Nothing sent {rangeLabel}</p>
              <p className="mt-1 text-xs text-muted">{sent(apps || []).length ? "Try a longer range to see your history." : <>Paste a job link on <Link href="/app/agent" className="font-semibold text-brand-ink">Your agent</Link> or switch on Auto-apply.</>}</p>
            </div>
          ) : <>
          <div className="mt-5 flex h-28 items-end gap-[3px]" aria-label="Applications over time">
            {chart.map((c, i) => (
              <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="rounded-t-[4px] bg-gradient-to-t from-brand to-[#6f8ef5] transition group-hover:from-pink group-hover:to-[#f07aa3]" style={{ height: `${c.n ? Math.max(6, (c.n / max) * 100) : 2}%`, opacity: c.n ? 1 : 0.25 }} />
                <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-white group-hover:block">{c.n} · {c.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-subtle"><span>{chart[0]?.label}</span><span>{chart[Math.floor(chart.length / 2)]?.label}</span><span>{chart[chart.length - 1]?.label}</span></div>
          </>}
        </div>
        <div className="card p-5">
          <p className="text-sm font-semibold">Your funnel {rangeLabel}</p>
          <div className="mt-4 space-y-3">
            {[
              ["Applied", s1.length, "from-brand to-[#6f8ef5]"],
              ["Heard back", heard(inRange).length, "from-[#7c8aa5] to-[#a3b0c8]"],
              ["Interview", intv(inRange).length, "from-pink to-[#f07aa3]"],
              ["Offer", offers(inRange).length, "from-green to-[#5cc58b]"],
            ].map(([l, n, g], i) => (
              <div key={l as string}>
                <div className="flex items-baseline justify-between text-sm"><span className="font-medium">{l}</span><span className="font-bold">{n as number}{i > 0 && s1.length ? <span className="ml-1.5 text-xs font-medium text-muted">{Math.round(((n as number) / s1.length) * 100)}%</span> : null}</span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-line-2"><div className={`h-full rounded-full bg-gradient-to-r ${g}`} style={{ width: `${s1.length ? Math.max((n as number) ? 3 : 0, ((n as number) / s1.length) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">{replyRate === null ? "Replies appear here as companies write back to your job email." : `${replyRate}% of companies have replied. Typical is 10–20%.`}</p>
        </div>
      </section>

      {working.length > 0 && (
        <section className="card mb-5 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="live-dot" />
            <h2 className="flex-1 text-sm font-bold">Your agent is working on {working.length} application{working.length > 1 ? "s" : ""}</h2>
            <Link href="/app/agent" className="text-xs font-semibold text-brand-ink">Open Your agent →</Link>
          </div>
          <ul className="divide-y divide-line">
            {working.slice(0, 8).map((t, i) => {
              const live = ["running", "waiting_code"].includes(t.status);
              const needsYou = ["needs_user", "needs_human", "awaiting_approval"].includes(t.status);
              return (
                <li key={t.id}>
                  <Link href="/app/agent" className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={tintFor(t.job.company)}>{initials(t.job.company)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{t.job.title} <span className="font-normal text-muted">· {t.job.company}</span></span>
                      <span className="block truncate text-xs text-muted">{roleName(t.job.role_id || null)} · {statusLine(t, t.status === "queued" ? working.filter((x) => x.status === "queued").indexOf(t) + 1 : undefined)}</span>
                    </span>
                    <span className={`chip ${live ? "bg-brand-tint text-brand-ink" : needsYou ? "bg-orange-tint text-orange-ink" : "bg-[#eef0f4] text-ink-2"}`}>{live ? "Applying now" : needsYou ? "Needs you" : `In queue${i >= 0 ? "" : ""}`}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {working.length > 8 && <p className="border-t border-line px-4 py-2 text-xs text-muted">+{working.length - 8} more on Your agent</p>}
        </section>
      )}

      {/* Controls */}
      <section className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input h-10 pl-9" placeholder="Search company, role or city" value={q} onChange={(e) => { setQ(e.target.value); setShown(30); }} aria-label="Search applications" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All"], ["active", "Active"], ["interviewing", "Interviewing"], ["offers", "Offers"], ["closed", "Closed"], ["todo", "To apply"]] as [StatusFilter, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)} className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${status === k ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {layout === "list" && <Segmented label="Group by" value={group} onChange={setGroup} options={[{ value: "company", label: "Company" }, { value: "role", label: "Role" }, { value: "day", label: "Day" }]} />}
          <div className="inline-flex rounded-lg bg-[#eef0f4] p-1">
            <button aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={`rounded-md p-1.5 ${layout === "list" ? "bg-white shadow-sm" : "text-muted"}`}><List size={17} /></button>
            <button aria-label="Board view" aria-pressed={layout === "board"} onClick={() => setLayout("board")} className={`rounded-md p-1.5 ${layout === "board" ? "bg-white shadow-sm" : "text-muted"}`}><LayoutGrid size={17} /></button>
          </div>
        </div>
      </section>

      {!apps && <div className="skeleton h-96" />}
      {apps && filtered.length === 0 && <div className="card p-10 text-center text-sm text-muted">No applications match. Try a longer time range or clear the filters.</div>}

      {layout === "list" && (
        <div className="space-y-3">
          {groups.slice(0, shown).map((g) => (
            <GroupCard key={g.key} g={g} group={group} roleName={roleName} resumes={resumes} onOpen={setOpen} now={now} />
          ))}
          {groups.length > shown && <button className="btn-secondary w-full" onClick={() => setShown(shown + 30)}>Show {Math.min(30, groups.length - shown)} more</button>}
        </div>
      )}

      {layout === "board" && (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[1260px] grid-cols-7 gap-3">
            {COLUMNS.map((col) => {
              const items = filtered.filter((a) => col.ids.includes(a.status));
              return (
                <div key={col.title} className="min-h-[360px] rounded-xl bg-[#eef0f4] p-2.5">
                  <div className="flex items-center gap-2 px-1.5 pb-2.5 pt-1"><span className="h-2 w-2 rounded-full" style={{ background: col.dot }} /><span className="text-sm font-bold">{col.title}</span><span className="ml-auto text-xs font-semibold text-muted">{items.length}</span></div>
                  <div className="space-y-2">
                    {items.slice(0, 60).map((a) => (
                      <button key={a.id} onClick={() => setOpen(a)} className="block w-full rounded-lg border border-line bg-white p-3 text-left shadow-sm transition hover:border-[#c9d5fb]">
                        <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span><span className="truncate text-[13px] font-semibold">{a.job.company}</span></div>
                        <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">{a.job.title}</p>
                        <p className="mt-1.5 text-[11px] text-muted">{timeAgo(a.applied_at || a.created_at)}{a.match_score ? ` · ${a.match_score}% match` : ""}</p>
                      </button>
                    ))}
                    {items.length > 60 && <p className="px-2 text-xs text-muted">+{items.length - 60} more — use search or List view</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open && <Detail a={open} resume={open.resume_id ? resumes.get(open.resume_id) : undefined} roleName={roleName(open.target_role_id)} onClose={() => setOpen(null)} onMove={move} onSaved={(m) => { setToast(m); load(); }} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function dayLabel(t: number, now: number) {
  const today = dayKey(now);
  if (t === today) return "Today";
  if (t === today - 864e5) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const stageColor = (k: AppStatus) => (k === "offer" ? "bg-green" : k === "interview" ? "bg-pink" : k === "assessment" ? "bg-[#e8930c]" : "bg-brand");

function Progress({ s }: { s: AppStatus }) {
  const idx = STAGE_INDEX[s];
  const closed = s === "rejected" || s === "withdrawn";
  return (
    <div className="flex items-center gap-1" aria-label={`Stage: ${STATUS[s].label}`}>
      {STAGES.map((st, i) => (
        <span key={st.key} title={st.label} className={`h-1.5 w-6 rounded-full ${i <= idx ? (closed ? "bg-[#c3c8d3]" : stageColor(st.key)) : "bg-line-2"}`} />
      ))}
    </div>
  );
}

function GroupCard({ g, group, roleName, resumes, onOpen, now }: {
  g: { key: string; title: string; items: App[]; latest: number }; group: Group; roleName: (id: string | null) => string;
  resumes: Map<string, ResumeLite>; onOpen: (a: App) => void; now: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const best = g.items.reduce((b, a) => (STAGE_INDEX[a.status] > STAGE_INDEX[b.status] && !["rejected", "withdrawn"].includes(a.status) ? a : b), g.items[0]);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas" aria-expanded={expanded}>
        {group === "company" ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={tintFor(g.title)}>{initials(g.title)}</span>
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">{group === "role" ? <User size={18} /> : <CalendarPlus size={18} />}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{g.title}</span>
          <span className="block truncate text-sm text-muted">{g.items.length} {group === "company" ? (g.items.length === 1 ? "role" : "roles") : g.items.length === 1 ? "application" : "applications"} · last {timeAgo(new Date(g.latest).toISOString())}</span>
        </span>
        {group === "company" && <span className={`chip hidden sm:inline-flex ${STATUS[best.status].cls}`}>{STATUS[best.status].label}</span>}
        <ChevronDown size={18} className={`text-subtle transition ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <ul className="divide-y divide-line border-t border-line">
          {g.items.map((a) => {
            const r = a.resume_id ? resumes.get(a.resume_id) : undefined;
            return (
              <li key={a.id}>
                <button onClick={() => onOpen(a)} className="grid w-full grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-brand-soft lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto]">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {group !== "company" && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span>}
                      <span className="line-clamp-2 font-medium lg:line-clamp-1">{group !== "company" ? `${a.job.company} · ` : ""}{a.job.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{a.job.location || a.job.country}{group !== "role" ? ` · ${roleName(a.target_role_id)}` : ""}</span>
                  </span>
                  <span className="min-w-0 text-xs text-muted">
                    <span className="flex items-center gap-1.5 truncate"><FileText size={13} className="shrink-0" />{r ? `${RESUME_STYLES[(r.style || "classic") as ResumeStyle]?.label || "Classic"} resume${r.ats_score ? ` · ATS ${r.ats_score}` : ""}` : "—"}</span>
                    <span className="mt-0.5 flex items-center gap-1.5">{a.source === "agent" ? <><Bot size={13} /> Applied by your agent</> : a.source === "extension" ? <><User size={13} /> Applied by you · Vantage extension</> : <><User size={13} /> Added by you</>}</span>
                  </span>
                  <span className="flex items-center gap-3"><Progress s={a.status} /><span className={`chip ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></span>
                  <span className="text-xs text-muted lg:w-24 lg:text-right">{a.applied_at ? new Date(a.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Not sent"}<span className="block">{a.applied_at && Date.parse(a.applied_at) > now - 864e5 * 2 ? timeAgo(a.applied_at) : ""}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Detail({ a, resume, roleName, onClose, onMove, onSaved }: { a: App; resume?: ResumeLite; roleName: string; onClose: () => void; onMove: (a: App, s: AppStatus) => void; onSaved: (m: string) => void }) {
  const [mails, setMails] = useState<Mail[]>([]);
  const [proof, setProof] = useState<string | null>(null);
  const [notes, setNotes] = useState(a.notes || "");
  const [showLetter, setShowLetter] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

  useEffect(() => {
    const s = supabaseBrowser();
    s.from("inbox_messages").select("id,subject,from_name,kind,received_at,snippet").eq("application_id", a.id).order("received_at", { ascending: false }).then(({ data }) => setMails((data as Mail[]) || []));
    if (a.agent_task_id) s.from("agent_proofs").select("image").eq("task_id", a.agent_task_id).maybeSingle().then(({ data }) => setProof((data as { image?: string } | null)?.image || null));
  }, [a.id, a.agent_task_id]);

  const stageAt = (k: AppStatus) => {
    if (k === "applied") return a.applied_at;
    const types: Record<string, string[]> = { in_review: ["in_review", "received", "rejection"], assessment: ["assessment"], interview: ["interview", "interview_scheduled"], offer: ["offer"] };
    return (a.events || []).find((e) => types[k]?.includes(e.type))?.at || null;
  };
  const timeline = [
    ...(a.events || []).map((e) => ({ at: e.at, text: e.text, kind: e.type })),
    ...mails.map((m) => ({ at: m.received_at, text: `${m.from_name || "Company"}: “${m.subject}”`, kind: `mail:${m.kind}` })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const answers = Object.entries(a.answers || {});
  const idx = STAGE_INDEX[a.status];

  async function saveNotes() {
    await supabaseBrowser().from("applications").update({ notes }).eq("id", a.id);
    onSaved("Notes saved");
  }

  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={a.job.title}>
      <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[600px] flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-line bg-white/95 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">{a.job.company} · {a.job.location || a.job.country}</p>
              <h2 className="text-xl font-bold leading-snug">{a.job.title}</h2>
              <p className="mt-1 text-xs text-muted">{roleName}{a.match_score ? ` · ${a.match_score}% match` : ""} · {a.source === "agent" ? "Applied by your agent" : a.source === "extension" ? "Applied by you with the Vantage extension" : "Added by you"}</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
          </div>
        </div>

        <div className="space-y-6 p-5">
          {/* Stage tracker */}
          <div>
            <div className="grid grid-cols-5 gap-2">
              {STAGES.map((st, i) => {
                const done = i <= idx && !["rejected", "withdrawn"].includes(a.status);
                const at = stageAt(st.key);
                return (
                  <div key={st.key} className="text-center">
                    <div className={`mx-auto h-1.5 rounded-full ${done ? stageColor(st.key) : "bg-line-2"}`} />
                    <p className={`mt-2 text-xs font-semibold ${done ? "text-ink" : "text-subtle"}`}>{st.label}</p>
                    {st.key === "assessment" && done && !at && <p className="text-[11px] text-subtle">skipped</p>}
                    <p className="text-[11px] text-muted">{at && done ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</p>
                  </div>
                );
              })}
            </div>
            {["rejected", "withdrawn"].includes(a.status) && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm text-muted">{a.status === "rejected" ? "The company chose other candidates. Your agent learns from this to pick better-fitting jobs." : "You withdrew this application."}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <a href={a.job.url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 text-[13px]"><ExternalLink size={14} /> Job posting</a>
            <Link href={`/app/interviews?app=${a.id}`} className="btn-secondary min-h-9 text-[13px]"><CalendarPlus size={14} /> Add interview</Link>
            <Link href={`/app/assistant?q=${encodeURIComponent(`Prepare me for an interview with ${a.job.company} for ${a.job.title}`)}`} className="btn-secondary min-h-9 text-[13px]"><Sparkles size={14} /> Prepare me</Link>
            <select aria-label="Move to stage" className="input h-9 w-auto py-0 text-[13px] font-semibold" value={a.status} onChange={(e) => onMove(a, e.target.value as AppStatus)}>
              {(Object.keys(STATUS) as AppStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </div>

          {/* What was sent */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Sent with this application</h3>
            <div className="divide-y divide-line rounded-xl border border-line">
              <div className="flex items-center gap-3 p-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-tint text-brand"><FileText size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{resume ? "Resume tailored to this job" : "Resume"}</span>
                  <span className="block truncate text-xs text-muted">{resume ? `${RESUME_STYLES[(resume.style || "classic") as ResumeStyle]?.label || "Classic"} style${resume.ats_score ? ` · ATS ${resume.ats_score}` : ""}` : "Not recorded"}</span>
                </span>
                {a.resume_id && <><Link href={`/app/resumes/${a.resume_id}`} className="btn-ghost min-h-8 text-xs">View</Link><a href={`/api/resume/${a.resume_id}/pdf`} className="rounded-lg p-2 text-subtle hover:bg-canvas" aria-label="Download resume"><Download size={16} /></a></>}
              </div>
              {a.cover_letter && (
                <div className="p-3">
                  <button className="flex w-full items-center gap-3 text-left" onClick={() => setShowLetter(!showLetter)}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-tint text-pink"><Mail size={17} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Cover letter</span><span className="block text-xs text-muted">{a.letter_tone ? `${a.letter_tone[0].toUpperCase()}${a.letter_tone.slice(1)} tone` : "Tailored"}</span></span>
                    <ChevronDown size={16} className={`text-subtle transition ${showLetter ? "rotate-180" : ""}`} />
                  </button>
                  {showLetter && <p className="mt-3 whitespace-pre-line rounded-lg bg-canvas p-3 text-sm leading-relaxed">{a.cover_letter}</p>}
                </div>
              )}
              {answers.length > 0 && (
                <div className="p-3">
                  <button className="flex w-full items-center gap-3 text-left" onClick={() => setShowAnswers(!showAnswers)}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef0f4] text-ink-2"><List size={17} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Form answers</span><span className="block text-xs text-muted">{answers.length} questions answered on the company&apos;s site</span></span>
                    <ChevronDown size={16} className={`text-subtle transition ${showAnswers ? "rotate-180" : ""}`} />
                  </button>
                  {showAnswers && (
                    <dl className="mt-3 space-y-2 text-sm">
                      {answers.map(([q, v]) => <div key={q} className="rounded-lg bg-canvas px-3 py-2"><dt className="text-xs text-muted">{q}</dt><dd className="font-medium">{v}</dd></div>)}
                    </dl>
                  )}
                </div>
              )}
            </div>
          </section>

          {proof && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-green" /> Proof of submission</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/jpeg;base64,${proof}`} alt={`Confirmation page from ${a.job.company}`} className="max-h-72 w-full rounded-xl border border-line object-cover object-top" />
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {timeline.map((e, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[27px] top-1 flex h-3 w-3 rounded-full ring-4 ring-white ${e.kind.startsWith("mail") ? "bg-pink" : "bg-brand"}`} />
                  <p className="text-sm font-medium">{e.text}</p>
                  <p className="text-xs text-muted">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </li>
              ))}
              {!timeline.length && <li className="text-sm text-muted">Nothing yet.</li>}
            </ol>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Your notes</h3>
            <textarea className="input py-2.5 font-normal" rows={3} placeholder="Recruiter name, salary range discussed, follow-up date…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {notes !== (a.notes || "") && <button className="btn-secondary mt-2 min-h-9 text-[13px]" onClick={saveNotes}>Save notes</button>}
          </section>

          <p className="flex items-center gap-2 pb-4 text-xs text-subtle"><Building2 size={13} /> Added {new Date(a.created_at).toLocaleDateString()}{a.applied_at ? ` · applied ${new Date(a.applied_at).toLocaleString()}` : ""}</p>
        </div>
      </aside>
    </div>
  );
}
