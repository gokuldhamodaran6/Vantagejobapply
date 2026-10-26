import type { ResumeContent } from "@/lib/types";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1.5 mt-4 border-b border-black pb-0.5 text-[11px] font-bold tracking-[0.08em]">{children}</h2>;
}

// Industry-standard, single-column, ATS-parsable layout. Same markup is used for screen and print.
export function ResumePaper({ c, highlight = [] }: { c: ResumeContent; highlight?: string[] }) {
  const hl = (text: string) => {
    if (!highlight.length) return text;
    const re = new RegExp(`(${highlight.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-[#dce7ff] px-0.5 text-inherit">{part}</mark> : part));
  };
  const contact = [c.location, c.phone, c.email, ...(c.links || [])].filter(Boolean).join("  |  ");
  return (
    <article className="resume-paper mx-auto bg-white px-10 py-9 text-[11.5px] leading-[1.5] text-[#111]" style={{ fontFamily: "Arial, Helvetica, sans-serif", maxWidth: 760 }}>
      <h1 className="text-[22px] font-bold">{c.name || "Your name"}</h1>
      {c.headline && <p className="text-[12px]">{c.headline}</p>}
      {contact && <p className="mt-0.5 text-[10.5px] text-[#333]">{contact}</p>}
      {c.summary && (<><H>SUMMARY</H><p>{hl(c.summary)}</p></>)}
      {!!c.skills?.length && (
        <>
          <H>SKILLS</H>
          {c.skills.map((g, i) => <p key={i}><strong>{g.group}:</strong> {hl(g.items.join(", "))}</p>)}
        </>
      )}
      {!!c.experience?.length && (
        <>
          <H>EXPERIENCE</H>
          {c.experience.map((e, i) => (
            <div key={i} className="mb-2.5">
              <div className="flex justify-between gap-3"><strong>{e.title}{e.company ? `, ${e.company}` : ""}{e.location ? ` — ${e.location}` : ""}</strong><span className="shrink-0">{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
              <ul className="mt-0.5 list-disc pl-4">{e.bullets.map((b, j) => <li key={j}>{hl(b)}</li>)}</ul>
            </div>
          ))}
        </>
      )}
      {!!c.projects?.length && (
        <>
          <H>PROJECTS</H>
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
          <H>EDUCATION</H>
          {c.education.map((e, i) => (
            <div key={i} className="flex justify-between gap-3"><span><strong>{e.degree}</strong>{e.school ? ` — ${e.school}` : ""}{e.location ? `, ${e.location}` : ""}{e.details ? `. ${e.details}` : ""}</span><span className="shrink-0">{e.end}</span></div>
          ))}
        </>
      )}
      {!!c.certifications?.length && (<><H>CERTIFICATIONS</H><p>{c.certifications.join(" · ")}</p></>)}
    </article>
  );
}
