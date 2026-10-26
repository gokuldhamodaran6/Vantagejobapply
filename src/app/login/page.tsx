"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthAside, AuthShell, FormError } from "@/components/auth-shell";
import { GoogleButton } from "@/components/google-button";
import { supabaseBrowser } from "@/lib/supabase/client";
import { hardNavigate } from "@/lib/nav";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match. Try again or reset your password." : error.message);
      return;
    }
    hardNavigate(next.startsWith("/") ? next : "/app");
  }

  return (
    <>
      <GoogleButton label="Continue with Google" />
      <form onSubmit={onSubmit} noValidate>
        <FormError message={error} />
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="password">Password</label>
              <Link href="/forgot" className="text-sm font-medium text-brand-ink">Forgot password?</Link>
            </div>
            <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <button type="submit" className="btn-primary mt-6 w-full min-h-12 text-[15px]" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New to Vantage? <Link href="/signup" className="font-semibold text-brand-ink">Create a free account</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to see your matches and applications." aside={<AuthAside />}>
      <Suspense fallback={<div className="skeleton h-64" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
