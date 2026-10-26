"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Segmented, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, timeAgo, tintFor } from "@/lib/format";
import { COUNTRY_BY_CODE } from "@/lib/countries";
import type { Application, AppStatus } from "@/lib/types";

const COLUMNS: { id: AppStatus[]; title: string; dot: string }[] = [
  { id: ["saved", "ready"], title: "To apply", dot: "#f7862b" },
  { id: ["applied"], title: "Applied", dot: "#2f5beb" },
  { id: ["in_review"], title: "In review", dot: "#7c8aa5" },
  { id: ["interview"], title: "Interview", dot: "#e0457b" },
  { id: ["offer"], title: "Offer", dot: "#22a05b" },
  { id: ["rejected", "withdrawn"], title: "Closed", dot: "#a3a9b6" },
];
const STATUS_TEXT: Record<AppStatus, string> = {
  saved: "Saved", ready: "Prepared", applied: "Applied", in_review: "In review", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};

type GroupBy = "role" | "company" | "country";

export default function ApplicationsPage() {
  const { roles, userId } = useMe();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [by, setBy] = useState<GroupBy>("role");
  const [pick, setPick] = useState("All");
  const [open, setOpen] = useState<Application | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const { data } = await supabaseBrowser().from("applications").select("*").order("updated_at", { ascending: false });
    setApps((data as Application[]) || []);
  }
  useEffect(() => {
    if (userId) load();
  }, [userId]);

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.title || "Other";
  const keyOf = (a: Application) => (by === "role" ? roleName(a.target_role_id) : by === "company" ? a.job.company : COUNTRY_BY_CODE[a.job.country]?.name || a.job.country);

  const groups = useMemo(() => {
    const m = new Map<string, number>();
    (apps || []).forEach((a) => m.set(keyOf(a), (m.get(keyOf(a)) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, by, roles]);

  const shown = (apps || []).filter((a) => pick === "All" || keyOf(a) === pick);
  const applied = shown.filter((a) => !["saved", "ready"].includes(a.status));
  const replied = shown.filter((a) => ["in_review", "interview", "offer", "rejected"].includes(a.status));
  const interviews = shown.filter((a) => ["interview", "offer"].includes(a.status));

  async function setStatus(a: Application, status: AppStatus) {
    const now = new Date().toISOString();
    const events = [...(a.events || []), { at: now, type: status, text: `Status changed to ${STATUS_TEXT[status]}` }];
    const { error } = await supabaseBrowser().from("applications").update({ status, events, applied_at: status === "applied" && !a.applied_at ? now : a.applied_at }).eq("id", a.id);
    if (error) return setToast(error.message);
    setToast(`Moved to ${STATUS_TEXT[status]}`);
    setOpen(null);
    load();
  }

  if (apps && apps.length === 0) {
    return (
      <>
        <PageHeader title="Applications" />
        <EmptyState title="No applications yet" body="Prepare an application from Live jobs and it will be tracked here — grouped by target role, company or country." action={<Link href="/app/jobs" className="btn-primary">Find jobs</Link>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Applications" subtitle="Every job you've saved, prepared or applied to — by target." />
      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink-2">View by</span>
          <Segmented label="Group by" value={by} onChange={(v) => { setBy(v); setPick("All"); }}
            options={[{ value: "role", label: "Target role" }, { value: "company", label: "Company" }, { value: "country", label: "Country" }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          {[["All", apps?.length || 0] as [string, number], ...groups].map(([g, n]) => (
            <button key={g} aria-pressed={pick === g} onClick={() => setPick(g)}
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold ${pick === g ? "border-brand bg-brand text-white" : "border-line text-ink"}`}>
              {g}<span className={`rounded-full px-1.5 text-xs ${pick === g ? "bg-white/25" : "bg-[#eef0f4]"}`}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Applied", applied.length, "text-ink"], ["Companies replied", replied.length, "text-green-ink"], ["Reply rate", applied.length ? `${Math.round((replied.length / applied.length) * 100)}%` : "—", "text-brand-ink"], ["Interviews", interviews.length, "text-pink-ink"]].map(([l, n, c]) => (
          <div key={l as string} className="card p-4"><p className="text-sm text-muted">{l}</p><p className={`mt-1 text-2xl font-bold ${c}`}>{n}</p></div>
        ))}
      </div>

      {!apps && <div className="skeleton h-96" />}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1000px] grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const items = shown.filter((a) => col.id.includes(a.status));
            return (
              <div key={col.title} className="min-h-[360px] rounded-xl bg-[#eef0f4] p-2.5">
                <div className="flex items-center gap-2 px-1.5 pb-2.5 pt-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
                  <span className="text-sm font-bold">{col.title}</span>
                  <span className="ml-auto text-xs font-semibold text-muted">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((a) => (
                    <button key={a.id} onClick={() => setOpen(a)} className="block w-full rounded-lg border border-line bg-white p-3 text-left shadow-sm transition hover:border-[#c9d5fb]">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span>
                        <span className="truncate text-[13px] font-semibold">{a.job.company}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">{a.job.title}</p>
                      <p className="mt-1.5 text-[11px] text-muted">{roleName(a.target_role_id)} · {timeAgo(a.updated_at)}{a.match_score ? ` · ${a.match_score}%` : ""}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={open.job.title}>
          <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={() => setOpen(null)} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{open.job.company} · {open.job.location || open.job.country}</p>
                <h2 className="text-xl font-bold">{open.job.title}</h2>
              </div>
              <button onClick={() => setOpen(null)} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
            </div>
            <a href={open.job.url} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-4 self-start">Official posting <ExternalLink size={14} /></a>
            <p className="mt-6 text-sm font-semibold">Move to</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(STATUS_TEXT) as AppStatus[]).map((s) => (
                <button key={s} onClick={() => setStatus(open, s)} disabled={open.status === s}
                  className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${open.status === s ? "border-brand bg-brand text-white" : "border-line hover:bg-canvas"}`}>{STATUS_TEXT[s]}</button>
              ))}
            </div>
            {open.resume_id && <Link href={`/app/resumes/${open.resume_id}`} className="mt-6 text-sm font-semibold text-brand-ink">Open the resume sent with this application</Link>}
            {open.cover_letter && (
              <div className="mt-6">
                <p className="text-sm font-semibold">Cover letter</p>
                <p className="mt-2 whitespace-pre-line rounded-lg bg-canvas p-3 text-sm leading-relaxed">{open.cover_letter}</p>
              </div>
            )}
            <div className="mt-6">
              <p className="text-sm font-semibold">Timeline</p>
              <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
                {[...(open.events || [])].reverse().map((e, i) => (
                  <li key={i} className="text-sm"><p className="font-medium">{e.text}</p><p className="text-xs text-muted">{new Date(e.at).toLocaleString()}</p></li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
