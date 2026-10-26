"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/me";
import { timeAgo } from "@/lib/format";
import { Toggle } from "@/components/ui";

const PROVIDERS = [
  { id: "gmail", label: "Gmail", steps: ["Create a new Gmail just for job hunting (e.g. yourname.careers@gmail.com).", "In that Gmail: Google Account → Security → turn on 2-Step Verification.", "Open myaccount.google.com/apppasswords, name it “Vantage”, and copy the 16-letter code."] },
  { id: "yahoo", label: "Yahoo", steps: ["Yahoo Account → Security → Generate app password.", "Name it “Vantage” and copy the code."] },
  { id: "icloud", label: "iCloud", steps: ["appleid.apple.com → Sign-In and Security → App-Specific Passwords.", "Create one called “Vantage” and copy it."] },
  { id: "zoho", label: "Zoho", steps: ["Zoho Mail settings → enable IMAP access.", "Zoho Account → Security → App passwords → generate one."] },
  { id: "other", label: "Other IMAP", steps: ["Find your provider's IMAP server (usually imap.yourprovider.com, port 993).", "Create an app password if your provider supports it."] },
];

/* ----------------------------- Job email ----------------------------- */
export function JobEmailCard({ onToast }: { onToast: (m: string) => void }) {
  const { userId } = useMe();
  const [acct, setAcct] = useState<{ address: string; status: string; provider: string; last_sync_at: string | null; error: string | null } | null | undefined>(undefined);
  const [provider, setProvider] = useState("gmail");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("mail_accounts").select("address,status,provider,last_sync_at,error").maybeSingle();
    setAcct((data as typeof acct) || null);
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  async function connect() {
    setBusy(true);
    const r = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, address, password, host }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(false);
    if (!r?.ok) return onToast(d.error || "Couldn't connect");
    setPassword("");
    onToast(`Connected ${d.address}${d.imported ? ` · ${d.imported} recent emails sorted` : ""}`);
    load();
  }
  async function disconnect() {
    if (!window.confirm("Disconnect this job email? Your agent won't be able to read verification codes.")) return;
    await fetch("/api/mail", { method: "DELETE" });
    load();
  }
  const p = PROVIDERS.find((x) => x.id === provider)!;

  return (
    <section id="job-email" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand"><Mail size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Job email</h2>
          <p className="text-sm text-muted">A separate inbox just for applications. Your agent signs up on careers sites with it, reads verification codes, and sorts every reply. Employers only ever see a normal personal email.</p>
        </div>
      </div>
      {acct === undefined && <div className="skeleton mt-4 h-24" />}
      {acct && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
          <span className={`h-2.5 w-2.5 rounded-full ${acct.status === "error" ? "bg-red-ink" : "bg-green"}`} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{acct.address}</p>
            <p className="text-xs text-muted">{acct.status === "error" ? `Problem: ${acct.error}` : `Connected · ${acct.last_sync_at ? `checked ${timeAgo(acct.last_sync_at)}` : "first check running"}`}</p>
          </div>
          <button className="btn-ghost text-sm" onClick={disconnect}>Disconnect</button>
        </div>
      )}
      {acct === null && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDERS.map((x) => (
                <button key={x.id} onClick={() => setProvider(x.id)} aria-pressed={provider === x.id} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${provider === x.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{x.label}</button>
              ))}
            </div>
            <ol className="mt-4 space-y-2.5 text-sm">
              {p.steps.map((s, i) => (
                <li key={i} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted">Outlook.com and work/school Google accounts no longer allow app passwords. Use a personal Gmail, Yahoo or iCloud.</p>
          </div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); connect(); }}>
            <label className="block text-sm font-semibold">Email address<input className="input mt-1.5" type="email" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="yourname.careers@gmail.com" /></label>
            <label className="block text-sm font-semibold">App password<input className="input mt-1.5 font-mono tracking-wider" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" /></label>
            {provider === "other" && <label className="block text-sm font-semibold">IMAP server<input className="input mt-1.5" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" /></label>}
            <p className="flex gap-2 text-xs text-muted"><ShieldCheck size={15} className="shrink-0 text-green" /> Encrypted with a key unique to you. Never shown to staff or to the AI. Remove it any time.</p>
            <button className="btn-primary w-full" disabled={busy || !address || password.replace(/\s/g, "").length < 8}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Test and connect</button>
          </form>
        </div>
      )}
    </section>
  );
}

/* ------------------------- Application profile ------------------------ */
type AP = Record<string, string | boolean | null>;
const EEO = {
  gender: ["Decline to self-identify", "Female", "Male", "Non-binary"],
  race: ["Decline to self-identify", "Asian", "Black or African American", "Hispanic or Latino", "White", "Native American or Alaska Native", "Native Hawaiian or Other Pacific Islander", "Two or more races"],
  hispanic: ["Decline to self-identify", "Yes", "No"],
  veteran: ["I don't wish to answer", "I am not a protected veteran", "I identify as one or more of the classifications of protected veteran"],
  disability: ["I don't wish to answer", "No, I do not have a disability", "Yes, I have a disability (or previously had one)"],
};

export function ApplicationProfileCard({ onToast }: { onToast: (m: string) => void }) {
  const { userId, profile } = useMe();
  const [ap, setAp] = useState<AP | null>(null);
  useEffect(() => {
    if (!userId) return;
    supabaseBrowser().from("applicant_profiles").select("*").maybeSingle().then(({ data }) => {
      const [first, ...rest] = (profile?.full_name || "").split(" ");
      setAp((data as AP) || { first_name: first || "", last_name: rest.join(" "), phone: profile?.phone || "", linkedin: profile?.linkedin_url || "", country: profile?.home_country === "US" ? "United States" : "", heard_from: "Company website", agent_consent: false });
    });
  }, [userId, profile]);
  if (!ap) return <div className="skeleton h-80" />;
  const v = (k: string) => (typeof ap[k] === "string" ? (ap[k] as string) : "");
  const set = (k: string, val: string | boolean) => setAp({ ...ap, [k]: val });
  async function save() {
    const row = { ...ap, user_id: userId, updated_at: new Date().toISOString() };
    const { error } = await supabaseBrowser().from("applicant_profiles").upsert(row, { onConflict: "user_id" });
    onToast(error ? error.message : "Application profile saved — your agent uses it on every form");
  }
  const F = ({ k, label, ph, type = "text" }: { k: string; label: string; ph?: string; type?: string }) => (
    <label className="block text-sm font-semibold">{label}<input className="input mt-1.5" type={type} value={v(k)} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>
  );
  const S = ({ k, label, options }: { k: keyof typeof EEO; label: string; options: string[] }) => (
    <label className="block text-sm font-semibold">{label}
      <select className="input mt-1.5" value={v(k) || options[0]} onChange={(e) => set(k, e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
  return (
    <section id="application-profile" className="card scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-lg font-bold">Application profile</h2>
      <p className="text-sm text-muted">Filled in once. Your agent copies these exactly into every application form — nothing is guessed.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {F({ k: "first_name", label: "Legal first name" })}
        {F({ k: "last_name", label: "Legal last name" })}
        {F({ k: "preferred_name", label: "Preferred name (optional)" })}
        {F({ k: "phone", label: "Phone", ph: "+1 312 555 0142", type: "tel" })}
        {F({ k: "address_line1", label: "Street address" })}
        {F({ k: "city", label: "City" })}
        {F({ k: "state", label: "State / province" })}
        {F({ k: "postal_code", label: "ZIP / postal code" })}
        {F({ k: "country", label: "Country", ph: "United States" })}
        {F({ k: "linkedin", label: "LinkedIn URL" })}
        {F({ k: "github", label: "GitHub (optional)" })}
        {F({ k: "portfolio", label: "Portfolio / website (optional)" })}
        {F({ k: "salary_expectation", label: "Salary expectation", ph: "e.g. 85,000 USD or Negotiable" })}
        {F({ k: "earliest_start", label: "Earliest start", ph: "Immediately / 2 weeks" })}
        {F({ k: "notice_period", label: "Notice period", ph: "None" })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold">
        <span className="flex items-center gap-2"><Toggle checked={ap.relocate === true} onChange={(x) => set("relocate", x)} label="Open to relocation" /> Open to relocation</span>
        <span className="flex items-center gap-2"><Toggle checked={ap.travel_ok === true} onChange={(x) => set("travel_ok", x)} label="Open to travel" /> Open to travel</span>
      </div>
      <details className="mt-5 rounded-xl border border-line p-4">
        <summary className="cursor-pointer text-sm font-semibold">Voluntary equal-opportunity questions (default: decline to answer)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {S({ k: "gender", label: "Gender", options: EEO.gender })}
          {S({ k: "race", label: "Race / ethnicity", options: EEO.race })}
          {S({ k: "hispanic", label: "Hispanic or Latino", options: EEO.hispanic })}
          {S({ k: "veteran", label: "Veteran status", options: EEO.veteran })}
          {S({ k: "disability", label: "Disability", options: EEO.disability })}
          {F({ k: "pronouns", label: "Pronouns (optional)" })}
        </div>
      </details>
      <label className="mt-5 flex items-start gap-3 rounded-xl bg-brand-soft p-4 text-sm">
        <input type="checkbox" className="mt-1" checked={ap.agent_consent === true} onChange={(e) => set("agent_consent", e.target.checked)} />
        <span><b>Let my agent accept employers&apos; privacy notices and confirm my information is accurate</b> on my behalf. It only uses facts from my resume, this profile and answers I&apos;ve given. Never marketing texts.</span>
      </label>
      <button className="btn-primary mt-5" onClick={save}>Save application profile</button>
    </section>
  );
}

/* ---------------------------- Saved answers ---------------------------- */
export function SavedAnswersCard() {
  const { userId } = useMe();
  const [rows, setRows] = useState<{ id: string; question: string; answer: string; updated_at: string }[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("answer_bank").select("id,question,answer,updated_at").order("updated_at", { ascending: false });
    setRows((data as typeof rows) || []);
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);
  async function save(id: string, answer: string) {
    await supabaseBrowser().from("answer_bank").update({ answer, updated_at: new Date().toISOString() }).eq("id", id);
  }
  async function del(id: string) {
    await supabaseBrowser().from("answer_bank").delete().eq("id", id);
    load();
  }
  return (
    <section id="answers" className="card scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-lg font-bold">Saved answers</h2>
      <p className="text-sm text-muted">Questions your agent asked you once. It reuses these answers on every form that asks the same thing.</p>
      {rows === null && <div className="skeleton mt-4 h-20" />}
      {rows?.length === 0 && <p className="mt-4 rounded-xl bg-canvas p-4 text-sm text-muted">None yet. When a form asks something only you know, it appears on the Agent page — answer once and it lands here.</p>}
      <ul className="mt-4 divide-y divide-line">
        {rows?.map((r) => (
          <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
            <p className="text-sm font-medium">{r.question}</p>
            <input className="input" defaultValue={r.answer} onBlur={(e) => e.target.value !== r.answer && save(r.id, e.target.value)} aria-label={`Answer to ${r.question}`} />
            <button className="justify-self-end rounded-lg p-2 text-subtle hover:text-red-ink" onClick={() => del(r.id)} aria-label="Delete answer"><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* --------------------------- Accounts vault --------------------------- */
export function VaultCard({ onToast }: { onToast: (m: string) => void }) {
  const { userId } = useMe();
  const [rows, setRows] = useState<{ id: string; host: string; label: string | null; login: string; created_at: string; last_used_at: string | null }[] | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("vault_credentials").select("id,host,label,login,created_at,last_used_at").order("created_at", { ascending: false });
    setRows((data as typeof rows) || []);
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);
  async function reveal(id: string) {
    if (shown[id]) return setShown(({ [id]: _, ...rest }) => (void _, rest));
    const r = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await r.json();
    if (!r.ok) return onToast(d.error || "Couldn't reveal");
    setShown((s) => ({ ...s, [id]: d.password }));
    setTimeout(() => setShown(({ [id]: _, ...rest }) => (void _, rest)), 30000);
  }
  function copy(t: string, id: string) {
    navigator.clipboard?.writeText(t);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }
  async function del(id: string) {
    if (!window.confirm("Remove this saved login? The account on the company's site stays; you'd need to reset its password to log in.")) return;
    await supabaseBrowser().from("vault_credentials").delete().eq("id", id);
    load();
  }
  return (
    <section id="vault" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-tint text-pink-ink"><KeyRound size={19} /></span>
        <div>
          <h2 className="text-lg font-bold">Careers-site accounts</h2>
          <p className="text-sm text-muted">Logins your agent created on employers&apos; sites, each with its own strong password. Only you can reveal them; they&apos;re encrypted and never shown to staff or the AI.</p>
        </div>
      </div>
      {rows === null && <div className="skeleton mt-4 h-20" />}
      {rows?.length === 0 && <p className="mt-4 rounded-xl bg-canvas p-4 text-sm text-muted">No accounts yet. Sites like Workday need one — your agent creates it with your job email the first time.</p>}
      <ul className="mt-4 divide-y divide-line">
        {rows?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.label || r.host}</p>
              <p className="truncate text-xs text-muted">{r.host} · {r.login}</p>
            </div>
            {shown[r.id] && <code className="rounded-lg bg-canvas px-2.5 py-1 text-sm">{shown[r.id]}</code>}
            {shown[r.id] && <button className="rounded-lg p-2 text-subtle hover:text-ink" onClick={() => copy(shown[r.id], r.id)} aria-label="Copy password">{copied === r.id ? <Check size={16} className="text-green" /> : <Copy size={16} />}</button>}
            <button className="btn-ghost min-h-9 text-xs" onClick={() => reveal(r.id)}>{shown[r.id] ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Reveal</>}</button>
            <a className="btn-ghost min-h-9 text-xs" href={`https://${r.host}`} target="_blank" rel="noopener noreferrer">Open site</a>
            <button className="rounded-lg p-2 text-subtle hover:text-red-ink" onClick={() => del(r.id)} aria-label="Remove login"><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
