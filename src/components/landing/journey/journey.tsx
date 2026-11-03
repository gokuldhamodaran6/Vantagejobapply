"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import type { Drive } from "./scene";

const JourneyScene = dynamic(() => import("./scene"), { ssr: false });

/** The four scenes, as the reader sees them: where each starts in the scroll, and its words. */
const CHAPTERS = [
  { at: 0, code: "00", name: "The posting" },
  { at: 0.2, code: "01", name: "Split" },
  { at: 0.46, code: "02", name: "The world" },
  { at: 0.74, code: "03", name: "Kept true" },
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

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>_-+*#";
/** Letters settle from noise into the line, the way a signal locks on. */
function Scramble({ text, on, className }: { text: string; on: boolean; className?: string }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!on) return;
    let f = 0;
    const total = 22;
    const id = setInterval(() => {
      f++;
      setOut(
        text
          .split("")
          .map((ch, i) => (ch === " " || i < (f / total) * text.length ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (f >= total) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [text, on]);
  return <span className={className} aria-label={text}><span aria-hidden>{out}</span></span>;
}

/** Optional sound: a soft cold drone that breathes with the scroll, and a chime on each new scene. */
function useSound() {
  const ctx = useRef<AudioContext | null>(null);
  const filter = useRef<BiquadFilterNode | null>(null);
  const gain = useRef<GainNode | null>(null);
  const [on, setOn] = useState(false);
  const start = () => {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new AC();
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.5);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    f.Q.value = 6;
    [55, 82.4, 110.3, 164.8].forEach((hz, i) => {
      const o = c.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = hz;
      o.detune.value = (i - 1.5) * 6;
      o.connect(f);
      o.start();
    });
    f.connect(g).connect(c.destination);
    ctx.current = c;
    filter.current = f;
    gain.current = g;
    setOn(true);
  };
  const stop = () => {
    const c = ctx.current;
    if (c && gain.current) {
      gain.current.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      setTimeout(() => c.close(), 500);
    }
    ctx.current = null;
    setOn(false);
  };
  const breathe = (p: number) => {
    if (filter.current && ctx.current) filter.current.frequency.setTargetAtTime(300 + p * 1400, ctx.current.currentTime, 0.3);
  };
  const chime = () => {
    const c = ctx.current;
    if (!c) return;
    [880, 1318.5].forEach((hz, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = hz;
      g.gain.setValueAtTime(0, c.currentTime + i * 0.08);
      g.gain.linearRampToValueAtTime(0.035, c.currentTime + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.08 + 1.4);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + i * 0.08);
      o.stop(c.currentTime + i * 0.08 + 1.5);
    });
  };
  useEffect(() => () => ctx.current?.close().catch(() => {}) as unknown as void, []);
  return { on, toggle: () => (on ? stop() : start()), breathe, chime };
}

export function Journey({ fallback }: { fallback: React.ReactNode }) {
  const reduce = useReducedMotion();
  const gl = useSyncExternalStore(subscribe, webgl, () => false);
  const mobile = useSyncExternalStore(subscribe, () => window.innerWidth < 768 || matchMedia("(pointer: coarse)").matches, () => false);
  const [lost, setLost] = useState(false);
  const drive = useMemo<Drive>(() => ({ p: 0 }), []);
  const section = useRef<HTMLElement>(null);
  const [ch, setCh] = useState(0);
  const [p, setP] = useState(0);
  const sound = useSound();

  useEffect(() => {
    if (!gl || reduce || lost) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = section.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const v = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
        drive.p = v;
        setP(Math.round(v * 200) / 200);
        let c = 0;
        CHAPTERS.forEach((x, i) => v >= x.at && (c = i));
        setCh((old) => (old === c ? old : c));
        // The page nav turns light while it floats over the dark journey.
        document.documentElement.dataset.lpTone = r.bottom > 80 ? "dark" : "light";
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      delete document.documentElement.dataset.lpTone;
    };
  }, [gl, reduce, lost, drive]);

  useEffect(() => sound.breathe(p), [p, sound]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    sound.chime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch]);

  if (!gl || reduce || lost) return <>{fallback}</>;

  const vis = (a: number, b: number) => {
    const fadeIn = Math.min(1, Math.max(0, (p - a) / 0.03));
    const fadeOut = Math.min(1, Math.max(0, (b - p) / 0.03));
    return Math.min(fadeIn, fadeOut);
  };
  const skip = () => document.getElementById("story")?.scrollIntoView({ behavior: "smooth" });
  const jump = (at: number) => {
    const el = section.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + (el.offsetHeight - window.innerHeight) * (at + 0.035);
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <section ref={section} aria-label="Vantage, in four scenes" className="jr relative -mt-[76px]" style={{ height: mobile ? "520svh" : "560vh" }}>
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[#040812]">
        <div className="absolute inset-0" aria-hidden>
          <JourneyScene drive={drive} mobile={mobile} onLost={() => setLost(true)} />
        </div>

        {/* HUD */}
        <div className="pointer-events-none absolute inset-0 z-[18] font-mono text-[11px] uppercase tracking-[0.16em] text-[#a9b8dc]">
          <div className="absolute left-4 top-[88px] sm:left-8">
            <span className="text-white">Vantage</span> <span className="opacity-60">{"//"}</span> <Scramble text={`${CHAPTERS[ch].code} — ${CHAPTERS[ch].name}`} on />
          </div>
          <nav aria-label="Scenes" className="pointer-events-auto absolute right-3 top-1/2 hidden -translate-y-1/2 flex-col gap-3 sm:right-8 sm:flex">
            {CHAPTERS.map((c, i) => (
              <button key={c.code} type="button" onClick={() => jump(c.at)} className="group flex items-center justify-end gap-3" aria-current={i === ch ? "step" : undefined}>
                <span className={`transition-opacity ${i === ch ? "opacity-100 text-white" : "opacity-0 group-hover:opacity-70"}`}>{c.name}</span>
                <span className={`block h-px transition-all ${i === ch ? "w-10 bg-white" : "w-5 bg-[#a9b8dc]/50"}`} />
              </button>
            ))}
          </nav>
          <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-[#7cc7ff] via-[#9b8cff] to-[#ff8fd0]" style={{ width: `${p * 100}%` }} />
          <div className="pointer-events-auto absolute bottom-5 left-4 flex items-center gap-4 sm:left-8">
            <button type="button" onClick={sound.toggle} className="flex items-center gap-2 py-2 hover:text-white" aria-pressed={sound.on}>
              <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                {[0, 1, 2, 3].map((k) => <span key={k} className={`w-[2px] bg-current ${sound.on ? "jr-eq" : ""}`} style={{ height: sound.on ? undefined : 3, animationDelay: `${k * 0.12}s` }} />)}
              </span>
              Sound {sound.on ? "on" : "off"}
            </button>
            <button type="button" onClick={skip} className="py-2 hover:text-white">Skip intro ↓</button>
          </div>
          <div className="absolute bottom-6 right-4 sm:right-8" style={{ opacity: 1 - Math.min(1, p * 12) }}>
            <span className="jr-scroll">Scroll</span>
          </div>
        </div>

        {/* A soft shade behind the words so they stay readable over bright light */}
        <div className="pointer-events-none absolute inset-0 z-[15] bg-[linear-gradient(0deg,rgba(4,8,18,.9)_0%,rgba(4,8,18,.55)_38%,transparent_62%)] sm:bg-[linear-gradient(90deg,rgba(4,8,18,.72)_0%,rgba(4,8,18,.35)_34%,transparent_55%)]" aria-hidden style={{ opacity: 1 - vis(0.42, 0.6) * 0.6 }} />

        {/* Words for each scene */}
        <div className="pointer-events-none absolute inset-0 z-20 mx-auto flex max-w-[1240px] items-end px-5 pb-24 sm:items-center sm:px-8 sm:pb-0">
          <div className="relative w-full max-w-[560px]">
            <Block show={vis(-1, 0.13)}>
              <p className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-[#9fb6ff] sm:block"><Scramble text="AI job applications, kept true" on={ch === 0} /></p>
              <h1 className="display mt-4 text-[clamp(38px,min(11vw,8.4svh),78px)] font-[680] leading-[0.98] text-white">A resume for every job. Every word still true.</h1>
              <p className="mt-5 max-w-[30rem] text-[16.5px] leading-relaxed text-[#c3cde6]">Vantage reads the posting, writes your resume and cover letter for that one job, checks every line against your history, then fills the company&apos;s form. You press Submit.</p>
              <div className="pointer-events-auto mt-7 flex flex-wrap gap-3">
                <Link href="/signup" className="jr-btn jr-btn-light">Join early access · free</Link>
                <button type="button" onClick={() => jump(0.2)} className="jr-btn jr-btn-ghost">See how it works</button>
              </div>
            </Block>
            <Block show={vis(0.2, 0.44)}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9fb6ff]"><Scramble text="01 / One posting in" on={ch === 1} /></p>
              <h2 className="display mt-4 text-[clamp(34px,min(9vw,7svh),62px)] font-[680] leading-[1.02] text-white">Four things out.</h2>
              <p className="mt-4 max-w-[28rem] text-[16px] leading-relaxed text-[#c3cde6]">For every job you choose: a resume written for it, a one-page cover letter, the company&apos;s own application filled in, and an interview kit to defend every line.</p>
            </Block>
            <Block show={vis(0.5, 0.72)}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9fb6ff]"><Scramble text="02 / Where you can be hired" on={ch === 2} /></p>
              <h2 className="display mt-4 text-[clamp(34px,min(9vw,7svh),62px)] font-[680] leading-[1.02] text-white">Jobs that can actually hire you.</h2>
              <p className="mt-4 max-w-[28rem] text-[16px] leading-relaxed text-[#c3cde6]">Visa and sponsorship rules for 10 countries are applied to every posting, so roles that can&apos;t hire you never reach your list.</p>
            </Block>
            <Block show={vis(0.77, 0.9)}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9fb6ff]"><Scramble text="03 / Kept true" on={ch === 3} /></p>
              <h2 className="display mt-4 text-[clamp(34px,min(9vw,7svh),62px)] font-[680] leading-[1.02] text-white">Every line checked like a hiring manager would.</h2>
              <p className="mt-4 max-w-[28rem] text-[16px] leading-relaxed text-[#c3cde6]">No invented numbers. No borrowed titles. Your passwords never seen. You decide when it&apos;s sent.</p>
            </Block>
            <Block show={vis(0.93, 2)}>
              <h2 className="display text-[clamp(36px,min(9.5vw,7.4svh),66px)] font-[680] leading-[1.0] text-white">Apply like the hiring manager is already reading.</h2>
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
      <div style={{ opacity: show, transform: `translateY(${(1 - show) * 18}px)` }}>{children}</div>
    </div>
  );
}
