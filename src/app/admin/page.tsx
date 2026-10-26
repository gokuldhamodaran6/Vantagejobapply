"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Loader2, Play, Plus, RefreshCw } from "lucide-react";
import { LogoMark } from "@/components/brand";
import { Segmented, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PLANS, PLAN_BY_ID } from "@/lib/plans";
import { COUNTRY_BY_CODE } from "@/lib/countries";
import { timeAgo } from "@/lib/format";

type Stats = {
  users: number; users_7d: number; active_7d: number; onboarded: number; plans: Record<string, number>;
  applications: number; applied: number; interviews: number; jobs: number; jobs_24h: number;
  jobs_by_country: Record<string, number>; sponsors: Record<string, number>;
  signups_by_day: { day: string; n: number }[]; top_targets: { country: string; n: number }[];
};
type U = { id: string; email: string; full_name: string | null; plan: string; role: string; home_country: string | null; citizenship: string | null; created_at: string; last_seen_at: string | null; onboarding_complete: boolean; countries: string[]; roles: number; applications: number; interviews: number };
type B = { id: number; ats: string; token: string; name: string; site: string | null; country: string | null; active: boolean; last_count: number | null; last_ok_at: string | null; last_error: string | null };

export default function AdminPage() {
  const { profile, loading } = useMe();
  const [tab, setTab] = useState<"overview" | "users" | "sources">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<U[]>([]);
  const [search, setSearch] = useState("");
  const [boards, setBoards] = useState<B[]>([]);
  const [running, setRunning] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState("");

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [st, us, bo] = await Promise.all([
      s.rpc("admin_stats"),
      s.rpc("admin_users", { p_search: search || null, p_limit: 200, p_offset: 0 }),
      s.from("boards").select("*").order("last_count", { ascending: false, nullsFirst: false }),
    ]);
    if (st.data) setStats(st.data as Stats);
    setUsers((us.data as U[]) || []);
    setBoards((bo.data as B[]) || []);
  }, [search]);

  useEffect(() => {
    if (profile?.role === "admin") load();
  }, [profile, load]);

  if (loading) return <div className="p-10"><div className="skeleton h-10 w-64" /></div>;
  if (profile?.role !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <p className="text-xl font-bold">This area is for administrators</p>
        <Link href="/app" className="btn-primary mt-4">Back to your dashboard</Link>
      </div>
    );
  }

  async function run(task: string) {
    setRunning(task);
    const r = await fetch("/api/admin/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task }) });
    const d = await r.json();
    setRunning("");
    setToast(r.ok ? `Finished “${task}” in ${Math.round((d.ms || 0) / 1000)}s` : d.error || "Task failed");
    load();
  }

  async function setPlan(id: string, plan: string) {
    const { error } = await supabaseBrowser().from("profiles").update({ plan }).eq("id", id);
    setToast(error ? error.message : "Plan updated");
    load();
  }

  async function addBoard() {
    const v = newBoard.trim();
    if (!v) return;
    setRunning("add");
    const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(/^https?:/i.test(v) ? { url: v } : { name: v }) });
    const d = await r.json();
    setRunning("");
    setToast(r.ok ? `Added ${d.board.name} (${d.jobs ?? 0} jobs)` : d.error);
    setNewBoard("");
    load();
  }

  async function toggleBoard(b: B) {
    await supabaseBrowser().from("boards").update({ active: !b.active }).eq("id", b.id);
    load();
  }

  const mrr = PLANS.reduce((sum, p) => sum + (stats?.plans?.[p.id] || 0) * p.prices.std.month, 0);
  const maxDay = Math.max(1, ...(stats?.signups_by_day || []).map((d) => d.n));

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/app" className="btn-ghost"><ArrowLeft size={16} /></Link>
          <LogoMark />
          <span className="font-bold">Vantage admin</span>
          <span className="pill bg-pink-tint text-pink-ink">{profile.email}</span>
          <button className="btn-secondary ml-auto" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "users", label: `Users${stats ? ` (${stats.users})` : ""}` }, { value: "sources", label: `Job sources (${boards.length})` }]} />

        {tab === "overview" && stats && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Users", stats.users, `+${stats.users_7d} this week`],
                ["Active (7 days)", stats.active_7d, `${stats.onboarded} finished setup`],
                ["Paying users", (stats.plans.pro || 0) + (stats.plans.autopilot || 0), `Pro ${stats.plans.pro || 0} · Autopilot ${stats.plans.autopilot || 0}`],
                ["Est. monthly revenue", `$${mrr.toLocaleString()}`, "List price, before discounts"],
                ["Applications", stats.applied, `${stats.applications} tracked in total`],
                ["Interviews", stats.interviews, stats.applied ? `${Math.round((stats.interviews / stats.applied) * 100)}% of applications` : "—"],
                ["Live jobs", stats.jobs.toLocaleString(), `${stats.jobs_24h.toLocaleString()} refreshed in 24 h`],
                ["Sponsor records", Object.values(stats.sponsors).reduce((a, b) => a + b, 0).toLocaleString(), Object.entries(stats.sponsors).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(" · ") || "Not loaded yet"],
              ].map(([l, v, s], i) => (
                <motion.div key={l as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="card p-4">
                  <p className="text-sm text-muted">{l}</p>
                  <p className="mt-1 text-2xl font-bold">{v}</p>
                  <p className="mt-1 text-xs text-muted">{s}</p>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="card p-5">
                <h2 className="font-semibold">Signups, last 30 days</h2>
                <div className="mt-4 flex h-40 items-end gap-1" role="img" aria-label="Signups per day">
                  {stats.signups_by_day.length === 0 && <p className="text-sm text-muted">No signups yet.</p>}
                  {stats.signups_by_day.map((d) => (
                    <div key={d.day} className="group relative flex-1">
                      <div className="rounded-t bg-brand transition group-hover:bg-pink" style={{ height: `${(d.n / maxDay) * 150}px` }} />
                      <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] text-white group-hover:block">{d.day}: {d.n}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card p-5">
                <h2 className="font-semibold">Where users want to work</h2>
                <ul className="mt-4 space-y-2.5">
                  {stats.top_targets.map((t) => (
                    <li key={t.country} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0">{COUNTRY_BY_CODE[t.country]?.name || t.country}</span>
                      <span className="h-2.5 flex-1 rounded-full bg-[#eef0f4]"><span className="block h-2.5 rounded-full bg-pink" style={{ width: `${(t.n / Math.max(1, stats.users)) * 100}%` }} /></span>
                      <span className="w-8 text-right font-semibold">{t.n}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-6 text-sm font-semibold">Jobs by country</h3>
                <p className="mt-1 text-sm text-muted">{Object.entries(stats.jobs_by_country).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(" · ") || "No jobs yet — run the job sync below."}</p>
              </section>
            </div>

            <section className="card p-5">
              <h2 className="font-semibold">Data jobs</h2>
              <p className="mt-1 text-sm text-muted">These also run automatically on a schedule.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[["boards", "Sync all company job feeds"], ["enrich", "Fill missing job descriptions"], ["uk_sponsors", "Refresh UK sponsor register"], ["prune", "Remove closed jobs"]].map(([t, l]) => (
                  <button key={t} className="btn-secondary" disabled={running !== ""} onClick={() => run(t)}>
                    {running === t ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {l}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "users" && (
          <section className="card mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <input className="input max-w-sm" placeholder="Search by email or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-[#f9fafc] text-left text-xs text-muted">
                  <tr>{["User", "Plan", "From", "Targets", "Roles", "Applied", "Interviews", "Joined", "Last seen"].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-line">
                      <td className="px-4 py-3"><p className="font-semibold">{u.full_name || "—"} {u.role === "admin" && <span className="pill ml-1 bg-pink-tint text-pink-ink">admin</span>}</p><p className="text-xs text-muted">{u.email}</p></td>
                      <td className="px-4 py-3">
                        <select aria-label={`Plan for ${u.email}`} className="rounded-md border border-line px-2 py-1 text-sm" value={u.plan} onChange={(e) => setPlan(u.id, e.target.value)}>
                          {PLANS.map((p) => <option key={p.id} value={p.id}>{PLAN_BY_ID[p.id].name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">{u.citizenship || "—"}</td>
                      <td className="px-4 py-3">{u.countries.join(", ") || "—"}</td>
                      <td className="px-4 py-3">{u.roles}</td>
                      <td className="px-4 py-3">{u.applications}</td>
                      <td className="px-4 py-3">{u.interviews}</td>
                      <td className="px-4 py-3 text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-muted">{timeAgo(u.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "sources" && (
          <section className="mt-6 space-y-4">
            <div className="card p-4">
              <p className="font-semibold">Add an employer</p>
              <p className="text-sm text-muted">Company name (auto-detects Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters) or any job link — including Workday.</p>
              <div className="mt-3 flex gap-2">
                <input className="input" value={newBoard} onChange={(e) => setNewBoard(e.target.value)} placeholder="e.g. Monzo or https://company.wd3.myworkdayjobs.com/en-US/Careers/job/…" aria-label="Employer" />
                <button className="btn-primary shrink-0" onClick={addBoard} disabled={running !== ""}>{running === "add" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add</button>
              </div>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[#f9fafc] text-left text-xs text-muted"><tr>{["Employer", "System", "Open jobs", "Last synced", "Status", ""].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {boards.map((b) => (
                    <tr key={b.id} className={`border-t border-line ${b.active ? "" : "opacity-50"}`}>
                      <td className="px-4 py-3 font-semibold">{b.name}</td>
                      <td className="px-4 py-3 text-muted">{b.ats}:{b.token}{b.site ? `/${b.site}` : ""}</td>
                      <td className="px-4 py-3">{b.last_count ?? "—"}</td>
                      <td className="px-4 py-3 text-muted">{timeAgo(b.last_ok_at) || "never"}</td>
                      <td className="px-4 py-3">{b.last_error ? <span className="chip bg-red-tint text-red-ink">{b.last_error}</span> : b.last_ok_at ? <span className="chip bg-green-tint text-green-ink">OK</span> : <span className="chip bg-[#eef0f4] text-ink-2">Waiting</span>}</td>
                      <td className="px-4 py-3 text-right"><button className="text-sm font-semibold text-brand-ink" onClick={() => toggleBoard(b)}>{b.active ? "Pause" : "Resume"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
