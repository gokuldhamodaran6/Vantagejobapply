import { RESUME_STYLES } from "@/lib/resume/styles";
import type { ResumeContent, ResumeStyle } from "@/lib/types";

function H({ children, accent, center }: { children: React.ReactNode; accent: string; center: boolean }) {
  return (
    <h2 className={`mb-1.5 mt-4 border-b pb-0.5 text-[11px] font-bold tracking-[0.08em] ${center ? "text-center" : ""}`} style={{ color: accent, borderColor: accent }}>
      {children}
    </h2>
  );
}

// Same structure as the downloadable PDF: single column, real text, standard headings.
export function ResumePaper({ c, highlight = [], style = "classic" }: { c: ResumeContent; highlight?: string[]; style?: ResumeStyle }) {
  const st = (RESUME_STYLES[style] || RESUME_STYLES.classic).css;
  const hl = (text: string) => {
    if (!highlight.length) return text;
    const re = new RegExp(`(${highlight.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-[#dce7ff] px-0.5 text-inherit">{part}</mark> : part));
  };
  const contact = [c.location, c.phone, c.email, ...(c.links || [])].filter(Boolean).join("  |  ");
  const hp = { accent: st.accent, center: st.center };
  return (
    <article className="resume-paper mx-auto bg-white px-10 py-9 leading-[1.5] text-[#111]" style={{ fontFamily: st.font, maxWidth: 760, fontSize: st.body }}>
      <div className={st.center ? "text-center" : ""}>
        <h1 className="font-bold" style={{ fontSize: st.nameSize, color: st.accent }}>{c.name || "Your name"}</h1>
        {c.headline && <p className="text-[12px] text-[#333]">{c.headline}</p>}
        {contact && <p className="mt-0.5 text-[10.5px] text-[#444]">{contact}</p>}
      </div>
      {c.summary && (<><H {...hp}>SUMMARY</H><p>{hl(c.summary)}</p></>)}
      {!!c.skills?.length && (
        <>
          <H {...hp}>SKILLS</H>
          {c.skills.map((g, i) => <p key={i}><strong>{g.group}:</strong> {hl(g.items.join(", "))}</p>)}
        </>
      )}
      {!!c.experience?.length && (
        <>
          <H {...hp}>EXPERIENCE</H>
          {c.experience.map((e, i) => (
            <div key={i} className="mb-2.5">
              <div className="flex justify-between gap-3"><strong>{e.title || e.company}</strong><span className="shrink-0 text-[#333]">{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
              {(e.title ? e.company : "") || e.location ? <p className="italic text-[#444]">{[e.title ? e.company : "", e.location].filter(Boolean).join(" · ")}</p> : null}
              <ul className="mt-0.5 list-disc pl-4">{e.bullets.map((b, j) => <li key={j}>{hl(b)}</li>)}</ul>
            </div>
          ))}
        </>
      )}
      {!!c.projects?.length && (
        <>
          <H {...hp}>PROJECTS</H>
          {c.projects.map((p, i) => (
            <div key={i} className="mb-2">
              <strong>{p.name}</strong>{p.tech ? ` (${p.tech})` : ""}
              <ul className="list-disc pl-4">{p.bullets.map((b, j) => <li key={j}>{hl(b)}</li>)}</ul>
            </div>
          ))}
        </>
      )}
      {!!c.education?.length && (
        <>
          <H {...hp}>EDUCATION</H>
          {c.education.map((e, i) => (
            <div key={i} className="mb-1">
              <div className="flex justify-between gap-3"><strong>{e.degree || e.school}</strong><span className="shrink-0">{e.end}</span></div>
              <p className="text-[#444]">{[e.degree ? e.school : "", e.location].filter(Boolean).join(" · ")}{e.details ? `. ${e.details}` : ""}</p>
            </div>
          ))}
        </>
      )}
      {!!c.certifications?.length && (<><H {...hp}>CERTIFICATIONS</H><p>{c.certifications.join("  •  ")}</p></>)}
      {!!c.awards?.length && (<><H {...hp}>AWARDS</H><ul className="list-disc pl-4">{c.awards.map((a, i) => <li key={i}>{a}</li>)}</ul></>)}
      {!!c.additional?.length && (<><H {...hp}>ADDITIONAL</H><ul className="list-disc pl-4">{c.additional.map((a, i) => <li key={i}>{a}</li>)}</ul></>)}
    </article>
  );
}
