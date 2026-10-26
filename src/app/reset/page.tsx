"use client";
import { useState } from "react";
import { AuthAside, AuthShell, FormError } from "@/components/auth-shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { hardNavigate } from "@/lib/nav";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else hardNavigate("/app");
  }

  return (
    <AuthShell title="Choose a new password" aside={<AuthAside />}>
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <label className="label" htmlFor="pw">New password</label>
        <input id="pw" type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-primary mt-6 w-full min-h-12" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthShell>
  );
}
