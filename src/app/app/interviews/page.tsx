"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, Clock, Download, ExternalLink, Mail, Plus, Sparkles, Video, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { CalendarView } from "@/components/calendar/calendar-view";
import { EventSheet } from "@/components/calendar/event-sheet";
import { Sheet } from "@/components/calendar/sheet";
import { calDetails, calTitle, toEvents, toneOf, type Interview } from "@/components/calendar/shared";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, tintFor } from "@/lib/format";
import { downloadIcs, guessRound, ROUNDS, toLocalInput } from "@/lib/calendar";
import { isAllDay } from "@/lib/calendar-grid";
import type { MailEvent } from "@/lib/mail-event";
import type { Application } from "@/lib/types";

type Suggestion = { id: string; subject: string; from_name: string; company: string | null; received_at: string; application_id: string | null; event: MailEvent };
type Draft = { id?: string; appId: string; company: string; title: string; round: string; when: string; minutes: number; allDay: boolean; link: string; location: string; notes: string; inboxId?: string };

const ALL_DAY_MIN = 24 * 60;

function newDraft(at?: Date, extra: Partial<Draft> = {}, allDay = false): Draft {
  const d = at ? new Date(at) : new Date(Date.now() + 864e5);
  if (allDay) return { appId: "", company: "", title: "", round: "Assessment", when: toLocalInput(d).slice(0, 10), minutes: ALL_DAY_MIN, allDay: true, link: "", location: "", notes: "", ...extra };
  if (!at) d.setHours(10, 0, 0, 0);
  return { appId: "", company: "", title: "", round: "Recruiter screen", when: toLocalInput(d), minutes: 45, allDay: false, link: "", location: "", notes: "", ...extra };
}

function editDraft(i: Interview): Draft {
  const allDay = isAllDay(i.minutes);
  const at = new Date(i.starts_at);
  return {
    id: i.id, appId: i.application_id || "", company: i.company, title: i.title || "", round: i.round, allDay,
    when: allDay ? toLocalInput(at).slice(0, 10) : toLocalInput(at), minutes: i.minutes, link: i.link || "", location: i.location || "", notes: i.notes || "",
  };
}

/** Flip a draft between a timed interview and an all-day item (e.g. an assessment deadline). */
function setAllDay(d: Draft, on: boolean): Draft {
  if (on) return { ...d, allDay: true, when: d.when.slice(0, 10), minutes: Math.max(ALL_DAY_MIN, Math.round(d.minutes / ALL_DAY_MIN) * ALL_DAY_MIN) };
  return { ...d, allDay: false, when: `${d.when.slice(0, 10)}T10:00`, minutes: 45 };
}

const icsOf = (i: Interview) => ({ id: i.id, title: calTitle(i), start: new Date(i.starts_at), minutes: i.minutes, details: calDetails(i), location: i.link || i.location || "", allDay: isAllDay(i.minutes) });
const whenText = (i: Interview, weekday: "long" | "short") => isAllDay(i.minutes)
  ? `${new Date(i.starts_at).toLocaleDateString(undefined, { weekday, month: "short", day: "numeric" })} · All day`
  : new Date(i.starts_at).toLocaleString(undefined, { weekday, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function InterviewsPage() {
  const { userId } = useMe();
  const [items, setItems] = useState<Interview[] | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [suggest, setSuggest] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<Interview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!userId) return;
    const s = supabaseBrowser();
    const [iv, ap, mail] = await Promise.all([
      s.from("interviews").select("*").order("starts_at"),
      s.from("applications").select("id,job,status,events,updated_at").eq("user_id", userId).in("status", ["applied", "in_review", "assessment", "interview", "offer"]).order("updated_at", { ascending: false }).limit(500),
      s.from("inbox_messages").select("id,subject,from_name,company,received_at,application_id,event").eq("kind", "interview").not("event", "is", null).order("received_at", { ascending: false }).limit(30),
    ]);
    const list = (iv.data as Interview[]) || [];
    setItems(list);
    setApps((ap.data as Application[]) || []);
    const used = new Set(list.map((x) => x.inbox_message_id).filter(Boolean));
    setSuggest(((mail.data as Suggestion[]) || []).filter((m) => !used.has(m.id) && !m.event?.dismissed && (!m.event.start || Date.parse(m.event.start) > Date.now() - 864e5)));
    setNow(Date.now());
  }, [userId]);
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
  }, [apps]);

  const live = useMemo(() => (items || []).filter((i) => i.status !== "cancelled"), [items]);
  const events = useMemo(() => toEvents(live), [live]);
  const upcoming = live.filter((i) => Date.parse(i.starts_at) + i.minutes * 60000 >= now && i.status === "scheduled");
  const next = upcoming.find((i) => !isAllDay(i.minutes)) || upcoming[0];
  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const create = useCallback((at?: Date, allDay?: boolean) => setDraft(newDraft(at, {}, Boolean(allDay))), []);

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
    // "2026-10-28T00:00" (no zone) is read as the viewer's local time.
    const start = new Date(d.allDay ? `${d.when.slice(0, 10)}T00:00` : d.when);
    if (isNaN(start.getTime())) return setToast("Pick a valid date and time.");
    const row = {
      user_id: userId, application_id: app?.id || null, company, title: app?.job.title || d.title || null, round: d.round,
      starts_at: start.toISOString(), minutes: d.allDay ? Math.max(ALL_DAY_MIN, d.minutes) : d.minutes, link: d.link.trim() || null, location: d.location.trim() || null,
      notes: d.notes.trim() || null, source: d.inboxId ? "email" : "manual", inbox_message_id: d.inboxId || null, updated_at: new Date().toISOString(),
    };
    const res = d.id ? await s.from("interviews").update(row).eq("id", d.id) : await s.from("interviews").insert(row);
    if (res.error) return setToast(res.error.message);
    // The application moves to Interview and its timeline records the round.
    if (app && !d.id) {
      const when = d.allDay ? start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const events = [...(app.events || []), { at: new Date().toISOString(), type: "interview_scheduled", text: `${d.round} scheduled for ${when}` }];
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

  const countdown = (iso: string) => {
    const ms = Date.parse(iso) - now;
    if (ms < 0) return "Happening now";
    const h = Math.round(ms / 3600000);
    if (h < 1) return `In ${Math.max(1, Math.round(ms / 60000))} min`;
    if (h < 36) return `In ${h} hours`;
    return `In ${Math.round(h / 24)} days`;
  };
  const in30 = upcoming.filter((i) => Date.parse(i.starts_at) < now + 30 * 864e5).length;
  const openApp = open?.application_id ? appById.get(open.application_id) || { id: open.application_id, job: { title: open.title || "Role", company: open.company } } : null;

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle="Your interview calendar. Invites in your job email show up here to confirm in one click."
        actions={<>
          {upcoming.length > 0 && <button className="btn-secondary" onClick={() => downloadIcs(upcoming.map(icsOf))}><Download size={16} /> Export all (.ics)</button>}
          <button className="btn-primary" onClick={() => create()} aria-keyshortcuts="c"><Plus size={16} /> Add interview</button>
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
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold"><Clock size={15} className="text-brand" />
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

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <CalendarView events={events} loading={items === null} paused={Boolean(open || draft)} onOpen={setOpen} onCreate={create} />

        <aside className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
          {next ? (
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-br from-brand to-pink p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Next interview · {countdown(next.starts_at)}</p>
                <p className="mt-2 text-xl font-bold">{next.company}</p>
                <p className="text-sm opacity-90">{next.round}{next.title ? ` · ${next.title}` : ""}</p>
                <p className="mt-3 text-sm font-semibold">{whenText(next, "long")}</p>
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
              <p className="mt-1 text-sm text-muted">When a company invites you, the email shows up above to confirm. You can also click any time on the calendar to add one.</p>
            </div>
          )}
          <div className="card p-5">
            <p className="text-sm font-semibold">At a glance</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Next 30 days", in30],
                ["Done", live.filter((i) => i.status === "done").length],
                ["Companies", new Set(live.map((i) => i.company)).size],
              ].map(([l, n]) => (
                <div key={l as string} className="rounded-xl bg-canvas py-3"><p className="text-xl font-bold">{n}</p><p className="text-xs text-muted">{l}</p></div>
              ))}
            </div>
          </div>
          {upcoming.length > 1 && (
            <div className="card p-4 md:col-span-2 2xl:col-span-1">
              <p className="mb-2 px-1 text-sm font-semibold">Coming up</p>
              <ul className="space-y-1">
                {upcoming.filter((i) => i.id !== next?.id).slice(0, 5).map((i) => (
                  <li key={i.id}><button onClick={() => setOpen(i)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-canvas">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: toneOf(i.round).bar }} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{i.company} <span className="font-normal text-muted">· {i.round}</span></span><span className="block truncate text-xs text-muted">{whenText(i, "short")}</span></span>
                  </button></li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {open && (
        <EventSheet
          iv={open}
          app={openApp}
          now={now}
          onClose={() => setOpen(null)}
          onEdit={() => { setDraft(editDraft(open)); setOpen(null); }}
          onDone={() => setStatus(open, "done")}
          onCancel={() => setStatus(open, "cancelled")}
        />
      )}

      {draft && (
        <Sheet onClose={() => setDraft(null)} title={draft.id ? "Edit interview" : draft.inboxId ? "Confirm interview" : "Add interview"} accent={toneOf(draft.round).bar}>
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
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-[#2f5beb]" checked={draft.allDay} onChange={(e) => setDraft(setAllDay(draft, e.target.checked))} />
              All day (for example an assessment deadline)
            </label>
            {draft.allDay ? (
              <label className="block text-sm font-semibold">Date<input type="date" className="input mt-1.5" value={draft.when.slice(0, 10)} onChange={(e) => setDraft({ ...draft, when: e.target.value })} /></label>
            ) : (
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <label className="block text-sm font-semibold">Date and time<input type="datetime-local" className="input mt-1.5" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} /></label>
                <label className="block text-sm font-semibold">Minutes<input type="number" min={5} max={600} step={5} className="input mt-1.5" value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: +e.target.value || 30 })} /></label>
              </div>
            )}
            <label className="block text-sm font-semibold">Video link<input className="input mt-1.5" placeholder="Zoom, Meet or Teams link" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} /></label>
            <label className="block text-sm font-semibold">Location (if in person)<input className="input mt-1.5" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
            <label className="block text-sm font-semibold">Notes<textarea className="input mt-1.5 py-2.5 font-normal" rows={3} placeholder="Interviewer names, what to prepare…" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <button className="btn-primary w-full"><CalendarCheck2 size={16} /> {draft.id ? "Save changes" : "Add to calendar"}</button>
          </form>
        </Sheet>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
