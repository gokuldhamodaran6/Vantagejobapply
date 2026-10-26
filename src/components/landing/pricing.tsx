"use client";
import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { PLANS, type Interval, type Region } from "@/lib/plans";

export function Pricing() {
  const [interval, setBilling] = useState<Interval>("quarter");
  const [region, setRegion] = useState<Region>("std");

  return (
    <section id="pricing" className="border-t border-line bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple plans. Pause or cancel anytime.</h2>
            <p className="mt-4 text-lg text-muted">Most job searches take a few months, so quarterly plans save the most.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div role="radiogroup" aria-label="Billing period" className="flex rounded-lg bg-[#e7e9f0] p-1">
              {(["month", "quarter"] as Interval[]).map((i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={interval === i}
                  onClick={() => setBilling(i)}
                  className={`min-h-9 rounded-md px-3.5 text-sm font-semibold transition ${interval === i ? "bg-white text-ink shadow-sm" : "text-muted"}`}
                >
                  {i === "month" ? "Monthly" : "Every 3 months"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
              Prices for
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as Region)}
                className="min-h-10 rounded-lg border border-[#d5d9e2] bg-white px-2.5 text-sm font-medium"
              >
                <option value="std">US, UK, Europe, Australia</option>
                <option value="ppp">India, South Asia, Africa, SE Asia</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {PLANS.map((p) => {
            const price = p.prices[region][interval];
            const perMonth = interval === "quarter" ? Math.round((price / 3) * 100) / 100 : price;
            return (
              <div
                key={p.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-7 ${p.highlight ? "border-brand shadow-[0_20px_50px_-24px_rgba(47,91,235,0.45)]" : "border-line"}`}
              >
                {p.highlight && <span className="pill absolute -top-3 left-7 bg-pink text-white">Most popular</span>}
                <h3 className="text-lg font-bold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted">{p.tagline}</p>
                <div className="mt-6 flex items-baseline gap-1.5">
                  <motion.span key={`${price}-${region}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-bold tracking-tight">
                    ${price}
                  </motion.span>
                  <span className="text-sm text-muted">{price === 0 ? "forever" : interval === "month" ? "per month" : "per 3 months"}</span>
                </div>
                <p className="mt-1 h-5 text-sm text-green-ink">{price > 0 && interval === "quarter" ? `$${perMonth.toFixed(2)} a month` : ""}</p>
                <Link href={`/signup?plan=${p.id}`} className={`mt-6 ${p.highlight ? "btn-primary" : "btn-secondary"} min-h-11`}>
                  {p.id === "free" ? "Start free" : `Start with ${p.name}`}
                </Link>
                <ul className="mt-7 space-y-3 text-[15px]">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Check size={18} className="mt-0.5 shrink-0 text-brand" strokeWidth={2.5} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-muted">Students with a university email get 20% off Pro and Autopilot. Prices in USD; taxes may apply.</p>
      </div>
    </section>
  );
}
