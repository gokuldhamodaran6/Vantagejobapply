import "server-only";

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
type Kind = "writer" | "tailor" | "fast";
type Opts = { model?: Kind; temperature?: number };

/** Model for long-form writing (resumes, letters), per-job tailoring, and quick structured decisions. */
export function modelFor(kind: Kind = "fast", provider: Provider = aiProvider() || "anthropic") {
  if (provider === "gemini") {
    if (kind === "writer") return process.env.GEMINI_WRITER_MODEL || "gemini-3.8-flash";
    if (kind === "tailor") return process.env.GEMINI_TAILOR_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  }
  if (kind === "writer") return process.env.AI_WRITER_MODEL || "claude-sonnet-5-5";
  // Per-job tailoring runs up to hundreds of times a day per user, so it defaults to the fast model.
  if (kind === "tailor") return process.env.AI_TAILOR_MODEL || process.env.AI_MODEL || "claude-haiku-5-5";
  return process.env.AI_MODEL || "claude-haiku-5-5";
}

// If a configured Gemini model isn't available on the key (404/403), these are tried next.
const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callAnthropic(system: string, messages: Msg[], maxTokens: number, opts: Opts): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: modelFor(opts.model, "anthropic"),
          max_tokens: maxTokens,
          system,
          messages,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await wait(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.error("claude error", res.status, (await res.text()).slice(0, 500));
        return null;
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || null;
    } catch (e) {
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
          // A bad key won't get better with another model.
          if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED.*key/i.test(body)) {
            console.error("gemini key rejected", res.status, body);
            return null;
          }
          console.error("gemini model unavailable", model, res.status, body);
          break; // try the next model
        }
        if (res.status === 429 || res.status >= 500) {
          await wait(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          console.error("gemini error", res.status, (await res.text()).slice(0, 500));
          return null;
        }
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };
        const c = data.candidates?.[0];
        const text = (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
        if (!text && c?.finishReason === "MAX_TOKENS" && budget < 32000) {
          budget *= 2;
          continue;
        }
        return text || null;
      } catch (e) {
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
