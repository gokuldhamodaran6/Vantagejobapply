import "server-only";

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Msg = { role: "user" | "assistant"; content: string };
type Opts = { model?: "writer" | "tailor" | "fast"; temperature?: number };

/** Model for long-form writing (resumes, letters) and for quick structured decisions. */
export function modelFor(kind: "writer" | "tailor" | "fast" = "fast") {
  if (kind === "writer") return process.env.AI_WRITER_MODEL || "claude-sonnet-5-5";
  // Per-job tailoring runs up to hundreds of times a day per user, so it defaults to the fast model.
  if (kind === "tailor") return process.env.AI_TAILOR_MODEL || process.env.AI_MODEL || "claude-haiku-5-5";
  return process.env.AI_MODEL || "claude-haiku-5-5";
}

/** Calls the Claude Messages API. Returns null if AI is not configured or fails. */
export async function claude(system: string, messages: Msg[], maxTokens = 1500, opts: Opts = {}): Promise<string | null> {
  if (!aiConfigured()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelFor(opts.model),
          max_tokens: maxTokens,
          system,
          messages,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        console.error("claude error", res.status, (await res.text()).slice(0, 500));
        return null;
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || null;
    } catch (e) {
      console.error("claude failed", e);
    }
  }
  return null;
}

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
