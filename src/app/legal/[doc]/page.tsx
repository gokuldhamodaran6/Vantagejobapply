import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand";

const DOCS: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms of Service",
    body: [
      "Vantage helps you find jobs, prepare applications and track your job search. By creating an account you agree to use it for your own job search and to provide accurate information about yourself.",
      "You are responsible for the information in your profile, resumes and applications. Vantage only uses facts you provide and never invents experience or changes your work-authorisation answers.",
      "Vantage summarises public immigration rules to help you search. It is not a law firm and does not give legal or immigration advice. Confirm your situation with official government sources or a licensed adviser.",
      "Job listings come from employers' public careers systems. Vantage does not guarantee that a job is still open, that an employer will respond, or any hiring outcome.",
      "Paid plans renew automatically until cancelled. You can cancel anytime from Settings; access continues until the end of the paid period.",
      "We may suspend accounts that misuse the service, including automated scraping of Vantage or submitting false information to employers.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      "We store the information you give us — your profile, work-authorisation answers, target roles, resumes and applications — to provide the service. We never sell your personal data.",
      "Your data is stored with our infrastructure providers (Supabase for the database and authentication, Render for hosting). Payments are processed by Stripe; we don't store card details.",
      "When AI features are enabled, the relevant resume and job text is sent to our AI provider to generate tailored resumes and cover letters, and is not used to train their models under our agreement.",
      "You can download all your data or permanently delete your account at any time from Settings.",
      "We use only essential cookies to keep you signed in.",
      "Contact the account owner listed in the app for any privacy request.",
    ],
  },
};

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc];
  if (!d) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Logo />
      <h1 className="mt-10 text-3xl font-bold tracking-tight">{d.title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated October 2026. Have a lawyer review these before launch.</p>
      <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-2">{d.body.map((p, i) => <p key={i}>{p}</p>)}</div>
      <Link href="/" className="btn-secondary mt-10">Back to home</Link>
    </div>
  );
}
