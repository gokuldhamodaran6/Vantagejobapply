import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand";
import { ADMIN_EMAIL } from "@/lib/env";

type Section = { h: string; p?: string[]; list?: string[]; after?: string[] };
type Doc = { title: string; intro: string; sections: Section[] };

const CONTACT = ADMIN_EMAIL;
const UPDATED = "26 October 2026";

const DOCS: Record<string, Doc> = {
  privacy: {
    title: "Privacy Policy",
    intro:
      "This policy explains what personal information Vantage collects, why, who it's shared with, how long it's kept, and the choices and rights you have. Vantage is a job-search service that helps you find jobs, prepare applications and track your search.",
    sections: [
      {
        h: "Who we are",
        p: [
          `Vantage (“we”, “us”) is the controller of the personal information described here. For any privacy question or request, email ${CONTACT}.`,
        ],
      },
      {
        h: "Information you give us",
        list: [
          "Account details: your name, email address and password (stored securely as a hash by our authentication provider), and your confirmation that you're 18 or older.",
          "Profile: citizenship, the country you live in, phone number and LinkedIn link, if you add them.",
          "Work authorisation: your status in each country you target and whether you need visa sponsorship. We use this only to filter jobs and to prepare truthful answers for you.",
          "Job-search preferences: target roles, levels, skills, countries, cities, industries, companies and salary floor.",
          "Resumes and cover letters you paste, write or generate, and the applications you save or track, including notes and interview details.",
          "Messages you send to “Ask Vantage”.",
          "Your application profile (address, phone, links, salary expectation, optional equal-opportunity answers — which default to “decline”) and answers you give Vantage so it can reuse them.",
          "If you connect a job email: its address and an app password, which we encrypt. Vantage reads new messages in that mailbox to find employer replies, application confirmations and interview invites. It keeps only job-search messages — from careers sites, or about an application you made — and ignores everything else (it isn't stored and isn't sent to AI). For job messages we keep the sender, subject, stage, a short excerpt, any code or link, and the message text for 30 days; after 30 days the message text is deleted. Disconnecting the mailbox deletes the job messages we stored from it.",
          "Logins Vantage created on employers' careers sites earlier (email and a generated password), encrypted with a key unique to you, and a record of any site terms or privacy notices accepted on your behalf (the wording and links shown).",
          "A screenshot of each application's confirmation page, as proof it was submitted.",
        ],
      },
      {
        h: "Information collected automatically",
        list: [
          "Usage information, such as searches run, features used and when you last signed in, to keep the service working and improve it.",
          "Technical information such as browser type and IP address, processed by our hosting provider for security and reliability.",
          "Essential cookies that keep you signed in. We don't use advertising or cross-site tracking cookies.",
        ],
      },
      {
        h: "How we use your information",
        list: [
          "To provide the service: show jobs you can apply to, score matches, tailor resumes and cover letters, and track applications.",
          "To keep your account secure and prevent misuse.",
          "To understand which features help people and to fix problems, using aggregated usage data where possible.",
          "To contact you about your account and important changes to the service, including any change to early access.",
        ],
        after: ["We don't sell your personal information, and we don't use it for advertising."],
      },
      {
        h: "Legal bases (UK and EU users)",
        p: [
          "We process your information to perform our contract with you (providing the service), for our legitimate interests in running and improving a secure service, and with your consent where we ask for it. Information about your immigration status is used only because you provide it to receive visa-aware job matching, and you can delete it at any time.",
        ],
      },
      {
        h: "Who we share information with",
        p: ["We share personal information only with service providers that help us run Vantage, under contracts that limit how they can use it:"],
        list: [
          "Supabase — database and sign-in.",
          "Render — application hosting.",
          "AI providers (Anthropic, and Google's Gemini where configured) — when AI features are used, your professional history from your resume, the job text, the open-ended questions on an application form, and job-search emails we need to classify are sent to generate tailored documents and answers. We remove contact details from resumes sent for form answers. Passwords and app passwords are never sent to an AI provider. When the Chrome extension fills an application form, the AI that places answers into the form's fields sees the questions on that form and the exact answers you gave for them — including work-authorisation, sponsorship and equal-opportunity answers — so it can put each in the right field; it never chooses those answers itself. Your immigration details are otherwise kept out of AI features. Nothing sent is used to train the providers' models.",
          "Email delivery provider — to send sign-in and account emails.",
        ],
      },
      {
        h: "Employers and job applications",
        p: [
          "Vantage works only with employers' official job postings. When you press Tailor & apply, Vantage writes a resume and cover letter for that job and opens the employer's own application in your browser, where the Vantage Chrome extension fills it with your resume, cover letter, application profile and answers you've confirmed. You check it, and the application is submitted only when you press Submit or ask the extension to. The employer then receives that application and its privacy policy applies. Answers to eligibility questions (citizenship, right to work, sponsorship, criminal record, pay history, clearances, age) are only ever your own answer to that exact question.",
        ],
      },
      {
        h: "The Vantage Chrome extension",
        p: [
          "The extension fills job applications in your own Chrome when you ask it to (“Fill it here”) or send a job to your Vantage list. On the tab you choose, it reads the application form's questions and the job's title and description, and sends them to Vantage so it can fill the form with your profile, saved answers and tailored resume. It types the answers into that page. It does not read other tabs, your browsing history, passwords, or pages you haven't asked it to fill, and it never presses the final Submit unless you tell it to.",
          "It stores only a sign-in key for your Vantage account and the state of the application in progress, in your browser. Disconnecting removes the key.",
          "Limited use: information the extension handles is used only to fill and track your job applications. It is not sold, not used for advertising or credit decisions, not shared except to submit the application you asked for to that employer, and not read by people except with your permission, for security, or where the law requires. Equal-opportunity and work-authorisation answers are typed by Vantage itself and never shown to AI.",
        ],
      },
      {
        h: "International transfers",
        p: [
          "Vantage is hosted in the United States (Supabase database in the US East region; Render application hosting in the US), and our AI providers process data in the US. If you are outside the US, your information is transferred there. Where required, transfers are protected by safeguards such as standard contractual clauses. Vantage isn't yet available to residents of Québec.",
        ],
      },
      {
        h: "How long we keep information",
        p: [
          "We keep your information while your account is open, with these shorter limits: job-email message text for 30 days; full job descriptions fetched for you for 30 days. When you delete your account, your profile, preferences, resumes, applications, messages and saved logins are deleted from our live systems straight away, and from backups within 30 days. Aggregated statistics that can't identify you may be kept.",
        ],
      },
      {
        h: "Your choices and rights",
        list: [
          "Access and download your information at any time from Settings → Your data.",
          "Correct your information in your profile, targets and resumes.",
          "Delete your account and all associated data from Settings.",
          "Object to or restrict certain processing, or withdraw consent, by emailing us.",
          "Complain to your local data protection authority — for example the UK ICO, an EU supervisory authority, or India's Data Protection Board.",
        ],
        after: [
          "Depending on where you live (for example the EU, UK, California, Canada, Australia or India), you may have additional rights under local law. We honour these requests without discrimination. Email us and we'll respond within 30 days.",
        ],
      },
      {
        h: "Security",
        p: [
          "Data is encrypted in transit and at rest by our providers. Access to your data is restricted by row-level security so each account can only read its own records. Mailbox app passwords and careers-site passwords are additionally encrypted with AES-256 using a key derived for your account; they are decrypted only on our servers when Vantage needs them to read your job email or when you choose to reveal one (after confirming your identity), every reveal is logged, and they are never shown to our staff or sent to AI providers. No system is perfectly secure, so please use a strong, unique password.",
        ],
      },
      {
        h: "Children",
        p: ["Vantage is for adults aged 18 and over. We don't knowingly collect information from anyone under 18."],
      },
      {
        h: "Changes to this policy",
        p: ["If we make material changes, we'll notify you by email or in the app before they take effect."],
      },
      { h: "Contact", p: [`Questions or requests: ${CONTACT}`] },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "These terms apply to your use of Vantage. By creating an account you agree to them.",
    sections: [
      {
        h: "Early access",
        p: [
          "Vantage is currently in early access and free to use. Features may change, and the service may occasionally be unavailable while we improve it. If we introduce paid plans, we'll tell members well in advance; nothing you don't choose will be charged.",
        ],
      },
      {
        h: "Your account",
        p: [
          "You must be 18 or older and provide accurate information. Vantage isn't yet available to residents of Québec. Keep your password secure; you're responsible for activity on your account. Use Vantage only for your own job search.",
        ],
      },
      {
        h: "Honest applications",
        p: [
          "You're responsible for the content of your profile, resumes and applications, and for checking them. Vantage only uses facts you provide and never invents experience. Eligibility questions — citizenship, right to work, visa sponsorship, criminal record, pay history, security clearances and age — are answered only with your own answer to that exact question; anything worded differently is sent to you. Don't use Vantage to submit false or misleading information to employers.",
        ],
      },
      {
        h: "You apply, Vantage helps",
        p: [
          "Vantage is software you control. The Chrome extension fills application forms in your own browser on employers' official careers sites; you review each page and the application is submitted only when you press Submit or ask the extension to. It ticks a site's privacy notice or “my information is accurate” box only if you allowed it in Settings. It never types your passwords: if a site needs you to sign in or create an account, you do that on the page. Everything submitted is submitted in your name and you remain responsible for it, so keep your profile, resume and saved answers accurate.",
          "Vantage never tries to defeat security checks such as CAPTCHAs, doesn't hide that it's assisting you, and uses no proxy rotation or stealth tools. If a site shows a human check, you complete it yourself.",
        ],
      },
      {
        h: "Not legal or immigration advice",
        p: [
          "Vantage summarises public immigration rules to help you search, with links to official sources. It is not a law firm and doesn't give legal or immigration advice. Confirm your situation with official government sources or a licensed adviser.",
        ],
      },
      {
        h: "Job listings",
        p: [
          "Listings come from employers' public careers systems. We can't guarantee that a job is still open, that information in a posting is accurate, or any hiring outcome.",
          "Vantage is not an employment agency or recruiter. We don't act for employers, aren't paid by them, and don't promise jobs, interviews or responses.",
        ],
      },
      {
        h: "Acceptable use",
        p: [
          "Don't misuse the service — for example by scraping Vantage, interfering with its security, or using it to harass anyone. We may suspend accounts that break these terms.",
        ],
      },
      {
        h: "Your content",
        p: [
          "You own your resumes and other content. You give us permission to store and process it only to provide the service to you.",
        ],
      },
      {
        h: "Liability",
        p: [
          "Vantage is provided “as is” during early access. To the extent the law allows, we aren't liable for indirect losses or for decisions made by employers or immigration authorities. Nothing in these terms limits rights you have under consumer law.",
        ],
      },
      {
        h: "Ending your account",
        p: ["You can delete your account at any time from Settings. We may end the service with reasonable notice."],
      },
      { h: "Contact", p: [`Questions: ${CONTACT}`] },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  return { title: DOCS[doc]?.title || "Legal" };
}

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc];
  if (!d) notFound();
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Logo />
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/legal/privacy" className={doc === "privacy" ? "text-brand-ink" : "text-ink-2 hover:text-ink"}>Privacy</Link>
            <Link href="/legal/terms" className={doc === "terms" ? "text-brand-ink" : "text-ink-2 hover:text-ink"}>Terms</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-[34px] font-bold tracking-tight">{d.title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
        <p className="mt-6 text-[16px] leading-relaxed text-ink-2">{d.intro}</p>
        <nav aria-label="On this page" className="mt-8 rounded-xl bg-canvas p-5">
          <p className="text-sm font-semibold">On this page</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {d.sections.map((s, i) => (
              <li key={s.h}><a href={`#s${i}`} className="text-brand-ink hover:underline">{s.h}</a></li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-9">
          {d.sections.map((s, i) => (
            <section key={s.h} id={`s${i}`} className="scroll-mt-6">
              <h2 className="text-xl font-bold">{s.h}</h2>
              {s.p?.map((t) => <p key={t} className="mt-3 text-[15px] leading-relaxed text-ink-2">{t}</p>)}
              {s.list && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-2">
                  {s.list.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
              {s.after?.map((t) => <p key={t} className="mt-3 text-[15px] leading-relaxed text-ink-2">{t}</p>)}
            </section>
          ))}
        </div>
        <div className="mt-12 border-t border-line pt-6">
          <Link href="/" className="btn-secondary">Back to home</Link>
        </div>
      </main>
    </div>
  );
}
