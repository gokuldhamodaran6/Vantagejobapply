/**
 * AI price table — the one place to edit when a provider changes its prices.
 *
 * Prices are US dollars per 1 million tokens. They are ESTIMATES set on 27 Oct 2026 from each provider's
 * published price tier; check them against the current price pages before planning on them:
 *   - Anthropic: https://www.anthropic.com/pricing (API) · https://docs.claude.com/en/docs/about-claude/pricing
 *   - Google:    https://ai.google.dev/gemini-api/docs/pricing
 * Every call stores its token counts as well as the cost, so if a price was wrong the cost can be recomputed later.
 *
 * Without a code change, prices can be overridden with the AI_PRICES_JSON env var, e.g.
 *   AI_PRICES_JSON={"claude-sonnet-5-5":{"input":3,"output":15}}
 */
export type Price = {
  /** $ per 1M uncached input tokens. */
  input: number;
  /** $ per 1M output tokens (Gemini "thinking" tokens are billed as output). */
  output: number;
  /** $ per 1M tokens read from the prompt cache. Default: 10% of input. */
  cacheRead?: number;
  /** $ per 1M tokens written to the prompt cache (Anthropic, 5-minute cache). Default: 125% of input. */
  cacheWrite?: number;
};

export const PRICES_AS_OF = "2026-10-27";

export const AI_PRICES: Record<string, Price> = {
  // Anthropic
  "claude-sonnet-5-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-5-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Google
  "gemini-3.8-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3.6-flash": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  "gemini-flash-latest": { input: 0.5, output: 3, cacheRead: 0.05 },
};

/** Model families, for model names not in the table (newer snapshots, env overrides). First match wins. */
const FAMILIES: [RegExp, Price][] = [
  [/opus/i, AI_PRICES["claude-opus-5-5"]],
  [/sonnet/i, AI_PRICES["claude-sonnet-5-5"]],
  [/haiku/i, AI_PRICES["claude-haiku-5-5"]],
  [/flash-lite|flash-8b/i, AI_PRICES["gemini-3.5-flash-lite"]],
  [/flash/i, AI_PRICES["gemini-3.8-flash"]],
  [/gemini.*pro/i, { input: 2, output: 12, cacheRead: 0.2 }],
];

/** Unknown model: priced like the most expensive model we normally use, so spend is never under-counted. */
export const FALLBACK_PRICE: Price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

let overrides: Record<string, Price> | null = null;
function envPrices(): Record<string, Price> {
  if (overrides) return overrides;
  overrides = {};
  try {
    const raw = typeof process !== "undefined" ? process.env.AI_PRICES_JSON : undefined;
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, Partial<Price>>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && Number.isFinite(Number(v.input)) && Number.isFinite(Number(v.output))) {
          overrides[k] = { input: Number(v.input), output: Number(v.output), ...(v.cacheRead !== undefined ? { cacheRead: Number(v.cacheRead) } : {}), ...(v.cacheWrite !== undefined ? { cacheWrite: Number(v.cacheWrite) } : {}) };
        }
      }
    }
  } catch {
    // A malformed override never breaks AI calls; the table above is used.
  }
  return overrides;
}

/** The price for a model: env override, exact match, family match, then the fallback. */
export function priceFor(model: string): { price: Price; source: "override" | "exact" | "family" | "fallback" } {
  const m = (model || "").trim().toLowerCase().replace(/^models\//, "");
  const o = envPrices();
  if (o[m]) return { price: o[m], source: "override" };
  if (AI_PRICES[m]) return { price: AI_PRICES[m], source: "exact" };
  // Dated snapshots ("claude-haiku-5-5-20261001") match their base name.
  const base = Object.keys(AI_PRICES).find((k) => m.startsWith(`${k}-`));
  if (base) return { price: AI_PRICES[base], source: "exact" };
  const fam = FAMILIES.find(([re]) => re.test(m));
  if (fam) return { price: fam[1], source: "family" };
  return { price: FALLBACK_PRICE, source: "fallback" };
}

export type TokenUsage = {
  /** Uncached input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens reported separately from output (Gemini thoughtsTokenCount). */
  thinking: number;
};

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

/** Estimated cost in USD of one call, rounded to a millionth of a dollar. */
export function costUsd(model: string, u: Partial<TokenUsage>): number {
  const { price: p } = priceFor(model);
  // tokens × ($ per 1M tokens) = millionths of a dollar
  const micro =
    n(u.input) * p.input +
    (n(u.output) + n(u.thinking)) * p.output +
    n(u.cacheRead) * (p.cacheRead ?? p.input * 0.1) +
    n(u.cacheWrite) * (p.cacheWrite ?? p.input * 1.25);
  return Math.round(micro) / 1e6;
}

/** Anthropic Messages API `usage` → token counts. input_tokens excludes cached tokens; thinking is inside output_tokens. */
export function anthropicUsage(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null | undefined): TokenUsage {
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), cacheRead: n(u?.cache_read_input_tokens), cacheWrite: n(u?.cache_creation_input_tokens), thinking: 0 };
}

/** Gemini `usageMetadata` → token counts. promptTokenCount includes cached tokens, so they are split out. */
export function geminiUsage(u: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number } | null | undefined): TokenUsage {
  const cached = n(u?.cachedContentTokenCount);
  return { input: Math.max(0, n(u?.promptTokenCount) - cached), output: n(u?.candidatesTokenCount), cacheRead: cached, cacheWrite: 0, thinking: n(u?.thoughtsTokenCount) };
}
