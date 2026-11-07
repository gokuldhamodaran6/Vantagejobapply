import { GlassNav, KeptTrue, FinalCall } from "@/components/landing/v2/sections";
import { Hero } from "@/components/landing/v4/hero";
import { Features, HowItWorks, Platforms, Promises } from "@/components/landing/v4/sections";
import { CountryRules } from "@/components/landing/countries";
import { Faq, Footer } from "@/components/landing/faq";
import { MobileCta } from "@/components/landing/v3/mobile-cta";

export default function Home() {
  return (
    <div className="lp flex min-h-screen flex-col overflow-x-clip">
      <GlassNav />
      <main className="flex-1">
        <Hero />
        <Platforms />
        <HowItWorks />
        <Features />
        <KeptTrue />
        <CountryRules />
        <Promises />
        <Faq />
        <FinalCall />
      </main>
      <Footer />
      <MobileCta />
    </div>
  );
}
