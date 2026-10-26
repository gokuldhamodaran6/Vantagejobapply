"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

type Me = {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  prefs: TargetPrefs | null;
  roles: TargetRole[];
  auth: WorkAuth[];
  refresh: () => Promise<void>;
};

const Ctx = createContext<Me | null>(null);

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<Me, "refresh">>({ loading: true, userId: null, profile: null, prefs: null, roles: [], auth: [] });

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    if (!uid) {
      setState((s) => ({ ...s, loading: false, userId: null }));
      return;
    }
    const [p, pr, r, a] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).single(),
      supabase.from("target_prefs").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("target_roles").select("*").eq("user_id", uid).order("priority").order("created_at"),
      supabase.from("work_auth").select("*").eq("user_id", uid),
    ]);
    setState({
      loading: false,
      userId: uid,
      profile: (p.data as Profile) ?? null,
      prefs: (pr.data as TargetPrefs) ?? null,
      roles: (r.data as TargetRole[]) ?? [],
      auth: (a.data as WorkAuth[]) ?? [],
    });
    // fire-and-forget activity ping for admin analytics
    supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", uid).then(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe must be used inside MeProvider");
  return v;
}

export function track(type: string, meta: Record<string, unknown> = {}) {
  const supabase = supabaseBrowser();
  supabase.auth.getUser().then(({ data }) => {
    if (data.user) supabase.from("usage_events").insert({ user_id: data.user.id, type, meta }).then(() => {});
  });
}
