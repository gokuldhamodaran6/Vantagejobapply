import "server-only";
import { aiCtx } from "@/lib/ai-context";
import { anthropicUsage, costUsd, geminiUsage, NO_TOKENS, type TokenUsage } from "@/lib/ai-pricing";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";

/**
 * One AI entry point for the whole app. Works with either provider:
 * - ANTHROPIC_API_KEY → Claude
 * - GEMINI_API_KEY (or GOOGLE_API_KEY) → Gemini
 * If both are set, Claude is used and Gemini is the automatic fallback.
 */
type Provider = "anthropic" | "gemini";
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

function providers(): Provider[] {
  const out: Provider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (geminiKey()) out.push("gemini");
  return out;
}

export function aiConfigured() {
  return providers().length > 0;
}

export function aiProvider(): Provider | null {
  return providers()[0] || null;
}

type Msg = { role: "user" | "assistant"; content: string };
type Kind = "writer" | "tailor" | "fast" | "pilot";
type Opts = {
  model?: Kind;
  temperature?: number;
  /** Short tag for the usage meter ("tailor", "assistant", …). Defaults to the runWithAi() feature, then the model kind. */
  feature?: string;
};

/** Model for long-form writing (resumes, letters), per-job tailoring, and quick structured decisions. */
export function modelFor(kind: Kind = "fast", provider: Provider = aiProvider() || "anthropic") {
  if (provider === "gemini") {
    if (kind === "writer") return process.env.GEMINI_WRITER_MODEL || "gemini-3.8-flash";
    if (kind === "tailor") return process.env.GEMINI_TAILOR_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    if (kind === "pilot") return process.env.GEMINI_PILOT_MODEL || "gemini-3.8-flash";
    return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  }
  if (kind === "writer") return process.env.AI_WRITER_MODEL || "claude-sonnet-5-5";
  // The form pilot drives real careers sites step by step: accuracy matters more than speed here.
  if (kind === "pilot") return process.env.AI_PILOT_MODEL || "claude-sonnet-5-5";
  // Per-job tailoring runs up to hundreds of times a day per user, so it defaults to the fast model.
  if (kind === "tailor") return process.env.AI_TAILOR_MODEL || process.env.AI_MODEL || "claude-haiku-5-5";
  return process.env.AI_MODEL || "claude-haiku-5-5";
}

// If a configured Gemini model isn't available on the key (404/403), these are tried next.
const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────── Usage meter ─────────────────────────
 * Every request to a provider (including retries and failures) becomes one row in private.ai_usage.
 * Rows are queued in memory and written in batches (every 2 s, or at 25 rows) by one RPC call, off the
 * request path: metering never waits on, slows down or breaks an AI call. If the write fails the batch is dropped.
 */
type UsageRow = {
  at: number; provider: Provider; model: string; feature: string; user_id: string | null; task_id: string | null;
  input: number; output: number; cache_read: number; cache_write: number; thinking: number;
  cost: number; latency_ms: number; ok: boolean; status: number | null; error: string | null;
};
const KIND_FEATURE: Record<Kind, string> = { writer: "writer", tailor: "tailor", pilot: "pilot", fast: "other" };
const queue: UsageRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let lastMeterError = 0;

function meter(provider: Provider, model: string, started: number, opts: Opts, r: { ok: boolean; status?: number; usage?: TokenUsage; error?: string }) {
  try {
    if (!process.env.INGEST_SECRET) return;
    const ctx = aiCtx();
    const u = r.usage || NO_TOKENS;
    const m = String(model || "unknown").replace(/^models\//, "").slice(0, 80);
    queue.push({
      at: Date.now(), provider, model: m,
      feature: String(opts.feature || ctx.feature || KIND_FEATURE[opts.model || "fast"] || "other").slice(0, 40),
      user_id: ctx.userId || null, task_id: ctx.taskId || null,
      input: u.input, output: u.output, cache_read: u.cacheRead, cache_write: u.cacheWrite, thinking: u.thinking,
      cost: costUsd(m, u), latency_ms: Math.max(0, Date.now() - started), ok: r.ok,
      status: r.status ?? null, error: r.ok ? null : (r.error || "failed").replace(/\s+/g, " ").slice(0, 200),
    });
    // Never hold more than a few thousand rows if the database is unreachable.
    if (queue.length > 5000) queue.splice(0, queue.length - 5000);
    if (queue.length >= 25) void flushAiUsage();
    else if (!flushTimer) {
      flushTimer = setTimeout(() => { flushTimer = null; void flushAiUsage(); }, 2000);
      (flushTimer as { unref?: () => void }).unref?.();
    }
  } catch {
    // Metering must never affect the AI call.
  }
}

/** Write queued usage rows now. Safe to call any time; never throws. */
export async function flushAiUsage(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const rows = queue.splice(0, 200);
      const now = Date.now();
      const { error } = await supabaseAnon().rpc("ai_usage_log", {
        secret: ingestSecret(),
        p_rows: rows.map(({ at, ...r }) => ({ ...r, ms_ago: Math.max(0, now - at) })),
      });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    if (Date.now() - lastMeterError > 10 * 60_000) {
      lastMeterError = Date.now();
      console.error("ai usage meter: write failed (rows dropped)", (e as Error).message);
    }
  } finally {
    flushing = false;
  }
}

/** Test hook: the rows waiting to be written. */
export const __usageQueue = queue;

async function callAnthropic(system: string, messages: Msg[], maxTokens: number, opts: Opts): Promise<string | null> {
  const model = modelFor(opts.model, "anthropic");
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) {
        meter("anthropic", model, started, opts, { ok: false, status: res.status, error: `http ${res.status}` });
        await wait(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        meter("anthropic", model, started, opts, { ok: false, status: res.status, error: body });
        console.error("claude error", res.status, body);
        return null;
      }
      const data = (await res.json()) as { model?: string; content?: { type: string; text?: string }[]; usage?: Parameters<typeof anthropicUsage>[0] };
      const text = data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || null;
      meter("anthropic", data.model || model, started, opts, { ok: Boolean(text), status: res.status, usage: anthropicUsage(data.usage), error: text ? undefined : "empty reply" });
      return text;
    } catch (e) {
      meter("anthropic", model, started, opts, { ok: false, status: 0, error: (e as Error).message });
      console.error("claude failed", (e as Error).message);
    }
  }
  return null;
}

async function callGemini(system: string, messages: Msg[], maxTokens: number, opts: Opts): Promise<string | null> {
  const first = modelFor(opts.model, "gemini");
  const models = [first, ...GEMINI_FALLBACKS.filter((m) => m !== first)];
  // Gemini's newer models think before answering and that counts toward the output limit, so leave room.
  let budget = maxTokens + 4096;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": geminiKey(), "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: budget, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 404 || res.status === 403 || res.status === 400) {
          const body = (await res.text()).slice(0, 400);
          meter("gemini", model, started, opts, { ok: false, status: res.status, error: body });
          // A bad key won't get better with another model.
          if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED.*key/i.test(body)) {
            console.error("gemini key rejected", res.status, body);
            return null;
          }
          console.error("gemini model unavailable", model, res.status, body);
          break; // try the next model
        }
        if (res.status === 429 || res.status >= 500) {
          meter("gemini", model, started, opts, { ok: false, status: res.status, error: `http ${res.status}` });
          await wait(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          const body = (await res.text()).slice(0, 500);
          meter("gemini", model, started, opts, { ok: false, status: res.status, error: body });
          console.error("gemini error", res.status, body);
          return null;
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
          usageMetadata?: Parameters<typeof geminiUsage>[0];
          modelVersion?: string;
        };
        const c = data.candidates?.[0];
        const text = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
        // Tokens are billed even when the reply is empty (all thinking), so empty replies are metered too.
        meter("gemini", data.modelVersion || model, started, opts, { ok: Boolean(text), status: res.status, usage: geminiUsage(data.usageMetadata), error: text ? undefined : `empty reply (${c?.finishReason || "no candidate"})` });
        if (!text && c?.finishReason === "MAX_TOKENS" && budget < 32000) {
          budget *= 2;
          continue;
        }
        return text || null;
      } catch (e) {
        meter("gemini", model, started, opts, { ok: false, status: 0, error: (e as Error).message });
        console.error("gemini failed", model, (e as Error).message);
      }
    }
  }
  return null;
}

/**
 * Ask the configured AI. Returns null if no AI is configured or every attempt fails — callers always have a
 * rule-based fallback. (Named `claude` for history; it uses whichever provider is configured.)
 */
export async function claude(system: string, messages: Msg[], maxTokens = 1500, opts: Opts = {}): Promise<string | null> {
  for (const p of providers()) {
    const out = p === "anthropic" ? await callAnthropic(system, messages, maxTokens, opts) : await callGemini(system, messages, maxTokens, opts);
    if (out) return out;
  }
  return null;
}

export const ask = claude;

export function extractJson<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
