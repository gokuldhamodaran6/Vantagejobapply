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
          "Account details: your name, email address and password (stored securely as a hash by our authentication provider).",
          "Profile: citizenship, the country you live in, phone number and LinkedIn link, if you add them.",
          "Work authorisation: your status in each country you target and whether you need visa sponsorship. We use this only to filter jobs and to prepare truthful answers for you.",
          "Job-search preferences: target roles, levels, skills, countries, cities, industries, companies and salary floor.",
          "Resumes and cover letters you paste, write or generate, and the applications you save or track, including notes and interview details.",
          "Messages you send to “Ask your agent”.",
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
          "Anthropic — when AI features are used, the relevant resume and job text is sent to generate tailored documents and answers. It isn't used to train their models.",
          "Email delivery provider — to send sign-in and account emails.",
        ],
      },
      {
        h: "Employers and job applications",
        p: [
          "Vantage links you to employers' official job postings. When you apply, you submit your application on the employer's own site, and the employer's privacy policy then applies to what you give them. Vantage doesn't send your information to employers on its own.",
        ],
      },
      {
        h: "International transfers",
        p: [
          "Our providers may store and process information in the United States and other countries. Where required, transfers are protected by safeguards such as standard contractual clauses.",
        ],
      },
      {
        h: "How long we keep information",
        p: [
          "We keep your information while your account is open. When you delete your account, your profile, preferences, resumes, applications and messages are deleted from our live systems straight away, and from backups within 30 days. Aggregated statistics that can't identify you may be kept.",
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
          "Data is encrypted in transit and at rest by our providers. Access to your data is restricted by row-level security so each account can only read its own records. No system is perfectly secure, so please use a strong, unique password.",
        ],
      },
      {
        h: "Children",
        p: ["Vantage is for people aged 16 and over. We don't knowingly collect information from children."],
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
          "You must be at least 16 and provide accurate information. Keep your password secure; you're responsible for activity on your account. Use Vantage only for your own job search.",
        ],
      },
      {
        h: "Honest applications",
        p: [
          "You're responsible for the content of your profile, resumes and applications. Vantage only uses facts you provide and never invents experience or changes your work-authorisation answers. Don't use Vantage to submit false or misleading information to employers.",
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
