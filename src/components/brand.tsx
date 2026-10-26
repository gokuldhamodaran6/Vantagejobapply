import Link from "next/link";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <rect width="30" height="30" rx="8" fill="#2F5BEB" />
      <path d="M9 10l6 10 6-10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="6" r="4" fill="#F7862B" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ href = "/", size = 30 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-ink" aria-label="Vantage home">
      <LogoMark size={size} />
      <span className="text-[18px] font-bold tracking-tight">Vantage</span>
    </Link>
  );
}
