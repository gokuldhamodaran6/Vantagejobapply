import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { HowItWorks, Features, FinalCta } from "@/components/landing/sections";
import { CountryRules } from "@/components/landing/countries";
import { EarlyAccess } from "@/components/landing/early-access";
import { Faq, Footer } from "@/components/landing/faq";

export default function Home() {
  return (
    <>
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <CountryRules />
        <Features />
        <EarlyAccess />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
