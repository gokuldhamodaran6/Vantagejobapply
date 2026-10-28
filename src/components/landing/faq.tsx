import Link from "next/link";
import { Logo } from "@/components/brand";

const FAQ = [
  {
    q: "Is Vantage free?",
    a: "Yes. Vantage is free for everyone during early access, with every feature unlocked and no credit card. If that ever changes, members will hear about it well in advance.",
  },
  {
    q: "Can someone from India apply for sponsored jobs in the UK, US, Canada or Australia?",
    a: "Yes. You set your citizenship and where you want to work, and Vantage filters out jobs that say they can't hire you — for example, it checks UK employers on the licensed sponsor register for degree-level roles. If your occupation isn't eligible for sponsorship in that country (UK lorry drivers, for instance), Vantage tells you plainly instead of wasting your applications.",
  },
  {
    q: "Where do the jobs come from, and how fresh are they?",
    a: "Only from employers' own official careers systems — Greenhouse, Lever, Ashby, Workday, Workable, Recruitee, Personio, Teamtailor, Rippling, BambooHR and more. Every Apply button opens the company's official posting, never a middleman job board. Each company's feed is re-read every few hours (every 15 minutes for companies you target), and closed jobs are removed.",
  },
  {
    q: "Will Vantage lie on my application to get me through?",
    a: "No. Eligibility questions — work authorization, sponsorship, citizenship, criminal record, pay history — are only ever answered with your own answer to that exact question; anything worded differently comes to you. Resumes are written only from experience you've confirmed. You check every application and press Submit yourself.",
  },
  {
    q: "Does my resume pass ATS software?",
    a: "Each resume uses the single-column, standard-heading format that applicant tracking systems parse reliably, and is checked against the keywords in your target jobs. No tool can guarantee a pass, but these are the factors that decide it.",
  },
  {
    q: "How do I apply?",
    a: "Press Tailor & apply on a job. Vantage writes a resume and cover letter for that job, opens the employer's official application, and the Vantage Chrome extension fills it in seconds — page by page, attaching the resume made for this job. You check it and press Submit (or tell Vantage to press it); it's recorded in your Applications. Vantage never submits without your say-so, never types your passwords and never tries to get around security checks. It doesn't promise interviews; it gives every application its best, honest shot.",
  },
  {
    q: "Is this immigration advice?",
    a: "No. Vantage summarises official rules to help you search and links to the official sources. For your specific case, confirm with the government website or a licensed immigration adviser.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Questions people ask first</h2>
          <p className="mt-4 text-lg text-muted">Anything else? Email us from inside the app.</p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[17px] font-semibold">
                {f.q}
                <span className="mt-1 text-xl leading-none text-brand transition group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-8 px-4 sm:px-6">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-muted">Jobs abroad that can actually hire you.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <a href="#features" className="text-ink-2 hover:text-ink">Features</a>
          <Link href="/legal/terms" className="text-ink-2 hover:text-ink">Terms</Link>
          <a href="#early-access" className="text-ink-2 hover:text-ink">Early access</a>
          <Link href="/legal/privacy" className="text-ink-2 hover:text-ink">Privacy</Link>
          <a href="#countries" className="text-ink-2 hover:text-ink">Countries</a>
          <Link href="/login" className="text-ink-2 hover:text-ink">Log in</Link>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-6xl px-4 text-xs text-subtle sm:px-6">
        © {new Date().getFullYear()} Vantage. Vantage is not a law firm and does not give immigration advice. Some jobs powered by Adzuna.
      </p>
    </footer>
  );
}
