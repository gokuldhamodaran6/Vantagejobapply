"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";

export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-[#eef0f4] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md px-3.5 text-sm font-semibold transition ${value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChoiceCard({
  selected, onClick, title, body, multi = false,
}: { selected: boolean; onClick: () => void; title: string; body?: string; multi?: boolean }) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border-[1.5px] p-3.5 text-left transition ${
        selected ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-[#c9d5fb]"
      }`}
    >
      <span
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center ${multi ? "rounded-[5px]" : "rounded-full"} border-2 ${
          selected ? "border-brand bg-brand" : "border-[#c3c8d3] bg-white"
        }`}
      >
        {selected && <span className={multi ? "text-[11px] font-bold leading-none text-white" : "h-1.5 w-1.5 rounded-full bg-white"}>{multi ? "✓" : ""}</span>}
      </span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        {body && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{body}</span>}
      </span>
    </button>
  );
}

export function TagInput({
  values, onChange, placeholder, suggestions = [], label,
}: { values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[]; label: string }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const t = v.trim();
    if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-tint py-1.5 pl-3 pr-1.5 text-sm font-semibold text-brand-ink">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-0.5 hover:bg-white/60">
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          aria-label={label}
          className="input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={() => add(draft)}>
          <Plus size={16} /> Add
        </button>
      </div>
      {suggestions.filter((s) => !values.includes(s)).length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Suggestions:</span>
          {suggestions
            .filter((s) => !values.includes(s))
            .slice(0, 8)
            .map((s) => (
              <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-[#f8cfdd] bg-[#fdf3f7] px-2.5 py-1 text-xs font-semibold text-pink-ink">
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] transition ${checked ? "justify-end bg-brand" : "justify-start bg-[#d5d9e2]"}`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow" />
    </button>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg lg:bottom-6">
      {message}
      <button onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 hover:bg-white/10"><X size={14} /></button>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "red" | "orange" | "blue" | "pink" | "gray"; children: React.ReactNode }) {
  const map = {
    green: "bg-green-tint text-green-ink",
    red: "bg-red-tint text-red-ink",
    orange: "bg-orange-tint text-orange-ink",
    blue: "bg-brand-tint text-brand-ink",
    pink: "bg-pink-tint text-pink-ink",
    gray: "bg-[#eef0f4] text-ink-2",
  } as const;
  return <span className={`chip ${map[tone]}`}>{children}</span>;
}
