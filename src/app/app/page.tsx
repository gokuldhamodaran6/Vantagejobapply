"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, ArrowUp, CalendarDays, CheckCircle2, Circle, FileText, Inbox, MapPin, Puzzle, Reply, Search, Sparkles, Video } from "lucide-react";
import { StreakCard } from "@/components/streak-card";
import { toneOf, type Interview } from "@/components/calendar/shared";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, timeAgo, tintFor } from "@/lib/format";
import { isAllDay, isSameDay } from "@/lib/calendar-grid";
import type { Application, Job, MatchResult } from "@/lib/types";

/** Applied this long ago with no reply → time to follow up. */
const FOLLOW_UP_DAYS = 10;
type AppRow = Pick<Application, "id" | "job" | "status" | "applied_at" | "updated_at" | "target_role_id">;

export default function Dashboard() {
  const router = useRouter();
  const { profile, roles, prefs, userId } = useMe();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [hasResume, setHasResume] = useState<boolean | null>(null);
  const [hasExtension, setHasExtension] = useState<boolean | null>(null);
  const [hasMail, setHasMail] = useState<boolean | null>(null);
  const [top, setTop] = useState<{ job: Job; match: MatchResult }[] | null>(null);
  const [ask, setAsk] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!userId) return;
    const s = supabaseBrowser();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    s.from("applications").select("id,job,status,applied_at,updated_at,target_role_id").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1000).then(({ data }) => setApps((data as AppRow[]) || []));
    s.from("interviews").select("*").eq("user_id", userId).eq("status", "scheduled").gte("starts_at", new Date(today.getTime() - 864e5).toISOString()).lt("starts_at", new Date(today.getTime() + 8 * 864e5).toISOString()).order("starts_at").limit(20)
      .then(({ data }) => setInterviews((data as Interview[]) || []));
    s.from("resumes").select("id", { count: "exact", head: true }).then(({ count }) => setHasResume((count || 0) > 0));
    s.from("extension_tokens").select("id", { count: "exact", head: true }).then(({ count, error }) => setHasExtension(error ? false : (count || 0) > 0));
    s.from("mail_accounts").select("status").maybeSingle().then(({ data }) => setHasMail(Boolean(data && (data as { status: string }).status !== "error")));
  }, [userId, now]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/jobs?country=${prefs?.countries?.[0] || "US"}`)
      .then(async (r) => setTop(((await r.json()).results || []).slice(0, 5)))
      .catch(() => setTop([]));
  }, [userId, prefs]);

  const list = apps || [];
  const loaded = apps !== null;
  const weekAgo = now - 7 * 864e5;
  const appliedWeek = list.filter((a) => a.applied_at && Date.parse(a.applied_at) > weekAgo).length;
  const replies = list.filter((a) => ["in_review", "assessment", "interview", "offer", "rejected"].includes(a.status)).length;
  const interviewing = list.filter((a) => a.status === "interview").length;
  const toApply = list.filter((a) => ["saved", "ready"].includes(a.status));
  const followUps = list
    .filter((a) => a.status === "applied" && a.applied_at && Date.parse(a.applied_at) < now - FOLLOW_UP_DAYS * 864e5)
    .sort((a, b) => Date.parse(a.applied_at!) - Date.parse(b.applied_at!));

  const hour = new Date(now).getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (profile?.full_name || "").split(" ")[0];

  const steps = [
    { done: roles.length > 0, label: "Add your target roles", href: "/app/targets" },
    { done: Boolean(hasResume), label: "Add your resume", href: "/app/resumes" },
    { done: Boolean(hasExtension), label: "Install the Chrome extension", href: "/app/extension" },
    { done: Boolean(hasMail), label: "Connect your job email", href: "/app/inbox" },
    { done: (prefs?.companies?.length || 0) > 0, label: "Add target companies", href: "/app/targets#companies" },
    { done: list.some((a) => !["saved", "ready"].includes(a.status)), label: "Apply to your first job", href: "/app/jobs" },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;
  const stepsLoaded = loaded && hasResume !== null && hasExtension !== null && hasMail !== null;

  // Interviews that haven't ended yet, today and the next 7 days.
  const soon = (interviews || []).filter((i) => Date.parse(i.starts_at) + i.minutes * 60000 > now);
  const dayLabel = (d: Date) => {
    const t = new Date(now);
    if (isSameDay(d, t)) return "Today";
    if (isSameDay(d, new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1))) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[26px] font-bold tracking-tight sm:text-[30px]">{greet}{first ? `, ${first}` : ""}</h1>
        <p className="mt-1.5 text-[15px] text-muted">Here&apos;s where your job search stands.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <StreakCard />

        <section className="card overflow-hidden" aria-labelledby="today-h">
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 id="today-h" className="flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-brand" /> Today and this week</h2>
            <Link href="/app/interviews" className="text-sm font-semibold text-brand-ink">Open calendar</Link>
          </div>
          {interviews === null ? (
            <div className="space-y-2 p-5">{[0, 1].map((i) => <div key={i} className="skeleton h-14" />)}</div>
          ) : soon.length === 0 ? (
            <div className="px-5 pb-5 pt-3">
              <p className="text-sm text-muted">No interviews in the next 7 days. When a company invites you, it shows up here from your job email.</p>
              <Link href="/app/interviews" className="btn-secondary mt-3 min-h-9 text-[13px]">Add an interview</Link>
            </div>
          ) : (
            <ul className="mt-2">
              {soon.slice(0, 5).map((i) => {
                const start = new Date(i.starts_at);
                const live = Date.parse(i.starts_at) - now < 30 * 60000;
                const t = toneOf(i.round);
                return (
                  <li key={i.id} className="flex items-center gap-3 border-t border-line px-5 py-3">
                    <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: t.bar }} aria-hidden />
                    <div className="w-[92px] shrink-0">
                      <p className={`text-xs font-bold uppercase ${isSameDay(start, new Date(now)) ? "text-brand-ink" : "text-muted"}`}>{dayLabel(start)}</p>
                      <p className="text-sm font-semibold tabular-nums">{isAllDay(i.minutes) ? "All day" : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                    </div>
                    <Link href="/app/interviews" className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{i.company}</span>
                      <span className="block truncate text-xs text-muted">{i.round}{i.title ? ` · ${i.title}` : ""}</span>
                    </Link>
                    {i.link ? (
                      <a href={i.link} target="_blank" rel="noopener noreferrer" className={`${live ? "btn-primary" : "btn-secondary"} min-h-9 shrink-0 px-3 text-[13px]`} aria-label={`Join ${i.company} ${i.round}`}><Video size={15} /> Join</a>
                    ) : i.location ? (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.location)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost min-h-9 shrink-0 px-3 text-[13px]" aria-label={`Directions to ${i.location}`}><MapPin size={15} /> Map</a>
                    ) : null}
                  </li>
                );
              })}
              {soon.length > 5 && <li className="border-t border-line px-5 py-2.5 text-sm"><Link href="/app/interviews" className="font-semibold text-brand-ink">+{soon.length - 5} more this week</Link></li>}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden" aria-labelledby="next-h">
          <div className="px-5 pt-4">
            <h2 id="next-h" className="font-semibold">Next steps</h2>
          </div>
          {!loaded ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>
          ) : followUps.length === 0 && toApply.length === 0 ? (
            <p className="px-5 pb-5 pt-2 text-sm text-muted">You&apos;re all caught up. <Link href="/app/jobs" className="font-semibold text-brand-ink">Find your next job</Link>.</p>
          ) : (
            <div className="pb-2">
              {followUps.length > 0 && (
                <>
                  <p className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Follow up · no reply after {FOLLOW_UP_DAYS}+ days</p>
                  <ul>
                    {followUps.slice(0, 4).map((a) => (
                      <li key={a.id}>
                        <Link href="/app/applications" className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.job.title}</span><span className="block truncate text-xs text-muted">{a.job.company} · applied {timeAgo(a.applied_at)}</span></span>
                          <span className="chip shrink-0 bg-orange-tint text-orange-ink"><Reply size={13} /> Follow up</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {followUps.length > 4 && <Link href="/app/applications" className="block px-5 py-1.5 text-sm font-semibold text-brand-ink">+{followUps.length - 4} more to follow up</Link>}
                </>
              )}
              {toApply.length > 0 && (
                <>
                  <p className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Saved, not applied yet · {toApply.length}</p>
                  <ul>
                    {toApply.slice(0, 3).map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={tintFor(a.job.company)}>{initials(a.job.company)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.job.title}</span><span className="block truncate text-xs text-muted">{a.job.company} · saved {timeAgo(a.updated_at)}</span></span>
                        {a.job.url && <a href={a.job.url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 shrink-0 px-3 text-[13px]" aria-label={`Apply to ${a.job.title} at ${a.job.company} on their site`}>Apply on site</a>}
                      </li>
                    ))}
                  </ul>
                  <Link href="/app/jobs" className="flex items-center gap-1 px-5 py-2 text-sm font-semibold text-brand-ink">Go to your jobs <ArrowRight size={14} /></Link>
                </>
              )}
            </div>
          )}
        </section>

        {stepsLoaded && stepsLeft > 0 ? (
          <section className="card p-5" aria-labelledby="setup-h">
            <h2 id="setup-h" className="font-semibold">Finish setting up</h2>
            <p className="text-sm text-muted">{stepsLeft} step{stepsLeft > 1 ? "s" : ""} left</p>
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
        ) : !stepsLoaded ? (
          <div className="skeleton h-[260px] rounded-xl" />
        ) : (
          <section className="card p-5" aria-labelledby="roles-h">
            <div className="flex items-center justify-between"><h2 id="roles-h" className="font-semibold">Your target roles</h2><Link href="/app/targets" className="text-sm font-semibold text-brand-ink">Edit</Link></div>
            <ul className="mt-3 space-y-2">
              {roles.map((r) => {
                const n = list.filter((a) => a.target_role_id === r.id && !["saved", "ready"].includes(a.status)).length;
                const iv = list.filter((a) => a.target_role_id === r.id && a.status === "interview").length;
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
        )}
      </div>

      <nav aria-label="Quick links" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { href: "/app/jobs", label: "Find jobs", body: "Live roles that match you", Icon: Search, tint: "#eef2fe", ink: "#2448c8" },
          { href: "/app/resumes", label: "Resumes", body: "Tailor one for each job", Icon: FileText, tint: "#fdecf2", ink: "#b4235a" },
          { href: "/app/extension", label: "Chrome extension", body: "Apply on the company's site", Icon: Puzzle, tint: "#fff1e5", ink: "#b4520a" },
          { href: "/app/inbox", label: "Inbox", body: "Replies and interview invites", Icon: Inbox, tint: "#e8f6ee", ink: "#17804a" },
        ].map(({ href, label, body, Icon, tint, ink }) => (
          <Link key={href} href={href} className="card group flex items-center gap-3 p-4 transition hover:border-brand">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: tint, color: ink }}><Icon size={19} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              <span className="hidden truncate text-xs text-muted sm:block">{body}</span>
            </span>
          </Link>
        ))}
      </nav>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        {[
          ["Applied this week", appliedWeek, "#2f5beb", "#eef2fe"],
          ["Companies replied", replies, "#22a05b", "#e8f6ee"],
          ["Interviewing", interviewing, "#e0457b", "#fdecf2"],
          ["Ready to apply", toApply.length, "#f7862b", "#fff1e5"],
        ].map(([label, n, dot, tint], i) => (
          <motion.div key={label as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 sm:p-5">
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: tint as string }}><span className="h-2 w-2 rounded-full" style={{ background: dot as string }} /></span><span className="text-sm font-medium text-ink-2">{label}</span></div>
            {loaded ? <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums">{n}</p> : <div className="skeleton mt-3 h-9 w-12" />}
          </motion.div>
        ))}
      </section>

      <form
        onSubmit={(e) => { e.preventDefault(); router.push(`/app/assistant?q=${encodeURIComponent(ask || "What did I apply to this week?")}`); }}
        className="card mt-6 flex items-center gap-3 p-2 pl-4"
      >
        <Sparkles size={20} className="shrink-0 text-pink" />
        <input className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" placeholder="Ask Vantage — “What did I apply to this week?”" value={ask} onChange={(e) => setAsk(e.target.value)} aria-label="Ask Vantage" />
        <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white" aria-label="Send"><ArrowUp size={18} /></button>
      </form>

      <section className="card mt-6 overflow-hidden" aria-labelledby="top-h">
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
    </>
  );
}
