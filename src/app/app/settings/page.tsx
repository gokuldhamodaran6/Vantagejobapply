"use client";
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { effectivePlan } from "@/lib/access";
import { ALL_NATIONALITIES, COUNTRIES } from "@/lib/countries";
import { hardNavigate } from "@/lib/nav";
import { ApplicationProfileCard, JobEmailCard, SavedAnswersCard, VaultCard } from "@/components/settings-agent";

export default function SettingsPage() {
  const { profile, refresh, userId } = useMe();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [citizenship, setCitizenship] = useState("");
  const [home, setHome] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name || "");
    setPhone(profile.phone || "");
    setLinkedin(profile.linkedin_url || "");
    setCitizenship(profile.citizenship || "");
    setHome(profile.home_country || "");
  }, [profile]);

  if (!profile) return <div className="skeleton h-96" />;
  const limits = effectivePlan(profile.plan, profile.role).limits;

  async function saveProfile() {
    const { error } = await supabaseBrowser().from("profiles").update({ full_name: name, phone: phone || null, linkedin_url: linkedin || null, citizenship, home_country: home }).eq("id", userId!);
    setToast(error ? error.message : "Settings saved");
    refresh();
  }



  async function exportData() {
    const s = supabaseBrowser();
    const [p, t, r, a, res, ap, ans, tasks, inbox, vault] = await Promise.all([
      s.from("profiles").select("*").single(), s.from("target_prefs").select("*"), s.from("target_roles").select("*"),
      s.from("applications").select("*").eq("user_id", userId!), s.from("resumes").select("*"), s.from("applicant_profiles").select("*"), s.from("answer_bank").select("question,answer,updated_at"),
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
      <PageHeader title="Settings" subtitle="Your profile, the job email Vantage reads, and the answers it fills in for you." />
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
          <button className="btn-primary mt-5" onClick={saveProfile}>Save profile</button>
        </section>

        <JobEmailCard onToast={setToast} />
        <ApplicationProfileCard onToast={setToast} />

        <section id="early-access" className="card overflow-hidden">
          <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pink-tint text-pink-ink"><Sparkles size={20} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">You&apos;re an early access member</h2>
              <p className="mt-1 max-w-2xl text-[15px] text-muted">Every feature is unlocked and free while Vantage is in early access. If that ever changes, we&apos;ll tell you well in advance — nothing changes without your say.</p>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {[`Up to ${limits.roles} target roles`, `Up to ${limits.countries} countries`, "A resume and cover letter written for every job", "Chrome extension that fills company application forms"].map((f) => (
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
