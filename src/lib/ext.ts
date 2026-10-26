import "server-only";
import { createHash, randomBytes } from "crypto";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/access";
import type { TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

/**
 * The Vantage Chrome extension signs requests with a personal key (Authorization: Bearer vx_…).
 * Only the key's SHA-256 is stored; the key itself is shown once, when the extension connects.
 */
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => `vx_${randomBytes(32).toString("base64url")}`;

export async function extRpc<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseAnon().rpc("ext_rpc", { secret: ingestSecret(), op, args });
  if (error) throw new Error(`ext_rpc ${op}: ${error.message}`);
  return data as T;
}

export type ExtUser = {
  user_id: string;
  profile: { full_name: string | null; role: string | null; email: string | null };
  roles: TargetRole[];
  prefs: TargetPrefs | null;
  auth: WorkAuth[];
};

export async function extUser(req: Request) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(vx_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const u = await extRpc<ExtUser | null>("user_for_token", { hash: hashToken(m[1]) }).catch(() => null);
  if (!u) return null;
  return { ...u, plan: effectivePlan(null, u.profile?.role || null) };
}

/** The task must belong to the extension's user. */
export async function ownTask(userId: string, taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const t = await extRpc<{ user_id: string; status: string; job_id: string } | null>("task_owner", { task_id: taskId });
  return t && t.user_id === userId ? t : null;
}

export const extJson = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
