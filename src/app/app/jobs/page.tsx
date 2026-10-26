"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Building2, ExternalLink, MapPin, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { PrepareDrawer } from "@/components/prepare-drawer";
import { Badge, Toast, Toggle } from "@/components/ui";
import { useMe } from "@/lib/me";
import { COUNTRY_BY_CODE } from "@/lib/countries";
import { money, timeAgo, tintFor, initials } from "@/lib/format";
import type { Job, MatchResult } from "@/lib/types";

type Item = { job: Job; match: MatchResult };
type Resp = { results: Item[]; meta: { sources: Record<string, number>; hidden: number; total: number; refreshed: number; sponsorCheck?: boolean }; tookMs: number; error?: string; upgrade?: boolean };

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
  const [showBlocked, setShowBlocked] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const c = country || countries[0];

  const load = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ country: c });
    if (roleId) p.set("role", roleId);
    if (query) p.set("q", query);
    if (remote) p.set("remote", "1");
    if (showBlocked) p.set("blocked", "1");
    const r = await fetch(`/api/jobs?${p}`);
    const d = (await r.json()) as Resp;
    setData(d);
    setBusy(false);
  }, [c, roleId, query, remote, showBlocked]);

  useEffect(() => {
    if (!loading) load();
  }, [loading, load]);

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
          <button onClick={() => setRoleId("")} aria-pressed={!roleId} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${!roleId ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>All target roles</button>
          {roles.filter((r) => r.active).map((r) => (
            <button key={r.id} onClick={() => setRoleId(r.id)} aria-pressed={roleId === r.id}
              className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${roleId === r.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{r.title}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex min-w-[240px] flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input className="input pl-9" placeholder="Search a different title, e.g. Product Analyst" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
            </div>
            <button className="btn-secondary">Search</button>
          </form>
          <label className="flex items-center gap-2 text-sm font-medium"><Toggle checked={remote} onChange={setRemote} label="Remote only" /> Remote only</label>
          <label className="flex items-center gap-2 text-sm font-medium"><Toggle checked={showBlocked} onChange={setShowBlocked} label="Show jobs that can't hire you" /> Show filtered</label>
        </div>
      </div>

      {data && !data.error && (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="font-semibold text-ink">{data.results.length} jobs fit you</span>
          {data.meta.hidden > 0 && <span>· {data.meta.hidden} hidden because they can&apos;t hire you</span>}
          {sourcesText && <span>· from {sourcesText}</span>}
          {data.meta.sponsorCheck && <span className="inline-flex items-center gap-1 text-green-ink"><ShieldCheck size={14} /> Sponsor register checked</span>}
          <span>· {Math.max(1, Math.round(data.tookMs))} ms</span>
        </p>
      )}

      {data?.error && (
        <div className="card mb-4 border-[#fbd9bc] bg-[#fff8f1] p-4 text-sm">
          {data.error} {data.upgrade && <Link href="/app/settings#billing" className="font-semibold text-brand-ink">See plans</Link>}
        </div>
      )}

      {busy && !data && (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-28" />)}</div>
      )}

      {data && !data.error && data.results.length === 0 && (
        <EmptyState
          title="No matching jobs here yet"
          body="Add target companies so Vantage watches their careers sites, try another title, or switch country. New jobs arrive throughout the day."
          action={<Link href="/app/targets#companies" className="btn-primary">Add target companies</Link>}
        />
      )}

      <ul className="space-y-3">
        {data?.results.map((it, i) => (
          <motion.li key={it.job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}>
            <JobCard item={it} onOpen={() => setOpen(it)} />
          </motion.li>
        ))}
      </ul>

      <PrepareDrawer item={open} onClose={() => setOpen(null)} onSaved={(m) => setToast(m)} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function JobCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { job, match } = item;
  const blocked = !match.eligible;
  const pay = money(job.salary_min, job.salary_max, job.currency);
  return (
    <article className={`card p-5 transition hover:border-[#c9d5fb] ${blocked ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start gap-4">
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
        {job.sponsor_registered && <Badge tone="green">✓ Licensed visa sponsor</Badge>}
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
          {!blocked && <button onClick={onOpen} className="btn-primary min-h-9 text-[13px]">Prepare application</button>}
        </div>
      </div>
    </article>
  );
}
