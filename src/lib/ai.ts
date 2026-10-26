import "server-only";

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Msg = { role: "user" | "assistant"; content: string };

/** Calls the Claude Messages API. Returns null if AI is not configured or fails. */
export async function claude(system: string, messages: Msg[], maxTokens = 1500): Promise<string | null> {
  if (!aiConfigured()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-haiku-5-5",
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      console.error("claude error", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || null;
  } catch (e) {
    console.error("claude failed", e);
    return null;
  }
}

export function extractJson<T>(text: string | null): T | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
