"use client";
import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink, Hand } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";

const GlobeScene = dynamic(() => import("./v3/globe-scene"), { ssr: false });

/** Where each country's pin sits on the globe. */
const PLACE: Record<string, [number, number]> = { US: [39, -98], GB: [54, -2], CA: [56, -106], AU: [-25, 134], DE: [51, 10], IE: [53, -8], NZ: [-41, 174], SG: [1.35, 103.8], IN: [21, 78], NL: [52.2, 5.3] };
const subscribe = () => () => {};
const webgl = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};

export function CountryRules() {
  const [active, setActive] = useState("GB");
  const c = COUNTRIES.find((x) => x.code === active)!;
  const reduce = useReducedMotion();
  const gl = useSyncExternalStore(subscribe, webgl, () => false);
  const pins = COUNTRIES.filter((x) => PLACE[x.code]).map((x) => ({ code: x.code, name: x.name, lat: PLACE[x.code][0], lon: PLACE[x.code][1] }));

  return (
    <section id="countries" className="py-24">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="display text-[34px] font-[680] leading-[1.06] sm:text-[46px]">The rules of each country, applied to every job</h2>
          <p className="mt-4 text-lg text-muted">
            Vantage knows which visa routes exist, who can sponsor and what disqualifies a job — and checks every posting for you.
          </p>
        </div>

        <div className={`mt-10 grid items-start gap-8 ${gl && !reduce ? "lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" : ""}`}>
        {gl && !reduce && (
          <div className="lg:sticky lg:top-24">
            <div className="relative mx-auto aspect-square w-full max-w-[540px]" aria-label="Interactive 3D globe of the countries Vantage covers">
              <div aria-hidden className="pointer-events-none absolute inset-[8%] -z-10 rounded-full opacity-70 blur-3xl [background:radial-gradient(circle,#c9d8ff,transparent_70%)]" />
              <GlobeScene pins={pins} active={active} onPick={setActive} />
            </div>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-muted"><Hand size={13} /> Drag to spin · click a country</p>
          </div>
        )}
        <div className="min-w-0">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Country">
          {COUNTRIES.map((x) => (
            <button
              key={x.code}
              role="tab"
              aria-selected={active === x.code}
              onClick={() => setActive(x.code)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold transition ${
                active === x.code ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-[#c9d5fb]"
              }`}
            >
              {x.name}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={c.code}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className={`mt-6 grid gap-5 ${gl && !reduce ? "" : "lg:grid-cols-[1.2fr_1fr]"}`}
          >
            <div className="glass rounded-[24px] p-7">
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
            <div className="glass flex flex-col rounded-[24px] p-7">
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
        </div>
      </div>
    </section>
  );
}
