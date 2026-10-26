"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { FOCUS_COUNTRIES } from "@/lib/countries";

export function CountryRules() {
  const [active, setActive] = useState(FOCUS_COUNTRIES[1].code);
  const c = FOCUS_COUNTRIES.find((x) => x.code === active)!;

  return (
    <section id="countries" className="py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">The rules of each country, applied to every job</h2>
          <p className="mt-4 text-lg text-muted">
            Vantage knows which visa routes exist, who can sponsor and what disqualifies a job — and checks every posting for you.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-2" role="tablist" aria-label="Country">
          {FOCUS_COUNTRIES.map((x) => (
            <button
              key={x.code}
              role="tab"
              aria-selected={active === x.code}
              onClick={() => setActive(x.code)}
              className={`min-h-11 rounded-full border px-5 text-sm font-semibold transition ${
                active === x.code ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-[#c9d5fb]"
              }`}
            >
              {x.name}
            </button>
          ))}
          <span className="flex min-h-11 items-center px-3 text-sm text-muted">+ Germany, Ireland, New Zealand, Singapore, Netherlands</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={c.code}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_1fr]"
          >
            <div className="card p-7">
              <h3 className="text-lg font-semibold">Ways to work in {c.name}</h3>
              <ul className="mt-5 space-y-4">
                {c.routes.map((r) => (
                  <li key={r.name} className="rounded-xl bg-canvas p-4">
                    <p className="font-semibold">{r.name}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{r.summary}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[15px] leading-relaxed"><span className="font-semibold">For students: </span>{c.studentPath}</p>
            </div>
            <div className="card flex flex-col p-7">
              <h3 className="text-lg font-semibold">What Vantage checks for you</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed">
                {c.facts.map((f) => (
                  <li key={f} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pink" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {c.sponsorData && (
                <p className="mt-5 rounded-lg bg-brand-tint px-4 py-3 text-sm text-brand-ink">Data source: {c.sponsorData}</p>
              )}
              <div className="mt-auto pt-6">
                <p className="text-xs text-muted">Official sources · rules reviewed October 2026</p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {c.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">
                        {s.label} <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
