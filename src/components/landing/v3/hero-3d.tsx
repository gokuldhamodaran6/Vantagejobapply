"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Hand, MousePointerClick, ShieldCheck } from "lucide-react";
import { CARDS, type HeroDemo } from "./cards";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

/** Fictional candidate and employers, for illustration only. */
const DEMOS: (HeroDemo & { bullets: string[]; letter: string; questions: string[] })[] = [
  {
    company: "Northwind Analytics", title: "Senior Data Analyst", place: "Austin, TX · Hybrid", reqs: ["SQL", "Experimentation", "Stakeholder reporting"],
    headline: "Data Analyst | SQL · Python | Experimentation", score: 87, fields: 17,
    bullet: "Contributed to a 22% lift in trial-to-paid conversion by designing 14 A/B tests with the growth team.",
    bullets: ["Contributed to a 22% lift in trial-to-paid conversion by designing 14 A/B tests with the growth team.", "Cut weekly reporting from 6 hours to 40 minutes by automating SQL pipelines into Looker.", "Defined 30 shared KPIs adopted by 4 product squads for leadership reviews."],
    letter: "Northwind's growth team runs on experiments, and that is the work I know best: 14 A/B tests behind a 22% lift in trial-to-paid, and the SQL pipelines that turned a 6-hour weekly report into 40 minutes.",
    questions: ["Walk me through one experiment that changed a decision.", "How would you set up reporting for a team that has none?", "Tell me about a time the data said something leadership didn't want to hear."],
  },
  {
    company: "Harbourside Health", title: "Registered Nurse, ICU", place: "Sydney · Visa sponsorship", reqs: ["ICU", "Patient education", "AHPRA"],
    headline: "Registered Nurse | Critical Care | Patient Education", score: 84, fields: 22,
    bullet: "Cared for 2 ventilated ICU patients per shift across a 24-bed unit with zero medication errors in 18 months.",
    bullets: ["Cared for 2 ventilated ICU patients per shift across a 24-bed unit with zero medication errors in 18 months.", "Wrote discharge guides used by 300+ families, cutting repeat questions to the ward by a third.", "Precepted 6 new graduate nurses through their first rotation."],
    letter: "Harbourside's ICU asks for calm hands and clear teaching. For 18 months I've cared for ventilated patients without a medication error, and my discharge guides are used by 300+ families.",
    questions: ["Describe your handover on a night with two unstable patients.", "How do you teach a family something frightening?", "What will you need before AHPRA registration is final?"],
  },
  {
    company: "Maple Ledger", title: "Product Analyst, Payments", place: "Toronto · Work permit OK", reqs: ["Funnel analysis", "Python", "Payments"],
    headline: "Product Analyst | Payments | Funnel Analysis", score: 89, fields: 15,
    bullet: "Found a 9% checkout drop-off in a funnel analysis of 1.2M sessions, fixed in the next release.",
    bullets: ["Found a 9% checkout drop-off in a funnel analysis of 1.2M sessions, fixed in the next release.", "Built a Python churn model that ranked 40,000 merchants for the retention team each week.", "Supported a payments launch in 3 markets with daily dashboards for operations."],
    letter: "Payments analytics is where small numbers matter: a 9% checkout drop-off I found in 1.2M sessions was fixed in the next release, and my churn model ranks 40,000 merchants every week.",
    questions: ["How did you find the 9% drop-off, step by step?", "How would you know the churn model is wrong?", "Which payments metric would you watch first here?"],
  },
];

const subscribe = () => () => {};
function canWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function Hero3D({ fallback }: { fallback: React.ReactNode }) {
  const reduce = useReducedMotion();
  // Decided on the client only: no WebGL (or reduced motion) keeps the flat illustrated version.
  const gl = useSyncExternalStore(subscribe, canWebGL, () => false);
  const compact = useSyncExternalStore(subscribe, () => window.innerWidth < 640, () => false);
  // Phones and small touch tablets get the swipe layout: a scene that never takes touches, readable cards below.
  const mobile = useSyncExternalStore(subscribe, () => window.innerWidth < 768 || (matchMedia("(pointer: coarse)").matches && window.innerWidth < 1024), () => false);
  const [lost, setLost] = useState(false);
  const [active, setActive] = useState(0);
  const low = useSyncExternalStore(subscribe, () => (navigator.hardwareConcurrency || 4) <= 4 || window.innerWidth < 640, () => true);
  const [i, setI] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  // A new job every 8 s while nobody is exploring a card.
  useEffect(() => {
    if (focus !== null || hovered !== null) return;
    const t = setTimeout(() => {
      setI((x) => (x + 1) % DEMOS.length);
      setTick((x) => x + 1);
    }, 8000);
    return () => clearTimeout(t);
  }, [i, focus, hovered]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setFocus(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (!gl || reduce || lost) return <>{fallback}</>;
  const d = DEMOS[i];

  if (mobile)
    return (
      <div className="relative w-full">
        <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 opacity-70 blur-3xl [background:radial-gradient(45%_35%_at_60%_30%,#c9d8ff,transparent),radial-gradient(35%_30%_at_30%_60%,#f6d6f0,transparent)]" />
        <div className="relative h-[250px]" aria-hidden>
          <HeroScene demo={d} demoKey={tick} focus={null} setFocus={() => {}} hovered={active} setHovered={() => {}} compact low mobile onLost={() => setLost(true)} />
          <div key={tick} className="v3-posting absolute left-0 top-1 max-w-[62%] rounded-2xl px-3 py-2">
            <p className="truncate text-[12px] font-semibold">{d.title}</p>
            <p className="truncate text-[11px] text-[var(--deep-3)]">{d.company} · {d.place}</p>
          </div>
        </div>
        <MobileCards d={d} active={active} setActive={setActive} />
        <p className="mt-1 text-center text-[11px] text-[var(--deep-3)]">Swipe the cards · fictional candidate and employers</p>
      </div>
    );

  return (
    <div className="relative mx-auto w-full max-w-[640px]">
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10 opacity-70 blur-3xl [background:radial-gradient(40%_35%_at_70%_40%,#c9d8ff,transparent),radial-gradient(30%_30%_at_35%_75%,#f6d6f0,transparent),radial-gradient(25%_25%_at_80%_85%,#ffe2c4,transparent)]" />
      <div className="relative h-[480px] sm:h-[600px]" aria-label="Interactive 3D example: one job posting becomes a resume, a cover letter, a filled application and an interview kit">
        <HeroScene demo={d} demoKey={tick} focus={focus} setFocus={setFocus} hovered={hovered} setHovered={setHovered} compact={compact} low={low} onLost={() => setLost(true)} />

        <AnimatePresence>
          {focus !== null && (
            <motion.div
              key={focus}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="glass absolute bottom-3 left-3 z-30 w-[min(340px,calc(100%-24px))] rounded-[20px] p-4"
              role="dialog"
              aria-label={`${CARDS[focus].label} for ${d.company}`}
            >
              <button type="button" onClick={() => setFocus(null)} className="mb-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--blue)]"><ArrowLeft size={13} /> Back to the whole scene</button>
              <p className="text-[15px] font-bold" style={{ color: CARDS[focus].color }}>{CARDS[focus].label} · {d.company}</p>
              <Detail k={focus} d={d} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {CARDS.map((c, k) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={focus === k}
            onClick={() => setFocus(focus === k ? null : k)}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(k)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(null)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-semibold transition ${focus === k ? "border-transparent bg-[var(--deep)] text-white" : "border-[rgba(11,26,58,0.12)] bg-white/80 text-[var(--deep-2)] hover:bg-white"}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> {c.label}
          </button>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--deep-3)]">
        <span className="inline-flex items-center gap-1.5"><Hand size={13} /> Drag to turn the scene</span>
        <span className="inline-flex items-center gap-1.5"><MousePointerClick size={13} /> Click a card to open it</span>
        <span>Fictional candidate and employers.</span>
      </p>
    </div>
  );
}

type Demo = (typeof DEMOS)[number];

/** What each output looks like for this job: used in the desktop panel and the phone cards. */
function Detail({ k, d }: { k: number; d: Demo }) {
  return (
    <>
              {k === 0 && (
        <>
          <p className="mt-1 text-[12px] font-semibold text-[var(--deep-2)]">{d.headline}</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-[var(--deep-2)]">{d.bullets.map((b) => <li key={b} className="flex gap-1.5"><span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--deep)]" />{b}</li>)}</ul>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--verify)]"><ShieldCheck size={13} /> Hiring-manager review {d.score}. Every line checked against your history.</p>
        </>
      )}
      {k === 1 && <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--deep-2)]">{d.letter}</p>}
      {k === 2 && (
        <ul className="mt-2 space-y-1.5 text-[12px] text-[var(--deep-2)]">
          <li>✓ Contact, work history and education filled from your profile</li>
          <li>✓ Resume and cover letter for this job attached</li>
          <li>✓ Screening answers given the same way every time</li>
          <li className="font-semibold text-[var(--deep)]">You check every page and press Submit yourself.</li>
        </ul>
      )}
      {k === 3 && (
        <>
          <p className="mt-1 text-[12px] text-[var(--deep-3)]">Likely questions, each matched to a story from your resume:</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-[var(--deep-2)]">{d.questions.map((q) => <li key={q}>“{q}”</li>)}</ul>
        </>
      )}
    </>
  );
}

/** Phones: swipe through the four outputs; the one in view lights its beam in the scene above. */
function MobileCards({ d, active, setActive }: { d: Demo; active: number; setActive: (i: number) => void }) {
  const row = useRef<HTMLDivElement>(null);
  // Set while the person is swiping; auto-advance waits until 9 s after their last touch.
  const touched = useRef(false);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = () => {
    touched.current = true;
    if (quiet.current) clearTimeout(quiet.current);
    quiet.current = setTimeout(() => (touched.current = false), 9000);
  };
  // Which card is centred.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const on = () => {
      const w = el.scrollWidth / CARDS.length;
      setActive(Math.max(0, Math.min(CARDS.length - 1, Math.round(el.scrollLeft / w))));
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [setActive]);
  // Gentle auto-advance until the person swipes.
  useEffect(() => {
    const t = setInterval(() => {
      const el = row.current;
      if (!el || touched.current) return;
      const next = (active + 1) % CARDS.length;
      el.scrollTo({ left: (el.scrollWidth / CARDS.length) * next, behavior: "smooth" });
    }, 4500);
    return () => clearInterval(t);
  }, [active]);
  function go(i: number) {
    hold();
    const el = row.current;
    if (el) el.scrollTo({ left: (el.scrollWidth / CARDS.length) * i, behavior: "smooth" });
  }

  return (
    <div>
      <div
        ref={row}
        onTouchStart={hold}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="What Vantage makes for this job"
      >
        {CARDS.map((c, k) => (
          <article key={c.key} className="glass w-[84%] shrink-0 snap-center rounded-[20px] p-4" aria-roledescription="slide" aria-label={`${c.label}, ${k + 1} of ${CARDS.length}`}>
            <p className="flex items-center gap-2 text-[15px] font-bold" style={{ color: c.color }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 12px ${c.color}` }} /> {c.label}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--deep-3)]">For {d.title} · {d.company}</p>
            <Detail k={k} d={d} />
          </article>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-1.5">
        {CARDS.map((c, k) => (
          <button key={c.key} type="button" onClick={() => go(k)} aria-label={`Show ${c.label}`} aria-current={active === k} className="flex h-8 w-8 items-center justify-center">
            <span className="block h-2 rounded-full transition-all" style={{ width: active === k ? 22 : 8, background: active === k ? c.color : "rgba(11,26,58,0.18)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
