/**
 * Clean what a careers site's widget reported as a question's choices. Custom dropdowns often report their own
 * display text ("Are you eligible…? NO") or a placeholder as an option, and the same choice twice.
 */
export function cleanOptions(label: string, options: string[] | undefined | null): string[] | undefined {
  if (!options?.length) return undefined;
  const q = label.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const head = q.slice(0, 28);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const o = String(raw || "").replace(/\s+/g, " ").trim();
    if (!o || /^(select|choose|please select|--|—|\.\.\.)/i.test(o)) continue;
    const n = o.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    // The question itself (often with the current answer appended) is not a choice.
    if (head.length >= 12 && n.includes(head)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(o);
  }
  return out.length ? out : undefined;
}

/** A one-time code box ("Enter verification code 1"). The agent reads codes from the mailbox; never a saved answer. */
export const isCodeQuestion = (label: string) =>
  /verification code|security code|one[- ]?time (pass)?code|\botp\b|passcode|confirmation code|enter (the )?(\d+[- ]digit )?code|digit \d+ of/i.test(label);

/** A yes/no question ("Are you…", "Do you…", "Will you…") — offered as Yes/No buttons when the site's list wasn't read. */
export const isYesNoQuestion = (label: string) => /^\s*(are|do|does|did|will|would|have|has|had|can|could|is|was|were|should|may)\b/i.test(label) && !/\b(which|what|how many|how much|when|where|list|describe|explain)\b/i.test(label.slice(0, 60));

/** Voluntary self-identification (gender, race, veteran, disability…): Vantage answers "decline" unless you set it. */
export const isVoluntaryId = (label: string) =>
  /^\s*i identify (as|my)|self[- ]identif|how do you identify|\bgender\b|\brace\b|ethnicit|hispanic|latin[oax]|veteran status|protected veteran|disability status|sexual orientation|transgender|\bpronouns?\b/i.test(label);
