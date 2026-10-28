"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Briefcase, Building2, CalendarDays, FileText, LayoutDashboard, LogOut, Mail, MessageSquare, Search, Puzzle, Settings, Shield, Target, Menu, X,
} from "lucide-react";
import { LogoMark } from "@/components/brand";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { hardNavigate } from "@/lib/nav";
import { canOpenFromSite, extensionState, type ExtState } from "@/lib/ext-client";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/jobs", label: "Live jobs", icon: Search },
  { href: "/app/companies", label: "Companies", icon: Building2 },
  { href: "/app/targets", label: "My targets", icon: Target },
  { href: "/app/applications", label: "Applications", icon: Briefcase },
  { href: "/app/inbox", label: "Inbox", icon: Mail },
  { href: "/app/resumes", label: "Resumes", icon: FileText },
  { href: "/app/interviews", label: "Interviews", icon: CalendarDays },
  { href: "/app/assistant", label: "Ask Vantage", icon: MessageSquare },
  { href: "/app/extension", label: "Chrome extension", icon: Puzzle },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const MOBILE = ["/app", "/app/jobs", "/app/applications", "/app/interviews", "/app/resumes"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, loading, prefs, roles } = useMe();
  const [drawer, setDrawer] = useState(false);
  const [ext, setExt] = useState<ExtState | null>(null);

  // Instant Live jobs: shortly after any page opens, the default job search is prepared on the server in the
  // background (shared for a few minutes), so opening Live jobs shows results at once.
  const hasRoles = roles.some((r) => r.active);
  const country = prefs?.countries?.[0] || "US";
  useEffect(() => {
    if (!profile?.onboarding_complete || !hasRoles) return;
    let last = 0;
    try { last = Number(sessionStorage.getItem("vantage.warm") || 0); } catch { /* storage blocked */ }
    if (Date.now() - last < 110_000) return;
    const t = setTimeout(() => {
      try { sessionStorage.setItem("vantage.warm", String(Date.now())); } catch { /* storage blocked */ }
      if (!pathname.startsWith("/app/jobs")) void fetch(`/api/jobs?${new URLSearchParams({ country })}`, { priority: "low" } as RequestInit).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [profile?.onboarding_complete, hasRoles, country, pathname]);

  // Is the Chrome extension installed and connected? (shown in the sidebar)
  useEffect(() => {
    let alive = true;
    const check = () => void extensionState().then((x) => alive && setExt(x));
    check();
    const id = setInterval(check, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!loading && profile && !profile.onboarding_complete) router.replace("/onboarding");
  }, [loading, profile, router]);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    hardNavigate("/");
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3.5 py-5">
      <Link href="/app" className="flex items-center gap-2.5 px-2.5">
        <LogoMark />
        <span className="text-[18px] font-bold tracking-tight">Vantage</span>
      </Link>
      <nav aria-label="App" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition ${
                on ? "bg-brand-tint font-semibold text-brand-ink" : "font-medium text-ink-2 hover:bg-canvas"
              }`}
            >
              <Icon size={19} className={on ? "text-brand" : "text-subtle"} />
              {label}
            </Link>
          );
        })}
        {profile?.role === "admin" && (
          <Link
            href="/admin"
            className="mt-2 flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-pink-ink hover:bg-pink-tint"
          >
            <Shield size={19} /> Admin portal
          </Link>
        )}
      </nav>
      <div className="mt-auto space-y-2">
        {profile && ext && (
          <Link href="/app/extension" className="block rounded-xl border border-line bg-canvas p-3.5 hover:border-brand/40">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              {ext.connected && canOpenFromSite(ext.version) ? (
                <><span className="live-dot h-2 w-2 rounded-full bg-green" /> Extension ready</>
              ) : ext.installed ? (
                <><span className="h-2 w-2 rounded-full bg-orange" /> {ext.connected ? "Update the extension" : "Connect the extension"}</>
              ) : (
                <><span className="h-2 w-2 rounded-full bg-line-2" /> Add the Chrome extension</>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">{ext.connected && canOpenFromSite(ext.version) ? "Tailor & apply fills company forms for you." : "It fills company application forms for you."}</p>
          </Link>
        )}
        <button onClick={signOut} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-canvas">
          <LogOut size={18} className="text-subtle" /> Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 border-r border-line bg-white lg:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-ink/30" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[270px] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
          <button className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line" aria-label="Open menu" onClick={() => setDrawer(true)}>
            {drawer ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/app" className="flex items-center gap-2 font-bold"><LogoMark size={26} /> Vantage</Link>
          <Link href="/app/settings" aria-label="Settings" className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-pink-tint text-xs font-bold text-pink-ink">
            {(profile?.full_name || profile?.email || "?").slice(0, 2).toUpperCase()}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.filter((n) => MOBILE.includes(n.href)).map(({ href, label, icon: Icon }) => {
          const on = isActive(href);
          return (
            <Link key={href} href={href} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${on ? "text-brand" : "text-subtle"}`}>
              <Icon size={21} />
              {label.replace("Live jobs", "Jobs").replace("My targets", "Targets")}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 max-w-md text-[15px] text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
