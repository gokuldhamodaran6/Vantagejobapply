"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Check } from "lucide-react";

const INCLUDED = [
  "Live jobs from employers' official careers sites",
  "Visa-aware filtering for the US, UK, Canada, Australia and more",
  "Up to 10 target roles across 6 countries",
  "A tailored resume and cover letter for every job",
  "Ask your agent: status, targets and interview prep",
  "Every application, email and interview in one place",
];

export function EarlyAccess() {
  return (
    <section id="early-access" className="border-t border-line bg-canvas py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <span className="pill bg-pink-tint text-pink-ink">Early access</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Free for everyone while we&apos;re in early access</h2>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-muted">
            Every feature is unlocked. In return, we&apos;d love to hear what works and what doesn&apos;t — you&apos;ll help shape what Vantage becomes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary min-h-12 px-6 text-[15px]">Join early access</Link>
            <Link href="/login" className="btn-secondary min-h-12 px-6 text-[15px]">I already have an account</Link>
          </div>
          <p className="mt-4 text-sm text-muted">No credit card. If anything ever changes, members hear about it well in advance.</p>
        </div>
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
          className="card divide-y divide-line p-2"
        >
          {INCLUDED.map((f) => (
            <motion.li
              key={f}
              variants={{ hidden: { opacity: 0, x: 12 }, show: { opacity: 1, x: 0 } }}
              className="flex items-center gap-3 px-4 py-3.5 text-[15px]"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-white"><Check size={14} strokeWidth={3} /></span>
              {f}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
