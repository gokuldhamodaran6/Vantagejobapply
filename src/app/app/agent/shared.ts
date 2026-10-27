"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ACTIVE, NEEDS_YOU, type AgentTask } from "@/lib/agent/status";

export async function patch(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/agent/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return { ok: Boolean(r?.ok), error: (d as { error?: string }).error };
}

/** Where a submitted application stands with the company — from their emails, never guessed. */
export const STAGE: Record<string, { label: string; tone: "green" | "red" | "orange" | "blue" | "pink" | "gray" }> = {
  applied: { label: "Applied · waiting to hear", tone: "blue" },
  in_review: { label: "Under review", tone: "gray" },
  assessment: { label: "Assessment", tone: "orange" },
  interview: { label: "Interview", tone: "pink" },
  offer: { label: "Offer", tone: "green" },
  rejected: { label: "Not selected", tone: "gray" },
  withdrawn: { label: "Withdrawn", tone: "gray" },
};

/** Every task, without the heavy columns: enough for counts, stats and filters. */
export type LightTask = Pick<AgentTask, "id" | "status" | "job_id" | "job" | "priority" | "attempts" | "created_at" | "updated_at" | "started_at" | "finished_at">;
const LIGHT = "id,status,job_id,job,priority,attempts,created_at,updated_at,started_at,finished_at";
/** Statuses the top of the page works with in full (live card, up next, needs-you cards). */
const WORKING = [...new Set([...ACTIVE, ...NEEDS_YOU])];

const POLL_MS = 5000;
const FULL_MS = 60_000;

/**
 * Live data for the agent page. Every 5 s while the tab is visible it asks the database one tiny question —
 * "how many tasks, and when did the newest change?" — and only when that answer moves does it reload.
 * A full refresh also runs every minute (company replies change application stages without touching tasks).
 */
export function useAgentData(userId: string | null) {
  const [working, setWorking] = useState<AgentTask[] | null>(null);
  const [index, setIndex] = useState<LightTask[] | null>(null);
  const [stages, setStages] = useState<Map<string, string>>(new Map());
  const [totalApplied, setTotalApplied] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const sig = useRef("");
  const lastFull = useRef(0);
  const inflight = useRef(false);

  const signature = useCallback(async () => {
    const { data, count, error } = await supabaseBrowser().from("agent_tasks").select("updated_at", { count: "exact" }).order("updated_at", { ascending: false }).limit(1);
    if (error) throw error;
    return `${count ?? 0}|${(data as { updated_at: string }[] | null)?.[0]?.updated_at || ""}`;
  }, []);

  const full = useCallback(async () => {
    const s = supabaseBrowser();
    const [w, ix, st, tot, sg] = await Promise.all([
      s.from("agent_tasks").select("*").in("status", WORKING).order("updated_at", { ascending: false }).limit(500),
      s.from("agent_tasks").select(LIGHT).order("updated_at", { ascending: false }).limit(5000),
      s.from("applications").select("agent_task_id,status").not("agent_task_id", "is", null).limit(5000),
      s.from("applications").select("id", { count: "exact", head: true }).not("applied_at", "is", null),
      signature(),
    ]);
    if (w.error || ix.error) throw w.error || ix.error;
    setWorking((w.data as AgentTask[]) || []);
    setIndex((ix.data as unknown as LightTask[]) || []);
    setStages(new Map(((st.data as { agent_task_id: string; status: string }[]) || []).map((x) => [x.agent_task_id, x.status])));
    setTotalApplied(tot.count ?? 0);
    sig.current = sg;
    lastFull.current = Date.now();
    setVersion((v) => v + 1);
  }, [signature]);

  const sync = useCallback(async (force = false) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      if (force || !sig.current || Date.now() - lastFull.current > FULL_MS) await full();
      else if ((await signature()) !== sig.current) await full();
      setSyncedAt(Date.now());
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inflight.current = false;
    }
  }, [full, signature]);

  useEffect(() => {
    if (!userId) return;
    void sync(true);
    const tick = () => { if (document.visibilityState === "visible") void sync(); };
    const i = setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [userId, sync]);

  return { working, index, stages, totalApplied, version, syncedAt, offline, refresh: () => sync(true) };
}

/** "updated just now" — ticks on its own so the rest of the page doesn't re-render every second. */
export function useTicker(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

export function agoShort(at: number | null, now: number) {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
