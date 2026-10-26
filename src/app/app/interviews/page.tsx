"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarPlus, Download } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Application } from "@/lib/types";

type Ev = { at: string; type: string; text: string; when?: string; minutes?: number; link?: string; round?: string };

function gcalUrl(title: string, start: Date, minutes: number, details: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(start.getTime() + minutes * 60000);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent(details)}`;
}
function ics(title: string, start: Date, minutes: number, details: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(start.getTime() + minutes * 60000);
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vantage//EN", "BEGIN:VEVENT", `UID:${start.getTime()}@vantage`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${title}`, `DESCRIPTION:${details.replace(/\n/g, "\\n")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  a.download = "interview.ics";
  a.click();
}

export default function InterviewsPage() {
  const { userId } = useMe();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [form, setForm] = useState({ appId: "", when: "", minutes: 45, round: "Recruiter screen", link: "" });
  const [toast, setToast] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  async function load() {
    const { data } = await supabaseBrowser().from("applications").select("*").in("status", ["applied", "in_review", "interview", "offer"]).order("updated_at", { ascending: false });
    setApps((data as Application[]) || []);
  }
  useEffect(() => {
    if (userId) load();
  }, [userId]);

  const upcoming = (apps || [])
    .flatMap((a) => ((a.events || []) as Ev[]).filter((e) => e.type === "interview_scheduled" && e.when).map((e) => ({ a, e })))
    .sort((x, y) => Date.parse(x.e.when!) - Date.parse(y.e.when!));

  async function add() {
    const a = apps?.find((x) => x.id === form.appId);
    if (!a || !form.when) return setToast("Choose the application and the date and time.");
    const ev: Ev = { at: new Date().toISOString(), type: "interview_scheduled", text: `${form.round} scheduled`, when: new Date(form.when).toISOString(), minutes: form.minutes, link: form.link, round: form.round };
    const { error } = await supabaseBrowser().from("applications").update({ status: "interview", events: [...(a.events || []), ev] }).eq("id", a.id);
    if (error) return setToast(error.message);
    setToast("Interview added");
    setForm({ ...form, appId: "", when: "", link: "" });
    load();
  }

  return (
    <>
      <PageHeader title="Interviews" subtitle="Every interview in one place, ready to add to your calendar." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          {apps && upcoming.length === 0 && <EmptyState title="No interviews scheduled yet" body="When a company invites you, add it here — or move an application to Interview." />}
          <ul className="space-y-3">
            {upcoming.map(({ a, e }, i) => {
              const start = new Date(e.when!);
              const past = start.getTime() < now;
              const details = `${a.job.title} at ${a.job.company}\n${e.link || ""}\nPosting: ${a.job.url}`;
              return (
                <li key={i} className={`card flex flex-wrap items-center gap-4 p-4 ${past ? "opacity-60" : ""}`}>
                  <div className="w-16 shrink-0 rounded-lg bg-pink-tint py-2 text-center text-pink-ink">
                    <p className="text-[11px] font-bold uppercase">{start.toLocaleDateString(undefined, { weekday: "short" })}</p>
                    <p className="text-xl font-bold">{start.getDate()}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.job.company} · {e.round}</p>
                    <p className="text-sm text-muted">{a.job.title} · {start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {e.minutes} min</p>
                    {e.link && <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-ink">Meeting link</a>}
                  </div>
                  <div className="flex gap-2">
                    <a className="btn-secondary min-h-9 text-[13px]" href={gcalUrl(`Interview: ${a.job.company}`, start, e.minutes || 45, details)} target="_blank" rel="noopener noreferrer"><CalendarPlus size={15} /> Google</a>
                    <button className="btn-secondary min-h-9 text-[13px]" onClick={() => ics(`Interview: ${a.job.company}`, start, e.minutes || 45, details)}><Download size={15} /> .ics</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="card h-fit p-5">
          <h2 className="font-semibold">Add an interview</h2>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-semibold">Application
              <select className="input mt-1.5" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })}>
                <option value="">Choose…</option>
                {(apps || []).map((a) => <option key={a.id} value={a.id}>{a.job.company} — {a.job.title}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Round
              <select className="input mt-1.5" value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })}>
                {["Recruiter screen", "Technical interview", "Hiring manager", "Panel", "Final round", "Assessment"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="block text-sm font-semibold">Date and time<input type="datetime-local" className="input mt-1.5" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Minutes<input type="number" min={10} step={5} className="input mt-1.5" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: +e.target.value })} /></label>
            </div>
            <label className="block text-sm font-semibold">Meeting link (optional)<input className="input mt-1.5" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></label>
            <button className="btn-primary w-full" onClick={add}>Add interview</button>
          </div>
          <p className="mt-4 text-sm text-muted">Tip: ask your agent to <Link href="/app/assistant?q=Prepare%20me%20for%20my%20next%20interview" className="font-semibold text-brand-ink">prepare you</Link> for any interview.</p>
        </section>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
