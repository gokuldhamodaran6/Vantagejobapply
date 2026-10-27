"use client";
import type { GhostRisk } from "@/lib/jobs/ghost";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Building2, Check, ExternalLink, Loader2, MapPin, RefreshCw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { PrepareDrawer } from "@/components/prepare-drawer";
import { Badge, Toast, Toggle } from "@/components/ui";
import { useMe } from "@/lib/me";
import { COUNTRY_BY_CODE } from "@/lib/countries";
import { money, timeAgo, tintFor, initials } from "@/lib/format";
import type { Job, MatchResult } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { roleKey } from "@/lib/agent/plan";

/** What you've already done with a job (or the same role reposted): shown on its card. */
type Known = { label: string; tone: "green" | "blue" | "orange" | "gray"; applied: boolean };
const KNOWN_OF: Record<string, Omit<Known, "label"> & { label: (at: string) => string }> = {
  submitted: { label: (at) => `Applied ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, tone: "green", applied: true },
  extension: { label: () => "In your browser", tone: "blue", applied: false },
  queued: { label: () => "In your list", tone: "blue", applied: false },
  awaiting_approval: { label: () => "Waiting for your OK", tone: "orange", applied: false },
  running: { label: () => "Applying now", tone: "blue", applied: false },
  waiting_code: { label: () => "Applying now", tone: "blue", applied: false },
  needs_human: { label: () => "Needs you", tone: "orange", applied: false },
  needs_user: { label: () => "Needs you", tone: "orange", applied: false },
  manual: { label: () => "Needs you", tone: "orange", applied: false },
};

type Item = { job: Job; match: MatchResult; ghost?: GhostRisk };
type Live = { open_jobs?: number; companies?: number; new_24h?: number; updated_at?: string };
type Resp = { results: Item[]; meta: { sources: Record<string, number>; hidden: number; hiddenBy?: Record<string, number>; total: number; refreshed: number; sponsorCheck?: boolean; live?: Live | null }; tookMs: number; error?: string };

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", workable: "Workable", recruitee: "Recruitee",
};

export default function JobsPage() {
  const { prefs, roles, loading } = useMe();
  const countries = prefs?.countries?.length ? prefs.countries : ["US"];
  const [country, setCountry] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string>("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState(false);
  const [days, setDays] = useState(60);
  const [showBlocked, setShowBlocked] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  // Jobs you've already applied to, queued or are working on — by posting, and by role (reposts).
  const [known, setKnown] = useState<{ byJob: Map<string, Known>; byRole: Map<string, Known> }>({ byJob: new Map(), byRole: new Map() });
  const [hideApplied, setHideApplied] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const loadKnown = useCallback(async () => {
    const s = supabaseBrowser();
    const [t, a] = await Promise.all([
      s.from("agent_tasks").select("job_id,job,status,finished_at,updated_at").neq("status", "cancelled").order("updated_at", { ascending: false }).limit(3000),
      s.from("applications").select("job_id,job,applied_at").not("applied_at", "is", null).limit(3000),
    ]);
    const byJob = new Map<string, Known>();
    const byRole = new Map<string, Known>();
    const put = (jobId: string | null, j: { company?: string; title?: string } | null, k: Known) => {
      if (jobId && !byJob.has(jobId)) byJob.set(jobId, k);
      const rk = j?.company && j?.title ? roleKey(j.company, j.title) : "";
      if (rk && (!byRole.has(rk) || (k.applied && !byRole.get(rk)!.applied))) byRole.set(rk, k);
    };
    for (const r of (a.data as { job_id: string | null; job: { company?: string; title?: string } | null; applied_at: string }[]) || []) put(r.job_id, r.job, { ...KNOWN_OF.submitted, label: KNOWN_OF.submitted.label(r.applied_at) });
    for (const r of (t.data as { job_id: string; job: { company?: string; title?: string }; status: string; finished_at: string | null; updated_at: string }[]) || []) {
      const m = KNOWN_OF[r.status];
      if (m) put(r.job_id, r.job, { ...m, label: m.label(r.finished_at || r.updated_at) });
    }
    setKnown({ byJob, byRole });
  }, []);
  useEffect(() => {
    void loadKnown();
  }, [loadKnown]);
  const knownOf = useCallback((j: Job): Known | null => {
    const k = known.byJob.get(j.id);
    if (k) return k;
    const r = known.byRole.get(roleKey(j.company, j.title));
    return r ? { ...r, label: r.applied ? `Applied to this role${r.label.replace("Applied", "")}` : r.label } : null;
  }, [known]);

  const c = country || countries[0];
  const activeRoles = roles.filter((r) => r.active);
  const role = activeRoles.find((r) => r.id === roleId);

  // Deep links from My targets and Your agent: /app/jobs?role=<target id>
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("role");
    if (r) setRoleId(r);
    setLinked(true);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ country: c });
    if (roleId) p.set("role", roleId);
    if (query) p.set("q", query);
    if (remote) p.set("remote", "1");
    if (days !== 60) p.set("days", String(days));
    if (showBlocked) p.set("blocked", "1");
    // Show the last results for this search at once, then swap in the fresh ones (a few hundred ms later).
    const key = `vantage.jobs.${p}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null") as Resp | null;
      if (cached?.results) setData(cached);
    } catch { /* storage unavailable */ }
    const r = await fetch(`/api/jobs?${p}`).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({ error: "Job search is temporarily unavailable." }))) as Resp) : ({ error: "Network error. Check your connection and try again." } as Resp);
    if (d.error) setData((cur) => (cur?.results ? cur : d));
    else {
      setData(d);
      try { localStorage.setItem(key, JSON.stringify({ ...d, results: d.results.map((it) => ({ ...it, job: { ...it.job, description: (it.job.description || "").slice(0, 400) } })) })); } catch { /* full or blocked */ }
    }
    setBusy(false);
  }, [c, roleId, query, remote, days, showBlocked]);

  useEffect(() => {
    if (!loading && linked) load();
  }, [loading, linked, load]);

  const results = useMemo(() => (data?.results || []).filter((it) => !(hideApplied && knownOf(it.job)?.applied)), [data, hideApplied, knownOf]);
  const appliedHidden = (data?.results.length || 0) - results.length;

  // Add the picked jobs to your agent's list. Each gets a tailored resume; over today's limit they wait for your OK.
  async function addPicked() {
    const items = results.filter((it) => picked.has(it.job.id));
    if (!items.length) return;
    setAdding({ done: 0, total: items.length });
    let queued = 0, later = 0, skipped = 0;
    let overLimit = false;
    const msgs: string[] = [];
    for (const it of items) {
      let r = await fetch("/api/agent/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: it.job.id, roleId: it.match.role?.id || null, later: overLimit }) }).catch(() => null);
      if (r?.status === 429 && !overLimit) {
        overLimit = true;
        r = await fetch("/api/agent/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: it.job.id, roleId: it.match.role?.id || null, later: true }) }).catch(() => null);
      }
      if (r?.ok) { if (overLimit) later++; else queued++; }
      else { skipped++; const d = r ? await r.json().catch(() => ({})) : {}; if (d.error && msgs.length < 1) msgs.push(d.error); }
      setAdding((x) => (x ? { ...x, done: x.done + 1 } : x));
    }
    setAdding(null);
    setPicked(new Set());
    void loadKnown();
    setToast([
      queued ? `${queued} added to Up next — your agent starts now.` : "",
      later ? `${later} over today's limit wait in Your agent for your OK.` : "",
      skipped ? `${skipped} skipped${msgs[0] ? `: ${msgs[0]}` : "."}` : "",
    ].filter(Boolean).join(" "));
  }

  const sourcesText = useMemo(() => {
    const s = data?.meta.sources || {};
    return Object.keys(s).map((k) => SOURCE_LABEL[k] || k).join(", ");
  }, [data]);

  if (!loading && roles.length === 0) {
    return (
      <>
        <PageHeader title="Live jobs" />
        <EmptyState title="Add a target role to see jobs" body="Tell Vantage which roles you want and it will show only live jobs that can hire you." action={<Link href="/app/targets" className="btn-primary">Add a target role</Link>} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Live jobs"
        subtitle="Straight from employers' official careers sites, filtered to what you can legally take."
        actions={<button className="btn-secondary" onClick={load} disabled={busy}><RefreshCw size={16} className={busy ? "animate-spin" : ""} /> Refresh</button>}
      />

      <div className="card mb-4 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {countries.map((cc) => (
            <button key={cc} onClick={() => setCountry(cc)} aria-pressed={c === cc}
              className={`min-h-9 rounded-full border px-4 text-sm font-semibold ${c === cc ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>
              {COUNTRY_BY_CODE[cc]?.name || cc}
            </button>
          ))}
          <Link href="/app/targets" className="ml-1 text-sm font-medium text-brand-ink">Edit countries</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setRoleId(""); setQuery(""); setQ(""); }} aria-pressed={!roleId && !query} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${!roleId && !query ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>All target roles</button>
          {activeRoles.map((r) => (
            <button key={r.id} onClick={() => { setRoleId(r.id); setQuery(""); setQ(""); }} aria-pressed={roleId === r.id && !query}
              className={`min-h-9 rounded-lg border px-3 text-sm font-semibold capitalize ${roleId === r.id && !query ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{r.title}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex min-w-[240px] flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); if (q.trim()) setRoleId(""); }}>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input className="input pl-9" placeholder="Search a different title, e.g. Product Analyst" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
            </div>
            <button className="btn-secondary">Search</button>
          </form>
          <label className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted">Posted</span>
            <select className="input min-h-9 w-auto py-0 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Posted within">
              <option value={60}>Last 60 days</option>
              <option value={30}>Last 30 days</option>
              <option value={14}>Last 14 days</option>
              <option value={7}>Last 7 days</option>
              <option value={3}>Last 3 days</option>
              <option value={1}>Last 24 hours</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium"><Toggle checked={remote} onChange={setRemote} label="Remote only" /> Remote only</label>
          <label className="flex items-center gap-2 text-sm font-medium"><Toggle checked={showBlocked} onChange={setShowBlocked} label="Show jobs that can't hire you" /> Show filtered</label>
        </div>
      </div>

      {data?.meta?.live?.open_jobs ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
          </span>
          <span><span className="font-semibold text-ink">{data.meta.live.open_jobs.toLocaleString()}</span> <span className="text-muted">live jobs from</span> <span className="font-semibold text-ink">{(data.meta.live.companies || 0).toLocaleString()}</span> <span className="text-muted">companies, read straight from their careers sites</span></span>
          {/* "New today" only means something when it's a small share — after a full re-crawl every job looks new. */}
          {(data.meta.live.new_24h || 0) > 0 && (data.meta.live.new_24h || 0) < (data.meta.live.open_jobs || 0) * 0.2 && <span className="text-muted">· {data.meta.live.new_24h!.toLocaleString()} new today</span>}
          <span className="text-muted">· closed jobs removed, reposts flagged</span>
        </div>
      ) : null}

      {data && !data.error && (
        <div className="mb-4 space-y-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="font-semibold text-ink">
              {results.length} {results.length === 1 ? "job fits" : "jobs fit"}{" "}
              {query ? <>“{query}”</> : role ? <>your <span className="capitalize">{role.title}</span> target</> : "your targets"}
            </span>
            {sourcesText && <span>· from {sourcesText}</span>}
            {data.meta.sponsorCheck && <span className="inline-flex items-center gap-1 text-green-ink"><ShieldCheck size={14} /> Sponsor register checked</span>}
            <label className="ml-auto flex items-center gap-2 font-medium text-ink-2"><Toggle checked={hideApplied} onChange={setHideApplied} label="Hide jobs you applied to" /> Hide applied{hideApplied && appliedHidden > 0 ? ` (${appliedHidden})` : ""}</label>
          </p>
          {data.meta.hidden > 0 && !showBlocked && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm">
              <span className="font-semibold">{data.meta.hidden} hidden:</span>
              {Object.entries(data.meta.hiddenBy || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <span key={k} className="chip bg-canvas text-ink-2">{v} · {k}</span>
              ))}
              <button className="ml-auto text-sm font-semibold text-brand-ink" onClick={() => setShowBlocked(true)}>Show them</button>
              {(data.meta.hiddenBy?.["Don't confirm sponsorship"] || 0) > 0 && (
                <Link href="/app/targets" className="text-sm font-semibold text-brand-ink">Change sponsorship filter</Link>
              )}
            </div>
          )}
        </div>
      )}

      {data?.error && (
        <div className="card mb-4 border-[#fbd9bc] bg-[#fff8f1] p-4 text-sm">
          {data.error}
        </div>
      )}

      {busy && !data && (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-28" />)}</div>
      )}

      {data && !data.error && results.length === 0 && (
        <EmptyState
          title="No matching jobs here yet"
          body="Add target companies so Vantage watches their careers sites, try another title, or switch country. New jobs arrive throughout the day."
          action={<Link href="/app/targets#companies" className="btn-primary">Add target companies</Link>}
        />
      )}

      <ul className="space-y-3">
        {results.map((it, i) => (
          <motion.li key={it.job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}>
            <JobCard item={it} known={knownOf(it.job)} picked={picked.has(it.job.id)} onPick={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(it.job.id); else n.delete(it.job.id); return n; })} onOpen={() => setOpen(it)} />
          </motion.li>
        ))}
      </ul>

      {(picked.size > 0 || adding) && (
        <div className="sticky bottom-3 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-xl" role="region" aria-label="Selected jobs">
          <p className="min-w-0 flex-1 text-sm">
            {adding ? <><Loader2 size={15} className="mr-1.5 inline animate-spin" aria-hidden /> Adding {adding.done} of {adding.total} — tailoring a resume for each…</> : <><b>{picked.size} selected</b> <span className="text-white/70">· {results.filter((r) => picked.has(r.job.id)).map((r) => r.job.company).slice(0, 4).join(", ")}{picked.size > 4 ? "…" : ""} · resumes tailored automatically</span></>}
          </p>
          {!adding && <button className="min-h-10 rounded-lg border border-white/25 px-4 text-sm font-semibold hover:bg-white/10" onClick={() => setPicked(new Set())}><X size={15} className="mr-1 inline" aria-hidden />Clear</button>}
          <button className="btn-primary min-h-10" disabled={Boolean(adding)} onClick={() => void addPicked()}><Sparkles size={16} /> Add {picked.size || adding?.total} to my agent</button>
        </div>
      )}

      <PrepareDrawer item={open} onClose={() => setOpen(null)} onSaved={(m) => setToast(m)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function JobCard({ item, known, picked, onPick, onOpen }: { item: Item; known: Known | null; picked: boolean; onPick: (v: boolean) => void; onOpen: () => void }) {
  const { job, match, ghost } = item;
  const blocked = !match.eligible;
  const canPick = !blocked && !known;
  const pay = money(job.salary_min, job.salary_max, job.currency);
  return (
    <article className={`card p-5 transition hover:border-[#c9d5fb] ${blocked ? "opacity-70" : ""} ${picked ? "border-brand ring-2 ring-brand/15" : ""} ${ghost?.level === "high" ? "border-red/40 bg-red-tint/30" : ""}`}>
      {ghost && (
        <p className={`-mx-5 -mt-5 mb-4 flex items-start gap-2 rounded-t-[inherit] px-5 py-2 text-[13px] font-semibold ${ghost.level === "high" ? "bg-red-tint text-red-ink" : "bg-orange-tint text-orange-ink"}`}>
          <span aria-hidden>●</span>
          <span>{ghost.level === "high" ? "Likely ghost job — skip it and save an application" : "Might be a ghost job"}<span className="font-normal"> · {ghost.reasons.join(" · ")}</span></span>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-4">
        {canPick ? (
          <label className="mt-2.5 flex cursor-pointer items-center">
            <input type="checkbox" className="size-5 accent-[var(--color-brand)]" checked={picked} onChange={(e) => onPick(e.target.checked)} aria-label={`Select ${job.title} at ${job.company}`} />
          </label>
        ) : <span className="w-5" aria-hidden />}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold" style={tintFor(job.company)}>{initials(job.company)}</span>
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="text-left text-[17px] font-semibold leading-snug hover:text-brand-ink">{job.title}</button>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1"><Building2 size={14} /> {job.company}</span>
            {job.location && <span className="inline-flex items-center gap-1"><MapPin size={14} /> {job.location}</span>}
            {pay && <span>{pay}</span>}
            {job.posted_at && <span>{timeAgo(job.posted_at)}</span>}
          </p>
        </div>
        <span className={`pill ${blocked ? "bg-red-tint text-red-ink" : match.verdict === "great" ? "bg-pink-tint text-pink-ink" : "bg-brand-tint text-brand-ink"}`}>
          {blocked ? "Can't hire you" : `${match.score}% match`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {known && <Badge tone={known.tone}>{known.applied ? <Check size={12} className="mr-0.5 inline" aria-hidden /> : null}{known.label}</Badge>}
        {job.sponsor_registered && <Badge tone="green">{job.country === "US" ? "✓ Has sponsored H-1B visas" : job.country === "GB" ? "✓ Licensed UK visa sponsor" : "✓ Known visa sponsor"}</Badge>}
        {job.sponsorship === "offers" && <Badge tone="green">✓ Offers sponsorship</Badge>}
        {job.sponsorship === "silent" && !job.sponsor_registered && <Badge tone="gray">Sponsorship not mentioned</Badge>}
        {job.remote && <Badge tone="blue">Remote</Badge>}
        {match.role && <Badge tone="gray">{match.role.title}</Badge>}
        {match.blockers.map((b) => <Badge key={b} tone="red">{b}</Badge>)}
        {match.warnings.slice(0, 2).map((w) => <Badge key={w} tone="orange">{w}</Badge>)}
      </div>
      {match.reasons.length > 0 && <p className="mt-3 text-sm text-ink-2">{match.reasons.slice(0, 3).join(" · ")}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-xs text-muted">Official posting on {job.company}&apos;s careers site</span>
        <div className="ml-auto flex gap-2">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn-ghost min-h-9 text-[13px]">View posting <ExternalLink size={14} /></a>
          {!blocked && !known?.applied && <button onClick={onOpen} className={`${known ? "btn-secondary" : "btn-primary"} min-h-9 text-[13px]`}>Prepare application</button>}
        </div>
      </div>
    </article>
  );
}
