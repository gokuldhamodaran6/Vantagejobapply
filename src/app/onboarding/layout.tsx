import { MeProvider } from "@/lib/me";

export const metadata = { title: "Set up your search", robots: { index: false } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider>{children}</MeProvider>;
}
