import { GlassNav, KeptTrue, Kit, FinalCall } from "@/components/landing/v2/sections";
import { PrismHero } from "@/components/landing/v2/prism-hero";
import { Story } from "@/components/landing/v2/story";
import { CountryRules } from "@/components/landing/countries";
import { Faq, Footer } from "@/components/landing/faq";
import { MobileCta } from "@/components/landing/v3/mobile-cta";

export default function Home() {
  return (
    <div className="lp flex min-h-screen flex-col">
      <GlassNav />
      <main className="flex-1">
        <PrismHero />
        <Story />
        <KeptTrue />
        <CountryRules />
        <Kit />
        <Faq />
        <FinalCall />
      </main>
      <Footer />
      <MobileCta />
    </div>
  );
}
