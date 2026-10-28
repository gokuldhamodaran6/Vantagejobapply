"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Building2, Check, ExternalLink, Loader2, Plus, Search, ShieldCheck, Star, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Badge, Toast } from "@/components/ui";
import { PrepareDrawer } from "@/components/prepare-drawer";
import type { MatchResult } from "@/lib/types";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { normCompany } from "@/lib/jobs/signals";
import { matchJob } from "@/lib/jobs/match";
import { timeAgo, tintFor } from "@/lib/format";
import type { Job } from "@/lib/types";

type BoardRow = { id: number; name: string; name_norm: string; industry: string | null; ats: string; last_count: number | null; last_ok_at: string | null; token: string; host: string | null; site: string | null };
const ATS_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", workable: "Workable", recruitee: "Recruitee", amazon: "Amazon Jobs" };
const JOB_COLS = "id,source,country,title,company,location,remote,description,url,salary_min,salary_max,currency,category,contract_time,posted_at,sponsorship,sponsor_registered,restrictions";

function careersUrl(b: BoardRow) {
  switch (b.ats) {
    case "greenhouse": return `https://job-boards.greenhouse.io/${b.token}`;
    case "lever": return `https://jobs.lever.co/${b.token}`;
    case "ashby": return `https://jobs.ashbyhq.com/${b.token}`;
    case "workday": return b.host ? `https://${b.host}/${b.site}` : "#";
    case "smartrecruiters": return `https://jobs.smartrecruiters.com/${b.token}`;
    case "workable": return `https://apply.workable.com/${b.token}`;
    case "recruitee": return `https://${b.token}.recruitee.com`;
    case "amazon": return "https://www.amazon.jobs";
    default: return "#";
  }
}

export default function CompaniesPage() {
  const { prefs, roles, auth, userId, refresh } = useMe();
  const [boards, setBoards] = useState<BoardRow[] | null>(null);
  const [sponsors, setSponsors] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "targets" | "sponsors">("all");
  const [industry, setIndustry] = useState("");
  const [open, setOpen] = useState<BoardRow | null>(null);
  const [add, setAdd] = useState("");
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const country = prefs?.countries?.[0] || "US";

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const { data } = await s.from("boards").select("id,name,name_norm,industry,ats,last_count,last_ok_at,token,host,site").eq("active", true).order("last_count", { ascending: false, nullsFirst: false }).limit(2000);
    const list = (data as BoardRow[]) || [];
    setBoards(list);
    const norms = [...new Set(list.map((b) => b.name_norm))];
    const found = new Set<string>();
    for (let i = 0; i < norms.length; i += 150) {
      const { data: sp } = await s.from("sponsors").select("name_norm").eq("country", country).in("name_norm", norms.slice(i, i + 150));
      (sp || []).forEach((r: { name_norm: string }) => found.add(r.name_norm));
    }
    setSponsors(found);
  }, [country]);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const targets = useMemo(() => new Set((prefs?.companies || []).map(normCompany)), [prefs]);
  const industries = useMemo(() => [...new Set((boards || []).map((b) => b.industry).filter(Boolean) as string[])].sort(), [boards]);
  const shown = (boards || []).filter((b) => {
    if (q && !b.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (industry && b.industry !== industry) return false;
    if (tab === "targets" && !targets.has(b.name_norm)) return false;
    if (tab === "sponsors" && !sponsors.has(b.name_norm)) return false;
    return true;
  });
  const totalJobs = (boards || []).reduce((n, b) => n + (b.last_count || 0), 0);

  async function toggleTarget(b: BoardRow) {
    const cur = prefs?.companies || [];
    const on = targets.has(b.name_norm);
    const next = on ? cur.filter((c) => normCompany(c) !== b.name_norm) : [...cur, b.name];
    const { error } = await supabaseBrowser().from("target_prefs").update({ companies: next }).eq("user_id", userId!);
    if (error) return setToast(error.message);
    await refresh();
    setToast(on ? `Removed ${b.name} from your targets` : `${b.name} added — checked every 10 minutes and applied to first`);
  }

  async function addCompany() {
    setAdding(true);
    const isUrl = /^https?:\/\//i.test(add.trim());
    const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isUrl ? { url: add.trim() } : { name: add.trim() }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setAdding(false);
    if (!r?.ok) return setToast(d.error || "Couldn't find that company's careers site. Paste one of their job links instead.");
    setAdd("");
    setToast(d.message || "Added — Vantage is now watching their careers site.");
    load();
  }

  return (
    <>
      <PageHeader title="Companies" subtitle={boards ? `${boards.length} employers watched on their official careers sites · ${totalJobs.toLocaleString()} open jobs` : "Every employer Vantage watches on their official careers site."} />
      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {([["all", "All companies"], ["targets", `My targets · ${targets.size}`], ["sponsors", country === "US" ? "Sponsored H-1B before" : "Licensed sponsors"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${tab === k ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>{l}</button>
          ))}
          <select aria-label="Industry" className="input ml-auto h-9 w-auto py-0 text-sm" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">All industries</option>
            {industries.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input className="input pl-9" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search companies" />
          </div>
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (add.trim()) addCompany(); }}>
            <input className="input" placeholder="Add a company: name or any job link" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add a company" />
            <button className="btn-secondary whitespace-nowrap" disabled={adding || !add.trim()}>{adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add</button>
          </form>
        </div>
      </div>

      {boards === null && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-28" />)}</div>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => {
          const isTarget = targets.has(b.name_norm);
          return (
            <li key={b.id} className="card flex flex-col p-4 transition hover:border-[#c9d5fb]">
              <button className="flex items-start gap-3 text-left" onClick={() => setOpen(b)}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold" style={tintFor(b.name)}>{b.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="block truncate text-xs text-muted">{b.industry || "Company"} · {ATS_LABEL[b.ats] || b.ats}</span>
                </span>
              </button>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{(b.last_count || 0).toLocaleString()} open jobs</Badge>
                {sponsors.has(b.name_norm) && <Badge tone="green"><ShieldCheck size={12} className="mr-0.5 inline" /> {country === "US" ? "H-1B history" : "Sponsor"}</Badge>}
              </div>
              <div className="mt-auto flex items-center gap-2 pt-3">
                <button className={`min-h-9 flex-1 rounded-lg border text-sm font-semibold ${isTarget ? "border-pink bg-pink-tint text-pink-ink" : "border-line text-ink-2 hover:bg-canvas"}`} onClick={() => toggleTarget(b)}>
                  {isTarget ? <><Check size={15} className="mr-1 inline" /> Target</> : <><Star size={15} className="mr-1 inline" /> Add to targets</>}
                </button>
                <button className="btn-secondary min-h-9 text-sm" onClick={() => setOpen(b)}>Jobs</button>
              </div>
            </li>
          );
        })}
      </ul>
      {boards && shown.length === 0 && <div className="card p-10 text-center text-sm text-muted"><Building2 className="mx-auto mb-2 text-subtle" /> No companies match. Add one above by name or job link.</div>}

      <CompanyDrawer board={open} onClose={() => setOpen(null)} roles={roles} prefs={prefs} auth={auth} onToast={setToast} isTarget={open ? targets.has(open.name_norm) : false} onToggle={() => open && toggleTarget(open)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function CompanyDrawer({ board, onClose, roles, prefs, auth, onToast, isTarget, onToggle }: {
  board: BoardRow | null; onClose: () => void; roles: ReturnType<typeof useMe>["roles"]; prefs: ReturnType<typeof useMe>["prefs"]; auth: ReturnType<typeof useMe>["auth"];
  onToast: (m: string) => void; isTarget: boolean; onToggle: () => void;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [onlyFit, setOnlyFit] = useState(true);
  const [prep, setPrep] = useState<{ job: Job; match: MatchResult } | null>(null);
  useEffect(() => {
    setJobs(null);
    if (!board) return;
    // Open jobs from the last 60 days only — the same window as Live jobs. Closed postings never appear.
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    supabaseBrowser().from("jobs").select(JOB_COLS).eq("company_norm", board.name_norm).is("closed_at", null).gte("posted_at", since).order("posted_at", { ascending: false, nullsFirst: false }).limit(300).then(({ data }) => setJobs((data as Job[]) || []));
  }, [board]);
  if (!board) return null;
  const scored = (jobs || []).map((j) => ({ j, m: matchJob(j, { roles, prefs, auth }) }));
  const list = onlyFit ? scored.filter((x) => x.m.eligible && !x.m.tooSenior && (x.m.roleFit ?? 0) >= 0.45 && x.m.score >= 30).sort((a, b) => b.m.score - a.m.score) : scored;
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={`${board.name} jobs`}>
        <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={onClose} />
        <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col bg-white shadow-2xl">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold" style={tintFor(board.name)}>{board.name.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold">{board.name}</h2>
              <p className="text-sm text-muted">{board.industry || "Company"} · {(board.last_count || 0).toLocaleString()} open jobs · updated {timeAgo(board.last_ok_at)}</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <button className={`btn min-h-9 border text-sm ${isTarget ? "border-pink bg-pink-tint text-pink-ink" : "border-line"}`} onClick={onToggle}>{isTarget ? <><Check size={15} /> In your targets</> : <><Star size={15} /> Add to targets</>}</button>
            <a className="btn-ghost min-h-9 text-sm" href={careersUrl(board)} target="_blank" rel="noopener noreferrer">Official careers site <ExternalLink size={14} /></a>
            <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} /> Only jobs that fit me</label>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {jobs === null && <div className="skeleton h-40" />}
            {jobs && list.length === 0 && <p className="text-sm text-muted">{onlyFit ? "No open roles here match your targets and can hire you right now. Turn off the filter to see everything." : "No open jobs right now."}</p>}
            <ul className="space-y-2">
              {list.slice(0, 150).map(({ j, m }) => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{j.title}</p>
                    <p className="truncate text-xs text-muted">{j.location || j.country} · {timeAgo(j.posted_at)}{m.eligible ? ` · ${m.score}% match` : ` · ${m.blockers[0]}`}</p>
                  </div>
                  <a href={j.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-ink">View</a>
                  {m.eligible && <button className="btn-primary min-h-8 text-xs" onClick={() => setPrep({ job: j, match: m })}><ArrowUpRight size={13} /> Tailor &amp; apply</button>}
                </li>
              ))}
            </ul>
          </div>
        </motion.aside>
        <PrepareDrawer item={prep} onClose={() => setPrep(null)} onSaved={onToast} />
      </motion.div>
    </AnimatePresence>
  );
}
