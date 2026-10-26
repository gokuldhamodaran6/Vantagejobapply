"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ShieldCheck, X } from "lucide-react";

type DemoJob = {
  title: string;
  company: string;
  place: string;
  cc: string;
  ok: boolean;
  why: string;
};

// Illustrative demo data — fictional employers.
const STREAM: DemoJob[] = [
  { title: "Backend Engineer", company: "Northwind Analytics", place: "London", cc: "UK", ok: true, why: "Licensed visa sponsor" },
  { title: "Data Analyst", company: "Crescent Systems", place: "Arlington, VA", cc: "US", ok: false, why: "US citizens only" },
  { title: "Registered Nurse", company: "Harbourside Health", place: "Sydney", cc: "AU", ok: true, why: "Offers employer sponsorship" },
  { title: "Software Developer", company: "Maple Ledger", place: "Toronto", cc: "CA", ok: true, why: "Positive LMIA history" },
  { title: "Product Analyst", company: "Kestrel Pay", place: "Manchester", cc: "UK", ok: false, why: "Not a licensed sponsor" },
  { title: "Analytics Engineer", company: "Halcyon Pay", place: "Remote, US", cc: "US", ok: true, why: "Sponsors H-1B" },
  { title: "Mechanical Engineer", company: "Ironbridge", place: "Calgary", cc: "CA", ok: true, why: "Open to work permits" },
  { title: "UX Designer", company: "Orbital Retail", place: "Austin, TX", cc: "US", ok: false, why: "Won't sponsor now or later" },
];

function Ticker() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<(DemoJob & { key: number })[]>(() => STREAM.slice(0, 4).map((j, i) => ({ ...j, key: i })));
  const idx = useRef(4);
  const [kept, setKept] = useState(1284);
  const [skipped, setSkipped] = useState(3911);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      const next = STREAM[idx.current % STREAM.length];
      const key = idx.current;
      idx.current += 1;
      setItems((prev) => [{ ...next, key }, ...prev].slice(0, 4));
      if (next.ok) setKept((k) => k + 1);
      else setSkipped((s) => s + 1);
    }, 2200);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <div className="relative">
      <div className="card overflow-hidden shadow-[0_24px_60px_-20px_rgba(16,24,40,0.25)]">
        <div className="flex items-center gap-2 border-b border-line bg-canvas/70 px-4 py-3">
          <span className="live-dot h-2 w-2 rounded-full bg-green" />
          <span className="text-sm font-semibold">Live job feed</span>
          <span className="ml-auto text-xs text-muted">Profile: F-1 student, needs sponsorship</span>
        </div>
        <ul className="relative h-[332px] overflow-hidden p-3" aria-live="off">
          <AnimatePresence initial={false}>
            {items.map((j) => (
              <motion.li
                key={j.key}
                layout
                initial={{ opacity: 0, y: -28, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-2.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-xs font-bold text-brand-ink">
                  {j.cc}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${j.ok ? "text-ink" : "text-subtle line-through decoration-1"}`}>{j.title}</p>
                  <p className="truncate text-xs text-muted">
                    {j.company}, {j.place}
                  </p>
                </div>
                {j.ok ? (
                  <span className="pill bg-green-tint text-green-ink"><Check size={12} strokeWidth={3} /> {j.why}</span>
                ) : (
                  <span className="pill bg-red-tint text-red-ink"><X size={12} strokeWidth={3} /> {j.why}</span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
        </ul>
        <div className="grid grid-cols-2 border-t border-line text-center">
          <div className="px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-ink">{kept.toLocaleString()}</p>
            <p className="text-xs text-muted">jobs you can apply to</p>
          </div>
          <div className="border-l border-line px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-subtle">{skipped.toLocaleString()}</p>
            <p className="text-xs text-muted">filtered out for you</p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-subtle">Illustrative demo. Real jobs come from employers' official careers sites.</p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(#e6e8ef_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-2"
          >
            <ShieldCheck size={15} className="text-brand" />
            Free during early access · Visa rules built in for the US, UK, Canada and Australia
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-[40px] font-bold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[56px]"
          >
            Find jobs abroad that can actually hire you.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted"
          >
            Tell Vantage your visa situation once. It pulls live jobs from employers' official careers sites, removes the ones that
            can&apos;t legally hire you, writes an ATS-ready resume for each role you target, and tracks every application.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link href="/signup" className="btn-primary min-h-12 px-6 text-[15px]">Join early access — it&apos;s free</Link>
            <a href="#how" className="btn-secondary min-h-12 px-6 text-[15px]">See how it works</a>
          </motion.div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            {["Free during early access", "No credit card", "Honest answers on every form"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check size={16} className="text-green" strokeWidth={2.5} /> {t}
              </li>
            ))}
          </ul>
        </div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}>
          <Ticker />
        </motion.div>
      </div>
    </section>
  );
}
