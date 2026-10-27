"use client";
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ChoiceCard, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { effectivePlan, DEFAULT_DAILY, HIGH_VOLUME_MAX, PER_EMPLOYER_30D } from "@/lib/access";
import { ALL_NATIONALITIES, COUNTRIES } from "@/lib/countries";
import { hardNavigate } from "@/lib/nav";
import { ApplicationProfileCard, JobEmailCard, SavedAnswersCard, ScheduleCard, VaultCard } from "@/components/settings-agent";

export default function SettingsPage() {
  const { profile, refresh, userId } = useMe();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [citizenship, setCitizenship] = useState("");
  const [home, setHome] = useState("");
  const [autonomy, setAutonomy] = useState<"approve_all" | "approve_important" | "fully_automatic">("approve_important");
  const [daily, setDaily] = useState(DEFAULT_DAILY);
  const [highVolume, setHighVolume] = useState(false);
  const [reviewFirst, setReviewFirst] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name || "");
    setPhone(profile.phone || "");
    setLinkedin(profile.linkedin_url || "");
    setCitizenship(profile.citizenship || "");
    setHome(profile.home_country || "");
    setAutonomy(profile.autonomy);
    const p = profile as typeof profile & { high_volume_ok?: boolean | null; review_first?: boolean | null };
    setHighVolume(Boolean(p.high_volume_ok));
    setReviewFirst(p.review_first !== false);
    setDaily(Math.min(profile.daily_limit || DEFAULT_DAILY, p.high_volume_ok ? HIGH_VOLUME_MAX : DEFAULT_DAILY));
  }, [profile]);

  if (!profile) return <div className="skeleton h-96" />;
  const limits = effectivePlan(profile.plan, profile.role).limits;

  async function saveProfile() {
    const { error } = await supabaseBrowser().from("profiles").update({ full_name: name, phone: phone || null, linkedin_url: linkedin || null, citizenship, home_country: home, autonomy, daily_limit: Math.min(daily, highVolume ? HIGH_VOLUME_MAX : DEFAULT_DAILY), high_volume_ok: highVolume, review_first: reviewFirst }).eq("id", userId!);
    setToast(error ? error.message : "Settings saved");
    refresh();
  }



  async function exportData() {
    const s = supabaseBrowser();
    const [p, t, r, a, res, ap, ans, tasks, inbox, vault] = await Promise.all([
      s.from("profiles").select("*").single(), s.from("target_prefs").select("*"), s.from("target_roles").select("*"),
      s.from("applications").select("*"), s.from("resumes").select("*"), s.from("applicant_profiles").select("*"), s.from("answer_bank").select("question,answer,updated_at"),
      s.from("agent_tasks").select("job,status,step,log,created_at,finished_at"), s.from("inbox_messages").select("from_addr,subject,kind,received_at"),
      s.from("vault_credentials").select("host,login,created_at"),
    ]);
    const blob = new Blob([JSON.stringify({ profile: p.data, targets: t.data, roles: r.data, applications: a.data, resumes: res.data, application_profile: ap.data, saved_answers: ans.data, agent_activity: tasks.data, inbox: inbox.data, careers_site_logins: vault.data }, null, 2)], { type: "application/json" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "vantage-data.json";
    el.click();
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account and all your data permanently? This can't be undone.")) return;
    const { error } = await supabaseBrowser().rpc("delete_my_account");
    if (error) return setToast(error.message);
    await supabaseBrowser().auth.signOut();
    hardNavigate("/");
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, your agent, and the job email and accounts it uses." />
      <div className="space-y-6">
        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold">Profile</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Full name<input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block text-sm font-semibold">Email<input className="input mt-1.5 bg-canvas" value={profile.email} disabled /></label>
            <label className="block text-sm font-semibold">Phone<input className="input mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label className="block text-sm font-semibold">LinkedIn<input className="input mt-1.5" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} /></label>
            <label className="block text-sm font-semibold">Citizenship
              <select className="input mt-1.5" value={citizenship} onChange={(e) => setCitizenship(e.target.value)}>{ALL_NATIONALITIES.map((n) => <option key={n}>{n}</option>)}</select>
            </label>
            <label className="block text-sm font-semibold">Country you live in
              <select className="input mt-1.5" value={home} onChange={(e) => setHome(e.target.value)}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}<option value="OTHER">Another country</option></select>
            </label>
          </div>
        </section>

        <JobEmailCard onToast={setToast} />
        <ApplicationProfileCard onToast={setToast} />

        <section id="agent-mode" className="card scroll-mt-24 p-5 sm:p-6">
          <h2 className="text-lg font-bold">How independent is your agent?</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <ChoiceCard selected={autonomy === "approve_all"} onClick={() => setAutonomy("approve_all")} title="Approve every application" body="Nothing is sent until you approve it." />
            <ChoiceCard selected={autonomy === "approve_important"} onClick={() => setAutonomy("approve_important")} title="Approve important ones" body="Target companies and top matches come to you first." />
            <ChoiceCard selected={autonomy === "fully_automatic"} onClick={() => setAutonomy("fully_automatic")} title="Fully automatic" body="The agent prepares and queues everything within your rules." />
          </div>
          <div className="mt-5 rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="daily" className="text-sm font-semibold">Applications per day</label>
              <span className="text-lg font-bold text-brand-ink">{daily}</span>
            </div>
            <input id="daily" type="range" min={5} max={highVolume ? Math.min(HIGH_VOLUME_MAX, limits.autoApplyPerDay) : DEFAULT_DAILY} step={5} value={daily} onChange={(e) => setDaily(Number(e.target.value))} className="mt-2 w-full accent-[#2f5beb]" />
            <p className="mt-1 text-xs text-muted">Your agent spreads these through the day — one per company at a time, no more than {PER_EMPLOYER_30D} to the same company in 30 days, only to jobs you can legally take.</p>
            <label className="mt-3 flex cursor-pointer items-start gap-3 border-t border-line pt-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" checked={highVolume}
                onChange={(e) => { setHighVolume(e.target.checked); if (!e.target.checked) setDaily((d) => Math.min(d, DEFAULT_DAILY)); }} />
              <span>
                <span className="font-semibold">Allow more than {DEFAULT_DAILY} a day (up to {HIGH_VOLUME_MAX})</span>
                <span className="block text-xs text-muted">Most people get interviews from fewer, well-matched applications. Very high volume can get applications flagged as spam by employers&apos; hiring systems — use it only if you understand that.</span>
              </span>
            </label>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" checked={reviewFirst} onChange={(e) => setReviewFirst(e.target.checked)} />
            <span>
              <span className="font-semibold">Let me review the first application on each kind of careers site</span>
              <span className="block text-xs text-muted">Your agent fills the form, then waits for you to check every answer before it presses Submit. After one approved application on a site type (Greenhouse, Workday…), later ones go straight through. Recommended.</span>
            </span>
          </label>
          <p className="mt-4 text-sm text-muted">Always on: truthful answers, only facts you confirmed, human checks on company sites are handed to you.</p>
          <button className="btn-primary mt-5" onClick={saveProfile}>Save settings</button>
        </section>

        <ScheduleCard onToast={setToast} />

        <section id="early-access" className="card overflow-hidden">
          <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pink-tint text-pink-ink"><Sparkles size={20} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">You&apos;re an early access member</h2>
              <p className="mt-1 max-w-2xl text-[15px] text-muted">Every feature is unlocked and free while Vantage is in early access. If that ever changes, we&apos;ll tell you well in advance — nothing changes without your say.</p>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {[`Up to ${limits.roles} target roles`, `Up to ${limits.countries} countries`, `Up to ${Math.min(limits.autoApplyPerDay, 200)} applications a day by your agent (20 unless you allow more)`, "Tailored resume and cover letter for every job"].map((f) => (
                  <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand" />{f}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <SavedAnswersCard />
        <VaultCard onToast={setToast} />

        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold">Your data</h2>
          <p className="mt-1 text-sm text-muted">Download everything Vantage stores about you, or delete your account.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportData}>Download my data</button>
            <button className="btn border border-[#f5c2be] text-red-ink hover:bg-red-tint" onClick={deleteAccount}>Delete account</button>
          </div>
        </section>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
