"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Briefcase, Building2, Check, CircleDollarSign, Factory, Globe2, Loader2, MapPin, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { US_STATES } from "@/lib/jobs/places";
import { Segmented, TagInput, Toast, Toggle } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { COUNTRIES, COUNTRY_BY_CODE, INDUSTRIES } from "@/lib/countries";
import { dailyLimit, effectivePlan } from "@/lib/access";
import { JOB_TYPES, WORK_MODES, wantedModes, type WorkMode } from "@/lib/jobs/match";
import { searchVariants } from "@/lib/jobs/roles";
import { DEFAULT_FRESH_DAYS, LIVE_MAX_DAYS, PRIORITIES, priorityMeta, shareOfLimit } from "@/lib/agent/plan";
import type { Pipeline } from "@/lib/jobs/engine";
import type { ApplyScope, TargetPrefs, TargetRole, WorkAuth, WorkStatus } from "@/lib/types";
import type { Coach } from "@/lib/resume/coach";
import { RoleCoach } from "@/components/role-coach";

const LEVELS = [
  { value: "intern", label: "Intern" },
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead / Manager" },
];
const STATUS_LABEL: Record<WorkStatus, string> = {
  citizen: "Citizen", permanent_resident: "Permanent resident", student_visa: "Student visa", post_study_work: "Post-study work (e.g. OPT, Graduate visa)",
  work_visa: "Work visa", dependent_visa: "Dependant visa", none: "No status there yet",
};
const FRESHNESS = [3, 7, 14, 30];
const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "INR", "SGD"];
const SECTIONS = [
  { id: "roles", label: "Roles", icon: Briefcase },
  { id: "where", label: "Locations", icon: MapPin },
  { id: "visa", label: "Work authorisation", icon: ShieldCheck },
  { id: "pay", label: "Pay & job details", icon: CircleDollarSign },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "industries", label: "Industries", icon: Factory },
];

type Board = { id: number; name: string; ats: string; last_count: number | null; last_ok_at: string | null };
type Save = { state: "idle" | "saving" | "saved" | "error"; at?: number; msg?: string };
type Job = () => Promise<string | null>;

const REGIONS: Record<string, string[]> = {
  US: Object.values(US_STATES),
  CA: ["Ontario", "British Columbia", "Quebec", "Alberta", "Manitoba", "Nova Scotia", "Saskatchewan", "New Brunswick"],
  AU: ["New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Australian Capital Territory", "Tasmania"],
  GB: ["England", "Scotland", "Wales", "Northern Ireland", "Greater London", "South East", "North West", "West Midlands"],
};
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Autosave: every change is written a moment after you stop typing, newest value wins per field,
 * failures are kept and can be retried, and the page tells you exactly where things stand.
 */
function useAutosave(onSettled: () => void) {
  const [save, setSave] = useState<Save>({ state: "idle" });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Job>());
  const failed = useRef(new Map<string, Job>());
  const running = useRef(0);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  const run = useCallback(async (key: string) => {
    const job = pending.current.get(key);
    pending.current.delete(key);
    timers.current.delete(key);
    if (!job) return;
    running.current += 1;
    const err = await job().catch((e) => String(e?.message || e));
    running.current -= 1;
    if (err) failed.current.set(key, job);
    else failed.current.delete(key);
    if (running.current || pending.current.size) return;
    if (failed.current.size) setSave({ state: "error", msg: err || "Some changes didn't save." });
    else {
      setSave({ state: "saved", at: Date.now() });
      settled.current();
    }
  }, []);

  const schedule = useCallback((key: string, job: Job, delay = 700) => {
    pending.current.set(key, job);
    clearTimeout(timers.current.get(key));
    setSave({ state: "saving" });
    timers.current.set(key, setTimeout(() => void run(key), delay));
  }, [run]);

  const retry = useCallback(() => {
    for (const [k, job] of failed.current) schedule(k, job, 0);
  }, [schedule]);

  // Leaving mid-save: write what's pending right away, and warn if the tab is closing.
  useEffect(() => {
    const t = timers.current;
    const beforeUnload = (e: BeforeUnloadEvent) => { if (pending.current.size || running.current) e.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      for (const [k, timer] of t) { clearTimeout(timer); void run(k); }
    };
  }, [run]);

  return { save, schedule, retry };
}

export default function TargetsPage() {
  const { profile, prefs, roles, auth, userId, refresh } = useMe();
  const plan = effectivePlan(profile?.plan, profile?.role);
  const limit = dailyLimit(profile as { daily_limit?: number | null; high_volume_ok?: boolean | null } | null, plan);
  const [p, setP] = useState<TargetPrefs | null>(null);
  const [rs, setRs] = useState<TargetRole[]>([]);
  const [as, setAs] = useState<WorkAuth[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [coachQueue, setCoachQueue] = useState<{ id: string; title: string; coach: Coach }[]>([]);
  const [newRole, setNewRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState("");
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<string | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [counting, setCounting] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const recount = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start from what's saved, once. After that the page owns its copy, so a background refresh never undoes typing.
  if (!p && prefs) {
    setP(prefs);
    setRs(roles);
    setAs(auth);
  }

  const loadPipeline = useCallback(async () => {
    setCounting(true);
    const r = await fetch("/api/agent/pipeline").catch(() => null);
    const d = r?.ok ? ((await r.json().catch(() => null)) as Pipeline | null) : null;
    setCounting(false);
    if (d && !(d as { error?: string }).error) setPipe(d);
  }, []);

  const onSettled = useCallback(() => {
    void refresh();
    if (recount.current) clearTimeout(recount.current);
    recount.current = setTimeout(() => void loadPipeline(), 1500);
  }, [refresh, loadPipeline]);
  const { save, schedule, retry } = useAutosave(onSettled);

  useEffect(() => {
    if (!userId) return;
    const s = supabaseBrowser();
    s.from("boards").select("id,name,ats,last_count,last_ok_at").then(({ data }) => setBoards((data as Board[]) || []));
    s.from("applications").select("target_role_id,status").then(({ data }) => {
      const c: Record<string, number> = {};
      (data || []).forEach((a: { target_role_id: string | null; status: string }) => {
        if (a.target_role_id && a.status !== "saved") c[a.target_role_id] = (c[a.target_role_id] || 0) + 1;
      });
      setCounts(c);
    });
    void loadPipeline();
  }, [userId, loadPipeline]);

  if (!p) return <div className="skeleton h-96" />;
  const coachFor = coachQueue[0];

  // ---- writes -------------------------------------------------------------------------------------------
  const savePrefs = (next: TargetPrefs) => schedule("prefs", async () => {
    const { error } = await supabaseBrowser().from("target_prefs").update({
      countries: next.countries, locations: next.locations, remote_ok: next.remote_ok, work_modes: next.work_modes ?? null,
      industries: next.industries, industry_mode: next.industry_mode, salary_min: next.salary_min, currency: next.currency,
      job_types: next.job_types, companies: next.companies, blocked_companies: next.blocked_companies, max_days_old: next.max_days_old,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId!);
    return error?.message || null;
  });
  const set = (patch: Partial<TargetPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    savePrefs(next);
  };

  function setRole(id: string, patch: Partial<TargetRole>, delay = 700) {
    const next = rs.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setRs(next);
    const r = next.find((x) => x.id === id)!;
    schedule(`role:${id}`, async () => {
      const title = r.title.trim();
      if (!title) return "A role needs a title.";
      const { error } = await supabaseBrowser().from("target_roles").update({ title, levels: r.levels, keywords: r.keywords, priority: r.priority, active: r.active }).eq("id", id);
      return error?.message || null;
    }, delay);
  }

  function setAuth(country: string, patch: Partial<WorkAuth>) {
    const next = as.map((a) => (a.country === country ? { ...a, ...patch } : a));
    setAs(next);
    const a = next.find((x) => x.country === country)!;
    schedule(`auth:${country}`, async () => {
      const { error } = await supabaseBrowser().from("work_auth").upsert({ user_id: userId, country: a.country, status: a.status, needs_sponsorship_now: a.needs_sponsorship_now, needs_sponsorship_future: a.needs_sponsorship_future, apply_scope: a.apply_scope, details: a.details }, { onConflict: "user_id,country" });
      return error?.message || null;
    });
  }

  async function addRole(raw?: string) {
    const t = (raw ?? newRole).trim();
    if (!t || adding) return;
    if (rs.some((r) => r.title.toLowerCase() === t.toLowerCase())) return setToast(`${t} is already one of your roles.`);
    if (rs.length >= plan.limits.roles) return setToast(`You can have up to ${plan.limits.roles} target roles. Pause or remove one to add another.`);
    setAdding(true);
    const { data, error } = await supabaseBrowser().from("target_roles").insert({ user_id: userId, title: t, levels: ["entry", "mid"], keywords: [], priority: 2, active: true }).select("*").single();
    setAdding(false);
    if (error || !data) return setToast(error?.message || "Couldn't add that role.");
    setRs((x) => [...x, data as TargetRole]);
    setNewRole("");
    onSettled();
    setToast(`Added ${t}. Reading your resume against live ${t} postings…`);
    void setupNewRoles([{ id: (data as TargetRole).id, title: t, coach: {} }]);
  }

  async function removeRole(r: TargetRole) {
    setConfirmDel(null);
    const before = rs;
    setRs((x) => x.filter((y) => y.id !== r.id));
    const { error } = await supabaseBrowser().from("target_roles").delete().eq("id", r.id);
    if (error) {
      setRs(before);
      return setToast(error.message);
    }
    onSettled();
    setToast(`Removed ${r.title}. Applications already sent stay in your tracker.`);
  }

  function toggleCountry(code: string) {
    const on = p!.countries.includes(code);
    if (!on && p!.countries.length >= plan.limits.countries) return setToast(`You can target up to ${plan.limits.countries} countries at once.`);
    if (on && p!.countries.length === 1) return setToast("Keep at least one country — that's where your agent searches.");
    set({ countries: on ? p!.countries.filter((c) => c !== code) : [...p!.countries, code] });
    if (!on && !as.some((a) => a.country === code)) {
      const a: WorkAuth = { country: code, status: "none", needs_sponsorship_now: true, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent", details: {} };
      setAs((x) => [...x, a]);
      schedule(`auth:${code}`, async () => {
        const { error } = await supabaseBrowser().from("work_auth").upsert({ user_id: userId, ...a }, { onConflict: "user_id,country" });
        return error?.message || null;
      });
    }
  }

  function toggleMode(m: WorkMode) {
    const cur = wantedModes(p);
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
    if (!next.length) return setToast("Keep at least one way of working.");
    set({ work_modes: WORK_MODES.map((w) => w.value).filter((v) => next.includes(v)), remote_ok: next.includes("remote") });
  }

  async function addCompany() {
    const v = company.trim();
    if (!v) return;
    setCompanyBusy(true);
    setCompanyMsg(null);
    const isUrl = /^https?:\/\//i.test(v);
    const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isUrl ? { url: v } : { name: v }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setCompanyBusy(false);
    if (!r?.ok) {
      setCompanyMsg(d.error);
      if (!isUrl) set({ companies: [...new Set([...p!.companies, v])] });
      return;
    }
    set({ companies: [...new Set([...p!.companies, d.board.name])] });
    setCompanyMsg(d.already ? `${d.board.name} is already watched.` : `Watching ${d.board.name} — ${d.jobs} open jobs found on their careers site.`);
    setCompany("");
    supabaseBrowser().from("boards").select("id,name,ats,last_count,last_ok_at").then(({ data }) => setBoards((data as Board[]) || []));
  }

  // Each new role: check how the resume fits it. A close fit or career move gets the recruiter coach; a strong fit gets its resume written straight away.
  async function setupNewRoles(added: { id: string; title: string; coach: Coach }[]) {
    const needCoach: { id: string; title: string; coach: Coach }[] = [];
    for (const r of added) {
      const res = await fetch("/api/resume/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assess", roleId: r.id }) }).catch(() => null);
      const d = res?.ok ? await res.json() : null;
      if (!d?.coach) continue;
      if (d.coach.fit?.level === "strong") {
        void fetch("/api/resume/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleId: r.id }) });
        setToast(`${r.title}: strong fit with your experience — writing its resume now.`);
      } else needCoach.push({ ...r, coach: d.coach });
    }
    setCoachQueue(needCoach);
  }

  // ---- derived -----------------------------------------------------------------------------------------
  const watched = new Map(boards.map((b) => [b.name.toLowerCase(), b]));
  const modes = wantedModes(p);
  const share = shareOfLimit(rs, limit);
  const pipeRole = new Map((pipe?.roles || []).map((r) => [r.id, r]));
  const activeCount = rs.filter((r) => r.active).length;
  const sponsorIn = p.countries.filter((c) => { const a = as.find((x) => x.country === c); return a && (a.needs_sponsorship_now || a.needs_sponsorship_future) && a.status !== "citizen" && a.status !== "permanent_resident"; });
  const suggestions = [...new Set(rs.flatMap((r) => searchVariants(r.title, 10).slice(1)))]
    .filter((s) => s.split(" ").length > 1 && !rs.some((r) => r.title.toLowerCase() === s))
    .slice(0, 6);
  const fresh = p.max_days_old || DEFAULT_FRESH_DAYS;

  return (
    <>
      <PageHeader
        title="My targets"
        subtitle="What your agent looks for. Changes save automatically and apply to Live jobs and auto-apply right away."
        actions={
          <>
            <SaveStatus save={save} onRetry={retry} />
            <Link href="/app/jobs" className="btn-secondary">See live matches <ArrowRight size={15} /></Link>
          </>
        }
      />

      {/* At a glance */}
      <section className="card mb-6 grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4" aria-label="Summary">
        {[
          { k: "Active roles", v: `${activeCount} of ${plan.limits.roles}`, sub: rs.length > activeCount ? `${rs.length - activeCount} paused` : "searched every few minutes" },
          { k: "Live matches", v: pipe ? pipe.live.toLocaleString() : null, sub: pipe ? `${pipe.ready} ready for your agent` : "counting…" },
          { k: "Daily limit", v: `${limit} a day`, sub: <Link href="/app/settings#agent-mode" className="hover:text-brand-ink">Change in Settings →</Link> },
          { k: "Freshness", v: `Last ${fresh} days`, sub: "what your agent applies to" },
        ].map((s) => (
          <div key={s.k} className="bg-white p-4">
            <p className="text-xs font-medium text-muted">{s.k}</p>
            {s.v === null ? <div className="skeleton mt-1.5 h-6 w-16" /> : <p className="mt-0.5 text-xl font-bold tracking-tight">{s.v}</p>}
            <p className="mt-0.5 text-[11px] text-subtle">{s.sub}</p>
          </div>
        ))}
      </section>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-canvas hover:text-ink">
                  <s.icon size={16} className="text-subtle" aria-hidden /> {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* ---------------- Roles ---------------- */}
          <Section id="roles" title="Roles" icon={Briefcase} aside={`${rs.length} of ${plan.limits.roles}`}
            body="Your agent searches each role's title plus the titles recruiters use for the same job. Priority decides which roles get your daily applications first.">
            {rs.length === 0 && (
              <div className="rounded-xl border border-dashed border-line p-6 text-center">
                <p className="font-semibold">Add the first role you want</p>
                <p className="mt-1 text-sm text-muted">For example “Business Analyst” or “Marketing Specialist”. You can add up to {plan.limits.roles}.</p>
              </div>
            )}
            <ul className="grid gap-3 xl:grid-cols-2">
              {rs.map((r) => {
                const pr = pipeRole.get(r.id);
                const also = searchVariants(r.title, 8).slice(1).filter((v) => v !== r.title.toLowerCase()).slice(0, 4);
                const pm = priorityMeta(r.priority);
                return (
                  <li key={r.id} className={`flex flex-col rounded-xl border p-4 transition ${r.active ? "border-line bg-white" : "border-dashed border-line bg-canvas/60"}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <label className="sr-only" htmlFor={`title-${r.id}`}>Role title</label>
                        <input id={`title-${r.id}`} className="-mx-2 w-[calc(100%+1rem)] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-bold capitalize outline-none transition hover:border-line focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
                          value={r.title} onChange={(e) => setRole(r.id, { title: e.target.value }, 1000)} />
                        <p className="mt-0.5 text-xs text-muted">{r.active ? (pr ? <><b className="text-ink">{pr.live}</b> live matches · <b className="text-brand-ink">{pr.ready}</b> ready for your agent</> : counting ? "Counting live matches…" : "—") : "Paused — your agent skips this role"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-1">
                        <span className="hidden text-xs font-medium text-muted sm:inline">{r.active ? "On" : "Paused"}</span>
                        <Toggle checked={r.active} onChange={(v) => setRole(r.id, { active: v }, 0)} label={`Apply to ${r.title} jobs`} />
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold text-ink-2">Priority</p>
                      <Segmented label={`Priority for ${r.title}`} value={String(pm.value) as "1" | "2" | "3"} onChange={(v) => setRole(r.id, { priority: Number(v) }, 0)}
                        options={PRIORITIES.map((x) => ({ value: String(x.value) as "1" | "2" | "3", label: x.short }))} />
                      <p className="mt-1.5 text-xs text-muted">
                        {r.active ? <>Gets about <b className="text-ink">{share[r.id] || 0}</b> of your {limit} daily applications when it has matches{pr && pr.planned !== (share[r.id] || 0) ? ` · ${pr.planned} lined up for today` : ""}.</> : "Turn it on to give it a share of your daily applications."}
                      </p>
                    </div>

                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold text-ink-2">Seniority</p>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Seniority for ${r.title}`}>
                        {LEVELS.map((lv) => {
                          const on = r.levels.includes(lv.value);
                          return (
                            <button key={lv.value} type="button" aria-pressed={on}
                              onClick={() => {
                                const next = on ? r.levels.filter((l) => l !== lv.value) : [...r.levels, lv.value];
                                if (!next.length) return setToast("Pick at least one level.");
                                setRole(r.id, { levels: next }, 300);
                              }}
                              className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-canvas"}`}>
                              {on && <Check size={12} aria-hidden />}{lv.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold text-ink-2">Key skills <span className="font-normal text-muted">· optional, jobs mentioning them rank higher</span></p>
                      <TagInput label={`Key skills for ${r.title}`} values={r.keywords} onChange={(v) => setRole(r.id, { keywords: v }, 300)} placeholder="e.g. SQL, Tableau" />
                    </div>

                    {also.length > 0 && (
                      <p className="mt-3 text-xs text-muted"><Search size={12} className="mr-1 inline" aria-hidden />Also searches: {also.map(titleCase).join(", ")}</p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
                      <Link href={`/app/applications`} className="text-muted hover:text-ink"><b className="text-ink">{counts[r.id] || 0}</b> applications</Link>
                      {r.active && <Link href={`/app/jobs?role=${r.id}`} className="font-semibold text-brand-ink">See live jobs →</Link>}
                      <span className="ml-auto">
                        {confirmDel === r.id ? (
                          <span className="flex items-center gap-2">
                            <span className="text-muted">Remove this role?</span>
                            <button className="rounded-md bg-red-tint px-2.5 py-1 font-semibold text-red-ink" onClick={() => void removeRole(r)}>Remove</button>
                            <button className="rounded-md px-2 py-1 font-semibold text-ink-2 hover:bg-canvas" onClick={() => setConfirmDel(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-red-tint hover:text-red-ink" onClick={() => setConfirmDel(r.id)} aria-label={`Remove ${r.title}`}><Trash2 size={13} /> Remove</button>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void addRole(); }}>
              <label className="sr-only" htmlFor="new-role">Add a role</label>
              <input id="new-role" className="input" placeholder="Add a role, e.g. Product Analyst" value={newRole} onChange={(e) => setNewRole(e.target.value)} disabled={rs.length >= plan.limits.roles} />
              <button className="btn-primary shrink-0" disabled={adding || !newRole.trim() || rs.length >= plan.limits.roles}>{adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add role</button>
            </form>
            {suggestions.length > 0 && rs.length < plan.limits.roles && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Related roles:</span>
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => void addRole(titleCase(s))} disabled={adding}
                    className="rounded-full border border-[#f8cfdd] bg-[#fdf3f7] px-2.5 py-1 text-xs font-semibold text-pink-ink hover:bg-pink-tint">+ {titleCase(s)}</button>
                ))}
              </div>
            )}
          </Section>

          {/* ---------------- Locations ---------------- */}
          <Section id="where" title="Locations" icon={MapPin} body="Where you'd work, and how. Leave cities empty to search a whole country.">
            <p className="mb-2 text-sm font-semibold">Work arrangement</p>
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Work arrangement">
              {WORK_MODES.map((m) => {
                const on = modes.includes(m.value);
                return (
                  <button key={m.value} type="button" role="checkbox" aria-checked={on} onClick={() => toggleMode(m.value)}
                    className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3 text-left transition ${on ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-[#c9d5fb]"}`}>
                    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 ${on ? "border-brand bg-brand text-white" : "border-[#c3c8d3] bg-white"}`}>{on && <Check size={12} strokeWidth={3} />}</span>
                    <span>
                      <span className="block text-sm font-semibold">{m.label}</span>
                      <span className="block text-xs text-muted">{m.value === "onsite" ? "In the office every day" : m.value === "hybrid" ? "Some days in the office" : "From anywhere in the country"}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mb-2 mt-6 text-sm font-semibold">Countries <span className="font-normal text-muted">· up to {plan.limits.countries}</span></p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Countries">
              {COUNTRIES.map((c) => {
                const on = p.countries.includes(c.code);
                return (
                  <button key={c.code} type="button" aria-pressed={on} onClick={() => toggleCountry(c.code)}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition ${on ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>
                    {on && <Check size={14} aria-hidden />}{c.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 space-y-3">
              {p.countries.map((code) => {
                const cityList = p.locations.filter((l) => l.country === code && l.city).map((l) => l.city);
                const stateList = p.locations.filter((l) => l.country === code && l.state && !l.city).map((l) => l.state!);
                const locs = p.locations;
                const others = (keep: (l: (typeof locs)[number]) => boolean) => locs.filter((l) => l.country !== code || keep(l));
                const radius = p.locations.find((l) => l.country === code)?.radius_km || 40;
                return (
                  <div key={code} className="rounded-xl border border-line p-4">
                    <p className="flex items-center gap-2 font-semibold"><Globe2 size={16} className="text-subtle" aria-hidden /> {COUNTRY_BY_CODE[code]?.name}
                      <span className="text-xs font-normal text-muted">{cityList.length || stateList.length ? `${cityList.length} cities · ${stateList.length} regions` : "Whole country"}</span></p>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-ink-2">Cities</p>
                        <TagInput label={`Cities in ${code}`} values={cityList} placeholder="Add a city"
                          suggestions={COUNTRY_BY_CODE[code]?.defaultCities || []}
                          onChange={(v) => set({ locations: [...others((l) => !l.city), ...v.map((city) => ({ country: code, city, radius_km: radius }))] })} />
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-ink-2">{code === "US" ? "Whole states" : code === "CA" || code === "AU" ? "Provinces / states" : "Regions"}</p>
                        <TagInput label={`States in ${code}`} values={stateList} placeholder={code === "US" ? "e.g. Texas or TX" : "Add a region"}
                          suggestions={REGIONS[code] || []}
                          onChange={(v) => set({ locations: [...others((l) => Boolean(l.city)), ...v.map((state) => ({ country: code, city: "", state, radius_km: radius }))] })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">{modes.includes("remote") ? "Remote jobs anywhere in your countries are included." : "Remote jobs are left out — tick Remote above to include them."}</p>
          </Section>

          {/* ---------------- Work authorisation ---------------- */}
          <Section id="visa" title="Work authorisation" icon={ShieldCheck}
            body="Your agent only applies where you can legally work, and answers sponsorship questions truthfully from this."
            aside={sponsorIn.length ? `Sponsorship needed in ${sponsorIn.map((c) => COUNTRY_BY_CODE[c]?.name || c).join(", ")}` : "No sponsorship needed"}>
            <div className="space-y-3">
              {p.countries.map((code) => {
                const a = as.find((x) => x.country === code);
                if (!a) return null;
                const citizen = a.status === "citizen" || a.status === "permanent_resident";
                return (
                  <div key={code} className="grid gap-4 rounded-xl border border-line p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                    <p className="font-semibold">{COUNTRY_BY_CODE[code]?.name}</p>
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-ink-2">Your status
                        <select className="input mt-1.5" value={a.status} onChange={(e) => {
                          const s = e.target.value as WorkStatus;
                          const cz = s === "citizen" || s === "permanent_resident";
                          setAuth(code, { status: s, needs_sponsorship_now: cz ? false : s === "post_study_work" ? false : a.needs_sponsorship_now, needs_sponsorship_future: cz ? false : a.needs_sponsorship_future });
                        }}>
                          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      {citizen ? (
                        <p className="rounded-lg bg-green-tint px-3 py-2 text-sm text-green-ink">You can work here without sponsorship.</p>
                      ) : (
                        <>
                          {a.status === "post_study_work" ? (
                            <p className="rounded-lg bg-green-tint px-3 py-2 text-sm text-green-ink">You can start now on this permit — no sponsorship needed to start.</p>
                          ) : (
                            <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Need sponsorship to start</span><Toggle checked={a.needs_sponsorship_now} onChange={(v) => setAuth(code, { needs_sponsorship_now: v })} label={`Need sponsorship to start in ${code}`} /></div>
                          )}
                          <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Need sponsorship later</span><Toggle checked={a.needs_sponsorship_future} onChange={(v) => setAuth(code, { needs_sponsorship_future: v })} label={`Need sponsorship later in ${code}`} /></div>
                          <label className="block text-xs font-semibold text-ink-2">Which jobs to include
                            <select className="input mt-1.5" value={a.apply_scope} onChange={(e) => setAuth(code, { apply_scope: e.target.value as ApplyScope })}>
                              <option value="sponsor_or_silent">Jobs that sponsor + jobs that don&apos;t mention it</option>
                              <option value="sponsor_only">Only jobs that clearly sponsor</option>
                              <option value="any_legal">Every job I can legally do today</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* ---------------- Pay & job details ---------------- */}
          <Section id="pay" title="Pay & job details" icon={CircleDollarSign} body="Jobs that list pay below your floor, or a job type you didn't pick, are ranked lower and rarely chosen by your agent.">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold" htmlFor="salary">Minimum yearly salary</label>
                <div className="flex gap-2">
                  <select aria-label="Currency" className="input w-24 shrink-0" value={p.currency || "USD"} onChange={(e) => set({ currency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input id="salary" className="input" inputMode="numeric" placeholder="No minimum"
                    value={p.salary_min ? p.salary_min.toLocaleString() : ""}
                    onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); set({ salary_min: Number.isFinite(n) && n > 0 ? n : null }); }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">Many postings don&apos;t list pay — those aren&apos;t penalised.</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">Job type</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Job type">
                  {JOB_TYPES.map(({ value: v, label: l }) => {
                    const on = p.job_types.includes(v);
                    return (
                      <button key={v} type="button" aria-pressed={on}
                        onClick={() => { const next = on ? p.job_types.filter((x) => x !== v) : [...p.job_types, v]; if (!next.length) return setToast("Pick at least one job type."); set({ job_types: next }); }}
                        className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium transition ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-canvas"}`}>{on && <Check size={13} aria-hidden />}{l}</button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-6">
              <p className="mb-1.5 text-sm font-semibold">Posted within</p>
              <Segmented label="Posted within" value={String(FRESHNESS.includes(fresh) ? fresh : 14)} onChange={(v) => set({ max_days_old: Number(v) })}
                options={FRESHNESS.map((d) => ({ value: String(d), label: `${d} days` }))} />
              <p className="mt-1.5 text-xs text-muted">Your agent applies only to jobs posted in the last {fresh} days — fresh posts get far more replies. Live jobs still shows up to {LIVE_MAX_DAYS} days so you can pick older ones yourself.</p>
            </div>
          </Section>

          {/* ---------------- Companies ---------------- */}
          <Section id="companies" title="Companies" icon={Building2} body="Target companies are watched every 20 minutes and their new jobs come to you first. Your agent never applies to companies you exclude.">
            <p className="mb-1.5 text-sm font-semibold">Target companies</p>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void addCompany(); }}>
              <input className="input" placeholder="Company name, or any job link from their careers site" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company name or job link" />
              <button className="btn-primary shrink-0" disabled={companyBusy || !company.trim()}>{companyBusy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add company</button>
            </form>
            {companyMsg && <p className="mt-2 text-sm text-ink-2" role="status">{companyMsg}</p>}
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {p.companies.length === 0 && <li className="p-4 text-sm text-muted">No target companies yet — your agent searches every verified careers site.</li>}
              {p.companies.map((c) => {
                const b = watched.get(c.toLowerCase());
                return (
                  <li key={c} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                    <span className="font-semibold capitalize">{c}</span>
                    {b ? <span className="chip bg-green-tint text-green-ink">Watching · {b.last_count ?? 0} open jobs</span> : <span className="chip bg-orange-tint text-orange-ink">Careers feed not found — paste a job link</span>}
                    <button className="ml-auto rounded-md px-2 py-1 text-sm font-medium text-muted hover:bg-red-tint hover:text-red-ink" onClick={() => set({ companies: p.companies.filter((x) => x !== c) })} aria-label={`Stop targeting ${c}`}>Remove</button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              <p className="mb-1.5 text-sm font-semibold">Never apply to</p>
              <TagInput label="Excluded company" values={p.blocked_companies} onChange={(v) => set({ blocked_companies: v })} placeholder="e.g. your current employer" />
            </div>
          </Section>

          {/* ---------------- Industries ---------------- */}
          <Section id="industries" title="Industries" icon={Factory}
            aside={<Segmented label="Industry rule" value={p.industry_mode} onChange={(v) => set({ industry_mode: v })} options={[{ value: "all", label: "Any" }, { value: "prefer", label: "Prefer" }, { value: "only", label: "Only these" }]} />}
            body={p.industry_mode === "all" ? "Every industry is included. Pick some and choose Prefer to rank them higher, or Only these to focus." : p.industry_mode === "prefer" ? "Jobs in these industries rank higher; others still show." : "Jobs outside these industries rank much lower."}>
            <div className={`flex flex-wrap gap-2 ${p.industry_mode === "all" ? "opacity-70" : ""}`} role="group" aria-label="Industries">
              {INDUSTRIES.map((i) => {
                const on = p.industries.includes(i);
                return (
                  <button key={i} type="button" aria-pressed={on}
                    onClick={() => set({ industries: on ? p.industries.filter((x) => x !== i) : [...p.industries, i], ...(on || p.industry_mode !== "all" ? {} : { industry_mode: "prefer" as const }) })}
                    className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3.5 text-sm font-medium transition ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-canvas"}`}>{on && <Check size={13} aria-hidden />}{i}</button>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

      {coachFor && <RoleCoach role={coachFor} onClose={() => setCoachQueue((q) => q.slice(1))} onDone={(m) => { setToast(m); setCoachQueue((q) => q.slice(1)); }} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function Section({ id, title, icon: Icon, body, aside, children }: { id: string; title: string; icon: typeof Briefcase; body?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby={`${id}-h`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-h`} className="flex items-center gap-2 text-lg font-bold"><Icon size={18} className="text-brand" aria-hidden /> {title}</h2>
          {body && <p className="mt-1 max-w-2xl text-sm text-muted">{body}</p>}
        </div>
        {aside && (typeof aside === "string" ? <span className="text-sm text-muted">{aside}</span> : aside)}
      </div>
      {children}
    </section>
  );
}

function SaveStatus({ save, onRetry }: { save: Save; onRetry: () => void }) {
  return (
    <span className="inline-flex min-h-10 items-center gap-1.5 px-1 text-xs" role="status" aria-live="polite">
      {save.state === "saving" && <><Loader2 size={13} className="animate-spin text-muted" aria-hidden /> <span className="text-muted">Saving…</span></>}
      {save.state === "saved" && <><Check size={14} className="text-green-ink" aria-hidden /> <span className="text-muted">All changes saved</span></>}
      {save.state === "error" && (
        <>
          <AlertCircle size={14} className="text-red-ink" aria-hidden />
          <span className="text-red-ink">Couldn&apos;t save{save.msg ? `: ${save.msg}` : ""}</span>
          <button className="ml-1 font-semibold text-brand-ink underline-offset-2 hover:underline" onClick={onRetry}>Retry</button>
        </>
      )}
      {save.state === "idle" && <span className="text-subtle">Changes save automatically</span>}
    </span>
  );
}
