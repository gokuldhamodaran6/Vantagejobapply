"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarPlus, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Mail, Plus, Sparkles, Video, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Segmented, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, tintFor } from "@/lib/format";
import { downloadIcs, googleCalendarUrl, guessRound, ROUNDS, sameDay, toLocalInput } from "@/lib/calendar";
import type { MailEvent } from "@/lib/mail-event";
import type { Application } from "@/lib/types";

type Interview = {
  id: string; application_id: string | null; company: string; title: string | null; round: string; starts_at: string; minutes: number;
  location: string | null; link: string | null; notes: string | null; source: "manual" | "email"; inbox_message_id: string | null; status: "scheduled" | "done" | "cancelled";
};
type Suggestion = { id: string; subject: string; from_name: string; company: string | null; received_at: string; application_id: string | null; event: MailEvent };
type Draft = { id?: string; appId: string; company: string; title: string; round: string; when: string; minutes: number; link: string; location: string; notes: string; inboxId?: string };

const ROUND_TONE: Record<string, string> = {
  "Recruiter screen": "bg-brand-tint text-brand-ink border-brand/20",
  "Hiring manager": "bg-pink-tint text-pink-ink border-pink/20",
  "Technical interview": "bg-orange-tint text-orange-ink border-orange/20",
  "Final round": "bg-green-tint text-green-ink border-green/20",
};
const tone = (r: string) => ROUND_TONE[r] || "bg-[#eef0f4] text-ink-2 border-line";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function InterviewsPage() {
  const { userId } = useMe();
  const [items, setItems] = useState<Interview[] | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [suggest, setSuggest] = useState<Suggestion[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<Interview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [iv, ap, mail] = await Promise.all([
      s.from("interviews").select("*").order("starts_at"),
      s.from("applications").select("id,job,status,events,updated_at").in("status", ["applied", "in_review", "assessment", "interview", "offer"]).order("updated_at", { ascending: false }).limit(500),
      s.from("inbox_messages").select("id,subject,from_name,company,received_at,application_id,event").eq("kind", "interview").not("event", "is", null).order("received_at", { ascending: false }).limit(30),
    ]);
    const list = (iv.data as Interview[]) || [];
    setItems(list);
    setApps((ap.data as Application[]) || []);
    const used = new Set(list.map((x) => x.inbox_message_id).filter(Boolean));
    setSuggest(((mail.data as Suggestion[]) || []).filter((m) => !used.has(m.id) && !m.event?.dismissed && (!m.event.start || Date.parse(m.event.start) > Date.now() - 864e5)));
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  // Opened from an application ("Add interview"): start a new interview for it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("app");
    if (!id || !apps.length) return;
    const a = apps.find((x) => x.id === id);
    window.history.replaceState(null, "", "/app/interviews");
    if (a) setDraft(newDraft(undefined, { appId: a.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const live = (items || []).filter((i) => i.status !== "cancelled");
  const upcoming = live.filter((i) => Date.parse(i.starts_at) + i.minutes * 60000 >= now && i.status === "scheduled");
  const next = upcoming[0];
  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

  // Month grid starting on Monday.
  const days = useMemo(() => {
    const first = new Date(month);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  function newDraft(at?: Date, extra: Partial<Draft> = {}): Draft {
    const d = at ? new Date(at) : new Date(Date.now() + 864e5);
    if (!at || (d.getHours() === 0 && d.getMinutes() === 0)) d.setHours(10, 0, 0, 0);
    return { appId: "", company: "", title: "", round: "Recruiter screen", when: toLocalInput(d), minutes: 45, link: "", location: "", notes: "", ...extra };
  }

  function fromSuggestion(m: Suggestion): Draft {
    const app = m.application_id ? appById.get(m.application_id) : apps.find((a) => m.company && a.job.company.toLowerCase() === m.company.toLowerCase());
    return newDraft(m.event.start ? new Date(m.event.start) : undefined, {
      appId: app?.id || "", company: app?.job.company || m.company || m.from_name || "", title: app?.job.title || "",
      round: guessRound(`${m.subject} ${m.event.title || ""}`), minutes: m.event.minutes || 30, link: m.event.link && !m.event.needsScheduling ? m.event.link : "",
      location: m.event.location || "", inboxId: m.id,
    });
  }

  async function save(d: Draft) {
    const s = supabaseBrowser();
    const app = d.appId ? appById.get(d.appId) : undefined;
    const company = (app?.job.company || d.company).trim();
    if (!company || !d.when) return setToast("Add the company and the date and time.");
    const row = {
      user_id: userId, application_id: app?.id || null, company, title: app?.job.title || d.title || null, round: d.round,
      starts_at: new Date(d.when).toISOString(), minutes: d.minutes, link: d.link.trim() || null, location: d.location.trim() || null,
      notes: d.notes.trim() || null, source: d.inboxId ? "email" : "manual", inbox_message_id: d.inboxId || null, updated_at: new Date().toISOString(),
    };
    const res = d.id ? await s.from("interviews").update(row).eq("id", d.id) : await s.from("interviews").insert(row);
    if (res.error) return setToast(res.error.message);
    // The application moves to Interview and its timeline records the round.
    if (app && !d.id) {
      const events = [...(app.events || []), { at: new Date().toISOString(), type: "interview_scheduled", text: `${d.round} scheduled for ${new Date(d.when).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }];
      await s.from("applications").update({ status: app.status === "offer" ? "offer" : "interview", events }).eq("id", app.id);
    }
    setDraft(null);
    setToast(d.id ? "Interview updated" : "Added to your calendar");
    load();
  }

  async function setStatus(i: Interview, status: Interview["status"]) {
    await supabaseBrowser().from("interviews").update({ status, updated_at: new Date().toISOString() }).eq("id", i.id);
    setOpen(null);
    setToast(status === "done" ? "Marked as done. Good luck!" : "Interview cancelled");
    load();
  }

  async function dismiss(m: Suggestion) {
    await supabaseBrowser().from("inbox_messages").update({ event: { ...m.event, dismissed: true } }).eq("id", m.id);
    setSuggest((x) => x.filter((y) => y.id !== m.id));
  }

  const details = (i: Interview) => `${i.round}${i.title ? ` · ${i.title}` : ""} at ${i.company}${i.link ? `\nJoin: ${i.link}` : ""}${i.notes ? `\n\n${i.notes}` : ""}\n\nPrepared with Vantage`;
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const countdown = (iso: string) => {
    const ms = Date.parse(iso) - now;
    if (ms < 0) return "Happening now";
    const h = Math.round(ms / 3600000);
    if (h < 1) return `In ${Math.max(1, Math.round(ms / 60000))} min`;
    if (h < 36) return `In ${h} hours`;
    return `In ${Math.round(h / 24)} days`;
  };

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle="Your interview calendar. Invites in your job email show up here to confirm in one click."
        actions={<>
          {upcoming.length > 0 && <button className="btn-secondary" onClick={() => downloadIcs(upcoming.map((i) => ({ id: i.id, title: `${i.round}: ${i.company}`, start: new Date(i.starts_at), minutes: i.minutes, details: details(i), location: i.link || i.location || "" })))}><Download size={16} /> Export all</button>}
          <button className="btn-primary" onClick={() => setDraft(newDraft())}><Plus size={16} /> Add interview</button>
        </>}
      />

      {suggest.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Mail size={16} className="text-brand" /> Found in your job email</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {suggest.map((m) => (
              <div key={m.id} className="card relative overflow-hidden p-4">
                <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand to-pink" />
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={tintFor(m.company || m.from_name)}>{initials(m.company || m.from_name || "?")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{m.company || m.from_name}</p>
                    <p className="line-clamp-2 text-sm text-muted">{m.subject}</p>
                  </div>
                  <button className="rounded-lg p-1 text-subtle hover:bg-canvas" aria-label="Dismiss" onClick={() => dismiss(m)}><X size={16} /></button>
                </div>
                {m.event.start ? (
                  <p className="mt-3 flex items-center gap-2 text-sm font-semibold"><Clock size={15} className="text-brand" />
                    {new Date(m.event.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {m.event.minutes} min
                    <span className="chip bg-[#eef0f4] text-ink-2">{m.event.source === "ics" ? "Calendar invite" : "From the email"}</span>
                  </p>
                ) : (
                  <p className="mt-3 text-sm">They sent a link to pick a time.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.event.needsScheduling && m.event.link && <a className="btn-secondary min-h-9 text-[13px]" href={m.event.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Pick a time</a>}
                  <button className="btn-primary min-h-9 text-[13px]" onClick={() => setDraft(fromSuggestion(m))}><CalendarCheck2 size={15} /> {m.event.start ? "Confirm & add" : "Add once booked"}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-1">
              <button className="rounded-lg p-2 hover:bg-canvas" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
              <button className="rounded-lg p-2 hover:bg-canvas" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
            </div>
            <h2 className="text-lg font-bold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
            <button className="btn-ghost min-h-8 text-xs" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
            <div className="ml-auto"><Segmented label="View" value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "agenda", label: "Agenda" }]} /></div>
          </div>

          {items === null && <div className="skeleton m-4 h-[480px]" />}

          {items && view === "month" && (
            <div className="grid grid-cols-7 text-sm">
              {WEEKDAYS.map((w) => <div key={w} className="border-b border-line bg-canvas px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">{w}</div>)}
              {days.map((d, idx) => {
                const inMonth = d.getMonth() === month.getMonth();
                const today = sameDay(d, new Date(now));
                const evs = live.filter((i) => sameDay(new Date(i.starts_at), d));
                return (
                  <div key={idx} role="button" tabIndex={0} onClick={() => setDraft(newDraft(d))} onKeyDown={(e) => { if (e.key === "Enter") setDraft(newDraft(d)); }}
                    className={`group min-h-[104px] border-b border-r border-line p-1.5 text-left transition hover:bg-brand-soft ${inMonth ? "bg-white" : "bg-canvas/60"} ${idx % 7 === 6 ? "border-r-0" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ${today ? "bg-brand text-white" : inMonth ? "text-ink" : "text-subtle"}`}>{d.getDate()}</span>
                      <Plus size={14} className="mr-1 text-subtle opacity-0 group-hover:opacity-100" />
                    </div>
                    <div className="mt-1 space-y-1">
                      {evs.slice(0, 3).map((i) => (
                        <button key={i.id} onClick={(e) => { e.stopPropagation(); setOpen(i); }}
                          className={`block w-full truncate rounded-md border px-1.5 py-1 text-left text-[11.5px] font-semibold ${tone(i.round)} ${i.status === "done" ? "opacity-60 line-through" : ""}`}>
                          {fmtTime(i.starts_at)} {i.company}
                        </button>
                      ))}
                      {evs.length > 3 && <p className="px-1 text-[11px] font-semibold text-muted">+{evs.length - 3} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {items && view === "agenda" && (
            <div className="divide-y divide-line">
              {live.length === 0 && <p className="p-8 text-center text-sm text-muted">Nothing scheduled yet.</p>}
              {live.map((i) => {
                const d = new Date(i.starts_at);
                return (
                  <button key={i.id} onClick={() => setOpen(i)} className={`flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-canvas ${Date.parse(i.starts_at) < now ? "opacity-60" : ""}`}>
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-[11px] font-bold uppercase text-muted">{d.toLocaleDateString(undefined, { month: "short" })}</p>
                      <p className="text-2xl font-bold leading-none">{d.getDate()}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{i.company} <span className={`chip ml-1 border ${tone(i.round)}`}>{i.round}</span></p>
                      <p className="truncate text-sm text-muted">{i.title || "—"} · {d.toLocaleDateString(undefined, { weekday: "long" })} {fmtTime(i.starts_at)} · {i.minutes} min</p>
                    </div>
                    {i.link && <Video size={17} className="text-brand" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {next ? (
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-br from-brand to-pink p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Next interview · {countdown(next.starts_at)}</p>
                <p className="mt-2 text-xl font-bold">{next.company}</p>
                <p className="text-sm opacity-90">{next.round}{next.title ? ` · ${next.title}` : ""}</p>
                <p className="mt-3 text-sm font-semibold">{new Date(next.starts_at).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
              </div>
              <div className="flex flex-wrap gap-2 p-4">
                {next.link && <a className="btn-primary min-h-9 text-[13px]" href={next.link} target="_blank" rel="noopener noreferrer"><Video size={15} /> Join</a>}
                <Link className="btn-secondary min-h-9 text-[13px]" href={`/app/assistant?q=${encodeURIComponent(`Prepare me for my ${next.round} with ${next.company}${next.title ? ` for the ${next.title} role` : ""}`)}`}><Sparkles size={15} /> Prepare me</Link>
                <button className="btn-ghost min-h-9 text-[13px]" onClick={() => setOpen(next)}>Details</button>
              </div>
            </div>
          ) : (
            <div className="card p-5">
              <p className="font-semibold">No interviews coming up</p>
              <p className="mt-1 text-sm text-muted">When a company invites you, the email shows up above to confirm. You can also add one yourself.</p>
            </div>
          )}
          <div className="card p-5">
            <p className="text-sm font-semibold">This month</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Scheduled", live.filter((i) => i.status === "scheduled" && new Date(i.starts_at).getMonth() === month.getMonth() && new Date(i.starts_at).getFullYear() === month.getFullYear()).length],
                ["Done", live.filter((i) => i.status === "done").length],
                ["Companies", new Set(live.map((i) => i.company)).size],
              ].map(([l, n]) => (
                <div key={l as string} className="rounded-xl bg-canvas py-3"><p className="text-xl font-bold">{n}</p><p className="text-xs text-muted">{l}</p></div>
              ))}
            </div>
          </div>
          {upcoming.length > 1 && (
            <div className="card p-4">
              <p className="mb-2 px-1 text-sm font-semibold">Coming up</p>
              <ul className="space-y-1">
                {upcoming.slice(1, 6).map((i) => (
                  <li key={i.id}><button onClick={() => setOpen(i)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-canvas">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={tintFor(i.company)}>{initials(i.company)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{i.company}</span><span className="block truncate text-xs text-muted">{new Date(i.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
                  </button></li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {open && (
        <Panel onClose={() => setOpen(null)} title={`${open.company} · ${open.round}`}>
          <p className="text-sm text-muted">{open.title || "Interview"}</p>
          <div className="mt-4 space-y-2 rounded-xl bg-canvas p-4 text-sm">
            <p className="flex items-center gap-2"><Clock size={15} className="text-brand" />{new Date(open.starts_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} · {open.minutes} min</p>
            {open.link && <p className="flex items-center gap-2"><Video size={15} className="text-brand" /><a className="truncate font-semibold text-brand-ink" href={open.link} target="_blank" rel="noopener noreferrer">{open.link}</a></p>}
            {open.location && <p>{open.location}</p>}
            {open.source === "email" && <p className="flex items-center gap-2 text-muted"><Mail size={15} /> Added from your job email</p>}
          </div>
          {open.notes && <p className="mt-4 whitespace-pre-line text-sm">{open.notes}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <a className="btn-secondary min-h-9 text-[13px]" href={googleCalendarUrl(`${open.round}: ${open.company}`, new Date(open.starts_at), open.minutes, details(open), open.link || open.location || "")} target="_blank" rel="noopener noreferrer"><CalendarPlus size={15} /> Google Calendar</a>
            <button className="btn-secondary min-h-9 text-[13px]" onClick={() => downloadIcs([{ id: open.id, title: `${open.round}: ${open.company}`, start: new Date(open.starts_at), minutes: open.minutes, details: details(open), location: open.link || open.location || "" }], "interview.ics")}><Download size={15} /> Outlook / Apple (.ics)</button>
            <Link className="btn-secondary min-h-9 text-[13px]" href={`/app/assistant?q=${encodeURIComponent(`Prepare me for my ${open.round} with ${open.company}${open.title ? ` for the ${open.title} role` : ""}`)}`}><Sparkles size={15} /> Prepare me</Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
            <button className="btn-ghost min-h-9 text-[13px]" onClick={() => { setDraft({ id: open.id, appId: open.application_id || "", company: open.company, title: open.title || "", round: open.round, when: toLocalInput(new Date(open.starts_at)), minutes: open.minutes, link: open.link || "", location: open.location || "", notes: open.notes || "" }); setOpen(null); }}>Edit or reschedule</button>
            {open.status === "scheduled" && <button className="btn-ghost min-h-9 text-[13px]" onClick={() => setStatus(open, "done")}>Mark as done</button>}
            <button className="btn-ghost min-h-9 text-[13px] text-red-ink" onClick={() => setStatus(open, "cancelled")}>Cancel interview</button>
          </div>
        </Panel>
      )}

      {draft && (
        <Panel onClose={() => setDraft(null)} title={draft.id ? "Edit interview" : draft.inboxId ? "Confirm interview" : "Add interview"}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
            <label className="block text-sm font-semibold">Application
              <select className="input mt-1.5" value={draft.appId} onChange={(e) => setDraft({ ...draft, appId: e.target.value })}>
                <option value="">Not in Vantage / other</option>
                {apps.map((a) => <option key={a.id} value={a.id}>{a.job.company} — {a.job.title}</option>)}
              </select>
            </label>
            {!draft.appId && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm font-semibold">Company<input className="input mt-1.5" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></label>
                <label className="block text-sm font-semibold">Role<input className="input mt-1.5" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
              </div>
            )}
            <label className="block text-sm font-semibold">Round
              <select className="input mt-1.5" value={draft.round} onChange={(e) => setDraft({ ...draft, round: e.target.value })}>
                {ROUNDS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="block text-sm font-semibold">Date and time<input type="datetime-local" className="input mt-1.5" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Minutes<input type="number" min={5} max={600} step={5} className="input mt-1.5" value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: +e.target.value || 30 })} /></label>
            </div>
            <label className="block text-sm font-semibold">Video link<input className="input mt-1.5" placeholder="Zoom, Meet or Teams link" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} /></label>
            <label className="block text-sm font-semibold">Location (if in person)<input className="input mt-1.5" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
            <label className="block text-sm font-semibold">Notes<textarea className="input mt-1.5 py-2.5 font-normal" rows={3} placeholder="Interviewer names, what to prepare…" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <button className="btn-primary w-full"><CalendarCheck2 size={16} /> {draft.id ? "Save changes" : "Add to calendar"}</button>
          </form>
        </Panel>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}
