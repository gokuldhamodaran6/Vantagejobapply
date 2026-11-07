"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowRight, Check, LockKeyhole, Play, ShieldCheck, X } from "lucide-react";

/**
 * The first screen: what Vantage does in one line, proof in a 20-second product demo, and the three promises that
 * earn trust. No scroll tricks: the page scrolls like any page, on any device. The demo sits in a browser frame tilted
 * in 3D on large screens (it follows the pointer, a little) and lies flat on phones, where tilt only costs space.
 */
export function Hero() {
  const [open, setOpen] = useState(false);
  return (
    <section className="relative isolate overflow-hidden pb-20 pt-8 sm:pt-12 lg:pb-28 lg:pt-16">
      <Backdrop />
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
        <div className="min-w-0">
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="inline-flex items-center gap-2 rounded-full border border-[rgba(11,26,58,0.08)] bg-white/80 py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium text-[var(--deep-2)] shadow-[0_1px_2px_rgba(11,26,58,0.05)]">
            <span className="rounded-full bg-[var(--deep)] px-2 py-0.5 text-[11.5px] font-semibold text-white">Free</span>
            Early access is open
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }} className="display mt-5 text-[clamp(40px,6.4vw,68px)] font-[680] leading-[1.02] text-[var(--deep)]">
            A resume for every job. <span className="bg-gradient-to-r from-[#2f5beb] via-[#6a4cf0] to-[#c04ba0] bg-clip-text text-transparent">Every word still true.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }} className="mt-5 max-w-[34rem] text-[17.5px] leading-relaxed text-[var(--deep-2)]">
            Vantage finds jobs that can actually hire you, writes a resume and cover letter for each one from your real history, and fills the company&apos;s own application. You review it and press Submit.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }} className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Join early access, free <ArrowRight size={17} />
            </Link>
            <button type="button" onClick={() => setOpen(true)} className="lp-btn lp-btn-glass">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--blue)] text-white"><Play size={11} fill="currentColor" /></span>
              Watch the demo · 20s
            </button>
          </motion.div>
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }} className="mt-9 grid gap-3 text-[14.5px] text-[var(--deep-2)] sm:grid-cols-3 sm:gap-4">
            {[
              { icon: Check, text: "Every line from your real history" },
              { icon: LockKeyhole, text: "Never sees your passwords" },
              { icon: ShieldCheck, text: "Nothing sent until you say so" },
            ].map((t) => (
              <li key={t.text} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e7f6ee] text-[var(--verify)]"><t.icon size={12} strokeWidth={2.6} /></span>
                <span className="leading-snug">{t.text}</span>
              </li>
            ))}
          </motion.ul>
        </div>
        <DemoFrame onExpand={() => setOpen(true)} />
      </div>
      {open && <DemoDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_75%_20%,rgba(124,151,255,0.28),transparent_70%),radial-gradient(40%_40%_at_10%_10%,rgba(245,163,224,0.18),transparent_70%),radial-gradient(50%_40%_at_60%_100%,rgba(124,199,255,0.18),transparent_70%)]" />
      <div className="lp-grid absolute inset-0" />
    </div>
  );
}

/** The product demo in a browser frame: tilted in 3D on large screens, flat on phones. */
function DemoFrame({ onExpand }: { onExpand: () => void }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const rotY = useTransform(sx, [-1, 1], [-15, -5]);
  const rotX = useTransform(sy, [-1, 1], [9, 3]);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(min-width: 1024px) and (pointer: fine)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Play only while on screen (saves battery and data); never autoplay for people who asked for less motion.
  useEffect(() => {
    const v = video.current;
    if (!v || reduce) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduce]);

  const tilt = wide && !reduce;
  return (
    <div
      ref={box}
      className="relative min-w-0 [perspective:1800px]"
      onPointerMove={(e) => {
        if (!tilt || e.pointerType !== "mouse" || !box.current) return;
        const r = box.current.getBoundingClientRect();
        px.set(((e.clientX - r.left) / r.width) * 2 - 1);
        py.set(((e.clientY - r.top) / r.height) * 2 - 1);
      }}
      onPointerLeave={() => { px.set(0); py.set(0); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.2, 0.7, 0.2, 1] }}
        style={tilt ? { rotateY: rotY, rotateX: rotX, transformStyle: "preserve-3d" } : undefined}
        className="relative"
      >
        <div className="overflow-hidden rounded-[18px] border border-[rgba(11,26,58,0.1)] bg-white shadow-[0_2px_4px_rgba(11,26,58,0.06),0_40px_80px_-30px_rgba(11,26,58,0.45),0_0_0_6px_rgba(255,255,255,0.6)]">
          <div className="flex h-9 items-center gap-1.5 border-b border-[rgba(11,26,58,0.07)] bg-[#f8f9fc] px-3.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="mx-auto hidden h-5 w-[46%] items-center justify-center rounded-md bg-white text-[11px] text-[var(--deep-3)] ring-1 ring-[rgba(11,26,58,0.07)] sm:flex">vantagejobapply.com</span>
          </div>
          <button type="button" onClick={onExpand} className="group relative block w-full" aria-label="Play the product demo larger">
            <video
              ref={video}
              className="block aspect-[16/10] w-full bg-[#f5f7fb]"
              muted
              loop
              playsInline
              preload="metadata"
              poster="/landing/demo-poster.jpg"
              aria-hidden
            >
              <source src="/landing/demo.webm" type="video/webm" />
              <source src="/landing/demo.mp4" type="video/mp4" />
            </video>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--deep)]/85 px-3 py-1.5 text-[12px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Play size={11} fill="currentColor" /> Watch larger
            </span>
          </button>
        </div>
        {/* Proof chips float just off the frame on large screens. */}
        <Chip className="-left-8 top-[18%]" delay={0.6} reduce={reduce}>
          <span className="text-[var(--verify)]">94% fit</span> · Sponsors visas
        </Chip>
        <Chip className="-right-6 top-[46%]" delay={0.8} reduce={reduce}>
          Recruiter check <b className="ml-1 text-[var(--deep)]">9.1</b>
        </Chip>
        <Chip className="-left-4 bottom-[10%]" delay={1} reduce={reduce}>
          <LockKeyhole size={13} className="text-[var(--blue)]" /> Password never seen
        </Chip>
      </motion.div>
    </div>
  );
}

function Chip({ className, delay, reduce, children }: { className: string; delay: number; reduce: boolean | null; children: React.ReactNode }) {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -6, 0] }}
      transition={reduce ? { delay } : { opacity: { delay, duration: 0.5 }, y: { delay, duration: 6, repeat: Infinity, ease: "easeInOut" } }}
      className={`absolute hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-white bg-white/90 px-3.5 py-2 text-[13px] font-medium text-[var(--deep-2)] shadow-[0_18px_40px_-18px_rgba(11,26,58,0.45)] backdrop-blur [transform:translateZ(60px)] lg:inline-flex ${className}`}
    >
      {children}
    </motion.span>
  );
}

function DemoDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const off = () => onClose();
    d?.addEventListener("close", off);
    return () => d?.removeEventListener("close", off);
  }, [onClose]);
  return (
    <dialog ref={ref} className="m-auto w-[min(1100px,94vw)] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-[rgba(11,26,58,0.6)] backdrop:backdrop-blur-sm" aria-label="Vantage product demo" onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="flex items-center justify-between border-b border-[rgba(11,26,58,0.08)] px-4 py-2.5">
        <p className="text-[14px] font-semibold text-[var(--deep)]">How Vantage applies for you, in 20 seconds</p>
        <button type="button" onClick={() => ref.current?.close()} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f1f3f8]" aria-label="Close the demo"><X size={18} /></button>
      </div>
      <video className="block aspect-[16/10] w-full bg-[#f5f7fb]" autoPlay muted loop playsInline controls poster="/landing/demo-poster.jpg">
        <source src="/landing/demo.webm" type="video/webm" />
        <source src="/landing/demo.mp4" type="video/mp4" />
      </video>
      <p className="px-4 py-3 text-[13px] text-[var(--deep-3)]">Sample candidate shown. 1 · Find jobs that can hire you · 2 · A resume written for this job · 3 · A cover letter checked line by line · 4 · The company&apos;s own form, filled · 5 · You press Submit.</p>
    </dialog>
  );
}
