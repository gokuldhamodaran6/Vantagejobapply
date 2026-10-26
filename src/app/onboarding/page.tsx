"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, FileText, Loader2, Plus, Sparkles, UploadCloud } from "lucide-react";
import { Logo } from "@/components/brand";
import { ChoiceCard, Segmented, TagInput, Toggle } from "@/components/ui";
import { FormError } from "@/components/auth-shell";
import { ALL_NATIONALITIES, COUNTRIES, COUNTRY_BY_CODE, INDUSTRIES } from "@/lib/countries";
import { useMe, track } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ApplyScope, WorkStatus } from "@/lib/types";
import { hardNavigate } from "@/lib/nav";

const STEPS = ["Your resume", "About you", "Where to work", "Work authorization", "Target roles", "Preferences", "Your agent"];
const S = { resume: 0, about: 1, where: 2, auth: 3, roles: 4, prefs: 5, mode: 6 } as const;
type Suggestion = { title: string; fit: "strong" | "adjacent" | "switch"; why: string };
const FIT_LABEL = { strong: { t: "Strong fit", c: "bg-green-tint text-green-ink" }, adjacent: { t: "Close fit", c: "bg-brand-tint text-brand-ink" }, switch: { t: "Career move", c: "bg-pink-tint text-pink-ink" } } as const;

const NATION_TO_CODE: Record<string, string> = {
  "United States": "US", "United Kingdom": "GB", Canada: "CA", Australia: "AU", Germany: "DE", Ireland: "IE",
  "New Zealand": "NZ", Singapore: "SG", India: "IN",
};

const STATUS_OPTIONS: { value: WorkStatus; label: string; body: string }[] = [
  { value: "citizen", label: "Citizen", body: "No restrictions" },
  { value: "permanent_resident", label: "Permanent resident", body: "Green card, ILR, PR" },
  { value: "student_visa", label: "Student visa", body: "F-1, Student visa, study permit" },
  { value: "post_study_work", label: "Post-study work", body: "OPT, Graduate visa, PGWP, 485" },
  { value: "work_visa", label: "Work visa", body: "H-1B, Skilled Worker, etc." },
  { value: "dependent_visa", label: "Dependant visa", body: "Spouse or partner visa" },
  { value: "none", label: "No status there yet", body: "Applying from abroad" },
];

const ROLE_SUGGESTIONS = [
  "Software Engineer", "Data Analyst", "Data Scientist", "Product Manager", "Registered Nurse", "Mechanical Engineer",
  "Business Analyst", "Accountant", "UX Designer", "DevOps Engineer", "Civil Engineer", "Marketing Manager",
  "HGV Driver", "Electrician", "Pharmacist", "Teacher",
];

type AuthDraft = { status: WorkStatus; now: boolean; later: boolean; scope: ApplyScope; optEnd?: string; stem?: boolean };
type RoleDraft = { title: string; levels: string[]; fit?: Suggestion["fit"]; why?: string; know?: string; motive?: string };

export default function OnboardingPage() {
  const { profile, userId, loading, refresh } = useMe();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [citizenship, setCitizenship] = useState("India");
  const [living, setLiving] = useState("IN");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [adult, setAdult] = useState(false);
  const [province, setProvince] = useState("");

  const [countries, setCountries] = useState<string[]>(["US"]);
  const [cities, setCities] = useState<Record<string, string[]>>({});
  const [radius, setRadius] = useState(40);
  const [remoteOk, setRemoteOk] = useState(true);

  const [auth, setAuth] = useState<Record<string, AuthDraft>>({});
  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [roleDraft, setRoleDraft] = useState("");

  const [industries, setIndustries] = useState<string[]>([]);
  const [industryMode, setIndustryMode] = useState<"only" | "prefer" | "all">("prefer");
  const [companies, setCompanies] = useState<string[]>([]);
  const [salary, setSalary] = useState("");
  const [jobTypes, setJobTypes] = useState<string[]>(["full_time"]);

  const [resumeText, setResumeText] = useState("");
  const [resumeState, setResumeState] = useState<"none" | "reading" | "done">("none");
  const [resumeInfo, setResumeInfo] = useState<{ name: string; headline: string; location: string } | null>(null);
  const [suggested, setSuggested] = useState<Suggestion[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [autonomy, setAutonomy] = useState<"approve_all" | "approve_important" | "fully_automatic">("approve_important");

  useEffect(() => {
    if (profile?.full_name && !fullName) setFullName(profile.full_name);
    if (profile?.onboarding_complete) hardNavigate("/app");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Default work-auth for each chosen country from citizenship.
  useEffect(() => {
    setAuth((prev) => {
      const next = { ...prev };
      for (const c of countries) {
        if (!next[c]) {
          const isCitizen = NATION_TO_CODE[citizenship] === c;
          next[c] = isCitizen
            ? { status: "citizen", now: false, later: false, scope: "any_legal" }
            : { status: "none", now: true, later: true, scope: "sponsor_or_silent" };
        }
      }
      Object.keys(next).forEach((k) => !countries.includes(k) && delete next[k]);
      return next;
    });
  }, [countries, citizenship]);

  const canNext = useMemo(() => {
    if (step === S.resume) return resumeState !== "reading";
    // 18+ only, and not yet available in Québec (its privacy law needs an assessment Vantage hasn't finished).
    if (step === S.about) return fullName.trim().length > 1 && adult && !(living === "CA" && (!province || province === "QC"));
    if (step === S.where) return countries.length > 0;
    if (step === S.roles) return roles.length > 0;
    return true;
  }, [step, fullName, countries, roles, resumeState]);

  function updateAuth(c: string, patch: Partial<AuthDraft>) {
    setAuth((a) => ({ ...a, [c]: { ...a[c], ...patch } }));
  }

  function addRole(title: string, s?: Suggestion) {
    const t = title.trim();
    if (!t || roles.some((r) => r.title.toLowerCase() === t.toLowerCase())) return;
    setRoles((r) => [...r, { title: t, levels: ["entry", "mid"], fit: s?.fit, why: s?.why }]);
    setRoleDraft("");
  }

  /** Read the resume first: it prefills the profile and suggests the roles worth targeting. */
  async function readResume(input: { file?: File; text?: string }) {
    setResumeState("reading");
    setError(null);
    try {
      let r: Response;
      if (input.file) {
        const fd = new FormData();
        fd.append("file", input.file);
        r = await fetch("/api/resume/import", { method: "POST", body: fd });
      } else {
        r = await fetch("/api/resume/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input.text }) });
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "We couldn't read that resume. Try a PDF or Word file, or paste the text.");
      const sr = await fetch("/api/resume/suggest-roles", { method: "POST" });
      const sd = await sr.json().catch(() => ({}));
      if (sr.ok) {
        setSuggested(sd.roles || []);
        const pf = sd.profile || {};
        setResumeInfo({ name: pf.name || "", headline: pf.headline || "", location: pf.location || "" });
        const nice = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/(^|\s)([a-z])/g, (_: string, a: string, b: string) => a + b.toUpperCase()) : n);
        if (pf.name && !fullName) setFullName(nice(pf.name));
        if (pf.phone && !phone) setPhone(pf.phone);
        if (pf.linkedin && !linkedin) setLinkedin(pf.linkedin);
      }
      setResumeState("done");
      setStep(S.about);
    } catch (e) {
      setResumeState("none");
      setError(e instanceof Error ? e.message : "We couldn't read that resume.");
    }
  }

  async function finish() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    const supabase = supabaseBrowser();
    try {
      const p1 = await supabase.from("profiles").update({
        full_name: fullName.trim(), citizenship, home_country: living, phone: phone || null,
        linkedin_url: linkedin || null, autonomy, adult_confirmed_at: new Date().toISOString(), region: living === "CA" ? province : null,
      }).eq("id", userId);
      if (p1.error) throw p1.error;

      const locations = countries.flatMap((c) => (cities[c] || []).map((city) => ({ country: c, city, radius_km: radius })));
      const p2 = await supabase.from("target_prefs").upsert({
        user_id: userId, countries, locations, remote_ok: remoteOk, industries, industry_mode: industryMode,
        salary_min: salary ? parseInt(salary.replace(/\D/g, ""), 10) : null,
        currency: COUNTRY_BY_CODE[countries[0]]?.currency || "USD", job_types: jobTypes, companies,
      });
      if (p2.error) throw p2.error;

      await supabase.from("work_auth").delete().eq("user_id", userId);
      const p3 = await supabase.from("work_auth").insert(
        countries.map((c) => ({
          user_id: userId, country: c, status: auth[c].status,
          needs_sponsorship_now: auth[c].now, needs_sponsorship_future: auth[c].later, apply_scope: auth[c].scope,
          details: { opt_end: auth[c].optEnd || null, stem_degree: auth[c].stem ?? null },
        })),
      );
      if (p3.error) throw p3.error;

      await supabase.from("target_roles").delete().eq("user_id", userId);
      const p4 = await supabase.from("target_roles").insert(
        roles.map((r, i) => {
          const answers = [
            r.know?.trim() ? { key: "know", q: `What do you already know or have done that's related to ${r.title}?`, a: r.know.trim() } : null,
            r.motive?.trim() ? { key: "why", q: `Why ${r.title}, and why now?`, a: r.motive.trim() } : null,
          ].filter(Boolean);
          return { user_id: userId, title: r.title, levels: r.levels, priority: i === 0 ? 1 : 2, coach: answers.length ? { answers, answeredAt: new Date().toISOString() } : {} };
        }),
      ).select();
      if (p4.error) throw p4.error;

      // A resume per role, written from the master resume plus what they told us about each role.
      if (resumeState === "done") await fetch("/api/resume/write-all", { method: "POST" }).catch(() => null);

      const p5 = await supabase.from("profiles").update({ onboarding_complete: true }).eq("id", userId);
      if (p5.error) throw p5.error;
      track("onboarding_complete", { countries, roles: roles.length });
      await refresh();
      hardNavigate("/app/jobs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while saving. Try again.");
      setSaving(false);
    }
  }

  if (loading) return <div className="p-10"><div className="skeleton h-10 w-60" /></div>;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Logo href="/" />
          <div className="ml-auto w-full max-w-sm">
            <div className="flex justify-between text-xs font-medium text-muted">
              <span className="font-semibold text-ink">Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-line">
              <motion.div className="h-1.5 rounded-full bg-brand" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="card p-6 sm:p-8"
          >
            {step === S.resume && (
              <div className="space-y-5">
                <Heading title="Start with your resume" sub="We read it like a recruiter: it fills in your profile, suggests the roles you can win, and becomes the master copy every tailored resume is built from. Nothing is ever invented." />
                {resumeState === "reading" ? (
                  <div className="flex flex-col items-center rounded-2xl border border-line bg-canvas px-6 py-12 text-center">
                    <Loader2 className="animate-spin text-brand" size={28} />
                    <p className="mt-3 font-semibold">Reading your resume…</p>
                    <p className="mt-1 text-sm text-muted">Keeping every fact, and finding the roles that fit you best.</p>
                  </div>
                ) : resumeState === "done" && resumeInfo ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-green/30 bg-green-tint/40 p-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green text-white"><Check size={18} /></span>
                    <div className="min-w-0 flex-1"><p className="font-semibold">Resume read{resumeInfo.name ? ` — ${resumeInfo.name}` : ""}</p><p className="truncate text-sm text-muted">{[resumeInfo.headline, resumeInfo.location].filter(Boolean).join(" · ")}</p></div>
                    <button className="btn-ghost min-h-9 text-[13px]" onClick={() => setResumeState("none")}>Replace</button>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center transition hover:border-brand hover:bg-brand-soft">
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tint text-brand"><UploadCloud size={26} /></span>
                      <span className="mt-3 font-semibold">Upload your resume</span>
                      <span className="mt-1 text-sm text-muted">PDF or Word · takes about 20 seconds</span>
                    </button>
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readResume({ file: f }); e.target.value = ""; }} />
                    <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
                      <button type="button" className="font-semibold text-brand-ink" onClick={() => setShowPaste(!showPaste)}><FileText size={14} className="mr-1 inline" />Paste the text instead</button>
                      <span className="text-subtle">·</span>
                      <button type="button" className="font-medium text-muted hover:text-ink" onClick={() => setStep(S.about)}>I&apos;ll add it later</button>
                    </div>
                    {showPaste && (
                      <div>
                        <textarea rows={8} className="input py-3 text-sm" value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your whole resume here" aria-label="Resume text" />
                        <button className="btn-primary mt-2" disabled={resumeText.trim().length < 80} onClick={() => readResume({ text: resumeText })}>Read my resume</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === S.about && (
              <div className="space-y-5">
                <Heading title="Tell us about you" sub="This is used on your applications. You can change it later." />
                <div>
                  <label className="label" htmlFor="fn">Full name</label>
                  <input id="fn" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="cit">Citizenship</label>
                    <select id="cit" className="input" value={citizenship} onChange={(e) => setCitizenship(e.target.value)}>
                      {ALL_NATIONALITIES.map((n) => <option key={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="liv">Country you live in now</label>
                    <select id="liv" className="input" value={living} onChange={(e) => setLiving(e.target.value)}>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      <option value="OTHER">Another country</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="ph">Phone <span className="font-normal text-muted">(optional)</span></label>
                    <input id="ph" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                  </div>
                  <div>
                    <label className="label" htmlFor="li">LinkedIn URL <span className="font-normal text-muted">(optional)</span></label>
                    <input id="li" className="input" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/…" />
                  </div>
                </div>
                {living === "CA" && (
                  <div>
                    <label className="label" htmlFor="prov">Province or territory</label>
                    <select id="prov" className="input" value={province} onChange={(e) => setProvince(e.target.value)}>
                      <option value="">Choose…</option>
                      {[["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Québec"], ["SK", "Saskatchewan"], ["YT", "Yukon"]].map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                    {province === "QC" && <p className="mt-2 rounded-xl bg-orange/10 p-3 text-sm">Vantage isn&apos;t available in Québec yet — Québec&apos;s privacy law asks for an assessment we&apos;re still completing. We&apos;re sorry, and we&apos;ll open it as soon as we can.</p>}
                  </div>
                )}
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                  <span>
                    <span className="font-semibold">I&apos;m 18 or older</span>
                    <span className="block text-xs text-muted">Vantage is for adults. We use this when an application asks whether you&apos;re at least 18.</span>
                  </span>
                </label>
              </div>
            )}

            {step === S.where && (
              <div className="space-y-6">
                <Heading title="Where do you want to work?" sub="Pick one or more countries. Add cities for each, or leave empty to search the whole country." />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {COUNTRIES.map((c) => (
                    <ChoiceCard
                      key={c.code}
                      multi
                      selected={countries.includes(c.code)}
                      onClick={() => setCountries((cs) => (cs.includes(c.code) ? cs.filter((x) => x !== c.code) : [...cs, c.code]))}
                      title={c.name}
                      body={c.routes[0]?.name ? `Main route: ${c.routes[0].name}` : "Local job search"}
                    />
                  ))}
                </div>
                {countries.map((c) => (
                  <div key={c}>
                    <p className="label">Cities in {COUNTRY_BY_CODE[c].name}</p>
                    <TagInput
                      label={`Add a city in ${COUNTRY_BY_CODE[c].name}`}
                      values={cities[c] || []}
                      onChange={(v) => setCities((x) => ({ ...x, [c]: v }))}
                      placeholder="Type a city and press Enter"
                      suggestions={COUNTRY_BY_CODE[c].defaultCities}
                    />
                  </div>
                ))}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="rad">Search radius around each city: {radius} km</label>
                    <input id="rad" type="range" min={5} max={150} step={5} value={radius} onChange={(e) => setRadius(+e.target.value)} className="w-full accent-[#2F5BEB]" />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl bg-canvas px-4 py-3">
                    <span className="text-sm font-semibold">Include remote jobs</span>
                    <Toggle checked={remoteOk} onChange={setRemoteOk} label="Include remote jobs" />
                  </div>
                </div>
              </div>
            )}

            {step === S.auth && (
              <div className="space-y-8">
                <Heading title="Your right to work in each country" sub="Be exact. Vantage uses this to filter jobs and answers truthfully on every application." />
                {countries.map((c) => {
                  const a = auth[c];
                  if (!a) return null;
                  const citizenLike = a.status === "citizen" || a.status === "permanent_resident";
                  return (
                    <div key={c} className="rounded-2xl border border-line p-5">
                      <p className="text-lg font-semibold">{COUNTRY_BY_CODE[c].name}</p>
                      <p className="mt-3 text-sm font-semibold">Your status there</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {STATUS_OPTIONS.map((o) => (
                          <ChoiceCard
                            key={o.value}
                            selected={a.status === o.value}
                            title={o.label}
                            body={o.body}
                            onClick={() =>
                              updateAuth(c, {
                                status: o.value,
                                ...(o.value === "citizen" || o.value === "permanent_resident"
                                  ? { now: false, later: false, scope: "any_legal" as ApplyScope }
                                  : o.value === "post_study_work"
                                    ? { now: false, later: true }
                                    : { now: true, later: true }),
                              })
                            }
                          />
                        ))}
                      </div>
                      {!citizenLike && (
                        <div className="mt-5 space-y-4">
                          {a.status === "post_study_work" ? (
                            <p className="rounded-xl bg-green-tint px-4 py-3 text-sm text-green-ink">You can start work now on this permit without sponsorship. Employers will see &ldquo;Yes&rdquo; to &ldquo;Are you authorised to work?&rdquo;</p>
                          ) : (
                            <Question q="Can you start a job without a new visa? (No = you need sponsorship to start)">
                              <Segmented label="Sponsorship now" value={a.now ? "yes" : "no"} onChange={(v) => updateAuth(c, { now: v === "yes" })}
                                options={[{ value: "no", label: "Yes, I can start" }, { value: "yes", label: "No, I need sponsorship" }]} />
                            </Question>
                          )}
                          <Question q="Will you need sponsorship later (for example H-1B or Skilled Worker)?">
                            <Segmented label="Sponsorship later" value={a.later ? "yes" : "no"} onChange={(v) => updateAuth(c, { later: v === "yes" })}
                              options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
                          </Question>
                          {c === "US" && a.status === "post_study_work" && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className="label" htmlFor={`opt-${c}`}>Work permit (EAD) end date</label>
                                <input id={`opt-${c}`} type="date" className="input" value={a.optEnd || ""} onChange={(e) => updateAuth(c, { optEnd: e.target.value })} />
                              </div>
                              <div className="flex items-end">
                                <div className="flex w-full items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
                                  <span className="text-sm font-semibold">STEM degree (eligible for +24 months)</span>
                                  <Toggle checked={Boolean(a.stem)} onChange={(v) => updateAuth(c, { stem: v })} label="STEM degree" />
                                </div>
                              </div>
                            </div>
                          )}
                          <div>
                            <p className="mb-2 text-sm font-semibold">Which jobs should we show and apply to?</p>
                            <div className="space-y-2">
                              <ChoiceCard selected={a.scope === "sponsor_or_silent"} onClick={() => updateAuth(c, { scope: "sponsor_or_silent" })}
                                title="Jobs that sponsor, plus jobs that don't mention it" body="Recommended. Skips only jobs that clearly rule you out." />
                              <ChoiceCard selected={a.scope === "sponsor_only"} onClick={() => updateAuth(c, { scope: "sponsor_only" })}
                                title="Only jobs that clearly sponsor" body="Fewer jobs, strongest long-term fit." />
                              <ChoiceCard selected={a.scope === "any_legal"} onClick={() => updateAuth(c, { scope: "any_legal" })}
                                title="Every job I can legally do today" body="Includes jobs that won't sponsor later; each one is flagged." />
                            </div>
                          </div>
                        </div>
                      )}
                      {c !== "IN" && COUNTRY_BY_CODE[c].studentPath && (
                        <p className="mt-4 rounded-lg bg-brand-tint px-3.5 py-2.5 text-sm text-brand-ink">{COUNTRY_BY_CODE[c].studentPath}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {step === S.roles && (
              <div className="space-y-5">
                <Heading title="Which roles are you targeting?" sub="Each role gets its own resume, written for it, and its own list of applications." />
                {suggested.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={15} className="text-brand" /> Suggested from your resume</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggested.map((sg) => {
                        const on = roles.some((r) => r.title.toLowerCase() === sg.title.toLowerCase());
                        return (
                          <button key={sg.title} type="button" disabled={on} onClick={() => addRole(sg.title, sg)}
                            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${on ? "border-brand bg-brand-soft" : "border-line hover:border-brand"}`}>
                            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${on ? "bg-brand text-white" : "bg-canvas text-ink-2"}`}>{on ? <Check size={14} /> : <Plus size={14} />}</span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">{sg.title}</span><span className={`chip ${FIT_LABEL[sg.fit].c}`}>{FIT_LABEL[sg.fit].t}</span></span>
                              <span className="mt-0.5 block text-xs text-muted">{sg.why}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <input className="input" aria-label="Role title" placeholder="e.g. Software Engineer, Registered Nurse, HGV Driver"
                    value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(roleDraft); } }} />
                  <button type="button" className="btn-primary shrink-0" onClick={() => addRole(roleDraft)}>Add role</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(suggested.length ? [] : ROLE_SUGGESTIONS).filter((s) => !roles.some((r) => r.title === s)).map((s) => (
                    <button key={s} type="button" onClick={() => addRole(s)} className="rounded-full border border-[#f8cfdd] bg-[#fdf3f7] px-2.5 py-1 text-xs font-semibold text-pink-ink">+ {s}</button>
                  ))}
                </div>
                <ul className="space-y-3">
                  {roles.map((r, i) => (
                    <li key={r.title} className="rounded-xl border border-line p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">{r.title} {i === 0 && <span className="pill ml-2 bg-pink-tint text-pink-ink">Top priority</span>}</p>
                        <button className="text-sm font-medium text-muted hover:text-red-ink" onClick={() => setRoles((rs) => rs.filter((x) => x.title !== r.title))}>Remove</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {["intern", "entry", "mid", "senior", "lead"].map((lv) => {
                          const on = r.levels.includes(lv);
                          return (
                            <button key={lv} type="button" aria-pressed={on}
                              onClick={() => setRoles((rs) => rs.map((x) => x.title === r.title ? { ...x, levels: on ? x.levels.filter((l) => l !== lv) : [...x.levels, lv] } : x))}
                              className={`min-h-8 rounded-md border px-3 text-xs font-semibold capitalize ${on ? "border-brand bg-brand text-white" : "border-line text-ink-2"}`}>
                              {lv === "entry" ? "Entry level" : lv}
                            </button>
                          );
                        })}
                      </div>
                      {r.fit !== "strong" && (
                        <div className="mt-4 space-y-3 rounded-xl bg-canvas p-3">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Sparkles size={13} className="text-pink" /> {r.fit === "switch" || r.fit === "adjacent" ? "A career move — help us position you like a recruiter would" : "Tell us a little about this role (optional, makes your resume much stronger)"}</p>
                          <label className="block text-xs font-semibold">What do you already know or have done that&apos;s related to {r.title}?
                            <textarea rows={2} className="input mt-1 py-2 text-sm font-normal" placeholder="Courses, projects, parts of your current job that overlap, tools you've used…"
                              value={r.know || ""} onChange={(e) => setRoles((rs) => rs.map((x) => (x.title === r.title ? { ...x, know: e.target.value } : x)))} />
                          </label>
                          <label className="block text-xs font-semibold">Why {r.title}, and why now?
                            <textarea rows={2} className="input mt-1 py-2 text-sm font-normal" placeholder="One or two lines — we use this to frame your summary and cover letters."
                              value={r.motive || ""} onChange={(e) => setRoles((rs) => rs.map((x) => (x.title === r.title ? { ...x, motive: e.target.value } : x)))} />
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === S.prefs && (
              <div className="space-y-6">
                <Heading title="Industries, companies and pay" sub="All optional. Leave empty to consider everything." />
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="label mb-0">Industries</p>
                    <Segmented label="Industry rule" value={industryMode} onChange={setIndustryMode}
                      options={[{ value: "only", label: "Only these" }, { value: "prefer", label: "Prefer these" }, { value: "all", label: "All" }]} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {INDUSTRIES.map((i) => {
                      const on = industries.includes(i);
                      return (
                        <button key={i} type="button" aria-pressed={on} onClick={() => setIndustries((x) => on ? x.filter((y) => y !== i) : [...x, i])}
                          className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>
                          {on && "✓ "}{i}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="label">Target companies <span className="font-normal text-muted">(applied to first)</span></p>
                  <TagInput label="Add a company" values={companies} onChange={setCompanies} placeholder="Type a company and press Enter" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="sal">Minimum yearly salary ({COUNTRY_BY_CODE[countries[0]]?.currency || "USD"})</label>
                    <input id="sal" className="input" inputMode="numeric" placeholder="e.g. 70000" value={salary} onChange={(e) => setSalary(e.target.value)} />
                  </div>
                  <div>
                    <p className="label">Job type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[["full_time", "Full-time"], ["part_time", "Part-time"], ["contract", "Contract"], ["internship", "Internship"]].map(([v, l]) => {
                        const on = jobTypes.includes(v);
                        return (
                          <button key={v} type="button" aria-pressed={on} onClick={() => setJobTypes((x) => on ? x.filter((y) => y !== v) : [...x, v])}
                            className={`min-h-10 rounded-lg border px-3 text-sm font-medium ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{l}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === S.mode && (
              <div className="space-y-6">
                <Heading title="How independent should your agent be?" sub="You can change this any time in Settings." />
                <div className="space-y-2">
                  <p className="label">How should the agent apply?</p>
                  <ChoiceCard selected={autonomy === "approve_all"} onClick={() => setAutonomy("approve_all")} title="Approve every application" body="Nothing is sent until you approve." />
                  <ChoiceCard selected={autonomy === "approve_important"} onClick={() => setAutonomy("approve_important")} title="Approve important ones only" body="Routine applications go ahead; target companies and top matches come to you." />
                  <ChoiceCard selected={autonomy === "fully_automatic"} onClick={() => setAutonomy("fully_automatic")} title="Fully automatic" body="The agent prepares and queues everything inside your rules." />
                </div>
              </div>
            )}
          </motion.section>
        </AnimatePresence>

        <FormError message={error} />
        <div className="mt-6 flex items-center justify-between gap-3">
          <button className="btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>
            <ArrowLeft size={16} /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn-primary min-h-11 px-6" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Continue</button>
          ) : (
            <button className="btn-primary min-h-11 px-6" disabled={saving} onClick={finish}>
              {saving ? "Setting up your search…" : (<><Check size={16} /> Show my matches</>)}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-[15px] text-muted">{sub}</p>
    </div>
  );
}

function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold">{q}</p>
      {children}
    </div>
  );
}
