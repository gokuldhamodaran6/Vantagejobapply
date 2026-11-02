"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Check, Play, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Hero3D } from "@/components/landing/v3/hero-3d";

/** Illustrative demo: a fictional candidate and fictional employers. */
type Demo = {
  company: string;
  title: string;
  place: string;
  reqs: string[];
  headline: string;
  bullets: { text: string; marks: string[] }[];
  score: number;
  check: { ok: boolean; text: string };
};

const DEMOS: Demo[] = [
  {
    company: "Northwind Analytics",
    title: "Senior Data Analyst",
    place: "Austin, TX · Hybrid",
    reqs: ["SQL", "Experimentation", "Stakeholder reporting"],
    headline: "Data Analyst | SQL · Python | Experimentation",
    bullets: [
      { text: "Contributed to a 22% lift in trial-to-paid conversion by designing 14 A/B tests with the growth team.", marks: ["A/B tests", "22%"] },
      { text: "Cut weekly reporting from 6 hours to 40 minutes by automating SQL pipelines into Looker.", marks: ["SQL", "6 hours to 40 minutes"] },
      { text: "Defined 30 shared KPIs adopted by 4 product squads for leadership reviews.", marks: ["KPIs", "leadership reviews"] },
    ],
    score: 87,
    check: { ok: false, text: "On-site 3 days a week in Austin" },
  },
  {
    company: "Harbourside Health",
    title: "Registered Nurse, ICU",
    place: "Sydney · Visa sponsorship",
    reqs: ["ICU", "Patient education", "AHPRA"],
    headline: "Registered Nurse | Critical Care | Patient Education",
    bullets: [
      { text: "Cared for 2 ventilated ICU patients per shift across a 24-bed unit with zero medication errors in 18 months.", marks: ["ICU", "zero medication errors"] },
      { text: "Wrote discharge guides used by 300+ families, cutting repeat questions to the ward by a third.", marks: ["discharge guides", "300+"] },
      { text: "Precepted 6 new graduate nurses through their first rotation.", marks: ["6 new graduate nurses"] },
    ],
    score: 84,
    check: { ok: false, text: "AHPRA registration needed before start" },
  },
  {
    company: "Maple Ledger",
    title: "Product Analyst, Payments",
    place: "Toronto · Work permit OK",
    reqs: ["Funnel analysis", "Python", "Payments"],
    headline: "Product Analyst | Payments | Funnel Analysis",
    bullets: [
      { text: "Found a 9% checkout drop-off in a funnel analysis of 1.2M sessions, fixed in the next release.", marks: ["funnel analysis", "1.2M sessions"] },
      { text: "Built a Python churn model that ranked 40,000 merchants for the retention team each week.", marks: ["Python", "40,000 merchants"] },
      { text: "Supported a payments launch in 3 markets with daily dashboards for operations.", marks: ["payments", "3 markets"] },
    ],
    score: 89,
    check: { ok: true, text: "Employer has hired on work permits before" },
  },
];

function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return <>{text}</>;
  const re = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[3px] bg-[#e6edff] px-0.5 text-[var(--deep)]">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function ScoreRing({ score, play }: { score: number; play: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(11,26,58,0.08)" strokeWidth="6" />
      <motion.circle
        cx="32" cy="32" r={r} fill="none" stroke="url(#ring)" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 32 32)"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: play ? c * (1 - score / 100) : c }}
        transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <defs>
        <linearGradient id="ring" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#2f5beb" />
          <stop offset="1" stopColor="#9b8cff" />
        </linearGradient>
      </defs>
      <text x="32" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0b1a3a">{score}</text>
    </svg>
  );
}

/** The glass prism: one white beam in, four spectral beams out. */
function Prism({ cycle }: { cycle: number }) {
  const reduce = useReducedMotion();
  const out = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)"];
  return (
    <svg viewBox="0 0 220 160" className="h-full w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="glassfill" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#dfe8ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f3e8ff" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="glassline" x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c7d4ff" />
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      {/* incoming beam */}
      <motion.line
        key={`in-${cycle}`}
        x1="0" y1="96" x2="92" y2="84" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" filter="url(#glow)"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.6 }}
      />
      <line x1="0" y1="96" x2="92" y2="84" stroke="#ffffff" strokeWidth="1.2" />
      {/* outgoing spectrum */}
      {out.map((col, i) => (
        <motion.line
          key={`out-${cycle}-${i}`}
          x1="132" y1={80 + i * 2} x2="220" y2={56 + i * 18} stroke={col} strokeWidth="2.4" strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.55 + i * 0.06 }}
        />
      ))}
      {/* the prism */}
      <path d="M112 22 L160 128 L64 128 Z" fill="url(#glassfill)" stroke="url(#glassline)" strokeWidth="1.5" />
      <path d="M112 22 L124 128" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="1" />
      <path d="M112 22 L160 128 L64 128 Z" fill="none" stroke="rgba(11,26,58,0.12)" strokeWidth="0.8" />
    </svg>
  );
}

function Studio() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [stage, setStage] = useState(reduce ? 3 : 0);
  const d = DEMOS[i];

  // One job every ~7.5 s: posting → light through the prism → resume writes → review scores it.
  useEffect(() => {
    if (reduce) return;
    const t = [setTimeout(() => setStage(1), 900), setTimeout(() => setStage(2), 1500), setTimeout(() => setStage(3), 3200), setTimeout(() => { setStage(0); setI((x) => (x + 1) % DEMOS.length); }, 7600)];
    return () => t.forEach(clearTimeout);
  }, [i, reduce]);

  // Depth: panes drift with the pointer like layered glass.
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 80, damping: 18 });
  const sy = useSpring(my, { stiffness: 80, damping: 18 });
  const near = { x: useTransform(sx, (v) => v * 14), y: useTransform(sy, (v) => v * 10) };
  const far = { x: useTransform(sx, (v) => v * -8), y: useTransform(sy, (v) => v * -6) };
  const onMove = (e: React.PointerEvent) => {
    if (reduce || !ref.current) return;
    const b = ref.current.getBoundingClientRect();
    mx.set((e.clientX - b.left) / b.width - 0.5);
    my.set((e.clientY - b.top) / b.height - 0.5);
  };

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={() => { mx.set(0); my.set(0); }} className="relative mx-auto w-full max-w-[580px] xl:h-[560px]">
      {/* light behind the glass */}
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10 opacity-70 blur-3xl [background:radial-gradient(40%_35%_at_70%_40%,#c9d8ff,transparent),radial-gradient(30%_30%_at_35%_75%,#f6d6f0,transparent),radial-gradient(25%_25%_at_80%_85%,#ffe2c4,transparent)]" />

      <div className="flex flex-col gap-3 xl:block">
        {/* the posting */}
        <motion.div style={far} className="glass relative z-10 rounded-2xl p-4 xl:absolute xl:left-0 xl:top-0 xl:w-[300px]">
          <AnimatePresence mode="wait">
            <motion.div key={d.company} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--deep)] text-sm font-bold text-white">{d.company[0]}</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{d.title}</p>
                  <p className="truncate text-xs text-[var(--deep-3)]">{d.company} · {d.place}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] font-medium text-[var(--deep-3)]">The job asks for</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {d.reqs.map((r) => (
                  <span key={r} className="rounded-full border border-[rgba(11,26,58,0.1)] bg-white/80 px-2.5 py-1 text-[11.5px] font-medium">{r}</span>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* the prism */}
        <div className="pointer-events-none relative z-0 mx-auto hidden h-[170px] w-[240px] xl:absolute xl:left-[6px] xl:top-[214px] xl:block">
          <Prism cycle={i} />
        </div>

        {/* the resume written for this job */}
        <motion.div style={near} className="relative z-20 rounded-2xl bg-white p-5 shadow-[0_40px_80px_-30px_rgba(11,26,58,0.45),0_0_0_1px_rgba(11,26,58,0.06)] xl:absolute xl:right-0 xl:top-[150px] xl:w-[380px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold tracking-tight">Priya Raman</p>
              <AnimatePresence mode="wait">
                <motion.p key={d.headline} initial={{ opacity: 0 }} animate={{ opacity: stage >= 2 ? 1 : 0.25 }} exit={{ opacity: 0 }} className="truncate text-[11.5px] text-[var(--deep-2)]">
                  {d.headline}
                </motion.p>
              </AnimatePresence>
            </div>
            <span className="shrink-0 rounded-full bg-[#eef2fe] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--blue)]">For {d.company.split(" ")[0]}</span>
          </div>
          <div className="mt-3 h-px bg-[rgba(11,26,58,0.08)]" />
          <ul className="mt-3 min-h-[168px] space-y-2.5 text-[12px] leading-[1.45] text-[var(--deep-2)]">
            {d.bullets.map((b, k) => (
              <motion.li
                key={`${d.company}-${k}`}
                className="flex gap-2"
                initial={reduce ? false : { opacity: 0, x: -6, filter: "blur(4px)" }}
                animate={stage >= 2 ? { opacity: 1, x: 0, filter: "blur(0px)" } : { opacity: 0, x: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.45, delay: reduce ? 0 : 0.35 * k }}
              >
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--deep)]" />
                <span><Marked text={b.text} marks={b.marks} /></span>
              </motion.li>
            ))}
          </ul>
          <motion.div
            className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[var(--verify)]"
            initial={false}
            animate={{ opacity: stage >= 3 ? 1 : 0 }}
          >
            <ShieldCheck size={13} /> Every line checked against your history. Nothing invented.
          </motion.div>
        </motion.div>

        {/* the hiring-manager review */}
        <motion.div style={near} className="glass prism-edge spin relative z-30 flex items-center gap-3 rounded-2xl px-4 py-3 xl:absolute xl:left-0 xl:top-[420px] xl:w-[196px]">
          <ScoreRing score={d.score} play={stage >= 3} />
          <div>
            <p className="text-[12.5px] font-semibold leading-tight">Hiring-manager review</p>
            <p className="text-[11px] text-[var(--deep-3)]">Read as the employer would</p>
          </div>
        </motion.div>

        {/* screening check */}
        <motion.div
          style={far}
          initial={false}
          animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 6 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="glass relative z-30 flex items-center gap-2 rounded-full px-3.5 py-2 text-[11.5px] font-medium xl:absolute xl:right-0 xl:top-[96px]"
        >
          {d.check.ok ? <Check size={14} className="text-[var(--verify)]" strokeWidth={2.6} /> : <TriangleAlert size={14} className="text-[#c26a12]" />}
          {d.check.ok ? d.check.text : `Check first: ${d.check.text}`}
        </motion.div>
      </div>
      <p className="mt-4 text-center text-[11px] text-[var(--deep-3)] xl:absolute xl:bottom-0 xl:left-0 xl:right-0 xl:mt-0">Illustrative example with a fictional candidate and employers.</p>
    </div>
  );
}

export function PrismHero() {
  const reduce = useReducedMotion();
  const enter = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <section className="relative overflow-hidden pb-20 pt-10 lg:pb-28 lg:pt-16">
      <div aria-hidden className="lp-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-[1200px] items-center gap-14 px-4 sm:px-6 xl:grid-cols-[1fr_1.08fr]">
        <div>
          <motion.p {...enter(0)} className="inline-flex items-center gap-2 rounded-full border border-[rgba(11,26,58,0.1)] bg-white/70 px-3 py-1.5 text-[13px] font-medium text-[var(--deep-2)]">
            <span className="live-dot h-2 w-2 rounded-full bg-[var(--verify)]" /> Free while in early access
          </motion.p>
          <motion.h1 {...enter(0.06)} className="display mt-6 text-[44px] font-[680] leading-[1.0] sm:text-[62px] lg:text-[72px]">
            A resume for every job. Every word still true.
          </motion.h1>
          <motion.p {...enter(0.14)} className="mt-6 max-w-[34rem] text-[17.5px] leading-[1.6] text-[var(--deep-2)]">
            Vantage reads the posting and the employer, writes your resume and cover letter for that one job, and checks every line against your real history the way a hiring manager would. Then it fills the company&apos;s form. You press Submit.
          </motion.p>
          <motion.div {...enter(0.22)} className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="lp-btn lp-btn-primary">Join early access</Link>
            <FilmButton />
          </motion.div>
          <motion.ul {...enter(0.3)} className="mt-9 grid max-w-[34rem] gap-2.5 text-[14.5px] text-[var(--deep-2)] sm:grid-cols-3">
            {["Never invents a number", "Never types your passwords", "You decide when it's sent"].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-[var(--verify)]" strokeWidth={2.6} /> {t}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div initial={reduce ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}>
          <Hero3D fallback={<Studio />} />
        </motion.div>
      </div>
    </section>
  );
}

/** The 40-second product film, in a modal. */
function FilmButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const open = () => {
    ref.current?.showModal();
    video.current?.play().catch(() => {});
  };
  const close = () => {
    video.current?.pause();
    ref.current?.close();
  };
  return (
    <>
      <button type="button" onClick={open} className="lp-btn lp-btn-glass">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--deep)] text-white"><Play size={11} fill="currentColor" /></span>
        Watch the 40-second film
      </button>
      <dialog
        ref={ref}
        onClose={() => video.current?.pause()}
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-[min(1100px,94vw)] overflow-visible bg-transparent p-0 backdrop:bg-[rgba(11,26,58,0.55)] backdrop:backdrop-blur-sm"
        aria-label="Vantage product film"
      >
        <div className="relative overflow-hidden rounded-[22px] bg-white shadow-[0_40px_120px_-20px_rgba(11,26,58,0.6)]">
          <video ref={video} src="/vantage-film.mp4" poster="/vantage-film-poster.jpg" controls playsInline preload="none" className="block aspect-video w-full" />
        </div>
        <button type="button" onClick={close} aria-label="Close the film" className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[var(--deep)] shadow-lg">
          <X size={18} />
        </button>
      </dialog>
    </>
  );
}
