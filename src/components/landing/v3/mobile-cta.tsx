"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Phones: once the hero's buttons scroll away, keep one clear way to sign up at the bottom of the screen. */
export function MobileCta() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => {
      const end = document.getElementById("final-call");
      const nearEnd = end ? end.getBoundingClientRect().top < window.innerHeight : false;
      // After the intro (and its own buttons) has scrolled away.
      const story = document.getElementById("story");
      const past = story ? story.getBoundingClientRect().top < window.innerHeight * 0.6 : window.scrollY > 700;
      setShow(past && !nearEnd);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 transition-transform duration-300 sm:hidden ${show ? "translate-y-0" : "translate-y-full"}`}
      aria-hidden={!show}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[rgba(11,26,58,0.08)] bg-white/95 p-2 pl-4 shadow-[0_12px_40px_-12px_rgba(11,26,58,0.35)] backdrop-blur">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-tight text-[var(--deep-2)]"><span className="block truncate font-semibold text-[var(--deep)]">Free in early access</span>No credit card</p>
        <Link href="/signup" tabIndex={show ? 0 : -1} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-[var(--deep)] px-5 text-[14px] font-semibold text-white">Join free</Link>
      </div>
    </div>
  );
}
