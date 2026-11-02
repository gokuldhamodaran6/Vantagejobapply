"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarDays, Check, FileText, Mail, Paperclip, ShieldCheck, TriangleAlert } from "lucide-react";

const STEPS = [
  {
    title: "It reads the posting and the employer",
    body: "Vantage pulls out what the hiring manager will screen for, the exact phrases their applicant tracking system looks for, and what this employer says it values. Hard requirements like location or sponsorship are flagged before you spend a minute.",
  },
  {
    title: "It writes your resume for that one job",
    body: "Your real experience is rewritten around what this job needs: results first, the posting's own language where you have earned it, your strongest proof at the top. Your titles, employers and dates stay exactly as they are.",
  },
  {
    title: "It fact-checks like a hiring manager",
    body: "A second pass reads the resume the way the hiring manager will, line by line against your history. Anything stretched is pulled back to what you can defend in an interview, then it scores the result.",
  },
  {
    title: "It fills the company's form",
    body: "The Chrome extension opens the employer's own application and fills it page by page, attaching the resume and cover letter written for this job. You check it and press Submit.",
  },
  {
    title: "Your inbox keeps score",
    body: "Confirmations, rejections and interview invites from any site land on the right application. Interviews go straight onto your calendar, and quiet applications get a follow-up nudge.",
  },
];

/* ---------- visuals ---------- */

function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" | "ok" }) {
  const cls = tone === "warn" ? "bg-[#fff4e6] text-[#9a520c]" : tone === "ok" ? "bg-[#e7f6ee] text-[#0b7a43]" : "bg-white/85 text-[var(--deep)] border border-[rgba(11,26,58,0.1)]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${cls}`}>{children}</span>;
}

const appear = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.15 + i * 0.22, duration: 0.4 } });

function ReadVisual() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
        <p className="text-[13px] font-semibold">Senior Data Analyst · Northwind Analytics</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--deep-3)]">
          You&apos;ll own <mark className="bg-[#e6edff] text-[var(--deep)]">experimentation</mark> for growth, write production <mark className="bg-[#e6edff] text-[var(--deep)]">SQL</mark>, and present to <mark className="bg-[#e6edff] text-[var(--deep)]">senior leadership</mark> weekly. Hybrid, 3 days a week in <mark className="bg-[#fff1df] text-[var(--deep)]">Austin</mark>.
        </p>
      </div>
      <div>
        <p className="text-[12px] font-medium text-[var(--deep-3)]">Must-haves found</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["A/B testing", "SQL", "Stakeholder reporting", "Python", "Dashboarding"].map((t, i) => (
            <motion.span key={t} {...appear(i)}><Chip>{t}</Chip></motion.span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[12px] font-medium text-[var(--deep-3)]">What this employer says it values</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Ownership", "Data-driven decisions", "Customer focus"].map((t, i) => (
            <motion.span key={t} {...appear(i + 4)}><Chip>{t}</Chip></motion.span>
          ))}
        </div>
      </div>
      <motion.div {...appear(7)}><Chip tone="warn"><TriangleAlert size={13} /> Check first: on-site 3 days a week in Austin</Chip></motion.div>
    </div>
  );
}

function WriteVisual() {
  const reduce = useReducedMotion();
  const [after, setAfter] = useState(Boolean(reduce));
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setAfter(true), 1100);
    return () => clearTimeout(t);
  }, [reduce]);
  const rows = [
    { before: "Responsible for running A/B tests for the growth team.", after: "Contributed to a 22% lift in trial-to-paid conversion by designing 14 A/B tests with the growth team." },
    { before: "Made reports for managers using SQL.", after: "Cut weekly reporting from 6 hours to 40 minutes by automating SQL pipelines into Looker." },
  ];
  return (
    <div className="rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
      <div className="flex items-baseline justify-between">
        <p className="text-[15px] font-bold">Priya Raman</p>
        <span className="text-[11px] font-semibold text-[var(--blue)]">Written for Northwind</span>
      </div>
      <p className="text-[12px] text-[var(--deep-3)]">Data Analyst | SQL · Python | Experimentation</p>
      <p className="mt-4 text-[11px] font-semibold text-[var(--deep-3)]">Growth Analyst · Lumen Labs · 2022 – Present</p>
      <ul className="mt-2 space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="relative min-h-[40px] text-[13px] leading-[1.5]">
            <AnimatePresence mode="wait" initial={false}>
              {after ? (
                <motion.p key="a" initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.5, delay: i * 0.35 }} className="text-[var(--deep)]">
                  {r.after}
                </motion.p>
              ) : (
                <motion.p key="b" exit={{ opacity: 0, filter: "blur(6px)" }} className="text-[var(--deep-3)]">{r.before}</motion.p>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip tone="ok"><Check size={12} strokeWidth={3} /> Results first</Chip>
        <Chip tone="ok"><Check size={12} strokeWidth={3} /> Posting&apos;s own words</Chip>
        <Chip tone="ok"><Check size={12} strokeWidth={3} /> Same titles and dates</Chip>
      </div>
    </div>
  );
}

function CheckVisual() {
  const reduce = useReducedMotion();
  const [fixed, setFixed] = useState(Boolean(reduce));
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setFixed(true), 1200);
    return () => clearTimeout(t);
  }, [reduce]);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
        <p className="text-[12px] font-medium text-[var(--deep-3)]">Your history says</p>
        <p className="mt-1 text-[13px]">&ldquo;…contributing to a 35% increase in qualified pipeline.&rdquo;</p>
        <div className="my-4 h-px bg-[rgba(11,26,58,0.08)]" />
        <p className="text-[12px] font-medium text-[var(--deep-3)]">The draft said</p>
        <p className="relative mt-1 text-[13px]">
          <span className={fixed ? "text-[var(--deep-3)] line-through decoration-[#d9534f] decoration-2" : ""}>Drove 35% pipeline growth and owned the regional budget.</span>
        </p>
        <AnimatePresence>
          {fixed && (
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mt-2 text-[13px] font-medium text-[var(--deep)]">
              Contributed to a 35% increase in qualified pipeline by analyzing 100+ enterprise accounts.
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {fixed && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-3 flex items-center gap-1.5 text-[12px] text-[#0b7a43]">
              <ShieldCheck size={14} /> Shared credit kept. &ldquo;Budget&rdquo; removed: it isn&apos;t in your history.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-4 rounded-xl bg-white/80 p-4 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(11,26,58,0.08)" strokeWidth="7" />
          <motion.circle cx="42" cy="42" r={r} fill="none" stroke="#2f5beb" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 42 42)" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * 0.13 }} transition={{ duration: 1.3, delay: 0.4, ease: [0.2, 0.8, 0.2, 1] }} />
          <text x="42" y="48" textAnchor="middle" fontSize="19" fontWeight="700" fill="#0b1a3a">87</text>
        </svg>
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {[["First impression", 9], ["Relevance", 9], ["Impact", 8], ["Credibility", 9]].map(([k, v]) => (
            <div key={k as string} className="flex justify-between text-[var(--deep-2)]"><span>{k}</span><span className="font-semibold tabular-nums">{v}/10</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FillVisual() {
  const fields = [
    { label: "First name", value: "Priya" },
    { label: "Email", value: "priya.raman@example.com" },
    { label: "Are you legally authorized to work in the US?", value: "Yes" },
    { label: "LinkedIn profile", value: "linkedin.com/in/priyaraman" },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(11,26,58,0.08)]">
      <div className="flex items-center gap-1.5 border-b border-[rgba(11,26,58,0.08)] bg-[#f7f8fb] px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff6159]" /><span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-[var(--deep-3)] shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">careers.northwind.example/apply/senior-data-analyst</span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_170px]">
        <div className="space-y-2.5">
          {fields.map((f, i) => (
            <div key={f.label}>
              <p className="text-[11px] font-medium text-[var(--deep-3)]">{f.label}</p>
              <div className="relative mt-1 h-8 overflow-hidden rounded-md border border-[rgba(11,26,58,0.14)] px-2.5 text-[12.5px] leading-8">
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.35 }}>{f.value}</motion.span>
                <motion.span className="absolute inset-0 bg-[#e6edff]" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.8, 0] }} transition={{ delay: 0.25 + i * 0.35, duration: 0.6 }} />
              </div>
            </div>
          ))}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="flex flex-wrap gap-1.5 pt-1">
            <Chip tone="ok"><Paperclip size={12} /> Resume for Northwind.pdf</Chip>
            <Chip tone="ok"><Paperclip size={12} /> Cover letter.pdf</Chip>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="glass rounded-xl p-3 text-[11.5px]">
          <p className="flex items-center gap-1.5 font-semibold"><span className="live-dot h-2 w-2 rounded-full bg-[var(--verify)]" /> Vantage</p>
          <p className="mt-2 text-[var(--deep-2)]">Page 1 of 3 filled. Your answers are your own; nothing is guessed.</p>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.1 }} className="mt-3 rounded-lg bg-[var(--deep)] px-2.5 py-2 text-center font-semibold text-white">Ready. Review, then press Submit.</motion.p>
        </motion.div>
      </div>
    </div>
  );
}

function InboxVisual() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(reduce ? 2 : 0);
  useEffect(() => {
    if (reduce) return;
    const t = [setTimeout(() => setStage(1), 900), setTimeout(() => setStage(2), 1800)];
    return () => t.forEach(clearTimeout);
  }, [reduce]);
  return (
    <div className="space-y-3">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef2fe] text-[var(--blue)]"><Mail size={16} /></span>
        <div className="min-w-0 text-[12.5px]">
          <p className="font-semibold">Northwind Talent Team</p>
          <p className="truncate text-[var(--deep-2)]">Interview: Senior Data Analyst. Thursday, 10:30 AM CT</p>
        </div>
      </motion.div>
      <div className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(11,26,58,0.06)]">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="flex items-center gap-2 font-semibold"><FileText size={15} /> Northwind · Senior Data Analyst</span>
          <motion.span layout className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${stage >= 1 ? "bg-[#e7f6ee] text-[#0b7a43]" : "bg-[#eef2fe] text-[var(--blue)]"}`}>
            {stage >= 1 ? "Interview" : "Applied"}
          </motion.span>
        </div>
        <div className="mt-3 flex gap-1">
          {["Applied", "In review", "Interview", "Offer"].map((s, i) => (
            <motion.span key={s} className="h-1.5 flex-1 rounded-full" initial={false} animate={{ backgroundColor: i <= (stage >= 1 ? 2 : 0) ? "#2f5beb" : "rgba(11,26,58,0.1)" }} transition={{ delay: i * 0.12 }} />
          ))}
        </div>
      </div>
      <AnimatePresence>
        {stage >= 2 && (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass flex items-center gap-3 rounded-xl p-4">
            <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--deep)] text-white">
              <span className="text-[10px] font-semibold opacity-80">Thu</span>
              <span className="text-[16px] font-bold leading-none">14</span>
            </span>
            <div className="text-[12.5px]">
              <p className="flex items-center gap-1.5 font-semibold"><CalendarDays size={14} /> Interview with Northwind</p>
              <p className="text-[var(--deep-3)]">10:30 – 11:15 AM · added to your calendar</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const VISUALS = [ReadVisual, WriteVisual, CheckVisual, FillVisual, InboxVisual];
export const STEP_TITLES = STEPS.map((s) => s.title);

/* ---------- section ---------- */

export function Story() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  // Plays itself while on screen; any click or tap hands control to the reader. No scroll-jacking.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (paused || !inView || reduce) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % STEPS.length), 7000);
    return () => clearTimeout(t);
  }, [active, paused, inView, reduce]);
  const pick = (i: number) => {
    setPaused(true);
    setActive(i);
  };
  const Visual = VISUALS[active];
  const s = STEPS[active];

  return (
    <section ref={ref} id="story" className="relative border-t border-[rgba(11,26,58,0.06)] bg-white/40 py-20 lg:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <h2 className="display max-w-3xl text-[34px] font-[680] leading-[1.05] sm:text-[52px]">How it works</h2>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-[var(--deep-2)]">Five steps run for every job you choose. Tap a step to see it.</p>

        {/* Phones: step chips in one row */}
        <div className="-mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Steps">
          {STEPS.map((x, i) => (
            <button key={x.title} type="button" role="tab" aria-selected={i === active} onClick={() => pick(i)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold ${i === active ? "border-transparent bg-[var(--deep)] text-white" : "border-[rgba(11,26,58,0.12)] bg-white/80 text-[var(--deep-2)]"}`}>
              <span className="tabular-nums opacity-70">{i + 1}</span> {SHORT[i]}
            </button>
          ))}
        </div>

        <div className="mt-6 grid items-start gap-8 lg:mt-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          {/* Desktop: the steps as a list */}
          <ol className="hidden space-y-2 lg:block" role="tablist" aria-label="Steps">
            {STEPS.map((x, i) => (
              <li key={x.title}>
                <button type="button" role="tab" aria-selected={i === active} onClick={() => pick(i)}
                  className={`w-full rounded-2xl px-5 py-4 text-left transition-colors ${i === active ? "glass" : "hover:bg-white/60"}`}>
                  <span className="flex items-baseline gap-4">
                    <span className={`display text-[15px] font-[700] tabular-nums ${i === active ? "text-[var(--blue)]" : "text-[var(--deep-3)]"}`}>{i + 1}</span>
                    <span>
                      <span className={`block text-[19px] font-semibold tracking-tight ${i === active ? "text-[var(--deep)]" : "text-[var(--deep-3)]"}`}>{x.title}</span>
                      {i === active && <span className="block pt-2 text-[15px] leading-relaxed text-[var(--deep-2)]">{x.body}</span>}
                    </span>
                  </span>
                  {i === active && !paused && !reduce && inView && <span aria-hidden className="mt-3 block h-[3px] overflow-hidden rounded-full bg-[rgba(11,26,58,0.08)]"><span key={active} className="story-bar block h-full rounded-full bg-[var(--blue)]" /></span>}
                </button>
              </li>
            ))}
          </ol>

          <div>
            {/* Phones: the step's words above its picture */}
            <div className="mb-4 lg:hidden">
              <h3 className="text-[21px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-[var(--deep-2)]">{s.body}</p>
            </div>
            <div className="glass prism-edge relative rounded-[24px] p-4 sm:p-6">
              <div aria-hidden className="pointer-events-none absolute -inset-16 -z-10 opacity-60 blur-3xl [background:radial-gradient(40%_40%_at_70%_30%,#cfdcff,transparent),radial-gradient(35%_35%_at_30%_80%,#f4d9f0,transparent)]" />
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="min-h-[300px] lg:min-h-[420px]">
                  <Visual />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 lg:hidden">
              <button type="button" onClick={() => pick((active + STEPS.length - 1) % STEPS.length)} className="min-h-11 rounded-full border border-[rgba(11,26,58,0.12)] bg-white/80 px-4 text-[14px] font-semibold">← Back</button>
              <span className="text-[13px] text-[var(--deep-3)]">Step {active + 1} of {STEPS.length}</span>
              <button type="button" onClick={() => pick((active + 1) % STEPS.length)} className="min-h-11 rounded-full bg-[var(--deep)] px-4 text-[14px] font-semibold text-white">Next →</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const SHORT = ["Reads the job", "Writes your resume", "Fact-checks", "Fills the form", "Tracks replies"];
