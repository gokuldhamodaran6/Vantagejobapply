"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUp, Bot, CheckCircle2, Circle } from "lucide-react";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, timeAgo, tintFor } from "@/lib/format";
import type { Application, Job, MatchResult } from "@/lib/types";

export default function Dashboard() {
  const router = useRouter();
  const { profile, roles, prefs, userId } = useMe();
  const [apps, setApps] = useState<Application[]>([]);
  const [hasResume, setHasResume] = useState<boolean | null>(null);
  const [top, setTop] = useState<{ job: Job; match: MatchResult }[] | null>(null);
  const [ask, setAsk] = useState("");

  useEffect(() => {
    if (!userId) return;
    const s = supabaseBrowser();
    s.from("applications").select("*").order("updated_at", { ascending: false }).then(({ data }) => setApps((data as Application[]) || []));
    s.from("resumes").select("id", { count: "exact", head: true }).then(({ count }) => setHasResume((count || 0) > 0));
    fetch(`/api/jobs?country=${prefs?.countries?.[0] || "US"}`).then(async (r) => {
      const d = await r.json();
      setTop((d.results || []).slice(0, 5));
    });
  }, [userId, prefs]);

  const [now] = useState(() => Date.now());
  const weekAgo = now - 7 * 864e5;
  const appliedWeek = apps.filter((a) => a.applied_at && Date.parse(a.applied_at) > weekAgo).length;
  const replies = apps.filter((a) => ["in_review", "interview", "offer", "rejected"].includes(a.status)).length;
  const interviews = apps.filter((a) => a.status === "interview").length;
  const toApply = apps.filter((a) => ["saved", "ready"].includes(a.status)).length;

  const hour = new Date(now).getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (profile?.full_name || "").split(" ")[0];

  const steps = [
    { done: roles.length > 0, label: "Add your target roles", href: "/app/targets" },
    { done: Boolean(hasResume), label: "Add your resume", href: "/app/resumes" },
    { done: (prefs?.companies?.length || 0) > 0, label: "Add target companies", href: "/app/targets#companies" },
    { done: apps.some((a) => a.status !== "saved"), label: "Prepare your first application", href: "/app/jobs" },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[26px] font-bold tracking-tight sm:text-[30px]">{greet}{first ? `, ${first}` : ""}</h1>
        <p className="mt-1.5 text-[15px] text-muted">Here&apos;s where your job search stands.</p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); router.push(`/app/assistant?q=${encodeURIComponent(ask || "What did I apply to this week?")}`); }}
        className="card mb-6 flex items-center gap-3 p-2 pl-4"
      >
        <Bot size={20} className="shrink-0 text-pink" />
        <input className="min-h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" placeholder="Ask your agent — “What did I apply to today?” or “Also target Product Analyst roles”" value={ask} onChange={(e) => setAsk(e.target.value)} aria-label="Ask your agent" />
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white" aria-label="Send"><ArrowUp size={18} /></button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        {[
          ["Applied this week", appliedWeek, "#2f5beb", "#eef2fe"],
          ["Companies replied", replies, "#22a05b", "#e8f6ee"],
          ["Interviews", interviews, "#e0457b", "#fdecf2"],
          ["Ready to apply", toApply, "#f7862b", "#fff1e5"],
        ].map(([label, n, dot, tint], i) => (
          <motion.div key={label as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 sm:p-5">
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: tint as string }}><span className="h-2 w-2 rounded-full" style={{ background: dot as string }} /></span><span className="text-sm font-medium text-ink-2">{label}</span></div>
            <p className="mt-3 text-3xl font-bold tracking-tight">{n}</p>
          </motion.div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card overflow-hidden" aria-labelledby="top-h">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 id="top-h" className="font-semibold">Best new matches for you</h2>
            <Link href="/app/jobs" className="text-sm font-semibold text-brand-ink">All live jobs</Link>
          </div>
          {top === null && <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>}
          {top?.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No matches yet. Add target companies or roles to widen your search.</p>}
          <ul>
            {top?.map(({ job, match }) => (
              <li key={job.id} className="border-t border-line">
                <Link href="/app/jobs" className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={tintFor(job.company)}>{initials(job.company)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{job.title}</span><span className="block truncate text-xs text-muted">{job.company} · {job.location || job.country} · {timeAgo(job.posted_at)}</span></span>
                  {job.sponsor_registered && <span className="chip hidden bg-green-tint text-green-ink sm:inline-flex">Sponsor</span>}
                  <span className="pill bg-pink-tint text-pink-ink">{match.score}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-6">
          {stepsLeft > 0 && (
            <section className="card p-5" aria-labelledby="setup-h">
              <h2 id="setup-h" className="font-semibold">Finish setting up</h2>
              <p className="text-sm text-muted">{stepsLeft} step{stepsLeft > 1 ? "s" : ""} left for the best matches</p>
              <ul className="mt-3 space-y-1">
                {steps.map((s) => (
                  <li key={s.label}>
                    <Link href={s.href} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-canvas">
                      {s.done ? <CheckCircle2 size={18} className="text-green" /> : <Circle size={18} className="text-subtle" />}
                      <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card p-5" aria-labelledby="roles-h">
            <div className="flex items-center justify-between"><h2 id="roles-h" className="font-semibold">Your target roles</h2><Link href="/app/targets" className="text-sm font-semibold text-brand-ink">Edit</Link></div>
            <ul className="mt-3 space-y-2">
              {roles.map((r) => {
                const n = apps.filter((a) => a.target_role_id === r.id && a.status !== "saved").length;
                const iv = apps.filter((a) => a.target_role_id === r.id && a.status === "interview").length;
                return (
                  <li key={r.id}>
                    <Link href="/app/applications" className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 hover:bg-canvas">
                      <span className="text-sm font-semibold">{r.title}</span>
                      <span className="text-xs text-muted">{n} applied · <span className="font-semibold text-pink-ink">{iv} interviews</span></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
