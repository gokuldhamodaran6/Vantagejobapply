"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ChoiceCard, Segmented, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PLANS, PLAN_BY_ID, PPP_COUNTRIES, type Interval } from "@/lib/plans";
import { ALL_NATIONALITIES, COUNTRIES } from "@/lib/countries";
import { hardNavigate } from "@/lib/nav";

export default function SettingsPage() {
  const { profile, refresh, userId } = useMe();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [citizenship, setCitizenship] = useState("");
  const [home, setHome] = useState("");
  const [autonomy, setAutonomy] = useState<"approve_all" | "approve_important" | "fully_automatic">("approve_important");
  const [interval, setIntervalChoice] = useState<Interval>("quarter");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name || "");
    setPhone(profile.phone || "");
    setLinkedin(profile.linkedin_url || "");
    setCitizenship(profile.citizenship || "");
    setHome(profile.home_country || "");
    setAutonomy(profile.autonomy);
    if (new URLSearchParams(window.location.search).get("upgraded")) setToast("Thanks! Your plan is being activated — it can take a few seconds.");
  }, [profile]);

  if (!profile) return <div className="skeleton h-96" />;
  const plan = PLAN_BY_ID[profile.plan];
  const region = PPP_COUNTRIES.includes(profile.home_country || "") ? "ppp" : "std";

  async function saveProfile() {
    const { error } = await supabaseBrowser().from("profiles").update({ full_name: name, phone: phone || null, linkedin_url: linkedin || null, citizenship, home_country: home, autonomy }).eq("id", userId!);
    setToast(error ? error.message : "Settings saved");
    refresh();
  }

  async function checkout(planId: string) {
    setBusy(planId);
    const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, interval }) });
    const d = await r.json();
    setBusy("");
    if (d.url) hardNavigate(d.url);
    else setToast(d.error);
  }

  async function portal() {
    const r = await fetch("/api/billing/portal", { method: "POST" });
    const d = await r.json();
    if (d.url) hardNavigate(d.url);
    else setToast(d.error);
  }

  async function exportData() {
    const s = supabaseBrowser();
    const [p, t, r, a, res] = await Promise.all([
      s.from("profiles").select("*").single(), s.from("target_prefs").select("*"), s.from("target_roles").select("*"),
      s.from("applications").select("*"), s.from("resumes").select("*"),
    ]);
    const blob = new Blob([JSON.stringify({ profile: p.data, targets: t.data, roles: r.data, applications: a.data, resumes: res.data }, null, 2)], { type: "application/json" });
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
      <PageHeader title="Settings" />
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

        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold">How independent is your agent?</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <ChoiceCard selected={autonomy === "approve_all"} onClick={() => setAutonomy("approve_all")} title="Approve every application" body="Nothing is sent until you approve it." />
            <ChoiceCard selected={autonomy === "approve_important"} onClick={() => setAutonomy("approve_important")} title="Approve important ones" body="Target companies and top matches come to you first." />
            <ChoiceCard selected={autonomy === "fully_automatic"} onClick={() => profile.plan === "autopilot" ? setAutonomy("fully_automatic") : setToast("Fully automatic is part of the Autopilot plan.")} title="Fully automatic" body={profile.plan === "autopilot" ? "The agent prepares and queues everything within your rules." : "Available on Autopilot."} />
          </div>
          <p className="mt-4 text-sm text-muted">Always on: truthful answers, only facts you confirmed, human checks on company sites are handed to you.</p>
          <button className="btn-primary mt-5" onClick={saveProfile}>Save settings</button>
        </section>

        <section id="billing" className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Plan and billing</h2>
              <p className="mt-1 text-sm text-muted">You&apos;re on <strong className="text-ink">{plan.name}</strong>{profile.plan_renews_at ? ` · renews ${new Date(profile.plan_renews_at).toLocaleDateString()}` : ""}.</p>
            </div>
            <div className="flex gap-2">
              <Segmented label="Billing period" value={interval} onChange={setIntervalChoice} options={[{ value: "month", label: "Monthly" }, { value: "quarter", label: "Every 3 months" }]} />
              {profile.stripe_customer_id && <button className="btn-secondary" onClick={portal}>Manage billing</button>}
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {PLANS.map((p) => {
              const current = p.id === profile.plan;
              const price = p.prices[region][interval];
              return (
                <div key={p.id} className={`rounded-xl border p-4 ${current ? "border-brand bg-brand-soft" : "border-line"}`}>
                  <p className="font-bold">{p.name}</p>
                  <p className="mt-1 text-2xl font-bold">${price}<span className="text-sm font-medium text-muted"> {price === 0 ? "" : interval === "month" ? "/ month" : "/ 3 months"}</span></p>
                  <ul className="mt-3 space-y-1.5 text-sm">{p.features.slice(0, 4).map((f) => <li key={f} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-brand" />{f}</li>)}</ul>
                  {current ? <p className="mt-4 text-sm font-semibold text-brand-ink">Your current plan</p> : p.id !== "free" && (
                    <button className={`mt-4 w-full ${p.highlight ? "btn-primary" : "btn-secondary"}`} disabled={busy === p.id} onClick={() => checkout(p.id)}>{busy === p.id ? "Opening checkout…" : `Choose ${p.name}`}</button>
                  )}
                </div>
              );
            })}
          </div>
          {region === "ppp" && <p className="mt-3 text-sm text-green-ink">Regional pricing applied for your country.</p>}
        </section>

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
