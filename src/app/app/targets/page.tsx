"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ChoiceCard, Segmented, TagInput, Toast, Toggle } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { COUNTRIES, COUNTRY_BY_CODE, INDUSTRIES } from "@/lib/countries";
import { effectivePlan } from "@/lib/access";
import type { ApplyScope, TargetPrefs, TargetRole, WorkAuth, WorkStatus } from "@/lib/types";

const LEVELS = ["intern", "entry", "mid", "senior", "lead"];
const STATUS_LABEL: Record<WorkStatus, string> = {
  citizen: "Citizen", permanent_resident: "Permanent resident", student_visa: "Student visa", post_study_work: "Post-study work",
  work_visa: "Work visa", dependent_visa: "Dependant visa", none: "No status there yet",
};

type Board = { id: number; name: string; ats: string; last_count: number | null; last_ok_at: string | null };

export default function TargetsPage() {
  const { profile, prefs, roles, auth, userId, refresh } = useMe();
  const plan = effectivePlan(profile?.plan);
  const [p, setP] = useState<TargetPrefs | null>(null);
  const [rs, setRs] = useState<TargetRole[]>([]);
  const [as, setAs] = useState<WorkAuth[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [company, setCompany] = useState("");
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<string | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (prefs) setP(prefs);
    setRs(roles);
    setAs(auth);
  }, [prefs, roles, auth]);

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
  }, [userId]);

  if (!p) return <div className="skeleton h-96" />;

  const set = (patch: Partial<TargetPrefs>) => {
    setP({ ...p, ...patch });
    setDirty(true);
  };

  function setRole(id: string, patch: Partial<TargetRole>) {
    setRs((x) => x.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function addRole() {
    const t = newRole.trim();
    if (!t) return;
    if (rs.length >= plan.limits.roles) {
      setToast(`You can have up to ${plan.limits.roles} target roles. Pause or remove one to add another.`);
      return;
    }
    setRs((x) => [...x, { id: `new-${Date.now()}`, title: t, levels: ["entry", "mid"], keywords: [], priority: 2, active: true }]);
    setNewRole("");
    setDirty(true);
  }

  function toggleCountry(code: string) {
    const on = p!.countries.includes(code);
    if (!on && p!.countries.length >= plan.limits.countries) {
      setToast(`You can target up to ${plan.limits.countries} countries at once.`);
      return;
    }
    set({ countries: on ? p!.countries.filter((c) => c !== code) : [...p!.countries, code] });
    if (!on && !as.some((a) => a.country === code)) {
      setAs((x) => [...x, { country: code, status: "none", needs_sponsorship_now: true, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent", details: {} }]);
    }
  }

  function setAuth(country: string, patch: Partial<WorkAuth>) {
    setAs((x) => x.map((a) => (a.country === country ? { ...a, ...patch } : a)));
    setDirty(true);
  }

  async function addCompany() {
    const v = company.trim();
    if (!v) return;
    setCompanyBusy(true);
    setCompanyMsg(null);
    const isUrl = /^https?:\/\//i.test(v);
    const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isUrl ? { url: v } : { name: v }) });
    const d = await r.json();
    setCompanyBusy(false);
    if (!r.ok) {
      setCompanyMsg(d.error);
      if (!isUrl) set({ companies: [...new Set([...p!.companies, v])] });
      return;
    }
    set({ companies: [...new Set([...p!.companies, d.board.name])] });
    setCompanyMsg(d.already ? `${d.board.name} is already watched.` : `Watching ${d.board.name} — ${d.jobs} open jobs found on their careers site.`);
    setCompany("");
    supabaseBrowser().from("boards").select("id,name,ats,last_count,last_ok_at").then(({ data }) => setBoards((data as Board[]) || []));
  }

  async function save() {
    if (!userId || !p) return;
    setSaving(true);
    const s = supabaseBrowser();
    const { error: e1 } = await s.from("target_prefs").update({
      countries: p.countries, locations: p.locations, remote_ok: p.remote_ok, industries: p.industries, industry_mode: p.industry_mode,
      salary_min: p.salary_min, job_types: p.job_types, companies: p.companies, blocked_companies: p.blocked_companies,
    }).eq("user_id", userId);

    const existing = rs.filter((r) => !r.id.startsWith("new-"));
    const created = rs.filter((r) => r.id.startsWith("new-"));
    const removed = roles.filter((r) => !rs.some((x) => x.id === r.id));
    await Promise.all([
      ...existing.map((r) => s.from("target_roles").update({ title: r.title, levels: r.levels, keywords: r.keywords, priority: r.priority, active: r.active }).eq("id", r.id)),
      ...(created.length ? [s.from("target_roles").insert(created.map((r) => ({ user_id: userId, title: r.title, levels: r.levels, keywords: r.keywords, priority: r.priority, active: r.active })))] : []),
      ...removed.map((r) => s.from("target_roles").delete().eq("id", r.id)),
      ...as.filter((a) => p.countries.includes(a.country)).map((a) =>
        s.from("work_auth").upsert({ user_id: userId, country: a.country, status: a.status, needs_sponsorship_now: a.needs_sponsorship_now, needs_sponsorship_future: a.needs_sponsorship_future, apply_scope: a.apply_scope, details: a.details }, { onConflict: "user_id,country" }),
      ),
    ]);
    setSaving(false);
    setDirty(false);
    setToast(e1 ? e1.message : "Targets saved. Your matches update right away.");
    refresh();
  }

  const watched = new Map(boards.map((b) => [b.name.toLowerCase(), b]));

  return (
    <>
      <PageHeader title="My targets" subtitle="Everything the agent searches and applies to comes from this page." actions={<Link href="/app/applications" className="btn-secondary">Applications by target</Link>} />

      <div className="space-y-6">
        <section className="card p-5 sm:p-6" aria-labelledby="roles-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="roles-h" className="text-lg font-bold">Target roles</h2>
            <span className="text-sm text-muted">{rs.length} of {plan.limits.roles}</span>
          </div>
          <ul className="mt-4 space-y-3">
            {rs.map((r) => (
              <li key={r.id} className={`rounded-xl border p-4 ${r.active ? "border-line" : "border-dashed border-line opacity-70"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <input aria-label="Role title" className="input max-w-sm font-semibold" value={r.title} onChange={(e) => setRole(r.id, { title: e.target.value })} />
                  <select aria-label="Priority" className="input w-auto" value={r.priority} onChange={(e) => setRole(r.id, { priority: +e.target.value })}>
                    <option value={1}>Top priority</option><option value={2}>High</option><option value={3}>Normal</option>
                  </select>
                  <span className="text-sm text-muted">{counts[r.id] || 0} applications</span>
                  <div className="ml-auto flex items-center gap-3">
                    <Toggle checked={r.active} onChange={(v) => setRole(r.id, { active: v })} label={`Apply to ${r.title} jobs`} />
                    <button className="rounded-lg p-2 text-subtle hover:bg-red-tint hover:text-red-ink" aria-label={`Remove ${r.title}`} onClick={() => { setRs((x) => x.filter((y) => y.id !== r.id)); setDirty(true); }}><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {LEVELS.map((lv) => {
                    const on = r.levels.includes(lv);
                    return (
                      <button key={lv} aria-pressed={on} onClick={() => setRole(r.id, { levels: on ? r.levels.filter((l) => l !== lv) : [...r.levels, lv] })}
                        className={`min-h-8 rounded-md border px-3 text-xs font-semibold capitalize ${on ? "border-brand bg-brand text-white" : "border-line text-ink-2"}`}>{lv === "entry" ? "Entry level" : lv}</button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <TagInput label={`Key skills for ${r.title}`} values={r.keywords} onChange={(v) => setRole(r.id, { keywords: v })} placeholder="Key skills for this role (optional), e.g. SQL" />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <input className="input" placeholder="Add another role, e.g. Product Analyst" value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRole()} aria-label="New role" />
            <button className="btn-primary shrink-0" onClick={addRole}><Plus size={16} /> Add role</button>
          </div>
        </section>

        <section className="card p-5 sm:p-6" aria-labelledby="where-h">
          <h2 id="where-h" className="text-lg font-bold">Countries, cities and work authorisation</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {COUNTRIES.map((c) => {
              const on = p.countries.includes(c.code);
              return (
                <button key={c.code} aria-pressed={on} onClick={() => toggleCountry(c.code)}
                  className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${on ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>{c.name}</button>
              );
            })}
          </div>
          <div className="mt-5 space-y-4">
            {p.countries.map((code) => {
              const a = as.find((x) => x.country === code);
              const cityList = p.locations.filter((l) => l.country === code).map((l) => l.city);
              return (
                <div key={code} className="rounded-xl border border-line p-4">
                  <p className="font-semibold">{COUNTRY_BY_CODE[code]?.name}</p>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-sm font-semibold">Cities (empty = whole country)</p>
                      <TagInput label={`Cities in ${code}`} values={cityList} placeholder="Add a city"
                        suggestions={COUNTRY_BY_CODE[code]?.defaultCities || []}
                        onChange={(v) => set({ locations: [...p.locations.filter((l) => l.country !== code), ...v.map((city) => ({ country: code, city, radius_km: p.locations.find((l) => l.country === code)?.radius_km || 40 }))] })} />
                    </div>
                    {a && (
                      <div className="space-y-3">
                        <label className="block text-sm font-semibold">Your status
                          <select className="input mt-1.5" value={a.status} onChange={(e) => {
                            const s = e.target.value as WorkStatus;
                            const citizen = s === "citizen" || s === "permanent_resident";
                            setAuth(code, { status: s, needs_sponsorship_now: citizen ? false : s === "post_study_work" ? false : a.needs_sponsorship_now, needs_sponsorship_future: citizen ? false : a.needs_sponsorship_future });
                          }}>
                            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                        {a.status !== "citizen" && a.status !== "permanent_resident" && (
                          <>
                            <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Need sponsorship to start</span><Toggle checked={a.needs_sponsorship_now} onChange={(v) => setAuth(code, { needs_sponsorship_now: v })} label="Need sponsorship to start" /></div>
                            <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Need sponsorship later</span><Toggle checked={a.needs_sponsorship_future} onChange={(v) => setAuth(code, { needs_sponsorship_future: v })} label="Need sponsorship later" /></div>
                            <select aria-label="Which jobs" className="input" value={a.apply_scope} onChange={(e) => setAuth(code, { apply_scope: e.target.value as ApplyScope })}>
                              <option value="sponsor_or_silent">Jobs that sponsor + jobs that don&apos;t mention it</option>
                              <option value="sponsor_only">Only jobs that clearly sponsor</option>
                              <option value="any_legal">Every job I can legally do today</option>
                            </select>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 text-sm font-medium"><Toggle checked={p.remote_ok} onChange={(v) => set({ remote_ok: v })} label="Include remote jobs" /> Include remote jobs</div>
        </section>

        <section className="card p-5 sm:p-6" aria-labelledby="ind-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ind-h" className="text-lg font-bold">Industries</h2>
            <Segmented label="Industry rule" value={p.industry_mode} onChange={(v) => set({ industry_mode: v })}
              options={[{ value: "only", label: "Only these" }, { value: "prefer", label: "Prefer these" }, { value: "all", label: "All industries" }]} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {INDUSTRIES.map((i) => (
              <ChoiceCard key={i} multi selected={p.industries.includes(i)} title={i}
                onClick={() => set({ industries: p.industries.includes(i) ? p.industries.filter((x) => x !== i) : [...p.industries, i] })} />
            ))}
          </div>
        </section>

        <section id="companies" className="card p-5 sm:p-6" aria-labelledby="co-h">
          <h2 id="co-h" className="text-lg font-bold">Target companies</h2>
          <p className="mt-1 text-sm text-muted">Type a company name or paste any job link from their careers site. Vantage finds their official careers feed and checks it every 20 minutes — new jobs there come to you first.</p>
          <div className="mt-4 flex gap-2">
            <input className="input" placeholder="e.g. Monzo, or https://company.wd5.myworkdayjobs.com/…" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} aria-label="Company name or job link" />
            <button className="btn-primary shrink-0" onClick={addCompany} disabled={companyBusy}>{companyBusy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add</button>
          </div>
          {companyMsg && <p className="mt-2 text-sm text-ink-2">{companyMsg}</p>}
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {p.companies.length === 0 && <li className="p-4 text-sm text-muted">No target companies yet.</li>}
            {p.companies.map((c) => {
              const b = watched.get(c.toLowerCase());
              return (
                <li key={c} className="flex flex-wrap items-center gap-3 p-3.5">
                  <span className="font-semibold">{c}</span>
                  {b ? <span className="chip bg-green-tint text-green-ink">Watching · {b.last_count ?? 0} open jobs</span> : <span className="chip bg-orange-tint text-orange-ink">Careers feed not found — paste a job link</span>}
                  <button className="ml-auto text-sm font-medium text-muted hover:text-red-ink" onClick={() => set({ companies: p.companies.filter((x) => x !== c) })}>Remove</button>
                </li>
              );
            })}
          </ul>
          <div className="mt-5">
            <p className="mb-1.5 text-sm font-semibold">Never apply to</p>
            <TagInput label="Blocked company" values={p.blocked_companies} onChange={(v) => set({ blocked_companies: v })} placeholder="e.g. your current employer" />
          </div>
        </section>

        <section className="card p-5 sm:p-6" aria-labelledby="pay-h">
          <h2 id="pay-h" className="text-lg font-bold">Pay and job type</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Minimum yearly salary ({p.currency || "USD"})
              <input className="input mt-1.5" inputMode="numeric" value={p.salary_min ?? ""} onChange={(e) => set({ salary_min: e.target.value ? parseInt(e.target.value.replace(/\D/g, ""), 10) : null })} />
            </label>
            <div>
              <p className="mb-1.5 text-sm font-semibold">Job type</p>
              <div className="flex flex-wrap gap-1.5">
                {[["full_time", "Full-time"], ["part_time", "Part-time"], ["contract", "Contract"], ["internship", "Internship"]].map(([v, l]) => {
                  const on = p.job_types.includes(v);
                  return <button key={v} aria-pressed={on} onClick={() => set({ job_types: on ? p.job_types.filter((x) => x !== v) : [...p.job_types, v] })} className={`min-h-10 rounded-lg border px-3 text-sm font-medium ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{l}</button>;
                })}
              </div>
            </div>
          </div>
        </section>
      </div>

      {dirty && (
        <div className="sticky bottom-20 z-30 mt-6 flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-3 shadow-lg lg:bottom-4">
          <span className="text-sm font-medium">You have unsaved changes</span>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
