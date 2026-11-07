"use client";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, FileText, Ghost, Globe2, Inbox, LockKeyhole, MessageSquareQuote, Search, Send, ShieldCheck } from "lucide-react";

/* Shared reveal: content rises in once as it scrolls into view (instant for people who asked for less motion). */
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.7, 0.2, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--blue)]">{children}</p>;

/* ---------- where it applies ---------- */

const PLATFORMS = ["Workday", "Greenhouse", "Lever", "Ashby", "iCIMS"];

export function Platforms() {
  return (
    <section aria-label="Careers sites Vantage fills" className="border-y border-[rgba(11,26,58,0.06)] bg-white/60 py-7">
      <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-4 px-4 sm:px-6 lg:flex-row lg:gap-10">
        <p className="shrink-0 text-[13.5px] font-medium text-[var(--deep-3)]">Fills the application on the company&apos;s own site</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 lg:justify-between lg:flex-1">
          {PLATFORMS.map((p) => (
            <li key={p} className="text-[16px] font-semibold tracking-tight text-[#8a93a8]">{p}</li>
          ))}
          <li className="text-[14px] font-medium text-[#8a93a8]">and most careers sites</li>
        </ul>
      </div>
    </section>
  );
}

/* ---------- how it works ---------- */

const STEPS = [
  {
    icon: Search,
    title: "Find jobs that can hire you",
    body: "Fresh roles from 250+ employers' own careers sites, checked against visa rules for 10 countries. Ghost jobs are flagged before you waste an application.",
    art: <StepFind />,
  },
  {
    icon: FileText,
    title: "Get a resume and letter for each job",
    body: "Written from your real history for that one posting, then checked like a recruiter would: every line traced back to you, nothing invented.",
    art: <StepTailor />,
  },
  {
    icon: Send,
    title: "Apply on the company's own site",
    body: "The Chrome extension fills Workday, Greenhouse, Lever and more, page by page. You review everything and press Submit yourself.",
    art: <StepApply />,
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 py-24 lg:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <Reveal className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="display mt-3 text-[clamp(32px,4.6vw,50px)] font-[680] leading-[1.05] text-[var(--deep)]">Three steps from posting to submitted. You stay in charge of every one.</h2>
        </Reveal>
        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.1} className="h-full">
                <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-[rgba(11,26,58,0.08)] bg-white shadow-[0_1px_2px_rgba(11,26,58,0.04),0_24px_50px_-34px_rgba(11,26,58,0.35)]">
                  <div className="relative h-[226px] overflow-hidden border-b border-[rgba(11,26,58,0.06)] bg-[linear-gradient(180deg,#f6f8ff,#fff)] p-5">{s.art}</div>
                  <div className="flex flex-1 flex-col p-6">
                    <span className="text-[13px] font-semibold text-[var(--deep-3)]">Step {i + 1}</span>
                    <h3 className="mt-1 text-[20px] font-semibold tracking-tight text-[var(--deep)]">{s.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[var(--deep-2)]">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Small, live-looking slices of the product (not screenshots, so they stay sharp at any size). */
function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 rounded-xl border border-[rgba(11,26,58,0.07)] bg-white px-3 py-2.5 shadow-[0_8px_20px_-16px_rgba(11,26,58,0.4)] ${className}`}>{children}</div>;
}
function StepFind() {
  return (
    <div className="space-y-2.5" aria-hidden>
      <Row><span className="flex size-8 items-center justify-center rounded-lg bg-[#2f5beb] text-[13px] font-bold text-white">N</span><span className="min-w-0 flex-1"><b className="block truncate text-[13.5px] text-[var(--deep)]">Growth Marketing Manager</b><span className="text-[12px] text-[var(--verify)]">✓ Sponsors visas</span></span><b className="text-[15px] text-[var(--verify)]">94%</b></Row>
      <Row><span className="flex size-8 items-center justify-center rounded-lg bg-[#9b6bff] text-[13px] font-bold text-white">L</span><span className="min-w-0 flex-1"><b className="block truncate text-[13.5px] text-[var(--deep)]">Demand Generation Lead</b><span className="text-[12px] text-[var(--verify)]">✓ Sponsors visas</span></span><b className="text-[15px] text-[var(--verify)]">88%</b></Row>
      <Row className="opacity-80"><span className="flex size-8 items-center justify-center rounded-lg bg-[#f7862b] text-[13px] font-bold text-white">B</span><span className="min-w-0 flex-1"><b className="block truncate text-[13.5px] text-[var(--deep)]">Marketing Analyst</b><span className="text-[12px] text-[#b4520a]">⚠ Open 4 months, likely ghost job</span></span></Row>
    </div>
  );
}
function StepTailor() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="rounded-lg bg-[#eef2fe] px-3 py-2 text-[12.5px] text-[var(--deep)]"><span className="text-[var(--blue)]">●</span> Posting: grow qualified pipeline with target accounts</div>
      <div className="rounded-lg bg-[#e7f6ee] px-3 py-2 text-[12.5px] text-[var(--deep)]">Grew qualified pipeline 40% across 200+ target accounts <span className="ml-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--verify)]">✓ your history</span></div>
      <div className="rounded-lg bg-white px-3 py-2 text-[12.5px] text-[var(--deep-3)] ring-1 ring-[rgba(11,26,58,0.07)]"><s>Drove 3x revenue growth</s> <span className="ml-1 whitespace-nowrap rounded-full bg-[#fdecec] px-2 py-0.5 text-[11px] font-semibold text-[#b42318]">not in your history</span></div>
    </div>
  );
}
function StepApply() {
  return (
    <div className="space-y-2" aria-hidden>
      {[["Full name", "Sam Rivera"], ["Resume", "Sam_Rivera_Northwind.pdf"], ["Sponsorship needed?", "Yes, from your profile"]].map(([k, v]) => (
        <div key={k}><span className="block text-[11px] font-semibold text-[var(--deep-3)]">{k}</span><span className="mt-0.5 block truncate rounded-lg border border-[#b9dcc8] bg-white px-2.5 py-1.5 text-[12.5px] text-[var(--deep)]">{v}</span></div>
      ))}
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--deep)] px-3 py-1.5 text-[12px] font-semibold text-white">Submit application <ArrowRight size={12} /></span>
    </div>
  );
}

/* ---------- features (bento) ---------- */

export function Features() {
  return (
    <section id="features" className="scroll-mt-24 border-t border-[rgba(11,26,58,0.06)] bg-white/50 py-24 lg:py-32">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <Reveal className="max-w-2xl">
          <Eyebrow>Built like a recruiter would build it</Eyebrow>
          <h2 className="display mt-3 text-[clamp(32px,4.6vw,50px)] font-[680] leading-[1.05] text-[var(--deep)]">Everything a hiring manager checks, checked first.</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[var(--deep-2)]">Recruiters skim a resume in seconds and ask about every line in the interview. Vantage prepares you for both.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 lg:grid-cols-6">
          <Tile className="lg:col-span-4" icon={ShieldCheck} title="Recruiter check" body="Before you apply, see what a recruiter sees: title match, the skills the job asks for that your resume proves, results with numbers, and the knock-out questions to watch.">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="relative mx-auto size-[120px]">
                <svg viewBox="0 0 120 120" className="size-full -rotate-90"><circle cx="60" cy="60" r="50" fill="none" stroke="#edf0f6" strokeWidth="12" /><motion.circle cx="60" cy="60" r="50" fill="none" stroke="url(#rc)" strokeWidth="12" strokeLinecap="round" strokeDasharray="314" initial={{ strokeDashoffset: 314 }} whileInView={{ strokeDashoffset: 314 * 0.09 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: "easeOut" }} /><defs><linearGradient id="rc"><stop stopColor="#2f5beb" /><stop offset="1" stopColor="#14975a" /></linearGradient></defs></svg>
                <span className="absolute inset-0 flex flex-col items-center justify-center"><b className="display text-[30px] leading-none text-[var(--deep)]">9.1</b><span className="text-[11.5px] text-[var(--deep-3)]">out of 10</span></span>
              </div>
              <ul className="space-y-2 text-[14px]">
                {[["Title matches the role", true], ["12 of 14 asked-for skills proven", true], ["8 of 10 bullets show a result", true], ["Knock-out: 3 years of HubSpot", false]].map(([t, ok]) => (
                  <li key={String(t)} className="flex items-center gap-2.5 rounded-lg bg-[#f7f9fc] px-3 py-2">
                    {ok ? <Check size={15} strokeWidth={2.6} className="text-[var(--verify)]" /> : <AlertTriangle size={15} className="text-[#b4520a]" />}
                    <span className="text-[var(--deep)]">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Tile>
          <Tile className="lg:col-span-2" icon={MessageSquareQuote} title="Interview kit" body="The questions your resume will raise, with talking points from your own results.">
            <div className="space-y-2 text-[13.5px]">
              <p className="rounded-xl rounded-bl-sm bg-[var(--deep)] px-3.5 py-2.5 text-white">“Walk me through the 40% pipeline lift. What was yours?”</p>
              <p className="ml-6 rounded-xl rounded-br-sm bg-[#eef2fe] px-3.5 py-2.5 text-[var(--deep)]">Target list of 200 accounts, LinkedIn plus paid search, weekly tests on audiences…</p>
            </div>
          </Tile>
          <Tile className="lg:col-span-2" icon={Globe2} title="Visa-aware jobs" body="Sponsorship rules for 10 countries applied to every posting, so roles that can't hire you never reach your list.">
            <ul className="flex flex-wrap gap-1.5">
              {["US", "UK", "Canada", "Australia", "Germany", "Ireland", "Netherlands", "New Zealand", "Singapore", "India"].map((c) => (
                <li key={c} className="rounded-full border border-[rgba(11,26,58,0.08)] bg-white px-2.5 py-1 text-[12.5px] font-medium text-[var(--deep-2)]">{c}</li>
              ))}
            </ul>
          </Tile>
          <Tile className="lg:col-span-2" icon={Ghost} title="Ghost jobs flagged" body="Postings open for months, reposted again and again, or silent for every applicant are marked before you apply.">
            <div className="flex items-center gap-2 rounded-xl bg-[#fff4e5] px-3.5 py-2.5 text-[13.5px] text-[#8a3c06]"><AlertTriangle size={15} /> Open 132 days · reposted 4 times</div>
          </Tile>
          <Tile className="lg:col-span-2" icon={Inbox} title="Your board fills itself" body="Applied anywhere else? The confirmation email adds it. Interview invites land on your calendar.">
            <div className="space-y-1.5 text-[13px]">
              {[["Northwind", "Interview Tue 10:00", "#e7f6ee", "#14975a"], ["Lumen Analytics", "Applied", "#eef2fe", "#2f5beb"]].map(([c, s, bg, fg]) => (
                <div key={c} className="flex items-center justify-between rounded-lg bg-[#f7f9fc] px-3 py-2"><span className="font-medium text-[var(--deep)]">{c}</span><span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: bg, color: fg }}>{s}</span></div>
              ))}
            </div>
          </Tile>
        </div>
      </div>
    </section>
  );
}

function Tile({ className = "", icon: Icon, title, body, children }: { className?: string; icon: typeof Check; title: string; body: string; children: React.ReactNode }) {
  return (
    <Reveal className={className}>
      <div className="flex h-full flex-col gap-5 rounded-[24px] border border-[rgba(11,26,58,0.08)] bg-white p-6 shadow-[0_1px_2px_rgba(11,26,58,0.04),0_24px_50px_-34px_rgba(11,26,58,0.35)] sm:p-7">
        <div>
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#eef2fe] text-[var(--blue)]"><Icon size={19} /></span>
          <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-[var(--deep)]">{title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--deep-2)]">{body}</p>
        </div>
        <div className="mt-auto">{children}</div>
      </div>
    </Reveal>
  );
}

/* ---------- promises ---------- */

const PROMISES = [
  { icon: LockKeyhole, title: "Your passwords stay yours", body: "Vantage never sees, stores or types the password for any careers site." },
  { icon: ShieldCheck, title: "You press Submit", body: "Nothing is sent to an employer until you review it and say so." },
  { icon: Check, title: "No invented facts", body: "No borrowed titles, no made-up numbers. Missing numbers become questions for you." },
  { icon: Search, title: "No scraping, no tricks", body: "No LinkedIn scraping, no CAPTCHA solving, no hidden bots. Jobs come from employers' own sites." },
];

export function Promises() {
  return (
    <section aria-labelledby="promises" className="py-20 lg:py-24">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <Reveal><h2 id="promises" className="display max-w-2xl text-[clamp(28px,3.8vw,40px)] font-[680] leading-[1.08] text-[var(--deep)]">What Vantage will never do.</h2></Reveal>
        <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map((p, i) => (
            <li key={p.title}>
              <Reveal delay={i * 0.06}>
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#e7f6ee] text-[var(--verify)]"><p.icon size={18} /></span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-[var(--deep)]">{p.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--deep-2)]">{p.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
