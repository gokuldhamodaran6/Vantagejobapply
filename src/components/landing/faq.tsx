import Link from "next/link";
import { Logo } from "@/components/brand";

const FAQ = [
  {
    q: "Can someone from India apply for sponsored jobs in the UK, US, Canada or Australia?",
    a: "Yes. You set your citizenship and where you want to work, and Vantage only shows jobs that can legally hire you — for example, UK employers on the licensed sponsor register for degree-level roles. If your occupation isn't eligible for sponsorship in that country (UK lorry drivers, for instance), Vantage tells you plainly instead of wasting your applications.",
  },
  {
    q: "Where do the jobs come from, and how fresh are they?",
    a: "Directly from employers' career sites (Greenhouse, Lever, Ashby and more) and from job search partners covering the US, UK, Canada, Australia, India and more. Feeds refresh continuously; most jobs you see are hours old.",
  },
  {
    q: "Will Vantage lie on my application to get me through?",
    a: "Never. Your work-authorization answers are saved once and used truthfully everywhere, and resumes are written only from experience you've confirmed. Recruiters check — honesty is what gets you hired and keeps you hired.",
  },
  {
    q: "Does my resume pass ATS software?",
    a: "Each resume uses the single-column, standard-heading format that applicant tracking systems parse reliably, and is checked against the keywords in your target jobs. No tool can guarantee a pass, but these are the factors that decide it.",
  },
  {
    q: "Does the agent apply for me automatically?",
    a: "On Autopilot, the agent prepares and queues applications for you every day — tailored resume, cover letter and answers — and you choose whether it submits on its own or waits for your approval. On Pro, you submit with one click.",
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
          <a href="#pricing" className="text-ink-2 hover:text-ink">Pricing</a>
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
