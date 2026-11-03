import { GlassNav, KeptTrue, Kit, FinalCall } from "@/components/landing/v2/sections";
import { Journey } from "@/components/landing/journey/journey";
import { Story } from "@/components/landing/v2/story";
import { CountryRules } from "@/components/landing/countries";
import { Faq, Footer } from "@/components/landing/faq";
import { MobileCta } from "@/components/landing/v3/mobile-cta";

export default function Home() {
  return (
    <div className="lp flex min-h-screen flex-col overflow-x-clip">
      <GlassNav />
      <main className="flex-1">
        <Journey />
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
