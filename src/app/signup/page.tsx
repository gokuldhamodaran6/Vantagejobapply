"use client";
import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { AuthAside, AuthShell, FormError } from "@/components/auth-shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GoogleButton } from "@/components/google-button";
import { hardNavigate } from "@/lib/nav";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    setBusy(true);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setBusy(false);
    if (error) return setError(error.message);
    if (data.session) hardNavigate("/onboarding");
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" aside={<AuthAside />}>
        <div className="card p-6">
          <MailCheck className="text-brand" size={28} />
          <p className="mt-4 text-[15px] leading-relaxed">
            We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish creating your account.
          </p>
          <p className="mt-3 text-sm text-muted">No email after a few minutes? Check spam, or <button className="font-semibold text-brand-ink underline" onClick={() => setSent(false)}>try again</button>.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join early access" subtitle="Free during early access. No credit card needed." aside={<AuthAside />}>
      <GoogleButton label="Sign up with Google" />
      <form onSubmit={onSubmit} noValidate>
        <FormError message={error} />
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <p className="mt-1.5 text-xs text-muted">At least 8 characters.</p>
          </div>
        </div>
        <button type="submit" className="btn-primary mt-6 w-full min-h-12 text-[15px]" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="font-semibold text-brand-ink">Log in</Link>
      </p>
    </AuthShell>
  );
}
