"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import type { Drive } from "./scene";

const JourneyScene = dynamic(() => import("./scene"), { ssr: false });

/** The four scenes, as the reader sees them: where each starts in the scroll, and its name. */
const CHAPTERS = [
  { at: 0, name: "The posting" },
  { at: 0.2, name: "Four things out" },
  { at: 0.48, name: "Where you can be hired" },
  { at: 0.74, name: "Kept true" },
];

const subscribe = () => () => {};
const webgl = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
};
const isMobile = () => window.innerWidth < 768 || matchMedia("(pointer: coarse)").matches;

/**
 * The landing intro. The stage and its words are server-rendered, so the page never flashes an older layout while
 * the 3D loads; the 3D fades in behind the words once it's ready. Without WebGL, with reduced motion, or after a lost
 * graphics context, the same stage stays with a calm still background.
 */
export function Journey() {
  const reduce = useReducedMotion();
  const gl = useSyncExternalStore(subscribe, webgl, () => false);
  const mobile = useSyncExternalStore(subscribe, isMobile, () => false);
  const [lost, setLost] = useState(false);
  const [ready, setReady] = useState(false);
  const drive = useMemo<Drive>(() => ({ p: 0 }), []);
  const section = useRef<HTMLElement>(null);
  const [ch, setCh] = useState(0);
  const [p, setP] = useState(0);
  const live = gl && !reduce && !lost;

  useEffect(() => {
    // One smoothed progress drives everything (camera, shapes, words), so they always move together and ease
    // gently after the scroll instead of jumping with every flick of the wheel.
    let target = 0;
    let cur = -1;
    let raf = 0;
    let last = 0;
    const read = () => {
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      target = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
      // The page nav turns light while it floats over the dark intro.
      document.documentElement.dataset.lpTone = r.bottom > 80 ? "dark" : "light";
    };
    const tick = (now: number) => {
      const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
      last = now;
      cur = cur < 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(target - cur) < 0.0004) cur = target;
      drive.p = cur;
      setP(Math.round(cur * 400) / 400);
      let c = 0;
      CHAPTERS.forEach((x, i) => cur >= x.at && (c = i));
      setCh((old) => (old === c ? old : c));
      raf = cur === target ? 0 : requestAnimationFrame(tick);
    };
    const on = () => {
      read();
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      delete document.documentElement.dataset.lpTone;
    };
  }, [drive]);

  // Words fade over a long stretch of scroll, so nothing snaps in or out.
  const vis = (a: number, b: number) => {
    const fadeIn = Math.min(1, Math.max(0, (p - a) / 0.06));
    const fadeOut = Math.min(1, Math.max(0, (b - p) / 0.06));
    return Math.min(fadeIn, fadeOut);
  };
  const skip = () => document.getElementById("story")?.scrollIntoView({ behavior: "smooth" });
  const jump = (at: number) => {
    const el = section.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + (el.offsetHeight - window.innerHeight) * (at + 0.06);
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <section ref={section} aria-label="Vantage, in four scenes" className="jr relative -mt-[76px] h-[480svh] sm:h-[600vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[#050a18]">
        {/* Still background: shown while the 3D loads, and instead of it when 3D is off */}
        <div className="jr-still absolute inset-0" aria-hidden />
        {live && (
          <div className={`absolute inset-0 transition-opacity duration-[1400ms] ease-out ${ready ? "opacity-100" : "opacity-0"}`} aria-hidden>
            <JourneyScene drive={drive} mobile={mobile} onReady={() => setReady(true)} onLost={() => setLost(true)} />
          </div>
        )}

        {/* A soft shade behind the words so they stay readable */}
        <div className="pointer-events-none absolute inset-0 z-[15] bg-[linear-gradient(0deg,rgba(5,10,24,.92)_0%,rgba(5,10,24,.6)_40%,transparent_66%)] sm:bg-[linear-gradient(90deg,rgba(5,10,24,.78)_0%,rgba(5,10,24,.4)_36%,transparent_58%)]" aria-hidden />

        {/* Controls: where you are, jump to a scene, skip */}
        <div className="pointer-events-none absolute inset-0 z-[18] text-[13px] text-[#b9c5e4]">
          <nav aria-label="Scenes" className="pointer-events-auto absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col items-end gap-1 lg:flex">
            {CHAPTERS.map((c, i) => (
              <button key={c.name} type="button" onClick={() => jump(c.at)} className="group flex min-h-9 items-center gap-3 rounded-full px-2" aria-current={i === ch ? "step" : undefined}>
                <span className={`transition-opacity duration-500 ${i === ch ? "text-white opacity-100" : "opacity-0 group-hover:opacity-80 group-focus-visible:opacity-80"}`}>{c.name}</span>
                <span className={`block size-2 rounded-full transition-all duration-500 ${i === ch ? "scale-125 bg-white" : "bg-white/30 group-hover:bg-white/60"}`} />
              </button>
            ))}
          </nav>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
            <div className="h-full bg-[#9fb6ff] transition-[width] duration-300 ease-out" style={{ width: `${p * 100}%` }} />
          </div>
          <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-2 sm:bottom-5 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
            <span className="hidden sm:inline">{ch + 1} of 4 · {CHAPTERS[ch].name}</span>
            <span className="hidden opacity-40 sm:inline">·</span>
            <button type="button" onClick={skip} className="min-h-11 rounded-full px-3 text-white/90 underline-offset-4 hover:underline">Skip intro ↓</button>
          </div>
        </div>

        {/* Words for each scene */}
        <div className="pointer-events-none absolute inset-0 z-20 mx-auto flex max-w-[1240px] items-end px-5 pb-20 sm:items-center sm:px-10 sm:pb-0">
          <div className="relative w-full max-w-[560px]">
            <Block show={vis(-1, 0.14)}>
              <p className="hidden text-[13px] font-semibold uppercase tracking-[0.14em] text-[#9fb6ff] sm:block">AI job applications, kept true</p>
              <h1 className="display mt-4 text-[clamp(36px,min(10.5vw,8svh),76px)] font-[680] leading-[1.0] text-white">A resume for every job. Every word still true.</h1>
              <p className="mt-5 max-w-[30rem] text-[17px] leading-relaxed text-[#cfd8ee]">Vantage reads the posting, writes your resume and cover letter for that one job, checks every line against your history, then fills the company&apos;s form. You press Submit.</p>
              <div className="pointer-events-auto mt-7 flex flex-wrap gap-3">
                <Link href="/signup" className="jr-btn jr-btn-light">Join early access · free</Link>
                <button type="button" onClick={() => jump(0.2)} className="jr-btn jr-btn-ghost">See how it works</button>
              </div>
            </Block>
            <Block show={vis(0.2, 0.44)}>
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#9fb6ff]">One posting in</p>
              <h2 className="display mt-3 text-[clamp(32px,min(9vw,7svh),60px)] font-[680] leading-[1.04] text-white">Four things out.</h2>
              <p className="mt-4 max-w-[28rem] text-[17px] leading-relaxed text-[#cfd8ee]">For every job you choose: a resume written for it, a one-page cover letter, the company&apos;s own application filled in, and an interview kit to defend every line.</p>
            </Block>
            <Block show={vis(0.52, 0.72)}>
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#9fb6ff]">Where you can be hired</p>
              <h2 className="display mt-3 text-[clamp(32px,min(9vw,7svh),60px)] font-[680] leading-[1.04] text-white">Jobs that can actually hire you.</h2>
              <p className="mt-4 max-w-[28rem] text-[17px] leading-relaxed text-[#cfd8ee]">Visa and sponsorship rules for 10 countries are applied to every posting, so roles that can&apos;t hire you never reach your list.</p>
            </Block>
            <Block show={vis(0.76, 0.94)}>
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#9fb6ff]">Kept true</p>
              <h2 className="display mt-3 text-[clamp(32px,min(9vw,7svh),60px)] font-[680] leading-[1.04] text-white">Every line checked like a hiring manager would.</h2>
              <p className="mt-4 max-w-[28rem] text-[17px] leading-relaxed text-[#cfd8ee]">No invented numbers. No borrowed titles. Your passwords never seen. You decide when it&apos;s sent.</p>
            </Block>
            <Block show={vis(0.95, 2)}>
              <h2 className="display text-[clamp(34px,min(9.5vw,7.4svh),64px)] font-[680] leading-[1.02] text-white">Apply like the hiring manager is already reading.</h2>
              <div className="pointer-events-auto mt-7 flex flex-wrap gap-3">
                <Link href="/signup" className="jr-btn jr-btn-light">Join early access · free</Link>
                <button type="button" onClick={skip} className="jr-btn jr-btn-ghost">Read the details ↓</button>
              </div>
            </Block>
          </div>
        </div>
      </div>
    </section>
  );
}

function Block({ show, children }: { show: number; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2" style={{ visibility: show > 0.01 ? "visible" : "hidden" }} aria-hidden={show < 0.5}>
      <div style={{ opacity: show, transform: `translateY(${(1 - show) * 12}px)` }}>{children}</div>
    </div>
  );
}
