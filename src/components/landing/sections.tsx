"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Bot, Briefcase, CalendarCheck, FileCheck2, Inbox, Search, Target } from "lucide-react";

const STEPS = [
  {
    title: "Tell us where you can work",
    body: "Your citizenship, your visa today, and whether you'll need sponsorship now or later — per country. It takes about four minutes.",
  },
  {
    title: "Pick the roles you want",
    body: "Add as many target roles as you like — developer, nurse, HGV driver, analyst — with level, cities, salary floor and companies.",
  },
  {
    title: "Get only jobs that fit",
    body: "Live jobs are checked against your status: sponsor registers, employer history and the posting's own wording. Dead ends never reach you.",
  },
  {
    title: "Apply with a resume built for the role",
    body: "Each target role gets its own ATS-ready resume and cover letter, written only from experience you confirmed.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-line bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">From signup to interview in four steps</h2>
          <p className="mt-4 text-lg text-muted">Set it up once. Vantage keeps working while you sleep.</p>
        </div>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-white p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ChatDemo() {
  const lines = [
    { me: true, t: "What did you apply to today?" },
    { me: false, t: "9 jobs across your 3 target roles. 6 are waiting on the company, 2 sent confirmations, 1 needs a quick check from you." },
    { me: true, t: "Also target Product Analyst roles in London, fintech only." },
    { me: false, t: "Done — 27 matching jobs are open now. I've drafted a Product Analyst resume for you to review." },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {lines.map((l, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: i * 0.35, duration: 0.35 }}
          className={
            l.me
              ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-sm text-white"
              : "max-w-[90%] rounded-2xl rounded-bl-md bg-canvas px-3.5 py-2.5 text-sm text-ink"
          }
        >
          {l.t}
        </motion.div>
      ))}
    </div>
  );
}

function AtsDemo() {
  const ats = ["Workday", "Greenhouse", "Lever", "iCIMS", "Taleo", "SuccessFactors"];
  return (
    <div>
      <div className="flex items-center gap-4">
        <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r="32" fill="none" stroke="#eef0f4" strokeWidth="8" />
          <motion.circle
            cx="38" cy="38" r="32" fill="none" stroke="#2F5BEB" strokeWidth="8" strokeLinecap="round"
            transform="rotate(-90 38 38)" strokeDasharray={2 * Math.PI * 32}
            initial={{ strokeDashoffset: 2 * Math.PI * 32 }}
            whileInView={{ strokeDashoffset: 2 * Math.PI * 32 * 0.06 }}
            viewport={{ once: true }} transition={{ duration: 1.2, ease: "easeOut" }}
          />
          <text x="38" y="44" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0e1525">94</text>
        </svg>
        <div>
          <p className="font-semibold">ATS match score</p>
          <p className="text-sm text-muted">Data Analyst resume, version 7</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {ats.map((a) => (
          <span key={a} className="flex items-center gap-2 rounded-md bg-canvas px-2.5 py-2 text-[13px] font-medium">
            <span className="text-green">✓</span> {a}
          </span>
        ))}
      </div>
    </div>
  );
}

const SMALL = [
  { icon: Search, title: "Live jobs, minutes old", body: "Employer career sites and major job boards, refreshed continuously and de-duplicated." },
  { icon: Target, title: "Targets in one place", body: "Roles, levels, industries, cities with a custom radius, salary floor and must-apply companies." },
  { icon: Briefcase, title: "Every application tracked", body: "One board for every job — filter by target role, company or industry." },
  { icon: Inbox, title: "Emails linked to jobs", body: "Connect a job-only inbox and replies, codes and invites attach to the right application." },
  { icon: CalendarCheck, title: "Interviews without clashes", body: "Holds the best slot from your availability and drafts the reply." },
];

export function Features() {
  return (
    <section id="features" className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything a job search abroad needs, in one account</h2>
          <p className="mt-4 text-lg text-muted">Built for international students, skilled workers and anyone targeting a move.</p>
        </div>
        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <div className="card p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-tint text-pink-ink"><Bot size={20} /></span>
              <h3 className="text-xl font-semibold">Ask your agent anything</h3>
            </div>
            <p className="mt-3 text-[15px] text-muted">Check status, change targets, or prep for an interview — in plain words. Big changes are always shown to you first.</p>
            <div className="mt-6 rounded-xl border border-line p-4"><ChatDemo /></div>
          </div>
          <div className="card p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-tint text-brand-ink"><FileCheck2 size={20} /></span>
              <h3 className="text-xl font-semibold">A resume for every target role</h3>
            </div>
            <p className="mt-3 text-[15px] text-muted">Industry-standard format for your level, tested against the systems employers use. Nothing invented — ever.</p>
            <div className="mt-6 rounded-xl border border-line p-4"><AtsDemo /></div>
          </div>
        </div>
        <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {SMALL.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-xl border border-line p-5">
              <Icon size={20} className="text-brand" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center sm:px-12">
        <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Stop applying to jobs that were never going to sponsor you.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-[#c9cedb]">Create your account, set your status, and see which live jobs fit you today.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="btn min-h-12 bg-white px-6 text-[15px] text-ink hover:bg-canvas">Create free account</Link>
          <a href="#pricing" className="btn min-h-12 border border-white/25 px-6 text-[15px] text-white hover:bg-white/10">Compare plans</a>
        </div>
      </div>
    </section>
  );
}
