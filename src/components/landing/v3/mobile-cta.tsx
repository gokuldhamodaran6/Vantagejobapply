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
      setShow(window.scrollY > 700 && !nearEnd);
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
      <div className="glass flex items-center gap-3 rounded-2xl p-2 pl-4">
        <p className="min-w-0 flex-1 text-[13px] leading-tight text-[var(--deep-2)]"><span className="block font-semibold text-[var(--deep)]">Free in early access</span>No credit card</p>
        <Link href="/signup" tabIndex={show ? 0 : -1} className="lp-btn lp-btn-primary min-h-11 px-5 text-[14px]">Join early access</Link>
      </div>
    </div>
  );
}
