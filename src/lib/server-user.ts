import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/access";
import type { Profile, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

export async function loadUserContext() {
  const supabase = await supabaseServer();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const uid = u.user.id;
  const [p, pr, r, a] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single(),
    supabase.from("target_prefs").select("*").eq("user_id", uid).maybeSingle(),
    supabase.from("target_roles").select("*").eq("user_id", uid).order("priority").order("created_at"),
    supabase.from("work_auth").select("*").eq("user_id", uid),
  ]);
  const profile = p.data as Profile;
  const plan = effectivePlan(profile?.plan, profile?.role);
  return {
    supabase,
    user: u.user,
    profile,
    plan,
    prefs: (pr.data as TargetPrefs) || null,
    roles: (r.data as TargetRole[]) || [],
    auth: (a.data as WorkAuth[]) || [],
  };
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
