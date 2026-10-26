"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthAside, AuthShell, FormError } from "@/components/auth-shell";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one." aside={<AuthAside />}>
      {sent ? (
        <p className="card p-5 text-[15px]">If an account exists for <strong>{email}</strong>, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <FormError message={error} />
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn-primary mt-6 w-full min-h-12" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link href="/login" className="font-semibold text-brand-ink">Back to log in</Link></p>
    </AuthShell>
  );
}
