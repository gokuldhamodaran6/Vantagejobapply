import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { HowItWorks, Features, FinalCta } from "@/components/landing/sections";
import { CountryRules } from "@/components/landing/countries";
import { Pricing } from "@/components/landing/pricing";
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
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
