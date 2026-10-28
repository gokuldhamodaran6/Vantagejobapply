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
