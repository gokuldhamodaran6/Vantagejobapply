"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogoMark } from "@/components/brand";
import { STEP_TITLES, VISUALS } from "@/components/landing/v2/story";

/** 40-second product film: title, the five steps, end card. Plays in real time for recording at 1280×720. */
const SCENES = [
  { id: "open", ms: 4500 },
  ...VISUALS.map((_, i) => ({ id: `s${i}`, ms: 6200 })),
  { id: "end", ms: 5500 },
];

export function Film() {
  const [k, setK] = useState(-1);
  useEffect(() => {
    const start = setTimeout(() => setK(0), 400);
    return () => clearTimeout(start);
  }, []);
  useEffect(() => {
    if (k < 0 || k >= SCENES.length - 1) return;
    const t = setTimeout(() => setK((x) => x + 1), SCENES[k].ms);
    return () => clearTimeout(t);
  }, [k]);
  const scene = SCENES[Math.max(0, k)];
  const step = scene.id.startsWith("s") ? Number(scene.id.slice(1)) : -1;
  const V = step >= 0 ? VISUALS[step] : null;

  return (
    <div className="lp fixed inset-0 overflow-hidden" data-scene={scene.id}>
      <div aria-hidden className="lp-grid absolute inset-0" />
      <div aria-hidden className="absolute -right-40 -top-40 h-[620px] w-[620px] opacity-60 blur-3xl [background:radial-gradient(closest-side,#cfdcff,transparent)]" />
      <div aria-hidden className="absolute -bottom-48 -left-32 h-[560px] w-[560px] opacity-50 blur-3xl [background:radial-gradient(closest-side,#f4d9f0,transparent)]" />
      <div className="absolute left-10 top-8 flex items-center gap-2.5">
        <LogoMark size={28} />
        <span className="text-[18px] font-bold tracking-tight">Vantage</span>
      </div>
      <AnimatePresence mode="wait">
        {k >= 0 && scene.id === "open" && (
          <motion.div key="open" className="absolute inset-0 flex flex-col items-center justify-center px-20 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.6 }}>
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-[22px] font-medium text-[var(--deep-2)]">One job posting. One resume written for it.</motion.p>
            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7 }} className="display mt-4 max-w-[900px] text-[84px] font-[680] leading-[1.0]">
              Every word still true.
            </motion.h1>
          </motion.div>
        )}
        {V && (
          <motion.div key={scene.id} className="absolute inset-0 grid grid-cols-[0.72fr_1.28fr] items-center gap-10 px-14 pt-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
            <div>
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="display text-[28px] font-[700] text-[var(--blue)]">{step + 1}</motion.p>
              <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="display mt-2 text-[46px] font-[680] leading-[1.04]">
                {STEP_TITLES[step]}
              </motion.h2>
              <div className="mt-8 flex gap-1.5">
                {VISUALS.map((_, i) => (
                  <span key={i} className={`h-1.5 w-10 rounded-full ${i <= step ? "bg-[var(--blue)]" : "bg-[rgba(11,26,58,0.12)]"}`} />
                ))}
              </div>
            </div>
            <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, delay: 0.15 }} className="glass prism-edge rounded-[28px] p-6" style={{ zoom: 1.28 }}>
              <V />
            </motion.div>
          </motion.div>
        )}
        {scene.id === "end" && (
          <motion.div key="end" className="absolute inset-0 flex flex-col items-center justify-center px-20 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <h2 className="display max-w-[980px] text-[72px] font-[680] leading-[1.02]">A resume for every job. Every word still true.</h2>
            <p className="mt-6 text-[22px] text-[var(--deep-2)]">Free during early access</p>
            <p className="mt-8 rounded-full bg-[var(--deep)] px-7 py-3.5 text-[20px] font-semibold text-white">vantagejobapply.onrender.com</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
