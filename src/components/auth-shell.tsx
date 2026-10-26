import Link from "next/link";
import { Logo } from "@/components/brand";

export function AuthShell({ title, subtitle, children, aside }: { title: string; subtitle?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Logo />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
        <p className="text-center text-xs text-subtle">
          Vantage is for adults (18+). By continuing you agree to the <Link href="/legal/terms" className="underline">Terms</Link> and{" "}
          <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
      <div className="relative hidden overflow-hidden bg-brand lg:block">
        <div aria-hidden="true" className="absolute inset-0 opacity-25 [background-image:radial-gradient(#ffffff_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">{aside}</div>
      </div>
    </div>
  );
}

export function AuthAside() {
  return (
    <>
      <p className="max-w-md text-[34px] font-bold leading-tight tracking-tight">
        Only jobs that can hire you. A resume for every role. Every application tracked.
      </p>
      <ul className="mt-8 space-y-3 text-[15px] text-white/90">
        <li>Visa-aware filtering for the US, UK, Canada and Australia</li>
        <li>Live jobs from employers&apos; official careers sites</li>
        <li>Honest answers on every application</li>
        <li>Free for everyone during early access</li>
      </ul>
    </>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg border border-[#f5c2be] bg-red-tint px-3.5 py-2.5 text-sm text-red-ink">
      {message}
    </p>
  );
}
