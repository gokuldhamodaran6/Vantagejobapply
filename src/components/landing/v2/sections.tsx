"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BellRing, CalendarCheck, Check, Flame, Ghost, Globe2, Inbox, Menu, Puzzle, X } from "lucide-react";
import { Logo } from "@/components/brand";

/* ---------- nav ---------- */

const LINKS = [
  { href: "#story", label: "How it works" },
  { href: "#true", label: "Kept true" },
  { href: "#countries", label: "Countries" },
  { href: "#faq", label: "FAQ" },
];

export function GlassNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className="sticky top-0 z-50 px-3 pt-3">
      <nav aria-label="Main" className={`mx-auto flex h-14 max-w-[1200px] items-center gap-4 rounded-full px-4 transition-all sm:px-5 ${scrolled ? "glass" : "bg-transparent"}`}>
        <Logo />
        <ul className="ml-4 hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="rounded-full px-3.5 py-2 text-[14px] font-medium text-[var(--deep-2)] hover:bg-white/70 hover:text-[var(--deep)]">{l.label}</a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-1.5 sm:flex">
          <Link href="/login" className="rounded-full px-4 py-2 text-[14px] font-medium text-[var(--deep-2)] hover:bg-white/70">Log in</Link>
          <Link href="/signup" className="lp-btn lp-btn-primary min-h-10 px-5 text-[14px]">Join early access</Link>
        </div>
        <button type="button" className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 sm:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </nav>
      {open && (
        <div className="glass mx-auto mt-2 max-w-[1200px] rounded-3xl p-3 sm:hidden">
          <ul>
            {LINKS.map((l) => (
              <li key={l.href}><a href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-[15px] font-medium">{l.label}</a></li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/login" className="lp-btn lp-btn-glass">Log in</Link>
            <Link href="/signup" className="lp-btn lp-btn-primary">Join free</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------- kept true ---------- */

const ROWS = [
  { what: "Your title", typical: "Account Executive (the job you're applying for)", ours: "The titles you actually held, word for word" },
  { what: "Your results", typical: "“Drove 35% pipeline growth”", ours: "“Contributed to a 35% increase in qualified pipeline”" },
  { what: "Skills", typical: "Copied from the posting, used or not", ours: "Only tools in your history; gaps shown to you" },
  { what: "Numbers", typical: "Invented to look impressive", ours: "Only numbers you gave. Missing ones become questions for you" },
  { what: "Your passwords", typical: "Stored and typed for you", ours: "Never seen, never typed" },
  { what: "Submitting", typical: "Sent automatically", ours: "Sent when you say so" },
];

export function KeptTrue() {
  const reduce = useReducedMotion();
  return (
    <section id="true" className="py-24 lg:py-32">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <h2 className="display text-[36px] font-[680] leading-[1.04] sm:text-[52px]">Polished is easy. True is the hard part.</h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[var(--deep-2)]">
              Recruiters ask about every line in the interview. Vantage writes the strongest version of your story that you can defend, and checks each one before it leaves your hands.
            </p>
          </div>
          <div className="glass overflow-hidden rounded-[28px]">
            <div className="hidden grid-cols-[0.7fr_1fr_1fr] gap-x-4 border-b border-[rgba(11,26,58,0.08)] px-5 py-3.5 text-[12.5px] font-semibold text-[var(--deep-3)] sm:grid sm:px-6">
              <span />
              <span>A typical AI writer</span>
              <span className="text-[var(--deep)]">Vantage</span>
            </div>
            <ul>
              {ROWS.map((r, i) => (
                <motion.li
                  key={r.what}
                  initial={reduce ? false : { opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ delay: i * 0.08 }}
                  className="grid gap-y-1.5 border-b border-[rgba(11,26,58,0.06)] px-5 py-4 text-[15px] last:border-0 sm:grid-cols-[0.7fr_1fr_1fr] sm:items-start sm:gap-x-4 sm:px-6 sm:text-[14.5px]"
                >
                  <span className="font-semibold">{r.what}</span>
                  <span className="flex items-start gap-1.5 text-[var(--deep-3)]"><X size={15} className="mt-1 shrink-0 text-[#d9534f]" /><span><span className="font-medium sm:hidden">Typical AI writer: </span>{r.typical}</span></span>
                  <span className="flex items-start gap-1.5 text-[var(--deep)]"><Check size={15} strokeWidth={2.6} className="mt-1 shrink-0 text-[var(--verify)]" /><span><span className="font-medium sm:hidden">Vantage: </span>{r.ours}</span></span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- everything around the application ---------- */

const KIT = [
  { icon: Puzzle, title: "Fills real application forms", body: "Workday, Greenhouse, Lever, Ashby, iCIMS and most careers sites, page by page, with the files written for that job." },
  { icon: Globe2, title: "Jobs that can hire you", body: "Visa rules for the US, UK, Canada and Australia applied to every posting, so roles that can't sponsor you never show up." },
  { icon: Ghost, title: "Ghost jobs flagged", body: "Postings open for months, reposted again and again, or silent for every applicant are marked before you apply." },
  { icon: Inbox, title: "Applications from any site", body: "Applied on LinkedIn or a company site? The confirmation email adds it to your board on its own." },
  { icon: CalendarCheck, title: "Interviews on your calendar", body: "Invites become calendar events with the job, the resume you sent and the people you'll meet." },
  { icon: BellRing, title: "Follow-ups that go out on time", body: "Quiet for ten days? A short, polite follow-up is drafted for you to send." },
  { icon: Flame, title: "A daily streak", body: "Small, steady progress: a few strong applications a day beats a hundred rushed ones." },
];

export function Kit() {
  return (
    <section className="border-t border-[rgba(11,26,58,0.06)] py-24 lg:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <h2 className="display max-w-3xl text-[34px] font-[680] leading-[1.06] sm:text-[46px]">Everything around the application, handled.</h2>
        <ul className="mt-12 grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {KIT.map((k) => (
            <li key={k.title} className="flex gap-4">
              <span className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[var(--blue)]"><k.icon size={19} /></span>
              <span>
                <span className="block text-[16.5px] font-semibold tracking-tight">{k.title}</span>
                <span className="mt-1 block text-[14.5px] leading-relaxed text-[var(--deep-2)]">{k.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- final call ---------- */

export function FinalCall() {
  return (
    <section id="final-call" className="px-3 pb-6">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[36px] bg-[var(--deep)] px-6 py-20 text-white sm:px-12 lg:py-28">
        <svg aria-hidden viewBox="0 0 600 420" className="pointer-events-none absolute right-0 top-1/2 hidden h-[78%] -translate-y-1/2 lg:block" preserveAspectRatio="xMaxYMid meet">
          <defs>
            <linearGradient id="cta-glass" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="1" stopColor="#9b8cff" stopOpacity="0.08" />
            </linearGradient>
            <filter id="cta-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          <line x1="120" y1="235" x2="250" y2="215" stroke="#fff" strokeWidth="5" opacity="0.5" filter="url(#cta-glow)" />
          <line x1="120" y1="235" x2="250" y2="215" stroke="#fff" strokeWidth="1.4" />
          {["#7cc7ff", "#9b8cff", "#f5a3e0", "#ffc48a"].map((c, i) => (
            <g key={c}>
              <line x1="330" y1={206 + i * 4} x2="600" y2={120 + i * 62} stroke={c} strokeWidth="7" opacity="0.35" filter="url(#cta-glow)" />
              <line x1="330" y1={206 + i * 4} x2="600" y2={120 + i * 62} stroke={c} strokeWidth="2" />
            </g>
          ))}
          <path d="M290 70 L390 300 L190 300 Z" fill="url(#cta-glass)" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
          <path d="M290 70 L312 300" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        </svg>
        <div className="relative max-w-[600px]">
          <h2 className="display text-[38px] font-[680] leading-[1.02] sm:text-[58px]">Apply like the hiring manager is already reading.</h2>
          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-white/80">Free for everyone during early access. Every feature unlocked, no credit card.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/signup" className="lp-btn bg-white text-[var(--deep)] hover:bg-[#eef2fe]">Join early access</Link>
            <Link href="/login" className="lp-btn border border-white/25 text-white hover:bg-white/10">I already have an account</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
